import test from 'node:test';
import assert from 'node:assert/strict';
import { GpsFeedCache, gpsResponse, gpsError } from '../scripts/gps-cache.mjs';
import { GpsFeed, handleRequest } from '../scripts/gps-worker.js';
import { ElronFeedCache } from '../scripts/elron-feed.mjs';
import { dataStatus } from '../src/data-status.js';
import { liveMetadata, liveDataState } from '../src/live-data.js';

const start = Date.parse('2026-10-30T08:00:00Z');
const csv = '3,T2,24740000,59438000,,138,501,Z,179,Lennujaam';
const request = (path = 'vehicles', headers = {}, method = 'GET') => new Request(`https://relay.test/${path}`, { headers, method });
function fixture() {
  let now = start, broken = false, calls = 0, saved;
  const logs = [];
  const feed = new GpsFeedCache({ now: () => now, log: entry => logs.push(entry),
    storage: { put: async (_, state) => { saved = structuredClone(state); } },
    fetch: async () => { calls++;return broken ? new Response('bad gateway', { status: 502 })
      : new Response(csv, { headers: { 'Last-Modified': new Date(now).toUTCString() } }); } });
  return { feed, logs, calls: () => calls, saved: () => saved, now: () => now,
    advance: ms => { now += ms; }, break: value => { broken = value; } };
}

test('fresh/stale/unavailable boundaries use original data age', () => {
  for (const [seconds, expected] of [[0,'fresh'],[60,'fresh'],[61,'stale'],[180,'stale'],[181,'unavailable']]) {
    assert.equal(dataStatus(start, start + seconds * 1000).status, expected);
  }
  assert.equal(dataStatus(undefined, start).status, 'unavailable');
  assert.equal(dataStatus(start, start + 10000, 'timeout').status, 'stale');
});

test('fallback survives restart, expires after 180 seconds, then recovers', async () => {
  const f = fixture();const first = await f.feed.get();f.break(true);f.advance(10000);
  const fallback = await f.feed.get(), response = gpsResponse(fallback, request(), { now: f.now() });
  assert.equal(response.status, 200);assert.equal(response.headers.get('X-Data-Status'), 'stale');
  assert.equal(response.headers.get('X-Upstream-Error'), 'upstream_5xx');
  assert.equal(response.headers.get('X-Data-Age'), '10');assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(fallback.validatedAt, first.validatedAt);
  await Promise.all(Array.from({ length: 100 }, () => f.feed.get()));assert.equal(f.calls(), 2);
  const restored = new GpsFeedCache({ state: f.saved(), now: f.now, fetch: () => assert.fail('cooldown must survive restart') });
  assert.equal((await restored.get()).upstreamError, 'upstream_5xx');
  f.advance(171000);
  let failure;try { await f.feed.get(); } catch (error) { failure = error; }
  assert(failure);const unavailable = gpsError(failure, request('vehicles', { 'If-None-Match': first.vehiclesEtag }), { now: f.now() });
  assert.equal(unavailable.status, 503);assert.equal(unavailable.headers.get('X-Data-Age'), '181');
  assert.equal(unavailable.headers.get('X-Data-Timestamp'), new Date(start).toISOString());
  assert(!((await unavailable.text()).includes('vehicles')));
  f.break(false);f.advance(10000);const recovered = gpsResponse(await f.feed.get(), request(), { now: f.now() });
  assert.equal(recovered.headers.get('X-Data-Status'), 'fresh');assert.equal(recovered.headers.get('X-Upstream-Error'), 'none');
});

test('an unchanged 200 or 304 without source timestamps cannot renew old locations', async () => {
  for (const status of [200,304]) {
    let now = start, calls = 0;
    const feed = new GpsFeedCache({ now: () => now, fetch: async () => ++calls === 1 || status === 200 ? new Response(csv) : new Response(null, { status: 304 }) });
    await feed.get();now += 181000;const next = await feed.get();
    assert.equal(next.observedAt, start);assert.equal(next.validatedAt, now);
    assert.equal(gpsResponse(next, request(), { now }).status, 503);assert.equal(feed.health().status, 'unavailable');
  }
});

test('successfully fetched but old source data is stale, then withheld even on conditionals/HEAD', async () => {
  const f = fixture();const snapshot = await f.feed.get();
  f.advance(61000);assert.equal(gpsResponse(snapshot, request(), { now: f.now() }).headers.get('X-Data-Status'), 'stale');
  f.advance(120000);
  for (const method of ['GET','HEAD']) {
    const res = gpsResponse(snapshot, request('vehicles', { 'If-None-Match': snapshot.vehiclesEtag }, method), { now: f.now() });
    assert.equal(res.status, 503);assert.equal(res.headers.get('Cache-Control'), 'no-store');
    if (method === 'HEAD') assert.equal(await res.text(), '');
  }
});

test('structured logs distinguish timeout, 5xx, malformed, network and internal failures', async () => {
  for (const [fetcher, expected] of [
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, 'timeout'],
    [async () => new Response('failed', { status: 503 }), 'upstream_5xx'],
    [async () => new Response('<html>bad</html>'), 'invalid_response'],
    [async () => new Response('3,broken'), 'invalid_response'],
    [async () => { throw new TypeError('failed fetch'); }, 'network_error'],
  ]) {
    let now = start;const logs = [];
    const feed = new GpsFeedCache({ now: () => now, log: entry => logs.push(entry), fetch: async () => { now += 120;return fetcher(); } });
    await assert.rejects(() => feed.get());assert.equal(logs[0].errorClass, expected);assert.equal(logs[0].durationMs, 120);
    assert.equal(feed.health().upstreamError, expected);assert.equal(feed.health().status, 'unavailable');
  }
  const logs = [], feed = new GpsFeedCache({ now: () => start, log: entry => logs.push(entry), storage: { put: async () => { throw new Error('storage failed'); } }, fetch: () => assert.fail() });
  await assert.rejects(() => feed.get());assert.equal(logs[0].errorClass, 'internal_error');
});

test('valid empty responses are successful empty observations, with separate log outcomes', async () => {
  for (const Cache of [GpsFeedCache, ElronFeedCache]) {
    const logs = [];let now = start;
    const feed = new Cache({ now: () => now, log: entry => logs.push(entry), fetch: async () => new Response(Cache === GpsFeedCache ? '' : '{"data":[]}') });
    const snapshot = await feed.get();
    assert.deepEqual(JSON.parse(snapshot.vehiclesBody).vehicles, []);
    assert.equal(feed.health().status, 'fresh');assert.equal(feed.health().vehicleCount, 0);
    assert.equal(logs[0].outcome, 'empty');assert.equal(logs[0].reason, 'empty_response');assert.equal(logs[0].errorClass, null);
    now += 181000;await feed.get();assert.equal(feed.health().status, 'fresh');
  }
});

test('liveness is independent of bindings; data health reads both source states without upstream requests', async () => {
  let now = Date.now(), calls = 0;
  const feed = new GpsFeedCache({ now: () => now, fetch: async () => { calls++;return new Response(csv); } });
  const trains = new ElronFeedCache({ now: () => now, log: () => {}, fetch: async () => { calls++;return new Response('{"data":[]}'); } });
  const env = { GPS_FEED: { idFromName: name => name, get: () => ({ fetch: url => GpsFeed.prototype.fetch.call({ feed, trains }, new Request(url)) }) } };
  const ctx = { waitUntil: () => assert.fail('health must not be cached') };
  const live = await handleRequest(request('health/live'), {}, ctx, { match: () => assert.fail() });
  assert.equal(live.status, 200);assert.deepEqual(await live.json(), { status: 'ok' });assert.equal(calls, 0);
  const cold = await handleRequest(request('health/data'), env, ctx);assert.equal(cold.status, 503);assert.equal(calls, 0);
  await Promise.all([feed.get(), trains.get()]);
  const fresh = await handleRequest(request('api/health/data'), env, ctx);assert.equal(fresh.status, 200);assert.equal(calls, 2);
  assert.equal(fresh.headers.get('Cache-Control'), 'no-store');assert.equal((await fresh.json()).sources.tallinn.status, 'fresh');
  now += 61000;const stale = await handleRequest(request('health/data'), env, ctx);assert.equal(stale.status, 503);assert.equal(calls, 2);
  now += 120000;assert.equal((await (await handleRequest(request('health/data'), env, ctx)).json()).status, 'unavailable');
});

test('filtered-out old rail fixes are unavailable data, rather than a fresh empty observation', async () => {
  const feed = new ElronFeedCache({ now: () => start, log: () => {}, fetch: async () => new Response(JSON.stringify({ data: [
    { reis: '101', longitude: '24.74', latitude: '59.438', asukoha_uuendus: '2026-10-30 09:56:00' },
  ] })) });
  const snapshot = await feed.get();
  assert.equal(snapshot.vehicleCount, 0);assert.equal(feed.health().ageSeconds, 240);
  assert.equal(feed.health().lastAttempt.reason, 'expired_fixes');
  assert.equal(feed.health().status, 'unavailable');assert.equal(gpsResponse(snapshot, request('trains'), { now: start }).status, 503);
});

test('browser reads metadata, keeps cached source age and expires markers while paused or after failures', () => {
  const headers = new Headers({ 'X-Data-Status': 'fresh', 'X-Data-Timestamp': new Date(start).toISOString(),
    'X-GPS-Validated-At': new Date(start + 10000).toISOString(), 'X-Data-Age': '0' });
  const state = { ...liveMetadata(headers, start + 20000), error: '', vehicles: [{ id: '1' }] };
  assert.equal(liveDataState(state, start + 61000).status, 'stale');
  assert.equal(liveDataState(state, start + 181000).vehicles.length, 0);
  assert.equal(liveDataState({ ...state, error: 'fetch failed' }, start + 30000).status, 'stale');
  assert.equal(liveDataState({ ...state, serverStatus: 'unavailable' }, start + 30000).vehicles.length, 0);
  const legacy = liveMetadata(new Headers({ 'Last-Modified': new Date(start).toUTCString() }), start + 70000);
  assert.equal(liveDataState({ ...legacy, vehicles: [], error: '' }, start + 70000).status, 'stale');
});

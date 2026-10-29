import test from 'node:test';
import assert from 'node:assert/strict';
import { GpsFeedCache, gpsResponse, gpsError, GPS_UPSTREAM } from '../scripts/gps-cache.mjs';
import { handleRequest } from '../scripts/gps-worker.js';
import { gpsValidatedAt } from '../src/transit.js';
const body = '3,T2,24762270,59433620,,138,501,Z,179,Lennujaam';
const modified = 'Thu, 29 Oct 2026 04:40:51 GMT';
const source = () => new Response(body, { headers: { ETag: 'W/"source-v1"', 'Last-Modified': modified, 'Set-Cookie': 'upstream-private=never-forward' } });
function fixture(fetcher = async () => source()) {
  let now = Date.parse('2026-10-29T04:41:00Z'), calls = [];
  const cache = new GpsFeedCache({ now: () => now, fetch: async (...args) => { calls.push(args); return fetcher(...args); } });
  return { cache, calls, advance: ms => { now += ms; }, now: () => now };
}

test('100 concurrent clients share one upstream request and the exact ten-second cap', async () => {
  const f = fixture();
  const snapshots = await Promise.all(Array.from({ length: 100 }, () => f.cache.get()));
  assert.equal(f.calls.length, 1);assert(snapshots.every(s => s === snapshots[0]));
  f.advance(9999);await f.cache.get();assert.equal(f.calls.length, 1);
  f.advance(1);await f.cache.get();assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0][0], GPS_UPSTREAM);
  assert.equal(f.calls[1][1].headers['If-None-Match'], 'W/"source-v1"');
  assert.equal(f.calls[1][1].headers['If-Modified-Since'], modified);
});

test('upstream 304 retains the body and source time, advances validation only', async () => {
  let count = 0;
  const f = fixture(async () => ++count === 1 ? source() : new Response(null, { status: 304 }));
  const first = await f.cache.get();f.advance(10000);const second = await f.cache.get();
  assert.equal(second.body, body);assert.equal(second.modified, modified);assert.equal(second.etag, first.etag);
  assert.equal(second.validatedAt, first.validatedAt + 10000);assert.equal(second.upstreamStatus, 304);
});

test('unchanged 200 responses have the same downstream content ETag', async () => {
  const f = fixture();const a = await f.cache.get();f.advance(10000);const b = await f.cache.get();
  assert.equal(a.etag, b.etag);
});

test('cache hits preserve Age and validation time; conditional GET/HEAD transfer no body', async () => {
  const f = fixture(), snapshot = await f.cache.get();f.advance(6100);
  const req = headers => new Request('https://relay.example/gps', { headers });
  const a = gpsResponse(snapshot, req(), { now: f.now() });
  assert.equal(a.headers.get('Age'), '7');assert.equal(a.headers.get('X-GPS-Validated-At'), new Date(snapshot.validatedAt).toISOString());
  assert.equal(a.headers.get('Cache-Control'), 'public, max-age=10, s-maxage=10, must-revalidate');
  assert.equal(a.headers.get('Set-Cookie'), null);
  const b = gpsResponse(snapshot, req({ 'If-None-Match': `"different", ${snapshot.etag}` }), { now: f.now() });
  assert.equal(b.status, 304);assert.equal(await b.text(), '');assert.equal(b.headers.get('Age'), '7');
  assert.equal(gpsResponse(snapshot, req({ 'If-Modified-Since': modified })).status, 304);
  assert.equal(gpsResponse(snapshot, req({ 'If-None-Match': '"different"', 'If-Modified-Since': modified })).status, 200);
  assert.equal(await gpsResponse(snapshot, new Request('https://relay.example/gps', { method: 'HEAD' })).text(), '');
});

test('failures are rate-limited, uncached and never renew the old snapshot', async () => {
  let broken = false;const f = fixture(async () => broken ? new Response('<html>blocked</html>') : source());
  const first = await f.cache.get();broken = true;f.advance(10000);
  await assert.rejects(() => f.cache.get());
  await Promise.all(Array.from({ length: 100 }, () => assert.rejects(() => f.cache.get())));
  assert.equal(f.calls.length, 2);assert.equal(f.cache.state.snapshot.validatedAt, first.validatedAt);
  const err = gpsError({ retryAfter: 8 });assert.equal(err.status, 503);assert.equal(err.headers.get('Cache-Control'), 'no-store');assert.equal(err.headers.get('Retry-After'), '8');
  f.advance(10000);broken = false;await f.cache.get();assert.equal(f.calls.length, 3);
});

test('persisted snapshots and failed-attempt throttle survive object eviction', async () => {
  let saved;
  let broken = false;const f = fixture(async () => broken ? new Response('failure', { status: 502 }) : source());f.cache.storage = { put: async (_, value) => { saved = structuredClone(value); } };
  const first = await f.cache.get();
  const restarted = new GpsFeedCache({ state: saved, now: f.now, fetch: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(await restarted.get(), first);
  broken = true;f.advance(10000);await assert.rejects(() => f.cache.get());
  // Rehydrate the pre-I/O reservation, including a restart during an upstream call.
  assert.equal(saved.snapshot.validatedAt, first.validatedAt);assert.equal(saved.nextAttemptAt, f.now() + 10000);
  let attempts = 0;
  const duringAttempt = new GpsFeedCache({ state: saved, now: f.now, fetch: async () => { attempts++;return source(); } });
  await assert.rejects(() => duringAttempt.get());
  assert.equal(attempts, 0);
});

function workerFixture() {
  const f = fixture(), entries = new Map(), work = [];let objectCalls = 0;
  const edge = { match: async req => entries.get(req.url)?.clone(), put: async (req, res) => { entries.set(req.url, res.clone()); } };
  const env = { ALLOWED_ORIGINS: 'https://jaakla.github.io,http://localhost:5177', GPS_FEED: {
    idFromName: name => { assert.equal(name, 'tallinn-public-gps-v1');return 'one-global-id'; },
    get: () => ({ fetch: async url => { objectCalls++;return gpsResponse(await f.cache.get(), new Request(url)); } }),
  } };
  const ctx = { waitUntil: promise => work.push(promise) };
  const send = async (path = '/gps', origin = 'https://jaakla.github.io', headers = {}) => {
    const res = await handleRequest(new Request(`https://relay.example${path}`, { headers: { Origin: origin, ...headers } }), env, ctx, edge);
    await Promise.all(work);return res;
  };
  return { ...f, env, entries, ctx, edge, send, objectCalls: () => objectCalls };
}

test('regional cache shares all origins and query variants without extending freshness', async () => {
  const f = workerFixture();
  // Use wall clock for Worker edge checks, while preserving the same core fixture.
  f.cache.now = Date.now;
  const a = await f.send();assert.equal(a.status, 200);assert.equal(a.headers.get('X-GPS-Cache'), 'GLOBAL');
  const b = await f.send('/api/gps?ignored=123', 'http://localhost:5177');
  assert.equal(b.headers.get('X-GPS-Cache'), 'EDGE');assert.equal(b.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5177');
  assert.equal(a.headers.get('X-GPS-Validated-At'), b.headers.get('X-GPS-Validated-At'));
  assert.equal(f.objectCalls(), 1);assert.equal(f.calls.length, 1);
  const c = await f.send('/gps', 'https://jaakla.github.io', { 'If-None-Match': a.headers.get('ETag') });
  assert.equal(c.status, 304);assert.equal(await c.text(), '');assert.equal(f.objectCalls(), 1);
  for (const entry of f.entries.values()) {
    const headers = new Headers(entry.headers);headers.set('X-GPS-Validated-At', new Date(Date.now() - 11000).toISOString());
    f.entries.set('https://relay.example/__gps_feed_v1', new Response(body, { headers }));
  }
  const d = await f.send();assert.equal(d.headers.get('X-GPS-Cache'), 'GLOBAL');assert.equal(f.objectCalls(), 2);assert.equal(f.calls.length, 1);
});

test('denied origins, unknown paths and preflights never hit the feed', async () => {
  const f = workerFixture();
  assert.equal((await f.send('/gps', 'https://unrelated.example')).status, 403);
  assert.equal((await f.send('/arbitrary-url')).status, 404);
  const res = await handleRequest(new Request('https://relay.example/gps', { method: 'OPTIONS', headers: { Origin: 'https://jaakla.github.io' } }), f.env, f.ctx, f.edge);
  assert.equal(res.status, 204);assert.equal(res.headers.get('Access-Control-Max-Age'), '86400');assert.equal(f.objectCalls(), 0);
});

test('browser cache hits retain validation age rather than becoming new GPS fixes', () => {
  const now = Date.parse('2026-10-29T04:41:10Z'), at = now - 7000;
  assert.equal(gpsValidatedAt(new Headers({ 'X-GPS-Validated-At': new Date(at).toISOString() }), now), at);
  assert.equal(gpsValidatedAt(new Headers({ Age: '8' }), now), now - 8000);
  assert.equal(gpsValidatedAt(new Headers({ 'X-GPS-Validated-At': new Date(now + 1000).toISOString() }), now), now);
});

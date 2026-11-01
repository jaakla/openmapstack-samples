import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { LocationArchive, backgroundWindow, collectBackground } from '../scripts/location-archive.mjs';
import { GpsFeedCache } from '../scripts/gps-cache.mjs';
import { GpsFeed, handleRequest } from '../scripts/gps-worker.js';

const start = Date.parse('2026-11-01T08:00:00Z');
const trial = { GPS_ARCHIVE_BACKGROUND_START: new Date(start).toISOString(), GPS_ARCHIVE_BACKGROUND_UNTIL: new Date(start + 14 * 86400_000).toISOString() };
const vehicle = { id: '501', mode: 'tram', route: 'T2', lon: 24.74, lat: 59.438, speed: null, bearing: 138, bearingSource: 'feed' };
const snapshot = (vehicles = [vehicle], at = start) => ({ observedAt: at, vehiclesBody: JSON.stringify({ vehicles }) });
function storage() {
  const db = new DatabaseSync(':memory:'); let alarm = null;
  const values = new Map();
  return { sql: { exec(query, ...args) { return db.prepare(query).all(...args); } },
    transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    getAlarm: async () => alarm, setAlarm: async at => { alarm = at; },
    get: async key => structuredClone(values.get(key)), put: async (key, value) => { values.set(key, structuredClone(value)); } };
}
function fixture() {
  let now = start, fail = false;
  const saved = storage(), sent = [], logs = [];
  const stream = { send: async rows => { if (fail) throw new Error('delivery_failed'); sent.push(...rows); } };
  const options = { now: () => now, log: entry => logs.push(entry) };
  const archive = new LocationArchive(saved, stream, options);
  return { saved, stream, options, archive, sent, logs, now: () => now, advance: ms => { now += ms; }, fail: value => { fail = value; } };
}

test('unchanged Tallinn locations deduplicate across feed changes and restarts; revisits survive', async () => {
  const f = fixture(); await f.archive.capture(snapshot(), { source: 'tallinn' });
  f.advance(10000);
  await f.archive.capture(snapshot([vehicle], f.now()), { source: 'tallinn', reason: 'background' });
  const restored = new LocationArchive(f.saved, f.stream, f.options);
  await restored.capture(snapshot([vehicle], f.now()), { source: 'tallinn' });
  assert.equal(restored.count(), 1);
  const moved = { ...vehicle, lon: 24.741 };
  f.advance(10000); await restored.capture(snapshot([moved], f.now()), { source: 'tallinn', reason: 'background' });
  f.advance(10000); await restored.capture(snapshot([vehicle], f.now()), { source: 'tallinn' });
  await restored.flush();
  assert.equal(f.sent.length, 3);
  assert.deepEqual(f.sent.map(row => row.capture_reason), ['user', 'background', 'user']);
  assert.equal(new Set(f.sent.map(row => row.event_id)).size, 3);
  assert(f.sent.every(row => row.source_fix_at_ms === null));
  assert.equal(restored.health().stats.duplicates, 2);
});

test('Elron deduplicates actual measurements, retains new stationary fixes, filters stale rows individually', async () => {
  const f = fixture();
  const train = { ...vehicle, id: 'elron:42', route: '42', mode: 'train', fixAt: new Date(start).toISOString() };
  await f.archive.capture(snapshot([train]), { source: 'elron' });
  f.advance(10000);
  await f.archive.capture(snapshot([train, { ...train, id: 'elron:43', fixAt: new Date(start - 61000).toISOString() }], f.now()), { source: 'elron' });
  await f.archive.capture(snapshot([{ ...train, fixAt: new Date(f.now()).toISOString() }], f.now()), { source: 'elron', reason: 'background' });
  await f.archive.flush(); assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent.map(row => row.source_fix_at_ms), [start, f.now()]);
  assert.equal(f.archive.health().stats.rejected, 1);
});

test('old, future and malformed locations never enter history', async () => {
  const f = fixture();
  await f.archive.capture(snapshot([vehicle], start - 60001), { source: 'tallinn' });
  await f.archive.capture(snapshot([vehicle], start + 30001), { source: 'tallinn' });
  await f.archive.capture(snapshot([{ ...vehicle, lon: null }]), { source: 'tallinn' });
  assert.equal(f.archive.count(), 0); assert.equal(f.archive.health().stats.rejected, 3);
  await f.archive.capture(snapshot([vehicle], start - 60000), { source: 'tallinn' });
  assert.equal(f.archive.count(), 1);
});

test('outbox survives delivery failure and eviction, retries stable IDs and reports degradation', async () => {
  const f = fixture(); await f.archive.capture(snapshot(), { source: 'tallinn' });
  f.fail(true); await f.archive.flush();
  assert.equal(f.archive.count(), 1); assert.equal(f.archive.health().status, 'degraded');
  assert.equal(await f.saved.getAlarm(), start + 60000);
  f.advance(10000);
  await f.archive.capture(snapshot([{ ...vehicle, lon: 24.741 }], f.now()), { source: 'tallinn' });
  assert.equal(await f.saved.getAlarm(), start + 60000); // New demand respects retry backoff.
  const restored = new LocationArchive(f.saved, f.stream, f.options);
  f.fail(false); await restored.resume(); await Promise.all([restored.flush(), restored.flush()]);
  assert.equal(f.sent.length, 2); assert.equal(restored.count(), 0);
  assert.equal(restored.health().status, 'ok'); assert.equal(restored.health().stats.delivered, 2);
});

test('an undelivered backlog is unhealthy even while new successful captures continue', async () => {
  const f = fixture(); await f.archive.capture(snapshot(), { source: 'tallinn' });
  f.advance(300001); await f.archive.capture(snapshot([{ ...vehicle, lon: 24.741 }], f.now()), { source: 'tallinn' });
  assert.equal(f.archive.health().status, 'degraded');
  assert.equal(f.archive.health().oldestPendingAt, new Date(start).toISOString());
});

test('lost delivery acknowledgements replay stable event IDs for downstream deduplication', async () => {
  const f = fixture(); let loseAck = true;
  f.stream.send = async rows => { f.sent.push(...rows); if (loseAck) throw new Error('ack_lost'); };
  await f.archive.capture(snapshot(), { source: 'tallinn' }); await f.archive.flush();
  assert.equal(f.archive.count(), 1); loseAck = false;
  await new LocationArchive(f.saved, f.stream, f.options).flush();
  assert.equal(f.sent.length, 2); assert.equal(f.sent[0].event_id, f.sent[1].event_id);
  assert.equal(f.archive.count(), 0);
});

test('large fresh feeds are delivered in bounded batches', async () => {
  const f = fixture(), sizes = [];
  f.stream.send = async rows => { sizes.push(rows.length); f.sent.push(...rows); };
  await f.archive.capture(snapshot(Array.from({ length: 1205 }, (_, id) => ({ ...vehicle, id: String(id) }))), { source: 'tallinn' });
  await f.archive.flush(); assert.deepEqual(sizes, [500, 500, 205]);
  assert.equal(f.archive.health().stats.delivered, 1205); assert.equal(f.archive.count(), 0);
});

test('archive records match the checked-in typed ingestion schema', async () => {
  const f = fixture(); await f.archive.capture(snapshot(), { source: 'tallinn' }); await f.archive.flush();
  const schema = JSON.parse(readFileSync(new URL('../monitoring/gps-archive-schema.json', import.meta.url)));
  const row = f.sent[0]; assert.equal(Object.keys(row).length, schema.fields.length);
  for (const field of schema.fields) {
    const value = row[field.name];
    if (!field.required && value === null) continue;
    assert.equal(typeof value, field.type === 'string' ? 'string' : 'number', field.name);
    if (/^int/.test(field.type)) assert(Number.isSafeInteger(value), field.name);
  }
});

test('only successful new upstream versions invoke archiving; cache hits, 304s, errors do not', async () => {
  let now = start, status = 200, calls = 0;
  const captures = [], csv = '3,T2,24740000,59438000,,138,501,Z,179,Lennujaam';
  const feed = new GpsFeedCache({ now: () => now, log: () => {}, onSnapshot: (s, reason) => captures.push({ s, reason }),
    fetch: async () => { calls++; return new Response(status === 304 ? null : csv, { status, headers: { 'Last-Modified': new Date(start).toUTCString() } }); } });
  await Promise.all(Array.from({ length: 50 }, () => feed.get('user')));
  assert.equal(captures.length, 1); assert.equal(calls, 1);
  now += 10000; status = 304; await feed.get('background');
  now += 10000; status = 200; await feed.get('background');
  now += 10000; status = 503; await feed.get('user');
  assert.equal(captures.length, 1); assert.equal(captures[0].reason, 'user');
});

test('archive capture failure never rolls back a healthy live snapshot', async () => {
  const feed = new GpsFeedCache({ now: () => start, log: () => {}, onSnapshot: async () => { throw new Error('disk full'); },
    fetch: async () => new Response('3,T2,24740000,59438000,,138,501,Z,179,Lennujaam') });
  const data = await feed.get(); assert.equal(data.vehicleCount, 1); assert.equal(feed.health().status, 'fresh');
  assert.equal(feed.state.lastError, null);
});

test('archive initialization failure cannot disable live GPS', async t => {
  t.mock.method(Date, 'now', () => start);
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('3,T2,24740000,59438000,,138,501,Z,179,Lennujaam'));
  let initialized;
  const feed = new GpsFeed({ storage: { get: async () => undefined, put: async () => {}, sql: { exec() { throw new Error('archive_schema_failed'); } } },
    blockConcurrencyWhile: callback => { initialized = callback(); } }, { GPS_ARCHIVE: {} });
  await initialized;
  const health = await feed.fetch(new Request('https://gps.internal/health/archive'));
  assert.equal((await health.json()).status, 'unavailable');
  const response = await feed.fetch(new Request('https://gps.internal/vehicles'));
  assert.equal(response.status, 200); assert.equal((await response.json()).vehicles.length, 1);
});

test('trial is bounded to 14 days, ends exactly at deadline, and cannot reset on redeploy', () => {
  assert.equal(backgroundWindow(trial, start - 1).active, false);
  assert.equal(backgroundWindow(trial, start).active, true);
  assert.equal(backgroundWindow(trial, start + 14 * 86400_000 - 1).active, true);
  assert.equal(backgroundWindow(trial, start + 14 * 86400_000).active, false);
  assert.equal(backgroundWindow({}, start).active, false);
  assert.equal(backgroundWindow({ ...trial, GPS_ARCHIVE_BACKGROUND_UNTIL: new Date(start + 15 * 86400_000).toISOString() }, start).active, false);
  const f = fixture(); assert.equal(f.archive.reserveSample('feed', start), true);
  assert.equal(new LocationArchive(f.saved, f.stream, f.options).reserveSample('feed', start + 299999), false);
  f.advance(300000);
  assert.equal(f.archive.reserveSample('feed', start + 300000), true);
  assert.equal(f.archive.health().backgroundSamples, 2);
  assert.equal(f.archive.health().lastBackgroundSampleAt, new Date(start + 300000).toISOString());
});

test('five-minute collector calls both shared feeds, no upstream/DO requests after cutoff', async () => {
  const calls = [], env = { ...trial, GPS_ARCHIVE: {}, GPS_FEED: {
    idFromName: name => name, get: name => ({ fetch: async (url, init) => { calls.push({ name, url, init }); return new Response(null, { status: 204 }); } }),
  } };
  await collectBackground({ scheduledTime: start }, env, start);
  assert.equal(calls.length, 2); assert(calls.every(call => call.init.method === 'POST'));
  assert(calls[1].url.endsWith('/archive/background/trains'));
  await collectBackground({ scheduledTime: start + 14 * 86400_000 }, env, start + 14 * 86400_000);
  await collectBackground({ scheduledTime: start }, env, start + 14 * 86400_000); // Late event fails closed.
  await collectBackground({ scheduledTime: start }, env, start + 300000); // Missed slots never catch up in a burst.
  assert.equal(calls.length, 2);
});

test('a restarted object rejects delayed sampling slots instead of replaying a backlog', () => {
  const f = fixture(); f.advance(900000);
  assert.equal(f.archive.reserveSample('feed', start), false);
  assert.equal(f.archive.reserveSample('feed', start + 300000), false);
  assert.equal(f.archive.reserveSample('feed', start + 600000), false);
  assert.equal(f.archive.reserveSample('feed', f.now()), true);
  assert.equal(f.archive.health().backgroundSamples, 1);
});

test('background collection paths are not exposed by the public proxy', async () => {
  for (const method of ['GET', 'POST']) {
    const response = await handleRequest(new Request('https://relay.test/archive/background/trains', { method }), { GPS_FEED: { get: () => assert.fail() } }, {});
    assert.equal(response.status, 404);
  }
});

test('shared Durable Object reserves each five-minute slot and stops polling at cutoff; user refreshes continue', async t => {
  let now = start, calls = [];
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const feed = { storageKey: 'feed', get: async reason => { calls.push(reason); return { ...snapshot(), validatedAt: now, etag: 'test', upstreamRequests: calls.length }; } };
  const state = { env: trial, archive: f.archive, feed };
  const request = () => new Request('https://gps.internal/archive/background/vehicles', { method: 'POST', headers: { 'X-Scheduled-Time': String(now) } });
  await GpsFeed.prototype.fetch.call(state, request());
  await GpsFeed.prototype.fetch.call(state, request());
  assert.deepEqual(calls, ['background']);
  now += 300000; f.advance(300000); await GpsFeed.prototype.fetch.call(state, request());
  assert.deepEqual(calls, ['background', 'background']);
  now = start + 14 * 86400_000; await GpsFeed.prototype.fetch.call(state, request());
  assert.equal(calls.length, 2);
  feed.get = async reason => { calls.push(reason); return { ...snapshot([], now), validatedAt: now, etag: 'test', vehiclesEtag: 'test', upstreamRequests: 3 }; };
  assert.equal((await GpsFeed.prototype.fetch.call(state, new Request('https://gps.internal/vehicles'))).status, 200);
  assert.equal(calls.at(-1), 'user');
});

test('archive health is read-only and HEAD has no body', async () => {
  const f = fixture();
  const state = { archive: f.archive, feed: { health: () => assert.fail(), get: () => assert.fail() } };
  const direct = await GpsFeed.prototype.fetch.call(state, new Request('https://gps.internal/health/archive'));
  assert.equal((await direct.json()).status, 'ok'); assert.equal(await f.saved.getAlarm(), null);
  const env = { ...trial, GPS_FEED: { idFromName: name => name, get: () => ({ fetch: async () => Response.json(f.archive.health()) }) } };
  const response = await handleRequest(new Request('https://relay.test/health/archive', { method: 'HEAD' }), env, {});
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
});

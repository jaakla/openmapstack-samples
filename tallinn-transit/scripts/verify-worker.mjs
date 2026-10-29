// Small live smoke test: two upstream refresh windows, many downstream clients.
import assert from 'node:assert/strict';
const base = process.argv[2] || 'https://tallinn-transit-api.jaak-laineste.workers.dev/';
const origin = 'https://jaakla.github.io';
const get = (path, headers = {}) => fetch(new URL(path, base), { headers: { Origin: origin, ...headers } });
const first = await get('gps');
assert.equal(first.status, 200, `GPS status ${first.status}: ${await first.clone().text()}`);
const text = await first.text();assert(/^\s*\d+,/.test(text));
const count = Number(first.headers.get('X-GPS-Upstream-Requests'));
const stamp = first.headers.get('X-GPS-Validated-At');
assert.equal(first.headers.get('Access-Control-Allow-Origin'), origin);
assert.equal(first.headers.get('Cache-Control'), 'public, max-age=10, s-maxage=10, must-revalidate');
assert.equal(first.headers.get('Set-Cookie'), null);
const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => get(`gps?client=${i}`)));
for (const r of burst) {
  assert.equal(r.status, 200);assert.equal(Number(r.headers.get('X-GPS-Upstream-Requests')), count);
  assert.equal(r.headers.get('X-GPS-Validated-At'), stamp);await r.arrayBuffer();
}
const conditional = await get('gps', { 'If-None-Match': first.headers.get('ETag') });
assert.equal(conditional.status, 304);assert.equal((await conditional.arrayBuffer()).byteLength, 0);
assert.equal(Number(conditional.headers.get('X-GPS-Upstream-Requests')), count);
assert.equal((await get('gps', { Origin: 'https://unrelated.example' })).status, 403);
assert.equal((await get('unknown')).status, 404);
const addresses = await get('geocode?q=Vabaduse%20v%C3%A4ljak%207');
assert.equal(addresses.status, 200);assert((await addresses.json()).some(a => a.name === 'Vabaduse väljak 7'));
// Wait past the original validation window, not ten seconds past each client.
await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(stamp) + 10100 - Date.now())));
const next = await get('gps');assert.equal(next.status, 200);
assert.equal(Number(next.headers.get('X-GPS-Upstream-Requests')), count + 1);
assert(Date.parse(next.headers.get('X-GPS-Validated-At')) >= Date.parse(stamp) + 10000);
await next.arrayBuffer();
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), base, passed: true,
  clientsInBurst: burst.length, initialUpstreamRequests: count, finalUpstreamRequests: count + 1,
  conditionalStatus: conditional.status, conditionalBytes: 0,
  cacheControl: first.headers.get('Cache-Control'), initialValidatedAt: stamp,
  nextValidatedAt: next.headers.get('X-GPS-Validated-At'), geocoder: 'Vabaduse väljak 7',
}, null, 2));

import { test, expect } from '@playwright/test';
import { activeServices, addDays, tallinnNow } from '../../src/transit.js';

const api = 'https://tallinn-transit-api.jaak-laineste.workers.dev';
const attach = (info, name, value) => info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });

test('published timetable covers today and the next fourteen days', async ({ request }, info) => {
  const response = await request.get('data/network.json', { timeout: 45000 });
  expect(response.status()).toBe(200);
  const data = await response.json();
  const projectResponse = await request.get('data/project.json');
  expect(projectResponse.status()).toBe(200);
  const project = await projectResponse.json();
  await attach(info, 'deployed-data-versions', {
    snapshot: data.snapshot, validFrom: data.validFrom, validUntil: data.validUntil,
    run: project.run,
    sources: Object.fromEntries(Object.entries(project.sources).map(([key, s]) => [key, {
      version: s.version, retrievedAt: s.access?.retrieved_at, bytes: s.access?.file?.size_bytes,
    }])),
  });
  const today = tallinnNow().date;
  for (let day = 0; day <= 14; day++) {
    const date = addDays(today, day), services = activeServices(data, date);
    const modes = new Set(data.trips.filter(t => services.has(t.service)).map(t => data.routes[t.r].mode));
    for (const mode of ['bus', 'tram', 'train']) expect(modes.has(mode), `${date}: no active ${mode} trips`).toBe(true);
  }
});

for (const endpoint of ['vehicles', 'trains']) {
  test(`${endpoint}: available, fresh, plausible GPS feed with ten-second caching`, async ({ request }, info) => {
    const started = Date.now();
    const response = await request.get(`${api}/${endpoint}`, { timeout: 15000 });
    expect(response.status()).toBe(200);
    const headers = response.headers(), data = await response.json();
    const now = Date.now(), validatedAt = Date.parse(headers['x-gps-validated-at']);
    await attach(info, `${endpoint}-health`, {
      status: response.status(), responseMs: now - started, count: data.vehicles?.length,
      observedAt: data.observedAt, validatedAt: headers['x-gps-validated-at'],
      lastModified: headers['last-modified'], cacheControl: headers['cache-control'],
      age: headers.age, cdnCache: headers['cf-cache-status'],
    });
    expect(Array.isArray(data.vehicles)).toBe(true);
    expect(Number.isFinite(validatedAt)).toBe(true);
    expect(now - validatedAt).toBeLessThanOrEqual(45000);
    expect(validatedAt - now).toBeLessThanOrEqual(30000);
    expect(headers['cache-control']).toContain('max-age=10');
    expect(headers['cache-control']).toContain('s-maxage=10');
    expect(headers['cache-control']).toContain('must-revalidate');
    if (endpoint === 'vehicles') {
      // Tallinn has no individual fix timestamps: monitor source age honestly.
      const sourceAt = Date.parse(headers['last-modified']);
      expect(Number.isFinite(sourceAt)).toBe(true);
      expect(now - sourceAt).toBeLessThanOrEqual(180000);
      expect(sourceAt - now).toBeLessThanOrEqual(30000);
      const hour = Number(tallinnNow().time.slice(0, 2));
      if (hour >= 8 && hour < 20) expect(data.vehicles.length, 'Empty Tallinn daytime feed').toBeGreaterThan(0);
    }
    const ids = new Set();
    for (const v of data.vehicles) {
      expect(typeof v.id).toBe('string');
      expect(ids.has(v.id), `Duplicate vehicle ${v.id}`).toBe(false); ids.add(v.id);
      // City feed includes the wider service area; it is not clipped to our map.
      const bounds = endpoint === 'trains' ? [24.45, 59.28, 25.04, 59.57] : [24.3, 59.2, 25.2, 59.65];
      expect(v.lon).toBeGreaterThanOrEqual(bounds[0]); expect(v.lon).toBeLessThanOrEqual(bounds[2]);
      expect(v.lat).toBeGreaterThanOrEqual(bounds[1]); expect(v.lat).toBeLessThanOrEqual(bounds[3]);
      expect(endpoint === 'trains' ? ['train'] : ['bus', 'tram']).toContain(v.mode);
      if (v.bearing != null) { expect(v.bearing).toBeGreaterThanOrEqual(0); expect(v.bearing).toBeLessThan(360); }
      if (v.speed != null) { expect(v.speed).toBeGreaterThanOrEqual(0); expect(v.speed).toBeLessThanOrEqual(250); }
      if (endpoint === 'trains') {
        const at = Date.parse(v.fixAt);
        expect(Number.isFinite(at)).toBe(true);
        expect(now - at).toBeLessThanOrEqual(180000);
        expect(at - now).toBeLessThanOrEqual(30000);
      }
    }
    // No train in our geographical bounds is a valid result, including at night.
  });
}

test('In-ADS relay finds a known Tallinn address with realistic coordinates', async ({ request }, info) => {
  const response = await request.get(`${api}/geocode`, { params: { q: 'Vabaduse väljak 7, Tallinn' }, timeout: 15000 });
  expect(response.status()).toBe(200);
  const addresses = await response.json();
  await attach(info, 'address-search', addresses);
  expect(addresses.some(a => a.kind === 'address' && /Vabaduse väljak 7(?:\D|$)/i.test(a.name)
    && Math.abs(a.lon - 24.744) < 0.01 && Math.abs(a.lat - 59.432) < 0.01)).toBe(true);
});

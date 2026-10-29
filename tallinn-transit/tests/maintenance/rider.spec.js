import { test, expect } from '@playwright/test';
import { tallinnNow } from '../../src/transit.js';

test('today: interactive map, address-to-address walking and transit, arrival routing and live markers', async ({ page }, info) => {
  const errors = [], failedRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  // Record usability inside the browser, without Playwright polling latency.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const button = document.querySelector('.find-button');
      if (button && !button.disabled) { window.__maintenanceReadyAt = performance.now(); observer.disconnect(); }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  });
  const vehiclesPromise = page.waitForResponse(r => /\/(vehicles)$/.test(new URL(r.url()).pathname)).then(r => r.json());
  const trainsPromise = page.waitForResponse(r => /\/(trains)$/.test(new URL(r.url()).pathname)).then(r => r.json());
  // Attach handlers immediately, so a navigation error doesn't leave unhandled promises.
  for (const pending of [vehiclesPromise, trainsPromise]) pending.catch(() => {});
  try {
    const response = await page.goto('./', { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Tallinn liigub/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'et');
    await expect(page.getByRole('heading', { name: 'Kuhu soovid minna?' })).toBeVisible({ timeout: 60000 });
    const find = page.getByRole('button', { name: 'Leia teekond', exact: true });
    await expect(find).toBeEnabled({ timeout: 45000 });
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const entries = performance.getEntriesByType('resource').filter(e => /\/data\/(network\.json|routes\.geojson|project\.json|walk-network\.json)$/.test(new URL(e.name).pathname));
      // Subtract the union of parallel data transfers, never their summed durations.
      let dataTransferMs = 0, end = 0;
      for (const e of entries.sort((a, b) => a.startTime - b.startTime)) {
        dataTransferMs += Math.max(0, e.responseEnd - Math.max(end, e.startTime)); end = Math.max(end, e.responseEnd);
      }
      const readyMs = window.__maintenanceReadyAt;
      return { domContentLoadedMs: nav.domContentLoadedEventEnd, readyMs, dataTransferMs,
        readyExcludingDataTransferMs: readyMs - dataTransferMs, dataResources: entries.length };
    });
    await info.attach('startup-timings', { body: JSON.stringify(timing, null, 2), contentType: 'application/json' });
    expect(timing.dataResources, 'All four startup datasets must be measured').toBe(4);
    // Limits are asserted after functional checks, so a slow app still yields diagnostics.
    const today = tallinnNow().date;
    await expect(page.getByLabel('Kuupäev', { exact: true })).toHaveValue(today);
    await page.waitForFunction(() => document.querySelector('.map-canvas')?.__tallinnMap?.getLayer('stations'));
    const [city, trains] = await Promise.all([vehiclesPromise, trainsPromise]);
    const expectedIds = [...city.vehicles, ...trains.vehicles].filter(v => !v.fixAt || Date.now() - Date.parse(v.fixAt) < 150000).map(v => v.id);
    if (expectedIds.length) {
      await expect.poll(() => page.locator('.map-canvas').evaluate(async el => {
        const features = (await el.__tallinnMap.getSource('vehicles').getData()).features;
        return features.map(f => f.properties.id);
      })).toEqual(expect.arrayContaining(expectedIds));
      // The source alone isn't proof of rendering: at least one actual marker must draw.
      await expect.poll(() => page.locator('.map-canvas').evaluate(el => el.__tallinnMap.queryRenderedFeatures({ layers: ['vehicle-points'] }).length)).toBeGreaterThan(0);
    }
    await info.attach('map-gps', { body: JSON.stringify({ city: city.vehicles.length, trains: trains.vehicles.length, checkedIds: expectedIds.length }), contentType: 'application/json' });
    await page.locator('.map-canvas').evaluate(el => el.__tallinnMap.jumpTo({ center: [24.744069, 59.432599], zoom: 16 }));
    const box = await page.locator('.map-canvas').boundingBox();
    await page.locator('.map-canvas').click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('.map-inspection').getByRole('button', { name: 'Teekond siit', exact: true })).toBeVisible();
    await expect(page.locator('.map-inspection').getByRole('button', { name: 'Teekond siia', exact: true })).toBeVisible();
    await expect(page.locator('.map-inspection')).toContainText('Jalgsi ligipääsetavad peatused', { timeout: 20000 });
    await page.getByRole('button', { name: 'Sulge kaardiinfo', exact: true }).click();
    async function address(label, query) {
      await page.getByRole('combobox', { name: label, exact: true }).fill(query);
      const option = page.getByRole('option').filter({ hasText: 'Aadress ·' }).first();
      await expect(option).toBeVisible({ timeout: 20000 }); await option.click();
    }
    await address('Lähtekoht', 'Vabaduse väljak 7');
    await address('Sihtkoht', 'Telliskivi 60');
    await page.getByLabel('Väljumine', { exact: true }).fill('08:00');
    await find.click();
    await expect(page.locator('.journey-result').first()).toBeVisible({ timeout: 30000 });
    await expect(find).toBeEnabled();
    await expect(page.locator('.itinerary')).toContainText('mööda tänavaid ja jalgteid');
    await expect(page.locator('.itinerary .ride')).not.toHaveCount(0);
    const route = await page.locator('.map-canvas').evaluate(async el => (await el.__tallinnMap.getSource('journey').getData()).features);
    const rides = route.filter(f => f.properties.type === 'ride');
    expect(rides.length).toBeGreaterThan(0);
    expect(rides.every(f => f.properties.lineLabel && f.geometry.coordinates.length > 1)).toBe(true);
    expect(route.some(f => f.properties.type === 'walk' && f.geometry.coordinates.length > 3)).toBe(true);
    for (const f of route) for (const [lon, lat] of f.geometry.coordinates) {
      expect(lon).toBeGreaterThanOrEqual(24.44); expect(lon).toBeLessThanOrEqual(25.05);
      expect(lat).toBeGreaterThanOrEqual(59.27); expect(lat).toBeLessThanOrEqual(59.58);
    }
    const times = await page.locator('.journey-result').first().locator('.journey-timing strong').innerText();
    const clocks = [...times.matchAll(/(\d{2}):(\d{2})/g)].map(m => Number(m[1]) * 60 + Number(m[2]));
    expect(clocks).toHaveLength(2);
    expect(clocks[0]).toBeGreaterThanOrEqual(8 * 60);
    expect(clocks[1] - clocks[0]).toBeGreaterThan(0);
    expect(clocks[1] - clocks[0]).toBeLessThan(120);
    await page.getByRole('button', { name: 'Saabun hiljemalt', exact: true }).click();
    await page.getByLabel('Saabumine', { exact: true }).fill('10:00');
    await find.click(); await expect(find).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('.journey-result').first()).toBeVisible();
    const arrival = await page.locator('.journey-result').first().locator('.journey-timing strong').innerText();
    const arrivalClocks = [...arrival.matchAll(/(\d{2}):(\d{2})/g)].map(m => Number(m[1]) * 60 + Number(m[2]));
    expect(arrivalClocks).toHaveLength(2);
    expect(arrivalClocks[1]).toBeLessThanOrEqual(10 * 60);
    // Also exercise station search and the railway part of the network today.
    for (const [label, name] of [['Lähtekoht', 'Balti jaam'], ['Sihtkoht', 'Nõmme']]) {
      await page.getByRole('combobox', { name: label, exact: true }).fill(name);
      const option = page.getByRole('option').filter({ hasText: 'Peatus ·' }).filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
      await expect(option).toHaveCount(1); await option.click();
    }
    await page.getByRole('button', { name: 'Väljun kell', exact: true }).click();
    await page.getByLabel('Väljumine', { exact: true }).fill('08:00');
    await page.locator('.journey-options > summary').click();
    await page.getByLabel('Liikumisviis', { exact: true }).selectOption('train');
    await find.click(); await expect(find).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('.itinerary')).toContainText('Rong');
    await expect(page.locator('.map-error, .error-message, .vite-error-overlay')).toHaveCount(0);
    await expect(page.locator('.itinerary')).not.toContainText(/undefined|NaN/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Horizontal overflow').toBe(false);
    await info.attach('rider-results', { body: JSON.stringify({ date: today, doorToDoor: times, arriveBy: arrival, rail: await page.locator('.itinerary').innerText() }, null, 2), contentType: 'application/json' });
    expect(errors, 'Browser errors').toEqual([]);
    expect(failedRequests, 'HTTP failures').toEqual([]);
    expect(timing.domContentLoadedMs, 'HTML/JS shell exceeds two seconds').toBeLessThan(2000);
    expect(timing.readyExcludingDataTransferMs, 'Usable planner, excluding data transfer, exceeds two seconds').toBeLessThan(2000);
  } finally {
    await info.attach('browser-errors', { body: JSON.stringify({ errors, failedRequests }, null, 2), contentType: 'application/json' });
    const screenshot = info.outputPath('rider-view.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('rider-view', { path: screenshot, contentType: 'image/png' });
  }
});

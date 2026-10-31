import { test, expect } from '@playwright/test';

const vehicles = page => page.locator('.map-canvas').evaluate(async el => {
  const source = el.__tallinnMap?.getSource('vehicles');
  return source ? (await source.getData()).features.map(f => f.properties) : [];
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`GPS freshness, partial failure, expiry on pause and recovery (${viewport.width}px)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [], consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    let now = Date.now(), stage = 'fresh';
    await page.clock.setFixedTime(now);
    await page.route(/\/(vehicles|trains)(?:\?|$)/, route => {
      const rail = new URL(route.request().url()).pathname.endsWith('/trains');
      const status = rail ? 'fresh' : stage;
      const timestamp = now - (status === 'stale' ? 90000 : status === 'unavailable' ? 181000 : 0);
      return route.fulfill({ status: status === 'unavailable' ? 503 : 200,
        json: { vehicles: [{ id: rail ? 'elron:101' : '501', mode: rail ? 'train' : 'tram', route: rail ? '101' : 'T2',
          lon: 24.74, lat: rail ? 59.439 : 59.438, ...(rail ? { fixAt: new Date(now).toISOString() } : {}) }] },
        headers: { 'X-Data-Status': status, 'X-Data-Timestamp': new Date(timestamp).toISOString(),
          'X-Data-Age': String((now - timestamp) / 1000), 'X-GPS-Validated-At': new Date(now).toISOString(),
          'X-Upstream-Error': status === 'fresh' ? 'none' : 'timeout', 'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Data-Status, X-Data-Timestamp, X-Data-Age, X-GPS-Validated-At, X-Upstream-Error' } });
    });
    const refresh = async () => {
      await page.getByRole('button', { name: 'Peata asukohtade uuendamine' }).click();
      await page.getByRole('button', { name: 'Jätka asukohtade uuendamist' }).click();
    };
    await page.goto('./');await expect(page).toHaveTitle(/Tallinn liigub/);
    await expect(page.getByRole('heading', { name: 'Kuhu soovid minna?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leia teekond', exact: true })).toBeEnabled({ timeout: 45000 });
    await expect.poll(async () => (await vehicles(page)).length).toBe(2);
    await expect(page.locator('.live-card')).toContainText('Sõidukid reaalajas');
    stage = 'stale';await refresh();
    await expect(page.locator('.live-error')).toHaveAttribute('data-status', 'stale');
    await expect(page.locator('.live-error')).toContainText('90 s vanad');
    await expect(page.locator('.live-card')).toContainText('osaliselt saadaval');
    await expect.poll(async () => (await vehicles(page)).find(v => v.id === '501')?.dataStale).toBe(true);
    expect((await vehicles(page)).find(v => v.id === 'elron:101')?.dataStale).toBe(false);
    const noticeBox = await page.locator('.live-error').boundingBox();
    expect(noticeBox.x).toBeGreaterThanOrEqual(0);expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `/tmp/tallinn-gps-stale-${viewport.width}.png` });
    stage = 'unavailable';await refresh();
    await expect(page.locator('.live-error')).toHaveAttribute('data-status', 'unavailable');
    await expect(page.locator('.live-error')).toContainText('reaalajaandmed pole praegu saadaval');
    await expect.poll(async () => (await vehicles(page)).map(v => v.id)).toEqual(['elron:101']);
    stage = 'fresh';await refresh();
    await expect(page.locator('.live-error')).toHaveCount(0);
    await expect.poll(async () => (await vehicles(page)).length).toBe(2);
    await page.getByRole('button', { name: 'Peata asukohtade uuendamine' }).click();
    now += 181000;await page.clock.setFixedTime(now);
    await expect.poll(async () => (await vehicles(page)).length).toBe(0);
    await page.getByRole('button', { name: 'Jätka asukohtade uuendamist' }).click();
    await expect.poll(async () => (await vehicles(page)).length).toBe(2);
    await expect(page.locator('.live-card')).toContainText('Sõidukid reaalajas');
    await expect(page.locator('vite-error-overlay, .map-error')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(consoleErrors.filter(message => !message.includes('503'))).toEqual([]);
    await page.screenshot({ path: `/tmp/tallinn-gps-recovered-${viewport.width}.png` });
    await context.close();
  });
}

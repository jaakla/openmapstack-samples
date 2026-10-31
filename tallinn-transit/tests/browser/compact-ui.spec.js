import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(new URL('../../data/derived/network.json', import.meta.url)));
const station = name => data.stations.find(s => s.name === name);

async function ready(page) {
  await page.route(/\/(vehicles|trains)(?:\?|$)/, route => route.fulfill({ json: { vehicles: [] }, headers: { 'Last-Modified': new Date().toUTCString() } }));
  await page.goto('./');
  await expect(page).toHaveTitle(/Tallinn liigub/);
  await expect(page.getByRole('heading', { name: 'Kuhu soovid minna?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leia teekond', exact: true })).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('.map-loading')).toHaveCount(0);
  await page.waitForFunction(() => !document.querySelector('.map-canvas').__tallinnMap.isMoving());
}

for (const width of [1440, 390]) {
  test(`compact controls and combined transport choices (${width}px)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: 'block', locale: 'et-EE' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await ready(page);
    const group = page.getByRole('group', { name: 'Liikumisviisid', exact: true });
    for (const name of ['Buss','Tramm','Rong']) await expect(group.getByRole('checkbox', { name, exact: true })).toBeChecked();
    if (width === 390) {
      const button = await page.getByRole('button', { name: 'Leia teekond', exact: true }).boundingBox();
      expect(button.y + button.height).toBeLessThanOrEqual(844);
      expect(await page.locator('.map-area').evaluate(el => el.clientHeight)).toBeLessThan(260);
      expect(await page.locator('.map-canvas').evaluate(el => el.__tallinnMap.getZoom())).toBeGreaterThan(10);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/tallinn-compact-${width}.png` });
    await group.getByRole('checkbox', { name: 'Rong', exact: true }).uncheck();
    await page.getByLabel('Kuupäev', { exact: true }).fill('2026-10-29');
    await page.getByLabel('Väljumine', { exact: true }).fill('08:00');
    await page.getByRole('button', { name: 'Leia teekond', exact: true }).click();
    await expect(page.locator('.journey-result').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leia teekond', exact: true })).toBeEnabled();
    const modes = await page.locator('.map-canvas').evaluate(async el => (await el.__tallinnMap.getSource('journey').getData()).features.filter(f => f.properties.type === 'ride').map(f => f.properties.mode));
    expect(modes.length).toBeGreaterThan(0);expect(modes.every(mode => ['bus','tram'].includes(mode))).toBe(true);
    await group.getByRole('checkbox', { name: 'Buss', exact: true }).uncheck();
    await group.getByRole('checkbox', { name: 'Tramm', exact: true }).uncheck();
    await expect(page.getByRole('button', { name: 'Leia teekond', exact: true })).toBeDisabled();
    await expect(page.locator('.mode-note')).toContainText('Vali vähemalt üks');
    await group.getByRole('checkbox', { name: 'Rong', exact: true }).check();
    await expect(page.getByRole('button', { name: 'Leia teekond', exact: true })).toBeEnabled();
    await expect(page.locator('vite-error-overlay, .map-error')).toHaveCount(0);expect(errors).toEqual([]);
    await context.close();
  });

  test(`stop suggestions follow the map at close and distant zooms (${width}px)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ready(page);await page.getByRole('tab', { name: 'Peatused', exact: true }).click();
    const move = async (place, zoom, bearing = 0) => {
      await page.locator('.map-canvas').evaluate((el, position) => el.__tallinnMap.jumpTo({ center: [position.lon,position.lat], zoom: position.zoom, bearing: position.bearing }), { ...place, zoom, bearing });
    };
    const first = page.locator('.viewport-stops .stop-list>button').first();
    await move(station('Nõmme'), 17);
    await expect(first).toContainText('Nõmme');
    await move(station('Balti jaam'), 17, 45);
    await expect(first).toContainText('Balti jaam');
    await page.getByRole('textbox', { name: 'Otsi peatust', exact: true }).fill('Nõmme');
    await expect(page.locator('.viewport-stops .stop-list-note')).toBeVisible();
    await expect(page.locator('.other-stops')).toHaveAttribute('open', '');
    await expect(page.locator('.other-stops .stop-list>button').first()).toContainText('Nõmme');
    await page.getByRole('textbox', { name: 'Otsi peatust', exact: true }).fill('');
    await move(station('Nõmme'), 10);
    await expect.poll(async () => Number(await page.locator('.stop-group-title span').textContent())).toBeGreaterThan(40);
    const count = await page.locator('.viewport-stops .stop-list>button').count();
    await page.getByRole('button', { name: /Näita veel kaardiala peatusi/ }).click();
    await expect.poll(() => page.locator('.viewport-stops .stop-list>button').count()).toBeGreaterThan(count);
    await move(station('Nõmme'), 17);
    await expect(first).toContainText('Nõmme');
    await page.getByRole('checkbox', { name: 'Peatused', exact: true }).uncheck();
    await expect(first).toContainText('Nõmme');
    await page.screenshot({ path: `/tmp/tallinn-stops-${width}.png` });
    await first.click();await expect(page.locator('.stop-detail h2')).toHaveText('Nõmme');
    expect(errors).toEqual([]);await context.close();
  });
}

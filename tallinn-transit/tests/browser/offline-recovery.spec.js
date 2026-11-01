import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function ready(page) {
  await expect(page).toHaveTitle(/Tallinn liigub/);
  await expect(page.getByRole('button', { name: 'Leia teekond', exact: true })).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('.map-error')).toHaveCount(0);
}
async function controlled(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
}
async function brokenMode(page) {
  await controlled(page);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const cache = await caches.open('tallinn-mode-state');
    await cache.put(new URL('__mode__', registration.scope), new Response('offline'));
    localStorage.setItem('tallinn-mode', 'offline');
    for (const name of await caches.keys()) if (name.startsWith('tallinn-transit-')) await caches.delete(name);
  });
}
async function fakeLive(context) {
  await context.route(/\/(vehicles|trains)(?:\?|$)/, route => route.fulfill({ json: { vehicles: [] }, headers: { 'Last-Modified': new Date().toUTCString() } }));
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`missing offline pack reload restores page and both workers (${viewport.width}px)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport }); await fakeLive(context);
    const page = await context.newPage(), errors = [], workers = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (/\/assets\/.*worker.*\.js$/.test(response.url())) workers.push(response.status()); });
    await page.goto('./'); await ready(page); await brokenMode(page);
    workers.length = 0;
    const response = await page.reload(); expect(response.status()).toBe(200);
    await ready(page); await expect(page.getByRole('button', { name: 'Veebis', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('tallinn-mode'))).toBe('online');
    expect(workers.length).toBeGreaterThanOrEqual(2); expect(workers.every(status => status === 200)).toBe(true);
    await page.getByRole('button', { name: 'Lülitu tumedale kaardile' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.map-error')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `/tmp/tallinn-offline-recovered-${viewport.width}.png` });
    await context.close();
  });
}

test('temporary disconnection without a pack does not persist offline mode or break the next reload', async ({ browser }) => {
  const context = await browser.newContext(); await fakeLive(context);
  const page = await context.newPage(); await page.goto('./'); await ready(page); await controlled(page);
  await context.setOffline(true);
  await expect(page.locator('.live-card')).toContainText('Võrguühenduseta');
  expect(await page.evaluate(() => localStorage.getItem('tallinn-mode'))).not.toBe('offline');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Veebis', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await page.reload()).status()).toBe(200); await ready(page);
  await context.close();
});

test('missing map worker in a saved pack falls back to network and restores a functional map', async ({ browser }) => {
  const context = await browser.newContext(); await fakeLive(context);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?online=1'); await ready(page);
  await expect.poll(()=>new URL(page.url()).searchParams.has('online')).toBe(false);
  await page.getByRole('button', { name: 'Võrguta', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Salvestatud', { timeout: 90000 });
  expect((await page.reload()).status()).toBe(200); await ready(page);
  await expect(page.getByRole('button', { name: 'Võrguta', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const missing = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('tallinn-offline'));
    const cache = await caches.open(saved.cache);
    const worker = (await cache.keys()).find(request => /maplibre-gl-worker.*\.js$/.test(request.url));
    if (!worker) throw new Error('Saved map worker missing before test');
    await cache.delete(worker); return worker.url;
  });
  const response = page.waitForResponse(response => response.url() === missing && response.status() === 200);
  expect((await page.reload()).status()).toBe(200); await response; await ready(page);
  await expect(page.getByRole('button', { name: 'Veebis', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]); await context.close();
});

test('recovery outside the legacy worker scope restores the map and preserves other apps and saved packs', async ({ browser }) => {
  const root = fileURLToPath(new URL('../../dist/', import.meta.url));
  let legacy = true;
  const oldWorker = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{e.respondWith((async()=>{const r=await(await caches.open('tallinn-mode-state')).match(new URL('__mode__',self.registration.scope));return r&&await r.text()==='offline'?new Response('Võrguühenduseta andmepakett puudub.',{status:503}):fetch(e.request);})());});`;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/other/sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end("self.addEventListener('install',()=>self.skipWaiting());"); return; }
    if (pathname === '/tallinn-transit/sw.js' && legacy) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(oldWorker); return; }
    const relative = pathname === '/tallinn-transit-recover.html' ? 'recover.html' : pathname.startsWith('/tallinn-transit/') ? pathname.slice('/tallinn-transit/'.length) || 'index.html' : null;
    const file = relative === null ? null : path.resolve(root, relative);
    if (!file || !file.startsWith(root)) { res.writeHead(404); res.end(); return; }
    let stat; try { stat = statSync(file); } catch { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json' }[path.extname(file)] || 'application/octet-stream';
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = match ? Number(match[1]) : 0, end = match ? Math.min(Number(match[2] || stat.size - 1), stat.size - 1) : stat.size - 1;
    res.writeHead(match ? 206 : 200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': end - start + 1, ...(match ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
    createReadStream(file, { start, end }).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext(); await fakeLive(context);
  try {
    const page = await context.newPage(); await page.goto(`${origin}/tallinn-transit/`); await ready(page); await brokenMode(page);
    expect((await page.reload()).status()).toBe(503);
    await page.goto(`${origin}/tallinn-transit-recover.html`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' });
      localStorage.setItem('other-app-value', 'keep');
      for (const name of ['other-app-cache', 'tallinn-transit-preserved-pack']) await (await caches.open(name)).put('/sentinel', new Response('keep'));
    });
    await expect(page.getByRole('heading', { name: 'Taasta Tallinn liigub veebirežiim' })).toBeVisible();
    await page.screenshot({ path: '/tmp/tallinn-recovery-page.png' }); legacy = false;
    await page.getByRole('button', { name: 'Taasta veebirežiim', exact: true }).click();
    await page.waitForURL(url=>url.pathname==='/tallinn-transit/'); await ready(page);
    await expect.poll(()=>new URL(page.url()).searchParams.has('online')).toBe(false);
    await expect(page.getByRole('button', { name: 'Veebis', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const preserved = await page.evaluate(async () => ({ other: localStorage.getItem('other-app-value'), caches: await caches.keys(), registrations: (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname) }));
    expect(preserved.other).toBe('keep'); expect(preserved.caches).toContain('other-app-cache');
    expect(preserved.caches).toContain('tallinn-transit-preserved-pack'); expect(preserved.registrations).toContain('/other/');
    await page.screenshot({ path: '/tmp/tallinn-legacy-recovered.png' });
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

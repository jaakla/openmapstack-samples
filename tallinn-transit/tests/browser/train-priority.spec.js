import { test, expect } from '@playwright/test';

for (const width of [1440,390]) {
  test(`train marker stays visible where a bus shares its location (${width}px)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if(message.type() === 'error') errors.push(message.text()); });
    const point = { lon: 24.755, lat: 59.427 };
    // The city feed is merged before the rail feed. Placement must keep the
    // train label even when a city vehicle at the same point has first priority.
    await page.route(/\/(vehicles|trains)(?:\?|$)/, route => {
      const rail = new URL(route.request().url()).pathname.endsWith('/trains');
      return route.fulfill({ json: { vehicles: [{ ...point, id: rail ? 'elron:101' : 'bus:1', route: rail ? '101' : '1', mode: rail ? 'train' : 'bus', ...(rail ? {fixAt:new Date().toISOString()} : {}) }] },
        headers: { 'Last-Modified': new Date().toUTCString() } });
    });
    await page.goto('./');
    await expect(page.getByRole('button', {name:'Leia teekond',exact:true})).toBeEnabled({timeout:45000});
    await expect(page.locator('.journey-result').first()).toBeVisible();
    await expect(page.locator('.map-loading')).toHaveCount(0);
    await page.waitForFunction(()=>!document.querySelector('.map-canvas').__tallinnMap.isMoving());
    await page.locator('.map-canvas').evaluate((el,p)=>el.__tallinnMap.jumpTo({center:[p.lon,p.lat],zoom:15}),point);
    const trainLabels = () => page.locator('.map-canvas').evaluate(el=>{
      const map=el.__tallinnMap;
      return map.getLayer('vehicles') ? map.queryRenderedFeatures({layers:['vehicles']}).filter(f=>f.properties.id==='elron:101').length : 0;
    });
    await expect.poll(trainLabels).toBeGreaterThan(0);
    const modes = await page.locator('.map-canvas').evaluate(async el=>(await el.__tallinnMap.getSource('vehicles').getData()).features.map(f=>f.properties.mode));
    expect(modes.sort()).toEqual(['bus','train']);
    await page.screenshot({path:`/tmp/tallinn-train-priority-${width}.png`});
    await page.getByRole('button',{name:'Lülitu tumedale kaardile'}).click();
    await expect.poll(trainLabels).toBeGreaterThan(0);
    await page.getByRole('checkbox',{name:'Rongid',exact:true}).uncheck();
    await expect.poll(trainLabels).toBe(0);
    await page.getByRole('checkbox',{name:'Rongid',exact:true}).check();
    await expect.poll(trainLabels).toBeGreaterThan(0);
    const position=await page.locator('.map-canvas').evaluate((el,p)=>{const q=el.__tallinnMap.project([p.lon,p.lat]);return {x:q.x,y:q.y};},point);
    await page.locator('.map-canvas').click({position});
    await expect(page.locator('.map-inspection')).toContainText('Rong 101');
    expect(errors).toEqual([]);await context.close();
  });
}

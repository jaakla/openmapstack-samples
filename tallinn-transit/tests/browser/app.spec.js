import {test,expect} from '@playwright/test';

async function ready(page){
  await page.goto('./');await expect(page.getByRole('heading',{name:'Kuhu soovid minna?'})).toBeVisible({timeout:45000});
  await expect(page.getByRole('button',{name:'Leia teekond',exact:true})).toBeEnabled({timeout:45000});
}
async function morning(page){
  await page.getByLabel('Kuupäev',{exact:true}).fill('2026-10-28');await page.getByLabel('Väljumine',{exact:true}).fill('08:00');
  await page.getByRole('button',{name:'Leia teekond',exact:true}).click();await expect(page.locator('.journey-result').first()).toBeVisible({timeout:20000});
  await expect(page.getByRole('button',{name:'Leia teekond',exact:true})).toBeEnabled({timeout:20000});
}
async function vehicleCount(page){return page.evaluate(async()=>{const s=document.querySelector('.map-canvas')?.__tallinnMap?.getSource('vehicles');return s?(await s.getData()).features.length:0;});}
async function selectAddress(page,label,query){
  const input=page.getByRole('combobox',{name:label,exact:true});await input.fill(query);
  const result=page.getByRole('option').filter({hasText:'Aadress ·'}).first();await expect(result).toBeVisible({timeout:20000});await result.click();
}

test('Estonian rider flows, grouped stops, actual departures and colored numbered route segments',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready(page);await expect(page.locator('html')).toHaveAttribute('lang','et');await morning(page);
  await expect(page.locator('.map-error')).toHaveCount(0);
  await expect(page.locator('.live-card')).toContainText('Sõidukid reaalajas',{timeout:25000});
  const route=await page.evaluate(async()=>{const m=document.querySelector('.map-canvas').__tallinnMap;return {features:(await m.getSource('journey').getData()).features,paint:m.getPaintProperty('journey-line','line-color'),labels:m.getLayoutProperty('journey-labels','text-field')};});
  expect(route.features.some(f=>f.properties.mode==='tram'&&f.properties.lineLabel.includes('T'))).toBe(true);
  expect(JSON.stringify(route.paint)).toContain('#e45d46');expect(route.labels).toEqual(['get','lineLabel']);
  await page.getByRole('combobox',{name:'Lähtekoht',exact:true}).fill('Balti jaam');
  await expect(page.getByRole('option').filter({hasText:'Peatus ·'}).filter({has:page.locator('strong',{hasText:/^Balti jaam$/})})).toHaveCount(1);
  await page.getByRole('option').filter({hasText:'Peatus ·'}).first().click();
  await page.getByRole('button',{name:'Saabun hiljemalt',exact:true}).click();await page.getByLabel('Saabumine',{exact:true}).fill('09:00');await page.getByRole('button',{name:'Leia teekond',exact:true}).click();await expect(page.locator('.journey-result').first()).toBeVisible();
  await page.getByRole('tab',{name:'Peatused',exact:true}).click();await page.getByRole('textbox',{name:'Otsi peatust'}).fill('Viru');await page.locator('.stop-list>button').first().click();
  await expect(page.locator('.stop-detail')).toBeVisible();await expect(page.locator('.departures>div').first()).toBeVisible();
  await page.getByRole('tab',{name:'Info',exact:true}).click();await expect(page.getByRole('heading',{name:'Tallinn sinu taskus.'})).toBeVisible();await expect(page.locator('[data-openmapstack-credits]')).toContainText('tehisintellekti');
  expect(errors).toEqual([]);
});

test('live map positions survive pause/resume, layer toggles and repeated style changes; unknown speed is hidden',async({browser})=>{
  // Route interception must run outside a service worker; offline behavior has
  // a separate full-pack test with service workers enabled.
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  let requests=0;
  await page.route(/\/(?:api\/)?gps(?:\?|$)/,route=>{requests++;return route.fulfill({contentType:'text/plain',body:'3,T2,24740000,59438000,,138,501,Z,179,Lennujaam',headers:{'Last-Modified':new Date().toUTCString()}});});
  await ready(page);await morning(page);await expect.poll(()=>vehicleCount(page)).toBe(1);
  const initial=requests;await page.getByRole('button',{name:'Peata asukohtade uuendamine'}).click();await expect(page.locator('.live-card')).toContainText('pausil');await expect.poll(()=>vehicleCount(page)).toBe(1);
  await page.getByRole('button',{name:'Jätka asukohtade uuendamist'}).click();await expect.poll(()=>requests).toBeGreaterThan(initial);await expect.poll(()=>vehicleCount(page)).toBe(1);
  for(const layer of ['Bussid','Trammid','Peatused','Liinid']){
    const input=page.getByRole('checkbox',{name:layer,exact:true});await input.setChecked(false);await input.setChecked(true);
  }
  for(const name of ['Lülitu tumedale kaardile','Lülitu heledale kaardile','Lülitu tumedale kaardile']){
    await page.getByRole('button',{name}).click();await expect.poll(()=>vehicleCount(page)).toBe(1);
  }
  await page.waitForFunction(()=>{
    const m=document.querySelector('.map-canvas').__tallinnMap;
    return m.getLayer('vehicle-points')&&m.queryRenderedFeatures({layers:['vehicle-points']}).some(f=>f.properties.id==='501');
  });
  const position=await page.locator('.map-canvas').evaluate(el=>{const p=el.__tallinnMap.project([24.74,59.438]);return{x:p.x,y:p.y};});
  await page.locator('.map-canvas').click({position});await expect(page.locator('.map-inspection')).toContainText('Tramm T2');await expect(page.locator('.map-inspection')).not.toContainText(/undefined|null|km\/h/);
  await expect(page.locator('.map-error')).toHaveCount(0);
  await context.close();
});

test('real In-ADS door-to-door planning uses walking routes and multiple reachable platforms',async({page})=>{
  await ready(page);await selectAddress(page,'Lähtekoht','Vabaduse väljak 7');await selectAddress(page,'Sihtkoht','Telliskivi 60');await morning(page);
  await expect(page.locator('.itinerary')).toContainText('mööda tänavaid ja jalgteid');
  await expect(page.locator('.error-message')).toHaveCount(0);
  const walkLines=await page.evaluate(async()=>(await document.querySelector('.map-canvas').__tallinnMap.getSource('journey').getData()).features.filter(f=>f.properties.type==='walk'));
  expect(walkLines.length).toBeGreaterThan(0);expect(walkLines.some(f=>f.geometry.coordinates.length>3)).toBe(true);
});

test('map location popup offers both directions and highlights real walks to nearby grouped stops',async({page})=>{
  await ready(page);
  await page.locator('.map-canvas').evaluate(el=>el.__tallinnMap.jumpTo({center:[24.744069,59.432599],zoom:16}));
  const size=await page.locator('.map-canvas').boundingBox();await page.locator('.map-canvas').click({position:{x:size.width/2,y:size.height/2}});
  await expect(page.getByRole('button',{name:'Teekond siit',exact:true}).last()).toBeVisible();
  await expect(page.locator('.map-inspection')).toContainText('Jalgsi ligipääsetavad peatused',{timeout:20000});
  const paths=await page.evaluate(async()=>(await document.querySelector('.map-canvas').__tallinnMap.getSource('nearby').getData()).features);
  expect(paths.some(p=>p.geometry.coordinates.length>3)).toBe(true);
  await page.locator('.map-inspection').getByRole('button',{name:'Teekond siit',exact:true}).click();await expect(page.getByRole('tab',{name:'Teekond',exact:true})).toHaveAttribute('aria-selected','true');
});

test('explicit offline mode downloads automatically, removes GPS, routes after reload and restores online service',async({page,context})=>{
  await ready(page);await page.getByRole('button',{name:'Võrguta',exact:true}).click();await expect(page.locator('.toast')).toContainText('Salvestatud',{timeout:90000});
  await expect(page.getByRole('button',{name:'Võrguta',exact:true})).toHaveAttribute('aria-pressed','true');await expect.poll(()=>vehicleCount(page)).toBe(0);
  await context.setOffline(true);await page.reload();await expect(page.getByRole('button',{name:'Leia teekond',exact:true})).toBeEnabled({timeout:45000});await morning(page);
  await page.getByRole('button',{name:'Lülitu tumedale kaardile'}).click();await expect(page.locator('.map-error')).toHaveCount(0);
  const range=await page.evaluate(async()=>{const r=await fetch('map/tallinn.pmtiles',{headers:{Range:'bytes=0-126'}});return{status:r.status,bytes:(await r.arrayBuffer()).byteLength};});expect(range).toEqual({status:206,bytes:127});
  await expect(page.locator('.live-card')).toContainText('Võrguühenduseta');
  await context.setOffline(false);await page.getByRole('button',{name:'Veebis',exact:true}).click();await expect(page.locator('.live-card')).toContainText('Sõidukid reaalajas',{timeout:25000});await expect.poll(()=>vehicleCount(page)).toBeGreaterThan(0);
});

test('phone layout and Estonian keyboard autocomplete remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);
  const from=page.getByRole('combobox',{name:'Lähtekoht',exact:true});await from.fill('Estonia');await from.press('Enter');await expect(from).toHaveValue('Estonia');
  await page.getByRole('checkbox',{name:'Liinid',exact:true}).check();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.getByRole('tab',{name:'Info',exact:true}).click();await expect(page.getByRole('heading',{name:'Tallinn sinu taskus.'})).toBeVisible();
});

test('deployed GPS relay supports the browser HTTP cache without renewing validation time',async({page,context})=>{
  await ready(page);
  const session=await context.newCDPSession(page);await session.send('Network.enable');
  let cacheHits=0;session.on('Network.requestServedFromCache',()=>cacheHits++);
  session.on('Network.responseReceived',({response})=>{if(response.url.includes('workers.dev/gps')&&response.fromDiskCache)cacheHits++;});
  const result=await page.evaluate(async()=>{
    const url='https://tallinn-transit-api.jaak-laineste.workers.dev/gps';
    const get=async()=>{const r=await fetch(url,{cache:'default',credentials:'omit'});return{status:r.status,body:await r.text(),at:r.headers.get('X-GPS-Validated-At'),count:r.headers.get('X-GPS-Upstream-Requests'),policy:r.headers.get('Cache-Control')};};
    return [await get(),await get()];
  });
  expect(result[0].status).toBe(200);expect(result[1].status).toBe(200);
  expect(result[1].at).toBe(result[0].at);expect(result[1].count).toBe(result[0].count);expect(result[1].body).toBe(result[0].body);
  expect(result[0].policy).toBe('public, max-age=10, s-maxage=10, must-revalidate');
  await expect.poll(()=>cacheHits).toBeGreaterThan(0);
});

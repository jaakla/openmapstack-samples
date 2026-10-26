// Browser plugin not available; Playwright checks actual rendered controls and geography.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/home/jaak/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
const tileResponses=[];page.on('response',r=>{if(r.url().includes('tiles.goplex.ee/planet-20261006/')&&r.status()===200)tileResponses.push(r.url())});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const part=process.env.DP_CHECK_PART||'all';
const section=name=>part==='all'||part===name;
const settle=()=>page.waitForTimeout(800);
const mapSettled=async()=>{await page.waitForFunction(()=>window.__DP_MAP__?.areTilesLoaded()&&!window.__DP_MAP__.isMoving(),null,{timeout:60000});await settle();};
const visibility=id=>page.evaluate(id=>window.__DP_MAP__.getLayoutProperty(id,'visibility')||'visible',id);
try {
 await page.goto(process.env.DP_URL||'http://127.0.0.1:5178/');
 await page.waitForFunction(()=>window.__DP_MAP__?.getLayer('planned-3d'),{timeout:60000});
 await page.waitForTimeout(2500);
 assert.match(await page.title(),/Idaringtee/);
 assert.equal(await page.locator('html').getAttribute('lang'),'et');
 assert.equal(await page.getByRole('button',{name:'Suurenda',exact:true}).count(),1);
 assert.match(await page.locator('#panel-explore .numbers').innerText(),/10,18/);
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures({layers:['planned-3d']}).length>20,null,{timeout:60000});
 assert.equal(await page.getByRole('alert').count(),0);
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures().some(f=>f.source==='base-protomaps'),null,{timeout:60000});
 assert.ok(tileResponses.length>0,'Actual goplex vector tiles loaded');
 assert.match(await page.locator('[data-testid=legend]').innerText(),/Ärihoone.*ärimaa/s);
 assert.match(await page.locator('[data-testid=legend]').innerText(),/Ridaelamud/);
 await page.screenshot({path:'/tmp/detailplaneering-desktop.png'});
 console.log('Loaded vector map');
 if(section('basic')){
 await page.getByRole('button',{name:'Olemasolev',exact:true}).click();await settle();
 assert.equal(await visibility('planned-3d'),'none');assert.equal(await visibility('plots'),'none');assert.equal(await visibility('existing-3d'),'visible');
 await page.getByRole('button',{name:'Planeering',exact:true}).click();await settle();
 await page.getByRole('switch',{name:'Joonise ülekattekiht'}).check();await settle();assert.equal(await visibility('drawing'),'visible');
 await page.getByRole('switch',{name:'Joonise ülekattekiht'}).uncheck();
 await page.getByRole('button',{name:'2D',exact:true}).click();await page.waitForFunction(()=>window.__DP_MAP__.getPitch()===0);
 await page.getByRole('button',{name:'3D',exact:true}).click();await page.waitForFunction(()=>Math.abs(window.__DP_MAP__.getPitch()-56)<.1);
 console.log('Checked proposal/existing, drawing, 2D/3D');
 }
 if(section('themes')){
 await page.getByRole('switch',{name:'Tehnovõrgud',exact:true}).check();
 await page.getByRole('switch',{name:'Mõjuala seosed',exact:true}).check();
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures({layers:['utility-lines']}).length>0);
 assert.equal(await visibility('relation-lines'),'visible');
 await page.getByRole('button',{name:'2D',exact:true}).click();await page.waitForFunction(()=>window.__DP_MAP__.getPitch()===0);
 await mapSettled();
 await page.screenshot({path:'/tmp/detailplaneering-utilities.png'});
 await page.getByRole('switch',{name:'Veetoru',exact:true}).uncheck();
 assert.ok(!(await page.evaluate(()=>window.__DP_MAP__.getFilter('utility-lines')))[2][1].includes('water'));
 await page.getByRole('switch',{name:'Veetoru',exact:true}).check();
 await page.getByRole('button',{name:'Näita kogu ümbruskonda ↗',exact:true}).click();await settle();
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures({layers:['relation-points']}).length>3);
 await mapSettled();
 assert.equal(await page.evaluate(()=>window.__DP_MAP__.getTerrain()),null,'Wide view pauses local relief');
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures({layers:['existing-3d']}).length>500);
 await page.screenshot({path:'/tmp/detailplaneering-relations.png'});
 await page.getByRole('switch',{name:'Tehnovõrgud',exact:true}).uncheck();
 await page.getByRole('switch',{name:'Mõjuala seosed',exact:true}).uncheck();
 await page.getByRole('button',{name:'Taasta vaade',exact:true}).click();await settle();
 }
 if(section('orbit')){
 await page.getByRole('button',{name:'Pööra paremale',exact:true}).click();
 await page.waitForFunction(()=>Math.abs(window.__DP_MAP__.getBearing()+2)<1);
 await page.getByRole('button',{name:'Lohistamine: liiguta',exact:true}).click();
 const orbitBox=await page.locator('#map').boundingBox();const beforeOrbit=await page.evaluate(()=>[window.__DP_MAP__.getBearing(),window.__DP_MAP__.getPitch()]);
 await page.mouse.move(orbitBox.x+orbitBox.width*.5,orbitBox.y+orbitBox.height*.45);await page.mouse.down();await page.mouse.move(orbitBox.x+orbitBox.width*.5+100,orbitBox.y+orbitBox.height*.45+60,{steps:8});await page.mouse.up();await settle();
 const afterOrbit=await page.evaluate(()=>[window.__DP_MAP__.getBearing(),window.__DP_MAP__.getPitch()]);
 assert.ok(Math.abs(afterOrbit[0]-beforeOrbit[0])>20,'Left-button drag rotates');assert.ok(Math.abs(afterOrbit[1]-beforeOrbit[1])>8,'Left-button drag changes pitch');
 await page.getByRole('button',{name:'Lohistamine: pööra',exact:true}).click();
 await page.getByRole('button',{name:'Taasta vaade',exact:true}).click();await settle();
 }
 if(section('details')){
 const clickPoint=await page.evaluate(()=>{const m=window.__DP_MAP__;const f=m.queryRenderedFeatures({layers:['planned-3d']}).find(f=>f.geometry.type==='Polygon');const ring=f.geometry.coordinates[0];const c=ring.slice(0,-1).reduce((a,p)=>[a[0]+p[0]/(ring.length-1),a[1]+p[1]/(ring.length-1)],[0,0]);return m.project(c)});
 const box=await page.locator('#map').boundingBox();await page.mouse.click(box.x+clickPoint.x,box.y+clickPoint.y);await settle();
 assert.equal(await page.getByRole('region',{name:'Valitud objekt'}).count(),1);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('region',{name:'Valitud objekt'}).count(),0);
 await page.getByRole('button',{name:'Ümbruskond',exact:true}).click();await settle();
 assert.ok(await page.evaluate(()=>window.__DP_MAP__.getZoom()<15));
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures({layers:['existing-3d']}).length>500,{timeout:30000});
 await page.getByRole('button',{name:'Ortofoto',exact:true}).click();await settle();assert.equal(await visibility('aerial'),'visible');
 await page.screenshot({path:'/tmp/detailplaneering-neighbourhood.png'});
 await page.getByRole('switch',{name:'Maapinna reljeef'}).uncheck();await settle();assert.equal(await page.evaluate(()=>window.__DP_MAP__.getTerrain()),null);
 await page.getByRole('tab',{name:'Allikad',exact:true}).click();
 assert.equal(await page.locator('#panel-sources a[href$=".pdf"]').count(),6);
 assert.match(await page.locator('#panel-sources').innerText(),/a3df1cb8126d/);
 assert.match(await page.locator('#panel-sources').innerText(),/Analüüs koostatud/);
 assert.match(await page.locator('#panel-sources').innerText(),/ETAK-i hoonekontuurid/);
 assert.doesNotMatch(await page.locator('body').innerText(),/Reading this model|Generated with AI|Existing buildings|Decision 737|Unknown|ETAK reported height/);
 await page.screenshot({path:'/tmp/detailplaneering-sources-et.png'});
 await page.getByRole('tab',{name:'Kaart',exact:true}).click();
 await page.getByRole('button',{name:'Taasta vaade'}).click();await settle();
 await page.getByRole('button',{name:'Tume kujundus'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.waitForFunction(()=>window.__DP_MAP__.queryRenderedFeatures().some(f=>f.layer.id.startsWith('base-dark-')),null,{timeout:60000});
 assert.equal(await visibility('planned-3d'),'visible');
 await page.screenshot({path:'/tmp/detailplaneering-dark.png'});
 await page.getByRole('button',{name:'Hele kujundus'}).click();
 assert.equal(await page.getByRole('alert').count(),0,JSON.stringify(await page.evaluate(()=>window.__DP_MAP_ERRORS__)));
 }
 if(section('mobile')){
 await page.setViewportSize({width:390,height:844});await page.reload();await page.waitForFunction(()=>window.__DP_MAP__?.getLayer('planned-3d')&&window.__DP_MAP__.queryRenderedFeatures({layers:['planned-3d']}).length>20,null,{timeout:60000});await page.waitForTimeout(1500);
 await mapSettled();
 assert.equal(await page.getByRole('alert').count(),0,JSON.stringify(await page.evaluate(()=>window.__DP_MAP_ERRORS__)));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.intro h1').innerText(),'Uus osa Ihastest');
 assert.ok((await page.locator('#map').boundingBox()).height>300);
 await page.screenshot({path:'/tmp/detailplaneering-mobile.png'});
 }
 assert.equal(await page.getByRole('alert').count(),0,JSON.stringify(await page.evaluate(()=>window.__DP_MAP_ERRORS__)));
 assert.deepEqual(errors,[]);
 console.log(`PASS browser section: ${part}; no browser or map alerts.`);
} finally {await browser.close();}

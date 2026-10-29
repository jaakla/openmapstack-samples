import test from 'node:test';
import assert from 'node:assert/strict';
import { observeVehicles } from '../scripts/vehicle-motion.mjs';
import { GpsFeedCache, gpsResponse } from '../scripts/gps-cache.mjs';
const start=Date.parse('2026-10-29T08:00:00Z');
const row=({lon=24.74,lat=59.438,bearing='',speed='',route='1',id='42'}={})=>`2,${route},${Math.round(lon*1e6)},${Math.round(lat*1e6)},${speed},${bearing},${id},Z,100,Lennujaam`;
function run(sequence){let history={};return sequence.map(([t,args])=>{const next=observeVehicles(row(args),start+t*1000,history);history=next.history;return next;});}

test('first observation has native direction but no fabricated speed',()=>{
 const v=observeVehicles(row({bearing:90}),start).vehicles[0];assert.equal(v.bearing,90);assert.equal(v.bearingSource,'feed');assert.equal(v.speed,null);assert.equal(v.speedSource,null);
});
test('two northbound observations yield an approximate speed and fallback bearing',()=>{
 const result=run([[0,{}],[10,{lat:59.439}]]).at(-1).vehicles[0];
 assert.equal(result.bearing,0);assert.equal(result.bearingSource,'estimated');assert(result.speed>=39&&result.speed<=41);assert.equal(result.speedSource,'estimated');assert.equal(result.speedWindowSeconds,10);
});
test('native heading and native zero speed take priority over inferred movement',()=>{
 const result=run([[0,{}],[10,{lat:59.439,bearing:270,speed:0}]]).at(-1).vehicles[0];
 assert.equal(result.bearing,270);assert.equal(result.bearingSource,'feed');assert.equal(result.speed,0);assert.equal(result.speedSource,'feed');
});
test('recent baseline follows a turn, while average speed uses more than two points',()=>{
 const result=run([[0,{}],[10,{lat:59.4385}],[20,{lat:59.439}],[30,{lat:59.439,lon:24.741}]]).at(-1).vehicles[0];
 assert.equal(result.bearing,90);assert.equal(result.samples,4);assert.equal(result.speedWindowSeconds,30);assert(result.speed>15&&result.speed<30);
});
test('stationary jitter produces neither estimated speed nor an invented heading',()=>{
 for(const {vehicles} of run([[0,{}],[10,{lat:59.43801}],[20,{lon:24.74001}],[30,{lat:59.43799}]])){
  assert.equal(vehicles[0].speed,null);assert.equal(vehicles[0].bearing,null);
 }
});
test('long gaps, impossible jumps and route changes reset motion estimates',()=>{
 for(const sequence of [ [[0,{}],[70,{lat:59.439}]], [[0,{}],[10,{lat:59.5}]], [[0,{}],[10,{lat:59.439,route:'2'}]] ]){
  const v=run(sequence).at(-1).vehicles[0];assert.equal(v.samples,1);assert.equal(v.speed,null);assert.equal(v.bearing,null);
 }
});
test('duplicate source timestamps do not add points and history is time-bounded',()=>{
 const a=observeVehicles(row(),start),b=observeVehicles(row(),start,a.history);assert.equal(b.vehicles[0].samples,1);
 const c=observeVehicles(row({id:'43'}),start+121000,b.history);assert.deepEqual(Object.keys(c.history),['bus:43']);
 const result=run(Array.from({length:20},(_,i)=>[i*10,{lat:59.438+i*0.0001}])).at(-1).vehicles[0];assert(result.samples<=6);assert(result.speedWindowSeconds<=40);
});
test('invalid heading is absent; 0 degrees is a valid north heading',()=>{
 for(const bearing of [-1,360,'undefined',''])assert.equal(observeVehicles(row({bearing}),start).vehicles[0].bearing,null);
 assert.equal(observeVehicles(row({bearing:0}),start).vehicles[0].bearing,0);
});
test('304 and cache hits never create observation points; raw CSV stays unchanged',async()=>{
 let now=start,calls=0;
 const feed=new GpsFeedCache({now:()=>now,fetch:async()=>++calls===1?new Response(row({bearing:45}),{headers:{'Last-Modified':new Date(start).toUTCString(),ETag:'"a"'}}):new Response(null,{status:304})});
 const a=await feed.get();now+=10000;const b=await feed.get();
 assert.equal(JSON.parse(b.vehiclesBody).vehicles[0].samples,1);assert.equal(a.vehiclesBody,b.vehiclesBody);
 assert.equal(await gpsResponse(b,new Request('https://relay/gps')).text(),row({bearing:45}));
 const res=gpsResponse(b,new Request('https://relay/vehicles'));assert(res.headers.get('Content-Type').includes('application/json'));assert.equal((await res.json()).vehicles[0].bearing,45);
 assert.notEqual(gpsResponse(b,new Request('https://relay/gps')).headers.get('ETag'),gpsResponse(b,new Request('https://relay/vehicles')).headers.get('ETag'));
});
test('old persistent CSV snapshot upgrades without an extra source request',async()=>{
 const snapshot={body:row({bearing:45}),etag:'W/"native"',validatedAt:start,upstreamRequests:1,upstreamStatus:200};
 const r=gpsResponse(snapshot,new Request('https://relay/vehicles'),{now:start});assert.equal((await r.json()).vehicles[0].bearing,45);assert(!r.headers.get('ETag').includes('undefined'));
});

test('expired inferred values are hidden while native fields remain usable',async()=>{
 const {cleanVehicle}=await import('../src/transit.js');
 const value={speed:25,bearing:90,speedSource:'estimated',bearingSource:'estimated',motionObservedAt:new Date(start).toISOString()};
 assert.equal(cleanVehicle(value,start+10000).speed,25);assert.equal(cleanVehicle(value,start+46000).speed,null);assert.equal(cleanVehicle(value,start+61000).bearing,null);
 assert.equal(cleanVehicle({...value,speedSource:'feed',bearingSource:'feed'},start+61000).speed,25);
});

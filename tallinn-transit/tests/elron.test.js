import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ElronFeedCache,ELRON_UPSTREAM,parseElron,elronTime,RAIL_BOUNDS} from '../scripts/elron-feed.mjs';
import {gpsResponse} from '../scripts/gps-cache.mjs';
import {planJourney,searchStations} from '../src/transit.js';
const at=Date.parse('2026-10-29T07:30:22Z');
const row={reis:'101',liin:'Tartu-Tallinn',longitude:'24.74446',latitude:'59.418498',asukoha_uuendus:'2026-10-29 09:30:19',kiirus:'61',rongi_suund:'304'};
const body=rows=>JSON.stringify({status:'ok',data:rows});

test('Elron native measurements have a real fix timestamp, speed and direction',()=>{
 const v=parseElron(body([row]),at)[0];assert.equal(v.mode,'train');assert.equal(v.id,'elron:101');assert.equal(v.speed,61);assert.equal(v.bearing,304);assert.equal(v.fixAt,'2026-10-29T07:30:19.000Z');
 assert.equal(elronTime('2026-07-01 09:30:19'),Date.parse('2026-07-01T06:30:19Z'));
 assert.equal(elronTime('2026-10-29 09:30:19'),Date.parse('2026-10-29T07:30:19Z'));assert.equal(elronTime('2026-02-31 09:30:19'),null);
 assert.equal(elronTime('2026-10-25 03:30:00',Date.parse('2026-10-25T00:30:05Z')),Date.parse('2026-10-25T00:30:00Z'));
 assert.equal(elronTime('2026-10-25 03:30:00',Date.parse('2026-10-25T01:30:05Z')),Date.parse('2026-10-25T01:30:00Z'));
});
test('Elron excludes stale/future/out-of-coverage fixes and hides unavailable fields',()=>{
 assert.equal(parseElron(body([row]),at+180000).length,0);
 for(const extra of [{longitude:'26.1'},{longitude:''},{latitude:null},{asukoha_uuendus:'2026-10-29 10:30:19'},{asukoha_uuendus:''}])assert.equal(parseElron(body([{...row,...extra}]),at).length,0);
 const v=parseElron(body([{...row,kiirus:'undefined',rongi_suund:'360'}]),at)[0];assert.equal(v.speed,null);assert.equal(v.bearing,null);
 assert.deepEqual(parseElron(body([]),at),[]);assert.throws(()=>parseElron('{"data":null}',at));
});
test('Elron uses one global conditional request per ten seconds despite the upstream two-week lifetime',async()=>{
 let now=at,calls=[];const cache=new ElronFeedCache({now:()=>now,fetch:async(...args)=>{calls.push(args);return calls.length===1?new Response(body([row]),{headers:{ETag:'"rail-v1"','Cache-Control':'max-age=1209600'}}):new Response(null,{status:304});}});
 const values=await Promise.all(Array.from({length:100},()=>cache.get()));assert.equal(calls.length,1);assert(values.every(v=>v===values[0]));assert.equal(calls[0][0],ELRON_UPSTREAM);assert.equal(calls[0][1].cache,'no-store');
 now+=9999;await cache.get();assert.equal(calls.length,1);now++;const next=await cache.get();assert.equal(calls.length,2);assert.equal(calls[1][1].headers['If-None-Match'],'"rail-v1"');assert.equal(next.vehiclesBody,values[0].vehiclesBody);
 const response=gpsResponse(next,new Request('https://example.test/trains'),{now});assert.match(response.headers.get('Content-Type'),/application\/json/);assert.equal(response.headers.get('Cache-Control'),'public, max-age=10, s-maxage=10, must-revalidate');assert.equal((await response.json()).vehicles[0].id,'elron:101');
 const head=gpsResponse({...next,body:'',vehiclesBody:''},new Request('https://example.test/trains',{method:'HEAD'}),{now});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('pinned Elron fixture confirms the public operator schema without replaying it live',()=>{
 const vehicles=parseElron(fs.readFileSync(new URL('../data/source/elron-gps-snapshot.json',import.meta.url),'utf8'),at);assert(vehicles.length>0);assert(vehicles.every(v=>v.fixAt&&v.lon>=RAIL_BOUNDS[0]&&v.lon<=RAIL_BOUNDS[2]));
});
test('real rail timetable supports both directions, mode filters and bus/train interchanges',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../data/derived/network.json',import.meta.url)));
 const station=name=>searchStations(d,name,50).find(s=>s.name===name);
 assert(d.routes.some(r=>r.mode==='train'));assert.equal(d.stops.filter(s=>s.sourceName==='Tallinn').length,2);
 const balti=station('Balti jaam');assert(balti.members.some(i=>d.stops[i].mode==='train'));assert(balti.members.some(i=>d.stops[i].mode!=='train'));
 const access=balti.members.map(stop=>({stop,seconds:0,metres:0}));const egress=station('Nõmme').members.map(stop=>({stop,seconds:0,metres:0}));
 const request={access,egress,from:null,to:null,date:'2026-10-29',time:'08:00',mode:'train',maxWalk:1000,maxTransfers:2};
 const rail=planJourney(d,request);assert(rail.length>0);assert(rail[0].legs.some(l=>l.type==='ride'&&d.routes[l.route].mode==='train'));
 const reverse=planJourney(d,{...request,time:'09:00',arriveBy:true});assert(reverse.length>0);assert(reverse[0].arrival<=9*3600);
 // Actual OSM transfer links attach the rail platforms to the city's stops.
 assert(d.stops.some((s,i)=>s.mode==='train'&&d.transfers[i].some(([j])=>d.stops[j].mode!=='train')));
 const mixed=planJourney(d,{...request,mode:'all',access:station('Laagri').members.map(stop=>({stop,seconds:0,metres:0})),egress:station('Viru').members.map(stop=>({stop,seconds:0,metres:0}))});
 assert(mixed.some(j=>j.legs.some(l=>l.type==='ride'&&d.routes[l.route].mode==='train')&&j.legs.some(l=>l.type==='ride'&&d.routes[l.route].mode==='tram')&&j.legs.some(l=>l.type==='walk'&&l.coordinates.length>2)));
 assert.deepEqual(d.railBounds,RAIL_BOUNDS);
});

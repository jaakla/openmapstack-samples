import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activeServices, addDays, clock, departures, parseGPS, planJourney, searchStops,searchStations,cleanVehicle, tallinnNow } from '../src/transit.js';

// Minimal synthetic timetable fixtures test algorithms, never the delivered map.
const calendar=[{id:'daily',start:'20260101',end:'20261231',days:[1,1,1,1,1,1,1]}];
function trip(id,r,stops,minutes,extra={}){return {id,r,stops,service:'daily',arrivals:minutes.map(m=>m*60),departures:minutes.map(m=>m*60),pickup:stops.map(()=>0),dropoff:stops.map(()=>0),shape:id,headsign:'End',...extra};}
function fixture(trips){return {stops:[0,1,2,3].map(i=>({id:String(i),name:`Stop ${i}`,code:`P${i}`})),routes:[{name:'1',mode:'bus'},{name:'T2',mode:'tram'}],trips,calendar,exceptions:[],transfers:[[],[],[],[]]};}
const query={from:0,to:2,date:'2026-10-28',time:'08:00',maxTransfers:2};
test('direct journey respects departure time and direction',()=>{
 const d=fixture([trip('a',0,[0,1,2],[481,490,500]),trip('b',0,[2,1,0],[480,490,500])]);
 const r=planJourney(d,query);assert.equal(r[0].departure,481*60);assert.equal(r[0].arrival,500*60);assert.equal(r[0].transfers,0);
 assert(planJourney(d,{...query,time:'08:02'}).every(j=>j.departure>=86400+481*60));
});
test('transfer rounds enforce both max transfers and 120-second interchange',()=>{
 const d=fixture([trip('a',0,[0,1],[480,490]),trip('too-early',1,[1,2],[491,498]),trip('b',1,[1,2],[493,505])]);
 assert.equal(planJourney(d,{...query,maxTransfers:0}).length,0);
 const j=planJourney(d,{...query,maxTransfers:1})[0];assert.equal(j.arrival,505*60);assert.equal(j.transfers,1);assert.equal(j.legs[1].trip,'b');
});
test('arrive-by yields latest feasible departure and never misses the deadline',()=>{
 const d=fixture([trip('a',0,[0,1,2],[480,490,500]),trip('b',0,[0,1,2],[490,500,510]),trip('c',0,[0,1,2],[500,510,520])]);
 const j=planJourney(d,{...query,arriveBy:true,time:'08:31'})[0];assert.equal(j.departure,490*60);assert.equal(j.arrival,510*60);
});
test('reverse routing applies transfer slack before earlier leg selection',()=>{
 const d=fixture([trip('a',0,[0,1],[480,490]),trip('b',1,[1,2],[493,505]),trip('late',0,[0,1],[485,492])]);
 const j=planJourney(d,{...query,arriveBy:true,time:'08:26'})[0];assert.equal(j.departure,480*60);assert.equal(j.legs[0].trip,'a');
});
test('calendar exceptions add and remove service including next/previous dates',()=>{
 const d=fixture([]);d.exceptions=[['daily','20261028',2],['special','20261028',1]];
 assert.deepEqual([...activeServices(d,'2026-10-28')],['special']);assert(activeServices(d,'2026-10-29').has('daily'));
 assert.equal(addDays('2026-12-31',1),'2027-01-01');
});
test('previous service day 24:xx trip is available after midnight',()=>{
 const d=fixture([trip('night',0,[0,2],[24*60+10,24*60+40])]);
 d.calendar=[{id:'daily',start:'20261027',end:'20261027',days:[1,1,1,1,1,1,1]}];
 const j=planJourney(d,{...query,time:'00:05'})[0];assert.equal(j.departure,600);assert.equal(j.arrival,2400);
 assert.equal(clock(25*3600),'01:00 (+1 p)');
});
test('pickup and dropoff restrictions are honored in both directions',()=>{
 const d=fixture([trip('restricted',0,[0,1,2],[480,490,500],{pickup:[1,0,0]})]);
 assert.equal(planJourney(d,query).length,0);assert.equal(planJourney(d,{...query,time:'08:30',arriveBy:true}).length,0);
 d.trips[0].pickup=[0,0,0];d.trips[0].dropoff=[0,0,1];
 assert.equal(planJourney(d,query).length,0);assert.equal(planJourney(d,{...query,time:'08:30',arriveBy:true}).length,0);
});
test('mode filtering and walking transfer graph affect actual journeys',()=>{
 const d=fixture([trip('a',0,[0,1],[480,490]),trip('b',1,[3,2],[495,505])]);
 d.transfers[1]=[[3,120,110]];d.transfers[3]=[[1,120,110]];
 const j=planJourney(d,query)[0];assert.equal(j.legs.length,3);assert.equal(j.legs[1].type,'walk');assert.equal(j.arrival,505*60);
 assert.equal(planJourney(d,{...query,mode:'bus'}).length,0);
 assert.equal(planJourney(d,{...query,mode:['bus','tram']})[0].arrival,505*60);
 assert.equal(planJourney(d,{...query,mode:['bus','train']}).length,0);
 assert.equal(planJourney(d,{...query,mode:[]}).length,0);
 assert.equal(planJourney(d,{...query,arriveBy:true,time:'08:30',mode:['bus','tram']})[0].departure,480*60);
 const reverse=planJourney(d,{...query,arriveBy:true,time:'08:30'})[0];assert.equal(reverse.departure,480*60);
});
test('Tallinn timezone is explicit across DST and foreign device zones',()=>{
 assert.deepEqual(tallinnNow(new Date('2026-10-28T12:30:00Z')),{date:'2026-10-28',time:'14:30'});
 assert.deepEqual(tallinnNow(new Date('2026-07-01T22:30:00Z')),{date:'2026-07-02',time:'01:30'});
});
test('GPS parser follows provider microdegree coordinates and rejects HTML',()=>{
 const v=parseGPS('3,T2,24762270,59433620,,138,501,Z,179,Lennujaam')[0];
 assert.equal(v.lon,24.76227);assert.equal(v.lat,59.43362);assert.equal(v.id,'501');assert.equal(v.headsign,'Lennujaam');assert.equal(v.mode,'tram');assert.equal(v.speed,null);
 assert.throws(()=>parseGPS('<html>forbidden</html>'));assert.throws(()=>parseGPS('2,1,0,0,,1,12'));
});
test('real source snapshot builds searchable stops and valid journeys',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../data/derived/network.json',import.meta.url)));
 assert.equal(d.routes.find(r=>r.name==='T1').mode,'tram');
 const stop=q=>searchStops(d,q,100).find(s=>s.name===q).index;
 const j=planJourney(d,{...query,from:stop('Balti jaam'),to:stop('Lennujaam'),time:'08:00'});
 assert(j.length>0);assert(j.every(x=>x.arrival>=x.departure&&x.legs.some(l=>l.type==='ride')));
 for(const x of j)for(const l of x.legs.filter(l=>l.type==='ride')){const t=d.trips.find(t=>t.id===l.trip);assert.equal(t.stops[l.fromSeq],l.from);assert.equal(t.stops[l.toSeq],l.to);}
 assert(departures(d,stop('Balti jaam'),'2026-10-28','08:00').length>0);
 assert(searchStops(d,'Balti').length>0);
 assert(parseGPS(fs.readFileSync(new URL('../data/source/gps-snapshot.txt',import.meta.url),'utf8')).length>0);
});
test('address access compares farther platforms instead of choosing only the nearest',()=>{
 const d=fixture([trip('near-but-slow',0,[0,2],[482,540]),trip('far-but-fast',1,[1,2],[486,500])]);
 const access=[{stop:0,seconds:60,metres:75,coordinates:[[24,59],[24.001,59]]},{stop:1,seconds:300,metres:375,coordinates:[[24,59],[24.005,59]]}];
 const j=planJourney(d,{...query,from:null,to:null,access,egress:[{stop:2,seconds:0}],fromLabel:'Lähteaadress',toLabel:'Sihtaadress'})[0];
 assert.equal(j.arrival,500*60);assert.equal(j.legs.find(l=>l.type==='ride').trip,'far-but-fast');assert.equal(j.legs[0].to,1);
 const reverse=planJourney(d,{...query,from:null,to:null,access,egress:[{stop:2,seconds:60,metres:75}],fromLabel:'Lähteaadress',toLabel:'Sihtaadress',arriveBy:true,time:'08:25'})[0];
 assert.equal(reverse.departure,481*60);assert.equal(reverse.arrival,501*60);
});
test('same-name platforms have one station listing and unknown GPS fields stay absent',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../data/derived/network.json',import.meta.url)));
 const stations=searchStations(d,'Balti jaam');assert.equal(stations.filter(s=>s.name==='Balti jaam').length,1);assert(stations[0].members.length>1);
 for(const value of [undefined,null,'','undefined','null',NaN,Infinity])assert.equal(cleanVehicle({speed:value}).speed,null);
 assert.equal(cleanVehicle({speed:'0'}).speed,0);assert.equal(cleanVehicle({speed:22}).speed,22);
});
test('a transfer walk cannot extend the final door walk beyond its selected limit',()=>{
 const d=fixture([trip('a',0,[0,1],[480,490])]);d.transfers[1]=[[2,480,600]];
 const result=planJourney(d,{...query,access:[{stop:0,seconds:0}],egress:[{stop:2,seconds:800,metres:1000}],maxWalk:1000});
 assert.equal(result.length,0);
 d.trips.push(trip('slower-valid',0,[0,2],[485,505]));
 const valid=planJourney(d,{...query,access:[{stop:0,seconds:0}],egress:[{stop:2,seconds:800,metres:1000}],maxWalk:1000});
 assert.equal(valid[0].legs.find(l=>l.type==='ride').trip,'slower-valid');assert.equal(valid[0].arrival,505*60+800);
});

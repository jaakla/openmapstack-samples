import { planJourney, departures } from './transit.js';
import { WalkingRouter } from './walking.js';
let data,walking;
function endpoint(point,limit,reverse=false) {
  if(point.kind==='station')return [
    ...point.members.map(stop=>({stop,seconds:0,metres:0})),
    ...walking.nearby(point,limit,reverse).filter(p=>!point.members.includes(p.stop)),
  ];
  return walking.nearby(point,limit,reverse);
}
self.onmessage = ({ data: message }) => {
  try {
    let result;
    if (message.type === 'init') { data = message.data;walking=new WalkingRouter(message.walking,data.stops);result=true; }
    else if (message.type === 'nearby') result=walking.nearby(message.point,message.limit||1000,message.reverse||false);
    else if (message.type === 'plan') {
      const r=message.request;
      if(typeof r.from==='object'){
        const access=endpoint(r.from,r.maxWalk||1000),egress=endpoint(r.to,r.maxWalk||1000,true);
        if(!access.length||!egress.length)throw new Error('Ühest valitud kohast ei leitud jalgsikäigu ulatuses ligipääsetavat peatust. Suurenda jalgsikäigu ulatust või vali teine koht.');
        const directWalk=r.from.kind!=='station'&&r.to.kind!=='station'?walking.route(walking.addPoint(r.from),walking.addPoint(r.to),r.maxWalk||1000):null;
        result=planJourney(data,{...r,access,egress,directWalk,fromLabel:r.from.name,toLabel:r.to.name});
      }else result=planJourney(data,r);
    }
    else if (message.type === 'departures') {
      const [stops,date,time]=message.args;
      const list=(Array.isArray(stops)?stops:[stops]).flatMap(stop=>departures(data,stop,date,time).map(d=>({...d,stop})));
      result=[...new Map(list.sort((a,b)=>a.time-b.time).map(d=>[`${d.trip}:${d.time}`,d])).values()].slice(0,24);
    }
    self.postMessage({id:message.id,result});
  } catch (error) { self.postMessage({ id: message.id, error: error.message }); }
};

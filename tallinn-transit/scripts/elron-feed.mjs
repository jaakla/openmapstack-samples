import { GpsFeedCache, FeedUnavailable } from './gps-cache.mjs';
import { finiteNumber } from '../src/transit.js';

export const ELRON_UPSTREAM='https://elron.ee/map_data.json';
export const RAIL_BOUNDS=[24.45,59.28,25.04,59.57];

// Source timestamps have no offset. Resolve Europe/Tallinn explicitly, including
// summer time; the browser/server's local timezone must never affect fix age.
export function elronTime(value,now=Date.now()) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return null;
  const wall=Date.parse(value.replace(' ','T')+'Z');
  const candidates=[];
  for(const offset of [2,3]){
    const at=wall-offset*3600000;
    const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Tallinn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(at));
    if(parts===value)candidates.push(at);
  }
  // During the repeated autumn hour, use the most recent occurrence that is
  // not in the future. This keeps first-hour fixes from jumping forward 1 h.
  return candidates.filter(at=>at<=now+30000).sort((a,b)=>b-a)[0] ?? candidates[0] ?? null;
}
export function parseElron(body,now=Date.now()) {
  const payload=JSON.parse(body);
  if(!Array.isArray(payload?.data))throw new FeedUnavailable();
  return payload.data.flatMap(row=>{
    const lon=finiteNumber(row.longitude),lat=finiteNumber(row.latitude),at=elronTime(row.asukoha_uuendus,now);
    if(!row.reis||lon===null||lat===null||lon<RAIL_BOUNDS[0]||lon>RAIL_BOUNDS[2]||lat<RAIL_BOUNDS[1]||lat>RAIL_BOUNDS[3]||at===null||now-at>180000||at-now>30000)return [];
    const speed=finiteNumber(row.kiirus),bearing=finiteNumber(row.rongi_suund);
    return [{id:`elron:${row.reis}`,tripNumber:String(row.reis),route:String(row.reis),mode:'train',lon,lat,
      headsign:typeof row.liin==='string'?row.liin:'',fixAt:new Date(at).toISOString(),
      speed:speed!==null&&speed>=0&&speed<=250?speed:null,bearing:bearing!==null&&bearing>=0&&bearing<360?bearing:null,
      speedSource:'feed',bearingSource:'feed',source:'Elron'}];
  });
}
// An out-of-area/empty result is valid, but in-area expired fixes must not
// become a healthy empty feed merely because parseElron filters them out.
export function elronObservation(body, now = Date.now()) {
  const payload = JSON.parse(body);
  if (!Array.isArray(payload?.data)) throw new FeedUnavailable();
  const rows = payload.data.filter(row => {
    const lon = finiteNumber(row.longitude), lat = finiteNumber(row.latitude);
    return row.reis && lon !== null && lat !== null && lon >= RAIL_BOUNDS[0] && lon <= RAIL_BOUNDS[2] && lat >= RAIL_BOUNDS[1] && lat <= RAIL_BOUNDS[3];
  });
  if (!rows.length) return { empty: true, timestamp: null };
  const timestamps = rows.map(row => elronTime(row.asukoha_uuendus, now));
  if (timestamps.some(at => at === null || at > now + 30000)) throw new FeedUnavailable(10, 200, 'invalid_response', 'invalid_fix_timestamp');
  return { empty: false, timestamp: Math.max(...timestamps) };
}
export class ElronFeedCache extends GpsFeedCache {
  constructor(options={}){super({...options,upstream:ELRON_UPSTREAM,referer:'https://elron.ee/',parseVehicles:parseElron,sourceObservation:elronObservation,storageKey:'elron'});}
}

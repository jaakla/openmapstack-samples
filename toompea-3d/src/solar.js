import {getPosition,getTimes} from 'suncalc';
export const SOLAR_ZONE='Europe/Tallinn';
const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:SOLAR_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:SOLAR_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function parts(date){return Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
function wallStamp(p){return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);}
export function tallinnInstant(day,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(time))throw new Error('Select a valid date and time.');
  const [year,month,d]=day.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  if(year<2000||year>2100||month<1||month>12||d<1||d>31||hour>23||minute>59)throw new Error('Choose a date from 2000–2100 and a valid local time.');
  const naive=Date.UTC(year,month-1,d,hour,minute),canonical=new Date(naive);
  if(canonical.getUTCMonth()!==month-1||canonical.getUTCDate()!==d)throw new Error('This calendar date does not exist.');
  const offsets=new Set([-86400000,0,86400000].map(delta=>wallStamp(parts(new Date(naive+delta)))-(naive+delta)));
  const candidates=[...offsets].map(offset=>new Date(naive-offset)).filter(date=>wallStamp(parts(date))===naive).sort((a,b)=>a-b);
  if(!candidates.length)throw new Error('Tallinn clocks skip this local time when daylight saving starts. Choose another time.');
  const date=candidates[0],offset=(naive-date.valueOf())/3600000;
  return {date,offset,ambiguous:candidates.length>1,zoneLabel:`${offset===3?'EEST':'EET'} · UTC+${String(offset).padStart(2,'0')}:00`};
}
export function solarStudy(day,time,reference){
  try{
    const instant=tallinnInstant(day,time),position=getPosition(instant.date,reference.latitude,reference.longitude);
    const noon=tallinnInstant(day,'12:00').date;
    const times=getTimes(noon,reference.latitude,reference.longitude,0,instant.offset*60);
    const azimuth=((position.azimuth-reference.grid_convergence_degrees)%360+360)%360,az=azimuth*Math.PI/180,alt=position.altitude*Math.PI/180;
    const format=t=>t instanceof Date&&Number.isFinite(t.valueOf())?clock.format(t):'—';
    return {valid:true,...instant,utc:instant.date.toISOString(),altitude:position.altitude,azimuth:position.azimuth,gridAzimuth:azimuth,daylight:position.altitude>0,direction:[Math.sin(az)*Math.cos(alt),Math.sin(alt),-Math.cos(az)*Math.cos(alt)],sunrise:format(times.sunrise),sunset:format(times.sunset)};
  }catch(error){return {valid:false,error:error.message};}
}

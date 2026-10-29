// Pure timetable engine. A round is one boarding; each round reads only the
// preceding round's labels, so maxTransfers is a real constraint. No network I/O.
export const DAY = 86400;
export const TRANSFER_SECONDS = 120;
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function tallinnNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const seconds = value => value.split(':').reduce((a, x, i) => a + Number(x) * [3600, 60, 1][i], 0);
export function clock(value) {
  const day = Math.floor(value / DAY);
  const normalized = ((value % DAY) + DAY) % DAY;
  return `${String(Math.floor(normalized / 3600)).padStart(2, '0')}:${String(Math.floor(normalized % 3600 / 60)).padStart(2, '0')}${day ? ` (${day > 0 ? '+' : ''}${day} p)` : ''}`;
}
export function activeServices(data, date) {
  const key = date.replaceAll('-', '');
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const set = new Set(data.calendar.filter(c => c.start <= key && key <= c.end && c.days[weekday]).map(c => c.id));
  for (const [id, d, type] of data.exceptions) if (d === key) type === 1 ? set.add(id) : set.delete(id);
  return set;
}
export function serviceTrips(data, date, mode = 'all') {
  return [-1, 0, 1].flatMap(day => {
    const services = activeServices(data, addDays(date, day));
    return data.trips.filter(t => services.has(t.service) && (mode === 'all' || data.routes[t.r].mode === mode))
      .map(trip => ({ trip, offset: day * DAY }));
  });
}
const validPickup = value => value == null || value === 0; // no phone/driver-arranged services
const validDropoff = validPickup;
const isBetter = (a, b, reverse) => reverse ? a > b : a < b;
const reverseTransferCache = new WeakMap();
function transferEdges(data, reverse) {
  if (!reverse) return data.transfers;
  if (!reverseTransferCache.has(data)) {
    const incoming = data.stops.map(()=>[]);
    data.transfers.forEach((edges,i)=>edges.forEach(([j,d,m,c])=>incoming[j].push([i,d,m,c])));
    reverseTransferCache.set(data,incoming);
  }
  return reverseTransferCache.get(data);
}
function relaxWalk(data, labels, changed, reverse) {
  // One precomputed, bounded walk between rides; never chain walking edges.
  const updates = [];
  for (const i of changed) {
    const label = labels[i];
    for (const [j, duration, metres, coordinates] of transferEdges(data,reverse)[i] || []) {
      const time = label.time + (reverse ? -duration : duration);
      if (isBetter(time, labels[j]?.time ?? (reverse ? -Infinity : Infinity), reverse)) {
        const leg = { type: 'walk', from: reverse ? j : i, to: reverse ? i : j,
          departure: reverse ? time : label.time, arrival: reverse ? label.time : time, metres, coordinates };
        updates.push([j, { time, legs: reverse ? [leg, ...label.legs] : [...label.legs, leg] }]);
      }
    }
  }
  for (const [j, label] of updates) if (isBetter(label.time, labels[j]?.time ?? (reverse ? -Infinity : Infinity), reverse)) labels[j] = label;
}
function endpointLeg(path, time, outgoing, label) {
  return {type:'walk',from:outgoing?null:path.stop,to:outgoing?path.stop:null,
    fromLabel:outgoing?label:undefined,toLabel:outgoing?undefined:label,
    departure:time,arrival:time+path.seconds,metres:path.metres,coordinates:path.coordinates};
}
function scan(data, trips, from, to, time, reverse, maxTransfers, endpoints) {
  const access=endpoints?.access||[{stop:from,seconds:0}],egress=endpoints?.egress||[{stop:to,seconds:0}];
  let prev = Array(data.stops.length).fill(null);
  for(const path of reverse?egress:access){
    const at=time+(reverse?-path.seconds:path.seconds);
    prev[path.stop]={time:at,legs:path.seconds?[endpointLeg(path,reverse?at:time,!reverse,reverse?endpoints?.toLabel:endpoints?.fromLabel)]:[]};
  }
  // Explicit endpoint access already contains every permitted walking route.
  // Chaining a transfer here would silently exceed the selected walking limit.
  if(!endpoints?.access)relaxWalk(data, prev, (reverse?egress:access).map(p=>p.stop), reverse);
  const results = [];
  const goals=new Map((reverse?access:egress).map(p=>[p.stop,p]));
  for (let round = 0; round <= maxTransfers; round++) {
    const cur = prev.slice(), changed = new Set();
    let best=null;
    function considerGoal(label,path) {
      if(!label?.legs.some(x=>x.type==='ride'))return;
      if(endpoints?.maxWalk){
        const legs=reverse?label.legs:label.legs.slice().reverse();let walking=path.metres||0;
        for(const leg of legs){if(leg.type!=='walk')break;walking+=leg.metres||0;}
        if(walking>endpoints.maxWalk)return;
      }
      const at=label.time+(reverse?-path.seconds:path.seconds);
      if(!best||isBetter(at,best.time,reverse)){
        const leg=path.seconds?endpointLeg(path,reverse?at:label.time,reverse,reverse?endpoints?.fromLabel:endpoints?.toLabel):null;
        best={time:at,legs:leg?(reverse?[leg,...label.legs]:[...label.legs,leg]):label.legs};
      }
    }
    for (const { trip: t, offset } of trips) {
      let boarded = null;
      const count = t.stops.length;
      for (let n = 0; n < count; n++) {
        const k = reverse ? count - 1 - n : n, stop = t.stops[k];
        const arr = t.arrivals[k] + offset, dep = t.departures[k] + offset;
        if (boarded && (reverse ? validPickup(t.pickup[k]) : validDropoff(t.dropoff[k]))) {
          const candidateTime = reverse ? dep : arr;
          const improves=isBetter(candidateTime, cur[stop]?.time ?? (reverse ? -Infinity : Infinity), reverse);
          if (improves || goals.has(stop)) {
            const leg = { type: 'ride', route: t.r, trip: t.id, shape: t.shape, headsign: t.headsign,
              from: reverse ? stop : boarded.stop, to: reverse ? boarded.stop : stop,
              fromSeq: reverse ? k : boarded.k, toSeq: reverse ? boarded.k : k,
              departure: reverse ? dep : boarded.time, arrival: reverse ? boarded.time : arr,
              stops: Math.abs(k - boarded.k) };
            const candidate={ time: candidateTime, legs: reverse ? [leg, ...boarded.label.legs] : [...boarded.label.legs, leg] };
            if(improves){cur[stop]=candidate;changed.add(stop);}
            // A faster label obtained through an overlong final walk must not
            // discard a later direct ride whose door-to-door walk is valid.
            if(goals.has(stop))considerGoal(candidate,goals.get(stop));
          }
        }
        const label = prev[stop];
        if (!label || !(reverse ? validDropoff(t.dropoff[k]) : validPickup(t.pickup[k]))) continue;
        const buffer = label.legs.some(x => x.type === 'ride') ? TRANSFER_SECONDS : 0;
        const canBoard = reverse ? arr <= label.time - buffer : dep >= label.time + buffer;
        if (canBoard && (!boarded || (reverse ? label.time > boarded.label.time : label.time < boarded.label.time))) {
          boarded = { k, stop, time: reverse ? arr : dep, label };
        }
      }
    }
    relaxWalk(data, cur, changed, reverse);
    for(const path of goals.values())considerGoal(cur[path.stop],path);
    if(best)results.push(best);
    prev = cur;
    if (!changed.size) break;
  }
  return results;
}
export function planJourney(data, request) {
  const { from, to, date, time, arriveBy = false, maxTransfers = 2, mode = 'all' } = request;
  if (!request.access && (!Number.isInteger(from) || !Number.isInteger(to) || !data.stops[from] || !data.stops[to])) throw new Error('Vali lähte- ja sihtkoht otsingutulemustest või kaardilt.');
  if (!request.access && from === to) return [];
  const trips = serviceTrips(data, date, mode);
  const requested = seconds(time);
  const found = [];
  // Earliest route and next departures (or latest preceding arrivals).
  for (const delta of [0, 600, 1200]) {
    found.push(...scan(data, trips, from, to, requested + (arriveBy ? -delta : delta), arriveBy, Math.min(3, maxTransfers),request));
  }
  if(request.directWalk){
    const p=request.directWalk,start=arriveBy?requested-p.seconds:requested;
    found.push({legs:[{...endpointLeg(p,start,true,request.fromLabel),to:null,toLabel:request.toLabel}],time:arriveBy?start:start+p.seconds});
  }
  const unique = new Map();
  for (const result of found) {
    const legs = result.legs.map(l=>({...l}));
    // Reverse search starts at the arrival deadline. A final walk can begin as
    // soon as the last vehicle arrives; do not invent waiting at the destination.
    const last=legs.at(-1),previous=legs.at(-2);
    if(last?.type==='walk'&&last.to===null&&previous){
      const duration=last.arrival-last.departure;
      last.departure=previous.arrival;last.arrival=last.departure+duration;
    }
    const departure = legs[0].departure, arrival = legs.at(-1).arrival;
    if (arrival - departure > 4 * 3600 || (!arriveBy && departure < requested) || (arriveBy && arrival > requested)) continue;
    const key = legs.filter(l => l.type === 'ride').map(l => `${l.trip}:${l.departure}:${l.from}:${l.to}`).join('|')||'walk';
    const rides = legs.filter(l => l.type === 'ride');
    unique.set(key, { legs, departure, arrival, duration: arrival - departure, transfers: Math.max(0,rides.length - 1) });
  }
  return [...unique.values()].sort((a, b) => arriveBy ? b.departure - a.departure || a.transfers - b.transfers : a.arrival - b.arrival || a.transfers - b.transfers).slice(0, 5);
}
export function departures(data, stop, date, time, route = null) {
  const now = seconds(time), list = [];
  for (const { trip: t, offset } of serviceTrips(data, date)) {
    if (route !== null && t.r !== route) continue;
    t.stops.forEach((s, k) => {
      const at = t.departures[k] + offset;
      if (s === stop && at >= now && at <= now + 4 * 3600 && validPickup(t.pickup[k])) list.push({ route: t.r, headsign: t.headsign, time: at, trip: t.id });
    });
  }
  return list.sort((a, b) => a.time - b.time).slice(0, 32);
}
export function searchStations(data, query, limit=12) {
  const q=normalize(query.trim());if(!q)return [];
  const groups=data.stations||data.stops.map((s,i)=>({...s,id:String(i),members:[i],routes:s.routes||[]}));
  return groups.filter(s=>normalize(s.name).includes(q)||s.members.some(i=>String(data.stops[i].code||'').includes(q)))
    .sort((a,b)=>Number(!normalize(a.name).startsWith(q))-Number(!normalize(b.name).startsWith(q))||a.name.localeCompare(b.name,'et')).slice(0,limit)
    .map(s=>({...s,kind:'station'}));
}
export function finiteNumber(value) {
  if(value===null||value===undefined||(typeof value==='string'&&!value.trim())||typeof value==='boolean')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
export function cleanVehicle(vehicle) {
  return {...vehicle,speed:finiteNumber(vehicle.speed),bearing:finiteNumber(vehicle.bearing),
    headsign:typeof vehicle.headsign==='string'&&!['undefined','null'].includes(vehicle.headsign)?vehicle.headsign:''};
}
export function normalize(text) { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('et'); }
export function searchStops(data, query, limit = 12) {
  const q = normalize(query.trim());
  if (!q) return [];
  return data.stops.map((s, index) => ({ ...s, index })).filter(s => normalize(s.name).includes(q) || s.code.includes(q))
    .sort((a, b) => Number(!normalize(a.name).startsWith(q)) - Number(!normalize(b.name).startsWith(q)) || a.name.localeCompare(b.name, 'et')).slice(0, limit);
}
// GPS CSV schema follows Tallinn's own map-leaflet.js; coordinates are microdegrees.
// No vehicle timestamp is present. Retrieval time is not a fix timestamp.
export function parseGPS(text) {
  if (text.trimStart().startsWith('<')) throw new Error('GPS provider returned a page instead of vehicle positions.');
  const vehicles = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const [type, route, lonRaw, latRaw, speed, bearing, id, ...rest] = line.split(',');
    const lon = Number(lonRaw) / 1e6, lat = Number(latRaw) / 1e6;
    if (!id || !route || !lonRaw || !latRaw || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 24.3 || lon > 25.2 || lat < 59.2 || lat > 59.65) continue;
    vehicles.push({ id, route: route.trim(), lon, lat, mode: type === '3' ? 'tram' : 'bus',
      bearing: bearing !== '' && Number(bearing) < 360 ? Number(bearing) : null,
      speed: finiteNumber(speed),
      headsign: rest.slice(2).join(',') });
  }
  if (!vehicles.length) throw new Error('GPS response contains no valid Tallinn vehicle positions.');
  return vehicles;
}

// A cached response keeps its original validation age, including browser hits.
export function gpsValidatedAt(headers, now = Date.now()) {
  const stamp = Date.parse(headers.get('x-gps-validated-at'));
  if (Number.isFinite(stamp)) return Math.min(now, stamp);
  const age = Number(headers.get('age') || 0);
  const date = Date.parse(headers.get('date'));
  return Math.min(now, Number.isFinite(date) ? date : now, now - (Number.isFinite(age) ? Math.max(0, age) * 1000 : 0));
}

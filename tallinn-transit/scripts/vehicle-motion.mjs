import { parseGPS } from '../src/transit.js';

// These are estimates from feed observations, not timestamped vehicle fixes.
// Six samples and a two-minute expiry bound persistent state; no background poll.
export const MOTION_WINDOW_MS = 40000;
const GAP_MS = 60000, KEEP_MS = 120000, MIN_MOVE_M = 15, MAX_KMH = 120;
const rad = degrees => degrees * Math.PI / 180;
function segment(a, b) {
  const dLon = rad(b[0] - a[0]), p1 = rad(a[1]), p2 = rad(b[1]), dLat = p2 - p1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  const metres = 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const bearing = (Math.atan2(Math.sin(dLon) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon)) * 180 / Math.PI + 360) % 360;
  return { metres, bearing };
}
export function observeVehicles(text, observedAt, previous = {}) {
  const vehicles = parseGPS(text), history = {};
  for (const [key, record] of Object.entries(previous)) {
    if (observedAt - record.points.at(-1)[2] <= KEEP_MS) history[key] = record;
  }
  const result = vehicles.map(vehicle => {
    const key = `${vehicle.mode}:${vehicle.id}`;
    let record = history[key];
    if (!record || record.route !== vehicle.route || record.headsign !== vehicle.headsign || observedAt - record.points.at(-1)[2] > GAP_MS) {
      record = { route: vehicle.route, headsign: vehicle.headsign, points: [] };
    }
    const point = [vehicle.lon, vehicle.lat, observedAt], last = record.points.at(-1);
    if (last && observedAt > last[2]) {
      const jump = segment(last, point).metres / ((observedAt - last[2]) / 1000) * 3.6;
      if (jump > MAX_KMH) record = { route: vehicle.route, headsign: vehicle.headsign, points: [] };
    }
    // Same source timestamp, including HTTP 304/repeated representations, is not
    // a new datapoint. Clock reversal also starts a fresh observation series.
    if (last && observedAt < last[2]) record = { route: vehicle.route, headsign: vehicle.headsign, points: [] };
    if (!record.points.length || observedAt > record.points.at(-1)[2]) record.points.push(point);
    record.points = record.points.filter(p => observedAt - p[2] <= MOTION_WINDOW_MS).slice(-6);
    history[key] = record;
    const points = record.points, seconds = points.length > 1 ? (points.at(-1)[2] - points[0][2]) / 1000 : 0;
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += segment(points[i - 1], points[i]).metres;
    // Do not call stationary/stale GPS jitter a measured zero speed. A known
    // native zero remains valid; otherwise omit speed when movement is unclear.
    let estimatedSpeed = null, estimatedBearing = null;
    if (seconds >= 5 && distance >= MIN_MOVE_M && segment(points[0], points.at(-1)).metres >= MIN_MOVE_M) {
      estimatedSpeed = Math.round(distance / seconds * 3.6);
      // Prefer the most recent sufficiently long baseline: turns should not be
      // averaged all the way back through the preceding street.
      for (let i = points.length - 2; i >= 0; i--) {
        const leg = segment(points[i], points.at(-1));
        if (leg.metres >= MIN_MOVE_M) { estimatedBearing = Math.round(leg.bearing) % 360;break; }
      }
    }
    const nativeSpeed = vehicle.speed !== null && vehicle.speed >= 0 && vehicle.speed <= MAX_KMH;
    const nativeBearing = vehicle.bearing !== null;
    return { ...vehicle,
      speed: nativeSpeed ? vehicle.speed : estimatedSpeed,
      speedSource: nativeSpeed ? 'feed' : estimatedSpeed !== null ? 'estimated' : null,
      speedWindowSeconds: !nativeSpeed && estimatedSpeed !== null ? Math.round(seconds) : null,
      bearing: nativeBearing ? vehicle.bearing : estimatedBearing,
      bearingSource: nativeBearing ? 'feed' : estimatedBearing !== null ? 'estimated' : null,
      motionObservedAt: new Date(observedAt).toISOString(), samples: points.length,
    };
  });
  // A feed is city-bounded, and missing vehicles expire. Retain at most 1500
  // records even if an upstream identifier bug begins creating new IDs.
  const bounded = Object.fromEntries(Object.entries(history).sort((a,b)=>b[1].points.at(-1)[2]-a[1].points.at(-1)[2]).slice(0,1500));
  return { vehicles: result, history: bounded };
}

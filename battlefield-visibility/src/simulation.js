import {height} from './visibility.js';

// Routes are published source-node coordinates, not freehand street approximations.
export function routePosition(route, distance) {
  if (route.length < 2) throw new Error('A route needs at least two source nodes');
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total) throw new Error('Zero-length route');
  // Ping-pong avoids a fabricated jump from the last street node back to the first.
  let d = ((distance % (2 * total)) + 2 * total) % (2 * total);
  const reverse = d > total;
  if (reverse) d = 2 * total - d;
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] || i === lengths.length - 1) {
      const a = route[i], b = route[i + 1], t = lengths[i] ? d / lengths[i] : 0;
      return {x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t,
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]) + (reverse ? Math.PI : 0)};
    }
    d -= lengths[i];
  }
}

export function sensorAt(grid, scenario, vector, time, settings, speedFactor = 1) {
  const route = scenario.routes[vector.route];
  const p = routePosition(route.coordinates, vector.offsetM + time * vector.speedMps * speedFactor);
  const agl = vector.type === 'uav' ? settings.uavHeight : settings.tankHeight;
  return {id: vector.id, type: vector.type, heading: p.heading,
    position: [p.x, p.y, height(grid, grid.dtm, p.x, p.y) + agl]};
}

export function predict(grid, scenario, vectors, time, settings) {
  return vectors.map(vector => ({id: vector.id, hypotheses: [0.8, 1, 1.2].map(factor =>
    Array.from({length: 5}, (_, i) => sensorAt(grid, scenario, vector, time + (i + 1) * 60, settings, factor).position))}));
}

export function activeVectors(scenario, settings) {
  return scenario.vectors.filter(v => Number(v.id.split('-')[1]) <= (v.type === 'uav' ? settings.uavs : settings.tanks));
}

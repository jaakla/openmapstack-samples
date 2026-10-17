import { height } from "./visibility.js";

// Routes are published source-node coordinates, not freehand street approximations.
export function routePosition(route, distance) {
  if (route.length < 2)
    throw new Error("A route needs at least two source nodes");
  const lengths = route
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total) throw new Error("Zero-length route");
  // Ping-pong avoids a fabricated jump from the last street node back to the first.
  let d = ((distance % (2 * total)) + 2 * total) % (2 * total);
  const reverse = d >= total;
  if (reverse) d = 2 * total - d;
  for (let i = 0; i < lengths.length; i++) {
    if (!lengths[i]) continue;
    if (d < lengths[i] || (reverse && d === lengths[i]) || i === lengths.length - 1) {
      const a = route[i],
        b = route[i + 1],
        t = lengths[i] ? d / lengths[i] : 0;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]) + (reverse ? Math.PI : 0),
      };
    }
    d -= lengths[i];
  }
}

export function sensorAt(
  grid,
  scenario,
  vector,
  time,
  settings,
  speedFactor = 1,
) {
  const route = scenario.routes[vector.route];
  const p = routePosition(
    route.coordinates,
    vector.offsetM + time * vector.speedMps * speedFactor,
  );
  const agl = settings.uavHeight;
  return {
    id: vector.id,
    type: vector.type,
    heading: p.heading,
    groundVelocity: [Math.sin(p.heading), Math.cos(p.heading)].map(
      (component) => component * vector.speedMps * speedFactor,
    ),
    agl,
    position: [p.x, p.y, height(grid, grid.dtm, p.x, p.y) + agl],
  };
}

export function predict(grid, scenario, vectors, time, settings) {
  return vectors.map((vector) => {
    const route = scenario.routes[vector.route].coordinates;
    const start = vector.offsetM + time * vector.speedMps;
    const agl = settings.uavHeight;
    return {
      id: vector.id,
      hypotheses: [0.8, 1, 1.2].map((factor) =>
        Array.from(
          { length: 5 },
          (_, i) =>
            sensorAt(
              grid,
              scenario,
              vector,
              time + (i + 1) * 60 * factor,
              settings,
            ).position,
        ),
      ),
      paths: [0.8, 1, 1.2].map((factor) =>
        routeTrace(route, start, start + 300 * vector.speedMps * factor).map(
          ([x, y]) => [x, y, height(grid, grid.dtm, x, y) + agl],
        ),
      ),
      uncertaintyPath: routeTrace(
        route,
        start + 300 * vector.speedMps * 0.8,
        start + 300 * vector.speedMps * 1.2,
      ).map(([x, y]) => [x, y, height(grid, grid.dtm, x, y) + agl]),
    };
  });
}

// Include every source vertex crossed, including end-of-route turns. Rendering
// sparse forecast samples as straight chords would cut through city blocks.
export function routeTrace(route, start, end) {
  const cumulative = [0];
  for (let i = 1; i < route.length; i++)
    cumulative.push(
      cumulative.at(-1) +
        Math.hypot(
          route[i][0] - route[i - 1][0],
          route[i][1] - route[i - 1][1],
        ),
    );
  const total = cumulative.at(-1),
    breaks = [start, end];
  if (!total) throw new Error("Zero-length route");
  for (
    let cycle = Math.floor(start / (2 * total));
    cycle <= Math.floor(end / (2 * total));
    cycle++
  )
    for (const distance of cumulative)
      for (const d of [
        cycle * 2 * total + distance,
        cycle * 2 * total + 2 * total - distance,
      ])
        if (d > start && d < end) breaks.push(d);
  return [...new Set(breaks)]
    .sort((a, b) => a - b)
    .map((d) => {
      const p = routePosition(route, d);
      return [p.x, p.y];
    });
}

export function activeVectors(scenario, settings) {
  return scenario.vectors.filter(
    (v) => v.type === "uav" && Number(v.id.split("-")[1]) <= settings.uavs,
  );
}

// History starts at scenario t=0; it never invents a pre-simulation flight.
export function pastTraces(grid, scenario, vectors, time, settings) {
  return vectors.map((v) => ({
    id: v.id,
    path: routeTrace(
      scenario.routes[v.route].coordinates,
      v.offsetM + Math.max(0, time - 120) * v.speedMps,
      v.offsetM + time * v.speedMps,
    ).map(([x, y]) => [
      x,
      y,
      height(grid, grid.dtm, x, y) + settings.uavHeight,
    ]),
  }));
}

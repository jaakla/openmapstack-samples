import test from "node:test";
import assert from "node:assert/strict";
import { lineOfSight, classifyTarget, ZONE } from "../src/visibility.js";
import {
  routePosition,
  routeTrace,
  predict,
  sensorAt,
} from "../src/simulation.js";

// Analytic arrays are unit-test fixtures only; never exported as city geometry.
function fixture(size = 12) {
  return {
    width: size,
    height: size,
    resolution: 1,
    zOrigin: 0,
    zScale: 1,
    dtm: new Uint16Array(size * size),
    dsm: new Uint16Array(size * size),
  };
}
test("flat ground, vertical ray and LOS symmetry", () => {
  const g = fixture();
  assert.equal(lineOfSight(g, [0.5, 0.5, 3], [10.5, 10.5, 2]), true);
  assert.equal(lineOfSight(g, [10.5, 10.5, 2], [0.5, 0.5, 3]), true);
  assert.equal(lineOfSight(g, [5.5, 5.5, 50], [5.5, 5.5, 2]), true);
});
test("one-cell ridge blocks low sensor, elevated ray clears it", () => {
  const g = fixture();
  for (let y = 0; y < 12; y++) g.dsm[y * 12 + 5] = 10;
  assert.equal(lineOfSight(g, [1.5, 6.5, 3], [10.5, 6.5, 2]), false);
  assert.equal(lineOfSight(g, [1.5, 6.5, 50], [10.5, 6.5, 20]), true);
});
test("grazing rays and corner-touching obstructions conservatively block", () => {
  const g = fixture();
  g.dsm[1] = 3;
  assert.equal(lineOfSight(g, [0.5, 0.5, 3], [4.5, 4.5, 3]), false);
  g.dsm[1] = 0;
  g.dsm[5 * 12 + 5] = 3;
  assert.equal(lineOfSight(g, [1.5, 5.5, 3], [10.5, 5.5, 3]), false);
});
test("NoData and out-of-bounds return unknown; a known obstruction still blocks", () => {
  const g = fixture();
  g.dsm[6 * 12 + 5] = 65535;
  assert.equal(lineOfSight(g, [1.5, 6.5, 3], [10.5, 6.5, 2]), null);
  assert.equal(lineOfSight(g, [-1, 1, 3], [10.5, 6.5, 2]), null);
  g.dsm[6 * 12 + 7] = 20;
  assert.equal(lineOfSight(g, [1.5, 6.5, 3], [10.5, 6.5, 2]), false);
});
test("rays along grid boundaries test both touching cells", () => {
  const g = fixture();
  g.dsm[6 * 12 + 4] = 5;
  assert.equal(lineOfSight(g, [5, 1.5, 3], [5, 10.5, 3]), false);
  g.dsm[6 * 12 + 4] = 0;
  g.dsm[4 * 12 + 6] = 5;
  assert.equal(lineOfSight(g, [1.5, 5, 3], [10.5, 5, 3]), false);
  assert.equal(lineOfSight(g, [0, 1.5, 3], [0, 10.5, 3]), null);
});
test("RED takes precedence; YELLOW threshold is speed-hypothesis event probability", () => {
  const g = fixture();
  for (let y = 0; y < 12; y++) g.dsm[y * 12 + 5] = 10;
  const current = [{ id: "TANK-1", position: [1.5, 6.5, 3] }],
    target = [10.5, 6.5, 2];
  const futures = [
    {
      id: "TANK-1",
      hypotheses: [[[1.5, 6.5, 3]], [[9.5, 6.5, 3]], [[1.5, 6.5, 3]]],
    },
  ];
  assert.equal(classifyTarget(g, target, current, futures).zone, ZONE.YELLOW);
  assert.equal(
    classifyTarget(g, target, current, futures, 0.5).zone,
    ZONE.GREEN,
  );
  assert.equal(
    classifyTarget(
      g,
      target,
      [{ id: "UAV-1", position: [9.5, 6.5, 50] }],
      futures,
    ).zone,
    ZONE.RED,
  );
  assert.deepEqual(classifyTarget(g, target, [], []), {
    zone: ZONE.GREEN,
    visibleTo: [],
    probability: 0,
  });
});
test("missing forecasts cannot silently classify green", () => {
  const g = fixture();
  const result = classifyTarget(
    g,
    [5.5, 5.5, 2],
    [],
    [{ hypotheses: [[[NaN, 1, 2]]] }],
  );
  assert.equal(result.zone, ZONE.UNKNOWN);
});
test("route follows source segments and reverses without teleporting", () => {
  const route = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  assert.deepEqual(
    [routePosition(route, 15).x, routePosition(route, 15).y],
    [10, 5],
  );
  assert.deepEqual(
    [routePosition(route, 25).x, routePosition(route, 25).y],
    [10, 5],
  );
  assert.equal(routePosition(route, 40).x, 0);
  assert.throws(() =>
    routePosition(
      [
        [0, 0],
        [0, 0],
      ],
      2,
    ),
  );
});
test("prediction is deterministic, five minutes long, with AGL height", () => {
  const g = fixture(),
    scenario = {
      routes: {
        road: {
          coordinates: [
            [1.5, 1.5],
            [10.5, 1.5],
          ],
        },
      },
    };
  const v = {
      id: "UAV-1",
      type: "uav",
      route: "road",
      offsetM: 0,
      speedMps: 1,
    },
    settings = { uavHeight: 50, tankHeight: 3 };
  const p = predict(g, scenario, [v], 0, settings);
  assert.equal(p[0].hypotheses.length, 3);
  assert.equal(p[0].hypotheses[1].length, 5);
  assert.deepEqual(
    p[0].hypotheses[1][4],
    sensorAt(g, scenario, v, 300, settings).position,
  );
  assert.equal(p[0].hypotheses[1][4][2], 50);
  const later = predict(g, scenario, [v], 200, settings);
  assert.deepEqual(
    later[0].hypotheses[0][0],
    sensorAt(g, scenario, v, 248, settings).position,
  );
});
test("rendered predictions preserve route corners and reversals", () => {
  assert.deepEqual(
    routeTrace(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      5,
      25,
    ),
    [
      [5, 0],
      [10, 0],
      [10, 10],
      [10, 5],
    ],
  );
});

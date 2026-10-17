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
test("QA endpoint-corner repro blocks both directions and cannot classify RED", () => {
  const g = fixture(4); g.dsm[1 * 4 + 2] = 10;
  const observer = [0.5, 0.5, 3], target = [2, 2, 2];
  assert.equal(lineOfSight(g, observer, target), false);
  assert.equal(lineOfSight(g, target, observer), false);
  assert.equal(classifyTarget(g, target, [{id:"QA",position:observer}], []).zone, ZONE.GREEN);
});

test("QA interior corner at t=1/3 blocks both directions", () => {
  const g = fixture(10); g.dsm[3 * 10 + 1] = 10;
  const a = [0.5, 0.5, 3], b = [5, 8, 2];
  assert.equal(lineOfSight(g, a, b), false);
  assert.equal(lineOfSight(g, b, a), false);
  // The same corner must carry NoData, and a ray above the solid must clear it.
  g.dsm[3 * 10 + 1] = 65535;
  assert.equal(lineOfSight(g, a, b), null);
  assert.equal(lineOfSight(g, b, a), null);
  g.dsm[3 * 10 + 1] = 2;
  assert.equal(lineOfSight(g, a, b), true);
  assert.equal(lineOfSight(g, b, a), true);
});

// Independent exact segment/AABB oracle for half-metre lattice fixtures. Scale
// coordinates to integers and use BigInt rational interval endpoints throughout:
// no floating-point division, tie tolerance, DDA traversal, or LOS helper reuse.
function exactLatticeOracle(g, a, b, solids) {
  const start = a.map(x => BigInt(x * 2)), end = b.map(x => BigInt(x * 2));
  const delta = end.map((x, axis) => x - start[axis]);
  const compare = (a, b) => a[0] * b[1] - b[0] * a[1];
  let unknown = false;
  for (const i of solids) {
    let enter = [0n, 1n], exit = [1n, 1n];
    for (const [axis, coordinate] of [[0, i % g.width], [1, Math.floor(i / g.width)]]) {
      const lo = BigInt(coordinate * 2), hi = lo + 2n, d = delta[axis];
      if (d === 0n) {
        if (start[axis] < lo || start[axis] > hi) { enter = [2n, 1n]; break; }
      } else {
        const lower = d > 0n ? [lo - start[axis], d] : [start[axis] - hi, -d];
        const upper = d > 0n ? [hi - start[axis], d] : [start[axis] - lo, -d];
        if (compare(lower, enter) > 0n) enter = lower;
        if (compare(upper, exit) < 0n) exit = upper;
      }
    }
    if (compare(enter, exit) > 0n) continue;
    if (g.dsm[i] === 65535) { unknown = true; continue; }
    const [num, den] = delta[2] >= 0n ? enter : exit;
    if (start[2] * den + delta[2] * num <= BigInt(g.dsm[i] * 2) * den) return false;
  }
  return unknown ? null : true;
}

test("200k seeded sparse 16x16 rays match exact AABB oracle and reciprocity", () => {
  let seed = 12345;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 2 ** 32 * n);
  };
  const g = fixture(16);
  for (let trial = 0; trial < 200000; trial++) {
    g.dsm.fill(0);
    const solids = new Set();
    const count = 1 + random(6);
    for (let j = 0; j < count; j++) {
      const i = random(256); solids.add(i);
      g.dsm[i] = random(13) === 0 ? 65535 : 1 + random(20);
    }
    // Interior XY avoids outside-coverage ambiguity; endpoints include faces,
    // corners, identical XY, and both ascending and descending half-metre Z.
    // All Z > 0, so omitted zero-height ground cells provably cannot intersect.
    const point = () => [0.5 + random(31) / 2, 0.5 + random(31) / 2, 2 + random(37) / 2];
    const a = point(), b = point();
    const expected = exactLatticeOracle(g, a, b, solids);
    const forward = lineOfSight(g, a, b), reverse = lineOfSight(g, b, a);
    if (forward !== expected || reverse !== expected) {
      assert.fail(JSON.stringify({seed:12345, trial, a, b, expected, forward, reverse,
        solids:[...solids].map(i => [i % 16, Math.floor(i / 16), g.dsm[i]])}));
    }
  }
});

// Independent oracle: intersect the entire closed segment with each cell's
// closed XY AABB, then compare its lowest Z in that interval to the solid.
function closedSolidOracle(g, a, b) {
  for (let row = 0; row < g.height; row++) for (let col = 0; col < g.width; col++) {
    let enter = 0, exit = 1;
    for (const [axis, coordinate] of [[0,col], [1,row]]) {
      const lo = coordinate*g.resolution, hi = lo+g.resolution, delta = b[axis]-a[axis];
      if (delta === 0) {
        if (a[axis] < lo || a[axis] > hi) { enter = 2; break; }
      } else {
        const t0=(lo-a[axis])/delta, t1=(hi-a[axis])/delta;
        enter=Math.max(enter,Math.min(t0,t1)); exit=Math.min(exit,Math.max(t0,t1));
      }
    }
    const z = Math.min(a[2]+(b[2]-a[2])*enter,a[2]+(b[2]-a[2])*exit);
    if (enter <= exit && z <= g.zOrigin + g.dsm[row*g.width+col]*g.zScale + 1e-7) return false;
  }
  return true;
}

test("endpoint faces, four corner cells, grazing heights and reciprocity match AABB oracle", () => {
  const points = [[0.5,0.5,3],[2,2,2],[2,1.5,2],[1.5,2,2],[2,2,10],[2,2,10.1],[3.5,3.5,3]];
  for (const [col,row] of [[1,1],[2,1],[1,2],[2,2]]) {
    const g=fixture(4);g.dsm[row*4+col]=10;
    for (const a of points) for (const b of points) {
      const expected=closedSolidOracle(g,a,b);
      assert.equal(lineOfSight(g,a,b),expected,JSON.stringify({col,row,a,b}));
      assert.equal(lineOfSight(g,b,a),expected,JSON.stringify({col,row,a:b,b:a}));
    }
  }
});

test("endpoint-only NoData stays unknown and a known touching solid takes precedence", () => {
  const g=fixture(4),a=[0.5,0.5,3],b=[2,2,2];g.dsm[1*4+2]=65535;
  assert.equal(lineOfSight(g,a,b),null);assert.equal(lineOfSight(g,b,a),null);
  g.dsm[2*4+1]=10;
  assert.equal(lineOfSight(g,a,b),false);assert.equal(lineOfSight(g,b,a),false);
});
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

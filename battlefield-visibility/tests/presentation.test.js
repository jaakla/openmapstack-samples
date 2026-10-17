import test from "node:test";
import assert from "node:assert/strict";
import { formatMGRS, parseMGRS, exportSnapshot } from "../src/coordinates.js";
import { calculateZones } from "../src/calculate.js";
import { pastTraces, activeVectors } from "../src/simulation.js";

const origin = [385200, 6671300],
  grid = {
    width: 16,
    height: 16,
    resolution: 1,
    zOrigin: 0,
    zScale: 1,
    dtm: new Uint16Array(256),
    dsm: new Uint16Array(256),
  };

test("QA GeographicLib C++ 2.7 metre-boundary reference stays in northing cell 72250", () => {
  // Independent pyproj EPSG:4326 -> 3067 values for the research reference points.
  assert.equal(
    formatMGRS([0, 0], [385611.3166849422, 6672118.380202087]),
    "35V LG 85611 72118",
  );
  assert.equal(
    formatMGRS([0, 0], [386263.3458830737, 6672250.999319683]),
    "35V LG 86263 72250",
  );
});
const scenario = {
  routes: {
    left: {
      coordinates: [
        [1.5, 2.5],
        [2.5, 2.5],
      ],
    },
    right: {
      coordinates: [
        [13.5, 2.5],
        [14.5, 2.5],
      ],
    },
    cross: {
      coordinates: [
        [1.5, 8.5],
        [14.5, 8.5],
      ],
    },
  },
  vectors: [
    { id: "UAV-1", type: "uav", route: "left", speedMps: 0, offsetM: 0 },
    { id: "UAV-2", type: "uav", route: "right", speedMps: 0, offsetM: 0 },
    { id: "UAV-3", type: "uav", route: "cross", speedMps: 0.04, offsetM: 0 },
  ],
  zoneSpacingM: 4,
  probabilityThreshold: 0.25,
  target: [14.5, 2.5],
};

test("TM35FIN/MGRS known grid reference, square-centre parse, bounds and invalid input", () => {
  assert.equal(formatMGRS(origin, [0, 0]), "35V LG 85200 71300");
  const p = parseMGRS(origin, "35v lg 85200 71300", grid);
  assert.ok(Math.abs(p[0] - 0.5) < 0.01 && Math.abs(p[1] - 0.5) < 0.01);
  assert.equal(formatMGRS(origin, p), "35V LG 85200 71300");
  for (const bad of [
    "",
    "hello",
    "35V LG 8520 7130",
    "35V II 85200 71300",
    "00V LG 85200 71300",
    "35V LG 99999 99999",
  ])
    assert.throws(() => parseMGRS(origin, bad, grid), undefined, bad);
});

test("each UAV gets its own current/forecast/blocked LOS status, independent of aggregate RED", () => {
  const g = { ...grid, dsm: grid.dsm.slice() };
  for (let y = 0; y < 16; y++) g.dsm[y * 16 + 8] = 10;
  const r = calculateZones(
    g,
    scenario,
    { uavs: 3, uavHeight: 3 },
    0,
    scenario.target,
  );
  assert.equal(r.status.zone, 3);
  assert.deepEqual(
    r.sightlines.map((s) => s.zone),
    [1, 3, 2],
  );
  const unknown = calculateZones(
    g,
    scenario,
    { uavs: 3, uavHeight: 3 },
    0,
    [8.5, 2.5],
  );
  assert.ok(unknown.sightlines.every((s) => s.zone === 0));
  const empty = calculateZones(
    g,
    scenario,
    { uavs: 0, uavHeight: 3 },
    0,
    scenario.target,
  );
  assert.deepEqual(empty.sensors, []);
  assert.deepEqual(empty.sightlines, []);
});

test("history never predates t=0, ends at current position and respects the two-minute window", () => {
  const settings = { uavs: 3, uavHeight: 3 };
  const initial = pastTraces(grid, scenario, scenario.vectors, 0, settings);
  assert.ok(initial.every((t) => t.path.length === 1));
  for (const time of [30, 120, 500]) {
    const result = calculateZones(
      grid,
      scenario,
      settings,
      time,
      scenario.target,
    );
    for (const trace of result.traces)
      assert.deepEqual(
        trace.path.at(-1),
        result.sensors.find((s) => s.id === trace.id).position,
      );
  }
  assert.equal(activeVectors(scenario, { uavs: 2 }).length, 2);
});

test("snapshot export uses MGRS for all own/drone positions and preserves per-drone LOS", () => {
  const result = calculateZones(
    grid,
    scenario,
    { uavs: 3, uavHeight: 50 },
    20,
    scenario.target,
  );
  const out = exportSnapshot({ origin, runId: "test" }, result);
  assert.equal(out.coordinateSystem, "MGRS / WGS84, 1 m squares");
  assert.match(out.ownPosition.mgrs, /^35V LG \d{5} \d{5}$/);
  assert.equal(out.drones.length, 3);
  assert.ok(out.drones.every((d) => d.mgrs && d.sighting.id === d.id));
  assert.ok(!JSON.stringify(out).includes('"position":'));
  assert.ok(!JSON.stringify(out).includes('"target":'));
});

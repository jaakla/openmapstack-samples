import test from "node:test";
import assert from "node:assert/strict";
import {
  relativeContact, degreesToMils, formatAzimuth, formatElevation, formatRange,
  formatRangeRate, formatContactLine,
} from "../src/contact.js";
import { gridConvergenceDegrees } from "../src/coordinates.js";
import { routePosition, sensorAt } from "../src/simulation.js";
import { calculateZones } from "../src/calculate.js";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const contact = (position, extra = {}) => relativeContact({
  ownPosition: [0, 0, 2], position, groundVelocity: [0, 0], agl: 50,
  convergenceDegrees: 0, ...extra,
});

test("cardinal/diagonal absolute grid bearings and 6400-mil conversion", () => {
  for (const [xy, deg, mil] of [
    [[0, 10], 0, 0], [[10, 0], 90, 1600], [[0, -10], 180, 3200],
    [[-10, 0], 270, 4800], [[10, 10], 45, 800], [[-10, 10], 315, 5600],
  ]) {
    const c = contact([...xy, 2]);
    near(c.bearingGridDeg, deg);
    near(c.bearingGridMils, mil);
    near(c.bearingTrueDeg, deg);
  }
  near(degreesToMils(360), 6400);
  assert.equal(formatAzimuth(359.9999), "0000 mil / 0.0°");
  assert.equal(formatAzimuth(-90), "4800 mil / 270.0°");
});

test("signed Δh, horizontal/slant ranges and signed elevation", () => {
  const above = contact([3, 4, 14]);
  near(above.horizontalRangeM, 5);
  near(above.relativeHeightM, 12);
  near(above.slantRangeM, 13);
  near(above.elevationDeg, Math.atan2(12, 5) * 180 / Math.PI);
  near(above.elevationMils, degreesToMils(above.elevationDeg));
  near(above.aglM, 50);
  const below = contact([3, 4, -10]);
  near(below.relativeHeightM, -12);
  near(below.elevationDeg, -above.elevationDeg);
  near(below.slantRangeM, 13);
  assert.equal(formatElevation(-45), "-800 mil / -45.0°");
});

test("grid convergence sign and local true = grid + convergence, with north wrap", () => {
  // Independent pyproj Proj('EPSG:3067').get_factors() / PROJ reference values.
  const fixtures = [
    [[386153.2369, 6671623.5336], -1.7798528359057746],
    [[385611.3166849422, 6672118.380202087], -1.7886386849727585],
    [[500000, 6672000], 0], [[610000, 6672000], 1.7199970358674983],
  ];
  for (const [xy, gamma] of fixtures) near(gridConvergenceDegrees(xy), gamma, 1e-6);
  near(contact([0, 10, 2], { convergenceDegrees: -2 }).bearingTrueDeg, 358);
  near(contact([0, 10, 2], { convergenceDegrees: 2 }).bearingTrueDeg, 2);
  assert.equal(contact([0, 10, 2], { convergenceDegrees: null }).bearingTrueDeg, null);
});

test("ground speed/course and horizontal closing/opening sign with own fixed", () => {
  for (const [velocity, rate, course] of [
    [[-12, 0], -12, 270], [[12, 0], 12, 90], [[0, 12], 0, 0],
  ]) {
    const c = contact([100, 0, 50], { groundVelocity: velocity });
    near(c.groundSpeedMps, 12);
    near(c.horizontalRangeRateMps, rate);
    near(c.courseGridDeg, course);
  }
  const oblique = contact([3, 4, 50], { groundVelocity: [4, -3] });
  near(oblique.horizontalRangeRateMps, 0);
  assert.equal(formatRangeRate(-12), "-12.0 m/s · CLOSING");
  assert.equal(formatRangeRate(12), "+12.0 m/s · OPENING");
  assert.equal(formatRangeRate(-0.000001), "0.0 m/s · STEADY");
});

test("stationary, overhead, coincident and unknown-height cases do not invent directions", () => {
  const overhead = contact([0, 0, 52]);
  assert.equal(overhead.bearingGridDeg, null);
  assert.equal(overhead.bearingTrueDeg, null);
  assert.equal(overhead.courseGridDeg, null);
  assert.equal(overhead.horizontalRangeRateMps, null);
  near(overhead.elevationDeg, 90);
  near(overhead.elevationMils, 1600);
  near(contact([0, 0, -48]).elevationDeg, -90);
  assert.equal(contact([0, 0, 2]).elevationDeg, null);
  const missing = contact([3, 4, NaN], { groundVelocity: undefined, agl: NaN });
  near(missing.horizontalRangeM, 5);
  assert.equal(missing.slantRangeM, null);
  assert.equal(missing.relativeHeightM, null);
  assert.equal(missing.elevationDeg, null);
  assert.equal(missing.aglM, null);
  assert.equal(missing.horizontalRangeRateMps, null);
  assert.ok(!JSON.stringify(missing).includes("NaN"));
});

test("radio line uses consistent units, grid reference, simulation time and per-UAV LOS", () => {
  const base = { id: "UAV-1", timeSeconds: 12, mgrs: "35V LG 85485 71770",
    ...contact([0, 2000, 52], { groundVelocity: [0, -12] }) };
  assert.equal(formatRange(1000), "1.00 km");
  assert.equal(formatRange(999), "999 m");
  assert.equal(formatRange(null), "UNKNOWN");
  for (const [zone, label] of [[0, "UNKNOWN"], [1, "MASKED"],
    [2, "LIKELY VISIBLE ≤5 MIN"], [3, "VISIBLE NOW"]]) {
    const line = formatContactLine({ ...base, zone });
    assert.ok(line.startsWith("CONTACT — SIMULATED — t=12.0 S — HOSTILE UAV-1"));
    assert.ok(line.includes("GRID 35V LG 85485 71770"));
    assert.ok(line.includes("BRG 0000 mil / 0.0° GRID"));
    assert.ok(line.includes("GROUND RNG 2.00 km"));
    assert.ok(line.includes("ΔH +50.0 m"));
    assert.ok(line.includes("COURSE 3200 mil / 180.0° GRID"));
    assert.ok(line.includes("-12.0 m/s · CLOSING"));
    assert.ok(line.endsWith(label));
  }
});

const grid = { width: 16, height: 16, resolution: 1, zOrigin: 0, zScale: 1,
  dtm: new Uint16Array(256), dsm: new Uint16Array(256) };
const scenario = { routes: { r: { coordinates: [[1, 2], [7, 2], [7, 8]] } },
  vectors: [{ id: "UAV-1", type: "uav", route: "r", speedMps: 1, offsetM: 0 }],
  zoneSpacingM: 4, probabilityThreshold: 0.25, target: [10, 10] };

test("track velocity follows outgoing source segments and reverses at route endpoints", () => {
  for (const [time, velocity] of [[0, [1, 0]], [6, [0, 1]], [12, [0, -1]],
    [18, [-1, 0]], [24, [1, 0]]]) {
    const s = sensorAt(grid, scenario, scenario.vectors[0], time, { uavHeight: 50 });
    s.groundVelocity.forEach((v, i) => near(v, velocity[i]));
  }
  const route = scenario.routes.r.coordinates;
  assert.deepEqual([routePosition(route, 6).x, routePosition(route, 6).y], [7, 2]);
});

test("contacts share worker snapshot time, target height, AGL, motion and individual LOS", () => {
  for (const [time, agl, own] of [[0, 50, [10, 10]], [6, 150, [8, 10]], [18, 10, [1, 10]]]) {
    const result = calculateZones(grid, scenario, { uavs: 1, uavHeight: agl },
      time, own, [385200, 6671300]);
    const c = result.contacts[0];
    assert.equal(c.timeSeconds, time);
    near(c.aglM, agl);
    near(c.relativeHeightM, agl - 2);
    near(c.groundSpeedMps, 1);
    assert.equal(c.zone, result.sightlines[0].zone);
    assert.match(c.mgrs, /^35V LG \d{5} \d{5}$/);
    assert.equal(c.line, formatContactLine(c));
    assert.deepEqual(own, result.target);
  }
  assert.deepEqual(calculateZones(grid, scenario, { uavs: 0, uavHeight: 50 },
    0, scenario.target, [385200, 6671300]).contacts, []);
});

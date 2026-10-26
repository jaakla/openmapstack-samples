import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_SYSTEM,
  analyzePV,
  buildHorizon,
  clearSkyIrradiance,
  compareOwnerData,
  horizonElevation,
  parseOwnerCsv,
  planeOfArray,
  polygonMetrics,
  projectCoordinate,
  solarPosition,
  trueToGridBearing,
  validateSystem,
} from "../src/analysis.js";

const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );
const time = "2024-06-21T10:00:00Z";
const weatherRow = { time, ghi: 700, dni: 600, dhi: 150, temperatureC: 20 };
const getHour = (analysis, iso = time) =>
  analysis.hourly.find((row) => Date.parse(row.time) === Date.parse(iso));
const rectangle = (x, y, width, height) =>
  [
    [x - width / 2, y - height / 2],
    [x + width / 2, y - height / 2],
    [x + width / 2, y + height / 2],
    [x - width / 2, y + height / 2],
  ].map((p) => projectCoordinate(p, "EPSG:3301", "EPSG:4326"));

test("solar position agrees with the independent NREL SPA example in geometric elevation and north-clockwise azimuth", () => {
  // NREL/TP-560-34302: 2003-10-17 12:30:30 -07:00, 39.742476,-105.1786.
  // SPA geometric zenith = 50.127954°, azimuth = 194.340241°. No refraction comparison.
  const sun = solarPosition("2003-10-17T19:30:30Z", 39.742476, -105.1786);
  close(sun.zenithDeg, 50.127954, 0.005);
  close(sun.azimuthDeg, 194.340241, 0.005);
  assert.ok(
    solarPosition("2024-06-21T00:00:00Z", 58.37, 26.72).elevationDeg < 0,
  );
});

test("EPSG:3301 area, perimeter and centroid round-trip a known 30 by 12 metre footprint", () => {
  const area = polygonMetrics(rectangle(658857.5, 6473027.5, 30, 12));
  close(area.areaM2, 360, 0.001);
  close(area.perimeterM, 84, 0.001);
  close(area.centroidProjected[0], 658857.5, 0.0001);
  close(area.centroidProjected[1], 6473027.5, 0.0001);
  assert.throws(
    () =>
      polygonMetrics([
        [26, 58],
        [26, 58],
        [26, 58],
      ]),
    /no measurable area/,
  );
});

test("polygon imports reject holes, crossings, duplicate edges and oversized vertex arrays", () => {
  const wgs = (points) =>
    points.map((p) => projectCoordinate(p, "EPSG:3301", "EPSG:4326"));
  const normal = rectangle(658857.5, 6473027.5, 30, 12);
  assert.throws(
    () => polygonMetrics({ type: "Polygon", coordinates: [normal, normal] }),
    /holes/,
  );
  const a = [658800, 6473000];
  const crossed = wgs([
    a,
    [a[0] + 20, a[1] + 20],
    [a[0], a[1] + 20],
    [a[0] + 30, a[1]],
  ]);
  assert.throws(() => polygonMetrics(crossed), /cross|area/);
  assert.throws(
    () =>
      polygonMetrics([normal[0], normal[1], normal[1], normal[2], normal[3]]),
    /duplicate/,
  );
  assert.throws(
    () => polygonMetrics([...normal, normal[1], normal[0]]),
    /cross|touch/,
  );
  assert.throws(
    () => polygonMetrics(Array(1002).fill(normal[0])),
    /1000 vertices/,
  );
});

test("true north is corrected for EPSG:3301 meridian convergence rather than assumed grid north", () => {
  // LCC convergence n*(longitude-24°), n≈0.854. At Tartu the correction is about -2.32°.
  const north = trueToGridBearing(0, 58.3688, 26.7153);
  assert.ok(north > 357.6 && north < 357.8);
  close(trueToGridBearing(180, 58.3688, 26.7153), north - 180, 1e-8);
  close(trueToGridBearing(0, 58.3688, 24), 0, 1e-5);
});

test("azimuth convention and plane-of-array units preserve horizontal irradiance", () => {
  const position = { elevationDeg: 30, azimuthDeg: 180 };
  const irradiance = { dni: 800, dhi: 100, ghi: 500 };
  close(
    planeOfArray(irradiance, position, { ...DEFAULT_SYSTEM, tiltDeg: 0 }).total,
    500,
  );
  const south = planeOfArray(irradiance, position, {
    ...DEFAULT_SYSTEM,
    tiltDeg: 60,
    azimuthDeg: 180,
  });
  const north = planeOfArray(irradiance, position, {
    ...DEFAULT_SYSTEM,
    tiltDeg: 60,
    azimuthDeg: 0,
  });
  close(south.direct, 800);
  close(north.direct, 0);
  assert.ok(south.total > north.total);
  const night = clearSkyIrradiance(time, { sinElevation: -0.5 });
  assert.deepEqual(night, { ghi: 0, dni: 0, dhi: 0 });
});

test("horizon interpolation crosses north continuously and does not reverse bearings", () => {
  const profile = [
    { azimuthDeg: 0, elevationDeg: 10 },
    { azimuthDeg: 90, elevationDeg: 20 },
    { azimuthDeg: 180, elevationDeg: 0 },
    { azimuthDeg: 270, elevationDeg: 0 },
  ];
  close(horizonElevation(profile, 45), 15);
  close(horizonElevation(profile, 315), 5);
  close(horizonElevation(profile, -45), 5);
  close(horizonElevation(profile, 360), 10);
});

test("DSM ray horizon finds a source obstacle east and propagates missing coverage", () => {
  const grid = {
    crs: "EPSG:3301",
    bounds: [658800, 6472950, 658910, 6473060],
    width: 11,
    height: 11,
    dsm: Array(121).fill(50),
    dtm: Array(121).fill(50),
  };
  // Receiver centre (658855,6473005); obstacle cell centre is 30 m east, 20 m above terrain.
  grid.dsm[5 * 11 + 8] = 70;
  const [longitude, latitude] = projectCoordinate(
    [658855, 6473005],
    "EPSG:3301",
    "EPSG:4326",
  );
  const horizon = buildHorizon({
    grid,
    site: { longitude, latitude },
    mountingHeightM: 2,
    maxDistanceM: 45,
    azimuthStepDeg: 2,
  });
  assert.equal(horizon.coveragePct, 100);
  assert.ok(horizonElevation(horizon, 90) > 25);
  close(horizonElevation(horizon, 270), 0);
  const higher = buildHorizon({
    grid,
    site: { longitude, latitude },
    mountingHeightM: 25,
    maxDistanceM: 45,
  });
  close(horizonElevation(higher, 90), 0);
  grid.dsm[5 * 11 + 3] = null;
  const missing = buildHorizon({
    grid,
    site: { longitude, latitude },
    maxDistanceM: 45,
  });
  assert.ok(missing.coveragePct < 100);
  assert.ok(missing.warnings.length > 0);
});

test("a receiver without valid terrain has an unavailable horizon and unknown production", () => {
  const grid = {
    crs: "EPSG:3301",
    bounds: [658800, 6472950, 658910, 6473060],
    width: 11,
    height: 11,
    dsm: Array(121).fill(50),
    dtm: Array(121).fill(null),
  };
  const [longitude, latitude] = projectCoordinate(
    [658855, 6473005],
    "EPSG:3301",
    "EPSG:4326",
  );
  const horizon = buildHorizon({
    grid,
    site: { longitude, latitude },
    maxDistanceM: 45,
  });
  assert.equal(horizon.method, "unavailable");
  assert.deepEqual(horizon.profile, []);
  const result = analyzePV({ weather: [weatherRow], horizon });
  assert.equal(getHour(result).shadedKwh, null);
});

test("opaque horizon reduces direct and diffuse production while a clear profile preserves it", () => {
  const blocked = [{ azimuthDeg: 0, elevationDeg: 90 }];
  const clearAnalysis = analyzePV({
    weather: [weatherRow],
    prices: [{ time, priceEurMWh: 100 }],
    horizon: [],
  });
  const blockedAnalysis = analyzePV({
    weather: [weatherRow],
    prices: [{ time, priceEurMWh: 100 }],
    horizon: blocked,
  });
  const clear = getHour(clearAnalysis);
  const shaded = getHour(blockedAnalysis);
  close(clear.weatherKwh, clear.shadedKwh);
  assert.ok(shaded.shadedKwh < shaded.weatherKwh * 0.1);
  assert.ok(shaded.shadingLossKwh > 0);
  assert.equal(clearAnalysis.hourly.length, 8784);
  assert.equal(clearAnalysis.summary.weatherKwh, null);
  assert.ok(clearAnalysis.summary.coveredWeatherKwh > 0);
});

test("revenue uses EUR/MWh divided by 1000, margin and negative prices without clipping losses", () => {
  const result = analyzePV({
    weather: [weatherRow],
    prices: [{ time, priceEurMWh: -100 }],
    horizon: [{ azimuthDeg: 0, elevationDeg: 90 }],
    system: { salesMarginEurMWh: 5 },
  });
  const row = getHour(result);
  close(row.netPriceEurKwh, -0.105);
  close(row.weatherRevenueEur, row.weatherKwh * -0.105);
  assert.ok(row.weatherRevenueEur < 0);
  assert.ok(
    row.shadowRevenueLossEur < 0,
    "shade avoids some export losses during negative-price intervals",
  );
  assert.equal(
    result.summary.shadedRevenueEur,
    null,
    "missing prices cannot become a full-year total",
  );
  close(result.summary.pricedShadedRevenueEur, row.shadedRevenueEur);
});

test("absent horizon or absent source values remain unknown and do not become zero", () => {
  const result = analyzePV({ weather: [weatherRow], prices: [] });
  assert.equal(getHour(result).shadedKwh, null);
  assert.equal(getHour(result).shadedRevenueEur, null);
  assert.equal(getHour(result, "2024-02-01T00:00:00Z").weatherKwh, null);
  assert.equal(result.summary.shadedKwh, null);
  assert.ok(
    result.quality.warnings.some((warning) =>
      warning.includes("Local shading"),
    ),
  );
  assert.throws(
    () => analyzePV({ weather: [weatherRow, weatherRow] }),
    /Duplicate weather/,
  );
  assert.throws(() => validateSystem({ kwp: NaN }), /kwp/);
});

test("end-of-interval weather is aligned to the matching market start", () => {
  const result = analyzePV({
    weather: [{ ...weatherRow, time: "2024-06-21T11:00:00Z" }],
    weatherTimeBasis: "end",
    prices: [{ time, priceEurMWh: 40 }],
    horizon: [],
  });
  assert.ok(getHour(result).weatherKwh > 0);
  assert.equal(getHour(result).priceEurMWh, 40);
  assert.equal(getHour(result, "2024-06-21T11:00:00Z").weatherKwh, null);
});

test("owner CSV keeps DST offsets distinct, rejects ambiguous timestamps/negative energy/duplicates, and reports gaps", () => {
  const parsed = parseOwnerCsv(
    "time;energy_kwh\n2024-10-27T03:00:00+03:00;0,25\n2024-10-27T03:00:00+02:00;0,5",
  );
  assert.equal(parsed.valid, true);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.missingIntervals, 3);
  close(parsed.rows[0].energyKwh, 0.25);
  const invalid = parseOwnerCsv(
    "time,energy_kwh\n2024-10-27T03:00:00,1\n2024-10-27T01:00:00Z,-1\n2024-10-27T01:00:00Z,2\n2024-10-27T01:00:00Z,2",
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 3);
  assert.equal(invalid.rows.length, 1);
  assert.equal(
    parseOwnerCsv("time,energy_kwh\n2024-02-30T00:00:00Z,1").valid,
    false,
  );
});

test("owner comparison aggregates four quarter-hours and excludes unavailable/outside model intervals", () => {
  const model = { hourly: [{ time: "2024-06-21T10:00:00Z", shadedKwh: 4 }, { time: "2024-06-21T11:00:00Z", shadedKwh: null }] };
  const owner = parseOwnerCsv("time,energy_kwh\n" + [
    ...[1,2,1,2].map((e,i) => `2024-06-21T10:${String(i*15).padStart(2,'0')}:00Z,${e}`),
    ...[0,1,2,3].map(i => `2024-06-21T11:${String(i*15).padStart(2,'0')}:00Z,0.5`),
    "2023-06-21T10:00:00Z,5",
  ].join("\n"));
  const result = compareOwnerData(owner, model);
  assert.equal(result.matchedIntervals, 1); assert.equal(result.matchedHours, 1);
  assert.equal(result.matchedSourceIntervals, 4); assert.equal(result.matched[0].sourceIntervals, 4);
  assert.equal(result.outsideModelIntervals, 1); close(result.outsideModelHours, 0.25);
  assert.equal(result.unavailableModelIntervals, 4); assert.equal(result.unavailableModelHours, 1);
  close(result.actualKwh, 6); close(result.modelKwh, 4); close(result.maeKwh, 2); close(result.rmseKwh, 2);
  close(result.biasPct, -100/3); assert.equal(result.matched[0].durationMinutes, 60);
  assert.match(result.assumption, /no annual extrapolation/); assert.match(result.assumption, /hourly resolution/);
});

const measuredFiveMinutes = (start = "2024-06-21T10:00:00Z", count = 12) => Array.from({ length: count }, (_, i) => ({ time: new Date(Date.parse(start) + i*300000).toISOString(), durationMinutes: 5, energyKwh: 0.1 }));

test("twelve five-minute measurements become one complete hourly observation with hourly error metrics", () => {
  const model = { hourly: [{ time: "2024-06-21T10:00:00Z", durationHours: 1, shadedKwh: 1.5 }, { time: "2024-07-21T10:00:00Z", shadedKwh: 8 }] };
  const result = compareOwnerData(measuredFiveMinutes(), model);
  assert.equal(result.matchedHours, 1); assert.equal(result.matchedIntervals, 1); assert.equal(result.matchedSourceIntervals, 12);
  close(result.actualKwh, 1.2); close(result.modelKwh, 1.5); close(result.hourlyMaeKwh, 0.3); close(result.hourlyRmseKwh, 0.3); close(result.biasPct, 25);
  assert.equal(result.candidateHours, 1); assert.equal(result.splitIntervals, 0);
  assert.equal(result.periodStart, "2024-06-21T10:00:00.000Z"); assert.equal(result.periodEnd, "2024-06-21T11:00:00.000Z");
});

test("partial measured hours are excluded rather than filled or compared to a fraction of a prediction", () => {
  const result = compareOwnerData(measuredFiveMinutes(undefined, 11), { hourly: [{ time: "2024-06-21T10:00:00Z", shadedKwh: 1.2 }] });
  assert.equal(result.status, "not_testable"); assert.equal(result.matchedHours, 0); assert.equal(result.partialHours, 1);
  close(result.partialCoveredHours, 55/60); close(result.excludedCoveredHours, 55/60);
  assert.equal(result.actualKwh, null); assert.equal(result.maeKwh, null); assert.equal(result.biasPct, null);
  assert.ok(result.warnings.some(w => w.includes("incomplete measured coverage")));
});

test("duplicate and nested overlaps invalidate touched hours without double-counting duration", () => {
  const source = measuredFiveMinutes();
  const model = { hourly: [{ time: source[0].time, shadedKwh: 1.2 }] };
  const duplicate = compareOwnerData([...source, source[3]], model);
  assert.equal(duplicate.matchedHours, 0); assert.equal(duplicate.overlapHours, 1); assert.equal(duplicate.overlapIntervals, 2);
  close(duplicate.inputCoverageHours, 1); assert.equal(duplicate.partialHours, 0);
  const nested = compareOwnerData([...source, { time: source[0].time, durationMinutes: 60, energyKwh: 1.2 }], model);
  assert.equal(nested.overlapIntervals, 13); assert.equal(nested.matchedHours, 0);
});

test("cross-hour source energy is allocated by duration only with an explicit assumption", () => {
  const source = [
    { time: "2024-06-21T10:00:00Z", durationMinutes: 55, energyKwh: 11 },
    { time: "2024-06-21T10:55:00Z", durationMinutes: 10, energyKwh: 2 },
    { time: "2024-06-21T11:05:00Z", durationMinutes: 55, energyKwh: 11 },
  ];
  const result = compareOwnerData(source, { hourly: [{ time: "2024-06-21T10:00:00Z", shadedKwh: 10 }, { time: "2024-06-21T11:00:00Z", shadedKwh: 14 }] });
  assert.equal(result.matchedHours, 2); assert.equal(result.matchedSourceIntervals, 3); assert.equal(result.splitIntervals, 1);
  close(result.matched[0].actualKwh, 12); close(result.matched[1].actualKwh, 12); close(result.actualKwh, 24);
  close(result.maeKwh, 2); close(result.biasKwh, 0);
  assert.ok(result.warnings.some(w => /uniform energy rate/.test(w)));
});

test("a monthly upload outside modeled years gives no fabricated totals or accuracy", () => {
  const result = compareOwnerData(measuredFiveMinutes("2026-06-21T10:00:00+02:00"), { hourly: [{ time: "2025-06-21T08:00:00Z", shadedKwh: 1.2 }] });
  assert.equal(result.status, "not_testable"); assert.equal(result.matchedHours, 0); assert.equal(result.outsideModelIntervals, 12);
  close(result.outsideModelHours, 1); assert.equal(result.actualKwh, null); assert.equal(result.modelKwh, null); assert.equal(result.rmseKwh, null);
  const repeated = measuredFiveMinutes("2026-06-21T10:00:00+02:00");
  close(compareOwnerData([...repeated, ...repeated], { hourly: [] }).outsideModelHours, 1);
});

test("known zero measured energy yields absolute hourly errors but unknown relative error", () => {
  const zero = measuredFiveMinutes().map(row => ({ ...row, energyKwh: 0 }));
  const result = compareOwnerData(zero, { hourly: [{ time: zero[0].time, shadedKwh: 1 }] });
  assert.equal(result.matchedHours, 1); close(result.actualKwh, 0); close(result.maeKwh, 1);
  assert.equal(result.biasPct, null); assert.equal(result.nmaePct, null);
});

test("invalid durations/energy and gaps cannot silently create a complete comparison hour", () => {
  const source = measuredFiveMinutes();
  const model = { hourly: [{ time: source[0].time, shadedKwh: 1.2 }] };
  const invalid = compareOwnerData([...source, { time: source[0].time, energyKwh: -1, durationMinutes: 5 }, { time: source[0].time, energyKwh: 1, durationMinutes: 0 }], model);
  assert.equal(invalid.invalidIntervals, 2); assert.equal(invalid.invalidHours, 1); assert.equal(invalid.matchedHours, 0);
  const gap = compareOwnerData(source.filter((_, i) => i !== 6), model);
  assert.equal(gap.partialHours, 1); assert.equal(gap.matchedHours, 0);
  assert.throws(() => compareOwnerData(source, { hourly: [{ time: source[0].time, durationHours: 0.25, shadedKwh: 1 }] }), /model hours/);
});

test("pinned 2024/2025 sources produce complete finite years with monotone shade losses and exact aggregation", () => {
  const read = (name) =>
    JSON.parse(
      fs.readFileSync(new URL(`../data/source/${name}.json`, import.meta.url)),
    );
  const grid = read("context-grid");
  const polygon = rectangle(658857.5, 6473027.5, 30, 12);
  const system = { ...DEFAULT_SYSTEM, polygon };
  const horizon = buildHorizon({ grid, polygon, mountingHeightM: 2 });
  assert.ok(
    horizon.coveragePct >= 90,
    "source rays should mostly be covered without concealing invalid source cells",
  );
  if (horizon.coveragePct < 100) assert.ok(horizon.warnings.length > 0);
  const pristine = JSON.stringify(horizon);
  for (const year of [2024, 2025]) {
    const result = analyzePV({
      system,
      weather: read(`weather-${year}`),
      prices: read(`prices-${year}`),
      horizon,
      year,
    });
    const hours = year === 2024 ? 8784 : 8760;
    assert.equal(result.hourly.length, hours);
    assert.equal(result.quality.weatherHours, hours);
    assert.equal(result.quality.pricedHours, hours);
    assert.ok(
      result.summary.weatherKwh > 8500 && result.summary.weatherKwh < 11500,
    );
    assert.ok(result.summary.shadedKwh < result.summary.weatherKwh);
    assert.ok(
      result.summary.shadingLossPct >= 0 && result.summary.shadingLossPct < 30,
    );
    assert.ok(Number.isFinite(result.summary.shadedRevenueEur));
    assert.ok(
      result.hourly.every(
        (row) => row.shadedKwh >= 0 && row.shadedKwh <= row.weatherKwh + 1e-9,
      ),
    );
    close(
      result.monthly.reduce((sum, row) => sum + row.shadedKwh, 0),
      result.summary.shadedKwh,
      1e-6,
    );
    close(
      result.monthly.reduce((sum, row) => sum + row.shadedRevenueEur, 0),
      result.summary.shadedRevenueEur,
      1e-6,
    );
  }
  assert.equal(
    JSON.stringify(horizon),
    pristine,
    "analysis must not mutate the source horizon",
  );
});

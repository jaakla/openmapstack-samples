import test from "node:test";
import assert from "node:assert/strict";
import {
  assessProductionComparison,
  PRODUCTION_ASSESSMENT_POLICY,
} from "../src/production-assessment.js";

const HOUR = 3600000;
const START = Date.parse("2024-04-01T00:00:00Z");
const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const has = (result, code) =>
  result.caveats.some((caveat) => caveat.code === code);
function fixture(days = 7, scale = 1) {
  const rows = Array.from({ length: days * 24 }, (_, i) => {
    const actualKwh = i % 24 >= 8 && i % 24 < 16 ? 2 : 0;
    return {
      time: new Date(START + i * HOUR).toISOString(),
      durationMinutes: 60,
      coverageMinutes: 60,
      actualKwh,
      modelKwh: actualKwh * scale,
      longerSpanMinutes: 0,
      maxSampleGapMinutes: null,
    };
  });
  return {
    comparison: { matched: rows },
    options: {
      sourceFormat: "interval-csv",
      sourceRows: rows.map((row) => ({ time: row.time, durationMinutes: 60 })),
      modelHourly: rows.map((row) => ({ time: row.time, durationHours: 1 })),
    },
  };
}
function assess(data, extra = {}) {
  return assessProductionComparison(data.comparison, {
    ...data.options,
    ...extra,
  });
}

test("total-energy bias is recomputed from unrounded hour pairs and uses the app screening bands", () => {
  const data = fixture(7, 0.865);
  Object.assign(data.comparison, {
    actualKwh: 9000,
    modelKwh: 9000,
    biasPct: 0,
    maeKwh: 0,
    matchedHours: 1,
  });
  const result = assess(data);
  assert.equal(result.status, "assessed");
  assert.equal(result.band.label, "Worth checking");
  assert.equal(result.band.tone, "review");
  close(result.total.biasPct, -13.5);
  close(result.total.actualKwh, 112);
  close(result.total.modelKwh, 96.88);
  close(result.total.differenceKwh, -15.12);
  assert.equal(result.total.direction, "lower");
  assert.match(result.headline, /13.5% lower.*matched hours/);
  close(result.hourly.maeKwh, 0.09);
  close(result.hourly.nmaePct, 13.5);
  close(result.hourly.nrmsePct, (result.hourly.rmseKwh / (112 / 168)) * 100);
  assert.equal(result.coverage.matchedHours, 168);
  assert.equal(result.coverage.matchedDays, 7);
  assert.equal(result.coverage.coveragePct, 100);
  assert.equal(result.generation.hours, 56);
  assert.equal(result.policy.hourlyFitGraded, false);
  assert.ok(has(result, "app_heuristic"));
  assert.ok(has(result, "matched_period_only"));
});

test("positive and negative bias boundaries tolerate floating point noise but preserve their documented inclusive limits", () => {
  for (const [absolute, label, tone] of [
    [5, "Close energy total", "good"],
    [10, "Reasonable energy total", "good"],
    [20, "Worth checking", "review"],
    [20.0001, "Large energy difference", "poor"],
  ]) {
    for (const direction of [-1, 1]) {
      const result = assess(fixture(7, 1 + (direction * absolute) / 100));
      assert.equal(result.band.label, label, `${direction * absolute}%`);
      assert.equal(result.band.tone, tone);
      close(result.total.biasPct, direction * absolute);
      assert.equal(result.total.direction, direction < 0 ? "lower" : "higher");
    }
  }
  const boundary = fixture();
  for (const row of boundary.comparison.matched) {
    row.actualKwh = 1;
    row.modelKwh = 1.05;
  }
  assert.ok(
    assess(boundary).total.biasPct > 5,
    "the fixture exercises a binary floating-point excess",
  );
  assert.equal(assess(boundary).band.id, "close");
});

test("canceling hourly errors can have close totals and large ungraded hourly errors", () => {
  const data = fixture();
  for (const [i, row] of data.comparison.matched.entries())
    if (row.actualKwh > 0) row.modelKwh = i % 2 ? 4 : 0;
  const result = assess(data);
  assert.equal(result.status, "assessed");
  assert.equal(result.band.label, "Close energy total");
  close(result.total.biasPct, 0);
  close(result.hourly.nmaePct, 100);
  assert.ok(result.hourly.nrmsePct > 100);
  assert.equal(result.policy.hourlyFitGraded, false);
  assert.match(
    result.caveats.find((c) => c.code === "app_heuristic").message,
    /close total can hide large hourly errors/,
  );
  assert.match(result.headline, /energy totals agree/);
});

test("all-hour normalization includes zero nights while the generation subset excludes true zeros and retains false-positive predictions", () => {
  const active = [
    {
      time: "2024-04-01T08:00:00Z",
      durationMinutes: 60,
      actualKwh: 2,
      modelKwh: 1,
    },
    {
      time: "2024-04-01T09:00:00Z",
      durationMinutes: 60,
      actualKwh: 0,
      modelKwh: 1,
    },
  ];
  const zero = {
    time: "2024-04-01T00:00:00Z",
    durationMinutes: 60,
    actualKwh: 0,
    modelKwh: 0,
  };
  const before = assessProductionComparison(
    { matched: active },
    { expectedHours: 2 },
  );
  const after = assessProductionComparison(
    { matched: [...active, zero] },
    { expectedHours: 3 },
  );
  close(before.hourly.nmaePct, 100);
  close(after.hourly.nmaePct, before.hourly.nmaePct);
  close(before.total.biasPct, 0);
  close(after.total.biasPct, 0);
  assert.notEqual(after.hourly.nrmsePct, before.hourly.nrmsePct);
  assert.deepEqual(after.generation, before.generation);
  assert.equal(after.generation.hours, 2);
  assert.equal(
    after.hourly.normalization,
    "mean_actual_all_matched_hours_including_nighttime",
  );
  assert.ok(has(after, "hourly_normalization"));
});

test("zero observed energy and absent or invalid matches are not assessable and retain complete result shapes", () => {
  const empty = assessProductionComparison(null);
  assert.equal(empty.status, "not_testable");
  assert.equal(empty.total.actualKwh, null);
  assert.equal(empty.hourly.maeKwh, null);
  assert.equal(empty.coverage.matchedHours, 0);
  assert.equal(empty.band.tone, "neutral");
  assert.ok(has(empty, "no_matches"));
  const data = fixture();
  for (const row of data.comparison.matched) {
    row.actualKwh = 0;
    row.modelKwh = 1;
  }
  const zero = assess(data);
  assert.equal(zero.status, "not_testable");
  assert.equal(zero.total.actualKwh, 0);
  assert.equal(zero.total.biasPct, null);
  close(zero.hourly.maeKwh, 1);
  assert.equal(zero.hourly.nmaePct, null);
  assert.equal(zero.hourly.nrmsePct, null);
  assert.equal(zero.generation.hours, 168);
  assert.ok(has(zero, "zero_actual_energy"));
  const invalid = assessProductionComparison({
    matched: [
      {
        time: "2024-04-01T00:00:00Z",
        durationMinutes: 15,
        actualKwh: 1,
        modelKwh: 1,
      },
    ],
  });
  assert.equal(invalid.status, "not_testable");
  assert.ok(has(invalid, "invalid_matched_rows"));
});

test("seven dates and 24 union-positive generation hours are independent evidence gates", () => {
  const sixDays = assess(fixture(6));
  assert.equal(sixDays.status, "limited");
  assert.equal(sixDays.band.tone, "neutral");
  assert.ok(has(sixDays, "few_dates"));
  const data = fixture();
  for (const row of data.comparison.matched) {
    row.actualKwh = 0;
    row.modelKwh = 0;
  }
  const selected = data.comparison.matched
    .filter((_, i) => i % 24 >= 8 && i % 24 < 12)
    .slice(0, 24);
  for (const row of selected) row.modelKwh = 1;
  selected[0].actualKwh = 1;
  const exact = assess(data);
  assert.equal(exact.status, "assessed");
  assert.equal(exact.generation.hours, 24);
  selected.at(-1).modelKwh = 0;
  const short = assess(data);
  assert.equal(short.status, "limited");
  assert.equal(short.generation.hours, 23);
  assert.ok(has(short, "few_generation_hours"));
});

test("whole-day source gaps count against overlap-window coverage even when every touched hour matched", () => {
  const data = fixture(10);
  const keepDays = new Set([0, 1, 2, 3, 4, 8, 9]);
  data.comparison.matched = data.comparison.matched.filter((_, i) =>
    keepDays.has(Math.floor(i / 24)),
  );
  data.comparison.candidateHours = data.comparison.matched.length;
  const result = assess(data);
  assert.equal(result.coverage.matchedDays, 7);
  assert.equal(result.coverage.expectedHours, 240);
  assert.equal(result.coverage.matchedHours, 168);
  assert.equal(result.coverage.coveragePct, 70);
  assert.equal(result.status, "limited");
  assert.ok(has(result, "low_coverage"));
  // A sparse uploaded CSV likewise carries the gap in its elapsed envelope.
  data.options.sourceRows = data.options.sourceRows.filter((_, i) =>
    keepDays.has(Math.floor(i / 24)),
  );
  assert.equal(assess(data).coverage.expectedHours, 240);
  // Missing model dates inside that same envelope also stay in the denominator.
  data.options.modelHourly = data.options.modelHourly.filter((_, i) =>
    keepDays.has(Math.floor(i / 24)),
  );
  assert.equal(assess(data).coverage.expectedHours, 240);
});

test("coverage at 80 percent passes and one more missing hour limits the assessment", () => {
  const data = fixture(10);
  data.comparison.matched = data.comparison.matched.filter(
    (_, i) => Math.floor(i / 24) !== 4 && Math.floor(i / 24) !== 5,
  );
  assert.equal(assess(data).coverage.coveragePct, 80);
  assert.equal(assess(data).status, "assessed");
  data.comparison.matched.splice(24, 1);
  assert.ok(assess(data).coverage.coveragePct < 80);
  assert.equal(assess(data).status, "limited");
});

test("sample instants and interval rows derive exclusive source ends, and partial boundaries use UTC hour bins", () => {
  const data = fixture();
  const summary = {
    firstTime: new Date(START).toISOString(),
    lastTime: new Date(START + 168 * HOUR).toISOString(),
  };
  assert.equal(
    assess(data, { sourceSummary: summary, sourceRows: undefined }).coverage
      .expectedHours,
    168,
  );
  const sampleBounds = {
    firstTime: new Date(START + 5 * 60000).toISOString(),
    lastTime: new Date(START + 168 * HOUR - 5 * 60000).toISOString(),
  };
  data.comparison.matched = data.comparison.matched.slice(1, -1);
  const partial = assess(data, {
    sourceSummary: sampleBounds,
    sourceRows: undefined,
  });
  assert.equal(partial.coverage.expectedHours, 168);
  close(partial.coverage.coveragePct, (166 / 168) * 100);
  const quarterRows = [
    { time: new Date(START).toISOString(), durationMinutes: 15 },
    {
      time: new Date(START + 168 * HOUR - 15 * 60000).toISOString(),
      durationMinutes: 15,
    },
  ];
  assert.equal(
    assess(data, { sourceRows: quarterRows }).coverage.expectedHours,
    168,
  );
});

test("source/model overlap excludes outside years and unknown or inconsistent windows never claim full coverage", () => {
  const data = fixture(10);
  data.options.modelHourly = data.options.modelHourly.slice(3 * 24);
  data.comparison.matched = data.comparison.matched.slice(3 * 24);
  const overlap = assess(data);
  assert.equal(overlap.coverage.expectedHours, 168);
  assert.equal(overlap.coverage.coveragePct, 100);
  assert.equal(overlap.status, "assessed");
  const unknown = assess(data, { sourceRows: undefined });
  assert.equal(unknown.coverage.expectedHours, null);
  assert.equal(unknown.coverage.coveragePct, null);
  assert.equal(unknown.status, "limited");
  assert.ok(has(unknown, "unknown_coverage"));
  const inconsistent = assess(data, { expectedHours: 1 });
  assert.equal(inconsistent.coverage.coveragePct, null);
  assert.equal(inconsistent.status, "limited");
  assert.ok(has(inconsistent, "inconsistent_window"));
  const missingYear = assessProductionComparison(
    { matched: [] },
    {
      sourceSummary: {
        firstTime: "2026-04-01T00:00:00Z",
        lastTime: "2026-04-08T00:00:00Z",
      },
      modelHourly: data.options.modelHourly,
    },
  );
  assert.equal(missingYear.coverage.expectedHours, 0);
  assert.equal(missingYear.status, "not_testable");
  assert.ok(has(missingYear, "no_period_overlap"));
});

test("accepted interpolation and excluded source gaps remain caveated even for perfect energy agreement", () => {
  const data = fixture();
  for (const row of data.comparison.matched) {
    row.longerSpanMinutes = 15;
    row.maxSampleGapMinutes = 10;
  }
  data.comparison.excludedHours = 2;
  const result = assess(data, {
    sourceFormat: "solarman-xlsx",
    sourceSummary: { integrationMaxGapMinutes: 30, excludedGapHours: 1 },
  });
  assert.equal(result.status, "assessed");
  assert.equal(result.total.biasPct, 0);
  assert.equal(result.coverage.longerSpanMinutes, 168 * 15);
  assert.equal(result.coverage.longerSpanPct, 25);
  assert.equal(result.coverage.maxSampleGapMinutes, 10);
  for (const code of [
    "integrated_power",
    "longer_spans",
    "excluded_gaps",
    "excluded_hours",
  ])
    assert.ok(has(result, code));
  assert.match(
    result.caveats.find((c) => c.code === "integrated_power").message,
    /not read from a metered/,
  );
});

test("invalid or overlapping source and matched rows cannot earn a reassuring assessment", () => {
  for (const key of ["invalidIntervals", "overlapIntervals"]) {
    const data = fixture();
    data.comparison[key] = 1;
    const result = assess(data);
    assert.equal(result.status, "limited");
    assert.equal(result.band.tone, "neutral");
    assert.ok(has(result, "source_quality"));
  }
  const data = fixture();
  assert.equal(assess(data, { sourceValid: false }).status, "not_testable");
  data.comparison.matched.push({ ...data.comparison.matched[8] });
  const duplicate = assess(data);
  assert.equal(duplicate.coverage.matchedHours, 167);
  assert.equal(duplicate.status, "limited");
  assert.ok(has(duplicate, "invalid_matched_rows"));
  data.comparison.matched.push({
    time: new Date(START + 10 * HOUR).toISOString(),
    durationMinutes: 60,
    actualKwh: NaN,
    modelKwh: 2,
  });
  assert.equal(assess(data).coverage.matchedHours, 166);
});

test("malformed completeness metadata and unrepresentable totals cannot produce a positive verdict", () => {
  const data = fixture();
  data.comparison.matched[8].coverageMinutes = "60";
  const invalid = assess(data);
  assert.equal(invalid.coverage.matchedHours, 167);
  assert.equal(invalid.status, "limited");
  assert.ok(has(invalid, "invalid_matched_rows"));
  const extreme = fixture();
  for (const row of extreme.comparison.matched) {
    row.actualKwh = 1e308;
    row.modelKwh = 1e308;
  }
  const result = assess(extreme);
  assert.equal(result.status, "not_testable");
  assert.equal(result.band.tone, "neutral");
  assert.equal(result.total.actualKwh, null);
  assert.equal(result.total.biasPct, null);
  assert.ok(has(result, "non_finite_totals"));
  assert.doesNotThrow(() => assessProductionComparison({ matched: {} }));
});

test("assessment is pure, exposes the policy, and suggests checks without automatic capacity correction", () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const result = assess(data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(result.policy, PRODUCTION_ASSESSMENT_POLICY);
  assert.equal(result.policy.bands.length, 4);
  assert.match(result.policy.description, /not an industry/);
  assert.throws(() => result.policy.bands.push({}), TypeError);
  assert.match(result.nextChecks.join(" "), /capacity.*tilt.*orientation/);
  assert.match(result.nextChecks.join(" "), /UTC offsets/);
  assert.match(result.nextChecks.join(" "), /AC or DC/);
  assert.match(result.nextChecks.join(" "), /weather.*grid cell/);
  assert.match(
    result.nextChecks.join(" "),
    /does not automatically correct capacity/,
  );
});

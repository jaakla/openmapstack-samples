const HOUR = 3600000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const iso = (time) => new Date(time).toISOString();

/** Product screening choices, not an industry validation or calibration standard. */
export const PRODUCTION_ASSESSMENT_POLICY = Object.freeze({
  description:
    "App screening heuristics for matched-period energy totals, not an industry accuracy standard or a model calibration.",
  minimumMatchedDays: 7,
  minimumGenerationHours: 24,
  minimumCoveragePct: 80,
  generationCriterion: "actualKwh > 0 OR modelKwh > 0",
  coverageBasis:
    "Complete matched UTC hours divided by all UTC hour bins in the source/model overlap window, including internal gaps.",
  normalization:
    "Hourly MAE and RMSE divided by mean actual hourly energy in the same set of hours. All matched hours include nighttime.",
  hourlyFitGraded: false,
  bands: Object.freeze([
    Object.freeze({
      id: "close",
      label: "Close energy total",
      tone: "good",
      minExclusivePct: null,
      maxInclusivePct: 5,
    }),
    Object.freeze({
      id: "reasonable",
      label: "Reasonable energy total",
      tone: "good",
      minExclusivePct: 5,
      maxInclusivePct: 10,
    }),
    Object.freeze({
      id: "worth_checking",
      label: "Worth checking",
      tone: "review",
      minExclusivePct: 10,
      maxInclusivePct: 20,
    }),
    Object.freeze({
      id: "large_difference",
      label: "Large energy difference",
      tone: "poor",
      minExclusivePct: 20,
      maxInclusivePct: null,
    }),
  ]),
});

function instant(value) {
  if (value instanceof Date) return value.getTime();
  if (finite(value)) return new Date(value).getTime();
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
    return NaN;
  return Date.parse(value);
}

function intervalMinutes(row) {
  return (
    row?.durationMinutes ??
    (finite(row?.durationHours) ? row.durationHours * 60 : null)
  );
}

function sourceExtent(sourceSummary, sourceRows) {
  const first = instant(sourceSummary?.firstTime);
  const last = instant(sourceSummary?.lastTime);
  // Logger summary timestamps are power sample instants; the last is the end,
  // rather than the beginning, of the last integrated interval.
  if (finite(first) && finite(last) && last > first)
    return { start: first, end: last };
  if (!Array.isArray(sourceRows) || !sourceRows.length) return null;
  let start = Infinity,
    end = -Infinity;
  for (const row of sourceRows) {
    const time = instant(row?.time);
    const minutes = intervalMinutes(row);
    if (
      !finite(time) ||
      !finite(minutes) ||
      minutes <= 0 ||
      !finite(time + minutes * 60000)
    )
      return null;
    start = Math.min(start, time);
    end = Math.max(end, time + minutes * 60000);
  }
  return end > start ? { start, end } : null;
}

function modelExtent(modelHourly) {
  if (!Array.isArray(modelHourly) || !modelHourly.length) return null;
  let start = Infinity,
    end = -Infinity;
  for (const row of modelHourly) {
    const time = instant(row?.time);
    if (
      !finite(time) ||
      time % HOUR !== 0 ||
      (row.durationHours != null && row.durationHours !== 1)
    )
      return null;
    start = Math.min(start, time);
    end = Math.max(end, time + HOUR);
  }
  return { start, end };
}

function overlapWindow(options) {
  if (options.expectedHours !== undefined) {
    return finite(options.expectedHours) &&
      Number.isInteger(options.expectedHours) &&
      options.expectedHours >= 0
      ? { expectedHours: options.expectedHours, start: null, end: null }
      : { expectedHours: null, start: null, end: null };
  }
  const source = sourceExtent(options.sourceSummary, options.sourceRows);
  const model = modelExtent(options.modelHourly);
  if (!source || !model) return { expectedHours: null, start: null, end: null };
  const start = Math.max(source.start, model.start),
    end = Math.min(source.end, model.end);
  if (end <= start) return { expectedHours: 0, start: null, end: null };
  const firstHour = Math.floor(start / HOUR) * HOUR;
  const lastEnd = Math.ceil(end / HOUR) * HOUR;
  return {
    expectedHours: (lastEnd - firstHour) / HOUR,
    start: firstHour,
    end: lastEnd,
  };
}

function metrics(rows) {
  const hours = rows.length;
  if (!hours)
    return {
      hours: 0,
      meanActualKwh: null,
      maeKwh: null,
      rmseKwh: null,
      nmaePct: null,
      nrmsePct: null,
      normalization: "mean_actual_same_hours",
    };
  const meanActualKwh = rows.reduce(
    (sum, row) => sum + row.actualKwh / hours,
    0,
  );
  const maeKwh = rows.reduce(
    (sum, row) => sum + Math.abs(row.modelKwh - row.actualKwh) / hours,
    0,
  );
  const maxError = rows.reduce(
    (maximum, row) => Math.max(maximum, Math.abs(row.modelKwh - row.actualKwh)),
    0,
  );
  // Scaling avoids overflowing error² for otherwise finite inputs.
  const scaledSquaredError = maxError
    ? rows.reduce(
        (sum, row) => sum + ((row.modelKwh - row.actualKwh) / maxError) ** 2,
        0,
      )
    : 0;
  const rmseKwh = maxError
    ? maxError * Math.sqrt(scaledSquaredError / hours)
    : 0;
  const normalized = (error) =>
    meanActualKwh > 0 && finite((error / meanActualKwh) * 100)
      ? (error / meanActualKwh) * 100
      : null;
  return {
    hours,
    meanActualKwh,
    maeKwh,
    rmseKwh,
    nmaePct: normalized(maeKwh),
    nrmsePct: normalized(rmseKwh),
    normalization: "mean_actual_same_hours",
  };
}

/** Assess only complete, unique observed/modelled hour pairs; never extrapolate. */
export function assessProductionComparison(comparison, options = {}) {
  const caveats = [];
  const add = (code, message) => caveats.push({ code, message });
  const byTime = new Map(),
    rejectedTimes = new Set();
  let invalidMatchedRows = 0,
    duplicateMatchedRows = 0;
  for (const row of Array.isArray(comparison?.matched)
    ? comparison.matched
    : []) {
    const time = instant(row?.time);
    const durationMinutes = intervalMinutes(row);
    const complete =
      durationMinutes === 60 &&
      (row.coverageMinutes == null ||
        (finite(row.coverageMinutes) &&
          Math.abs(row.coverageMinutes - 60) <= 1e-8));
    if (
      !finite(time) ||
      time % HOUR !== 0 ||
      !complete ||
      !finite(row.actualKwh) ||
      row.actualKwh < 0 ||
      !finite(row.modelKwh) ||
      row.modelKwh < 0
    ) {
      invalidMatchedRows += 1;
      if (finite(time)) rejectedTimes.add(time);
      continue;
    }
    if (byTime.has(time)) {
      duplicateMatchedRows += 1;
      rejectedTimes.add(time);
    } else byTime.set(time, { ...row, time: iso(time) });
  }
  const rows = [...byTime]
    .filter(([time]) => !rejectedTimes.has(time))
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
  const hours = rows.length;
  const sum = (key) => {
    const value = rows.reduce((total, row) => total + row[key], 0);
    return hours && finite(value) ? value : null;
  };
  const actualKwh = sum("actualKwh"),
    modelKwh = sum("modelKwh");
  const differenceKwh =
    actualKwh != null && modelKwh != null ? modelKwh - actualKwh : null;
  const rawBiasPct =
    actualKwh > 0 && differenceKwh != null
      ? (differenceKwh / actualKwh) * 100
      : null;
  const biasPct = finite(rawBiasPct) ? rawBiasPct : null;
  const numericProblem =
    hours > 0 &&
    (actualKwh == null ||
      modelKwh == null ||
      (actualKwh > 0 && biasPct == null));
  const total = {
    actualKwh,
    modelKwh,
    differenceKwh,
    biasPct,
    direction:
      differenceKwh == null
        ? "unknown"
        : differenceKwh < 0
          ? "lower"
          : differenceKwh > 0
            ? "higher"
            : "equal",
  };
  const hourly = {
    ...metrics(rows),
    normalization: "mean_actual_all_matched_hours_including_nighttime",
  };
  const generationRows = rows.filter(
    (row) => row.actualKwh > 0 || row.modelKwh > 0,
  );
  const generation = {
    ...metrics(generationRows),
    normalization: "mean_actual_generation_hours",
    criterion: PRODUCTION_ASSESSMENT_POLICY.generationCriterion,
  };
  const window = overlapWindow(options);
  const inconsistentWindow =
    (window.expectedHours != null && hours > window.expectedHours) ||
    (window.start != null &&
      rows.some(
        (row) =>
          instant(row.time) < window.start || instant(row.time) >= window.end,
      ));
  const coveragePct =
    window.expectedHours > 0 && !inconsistentWindow
      ? (hours / window.expectedHours) * 100
      : null;
  const matchedDays = new Set(rows.map((row) => row.time.slice(0, 10))).size;
  const longerSpanMinutes = rows.reduce(
    (sum, row) =>
      sum +
      (finite(row.longerSpanMinutes) &&
      row.longerSpanMinutes >= 0 &&
      row.longerSpanMinutes <= 60
        ? row.longerSpanMinutes
        : 0),
    0,
  );
  const maxSampleGapMinutes = rows.reduce(
    (maximum, row) =>
      finite(row.maxSampleGapMinutes) && row.maxSampleGapMinutes > 0
        ? Math.max(maximum ?? 0, row.maxSampleGapMinutes)
        : maximum,
    null,
  );
  const coverage = {
    matchedHours: hours,
    expectedHours: window.expectedHours,
    coveragePct,
    matchedDays,
    longerSpanMinutes,
    longerSpanPct: hours ? (longerSpanMinutes / (hours * 60)) * 100 : null,
    maxSampleGapMinutes,
  };

  add(
    "matched_period_only",
    "Totals and errors describe matched hours only. They are not an annual accuracy claim and are not extrapolated to missing periods.",
  );
  add(
    "app_heuristic",
    "Energy-total bands and evidence gates are app screening heuristics, not an industry validation standard. A close total can hide large hourly errors.",
  );
  add(
    "hourly_normalization",
    "Normalized hourly MAE and RMSE use mean actual energy over the same matched hours, including nighttime. Generation-hour figures use hours where actual or modeled energy is positive; no hourly-fit grade is assigned.",
  );
  if (options.sourceFormat === "solarman-xlsx")
    add(
      "integrated_power",
      "Uploaded energy is estimated by interpolating and integrating reported power samples, not read from a metered kWh counter. The export does not establish the AC/DC measurement point.",
    );
  if (longerSpanMinutes > 0)
    add(
      "longer_spans",
      `${longerSpanMinutes.toFixed(1)} matched minutes come from accepted spans longer than 1.5 times the typical sample spacing; their energy depends on interpolation.`,
    );
  if ((options.sourceSummary?.excludedGapHours ?? 0) > 0)
    add(
      "excluded_gaps",
      "Logger gaps beyond the selected interpolation limit are excluded. The overlap-window coverage denominator includes internal outages.",
    );
  if (
    (comparison?.excludedHours ?? 0) > 0 ||
    (comparison?.partialHours ?? 0) > 0
  )
    add(
      "excluded_hours",
      "Incomplete or otherwise excluded hours are absent from the energy and error totals; their missing energy is unknown.",
    );
  if ((comparison?.outsideModelIntervals ?? 0) > 0)
    add(
      "outside_model",
      "Some uploaded intervals lie outside available model dates and are not compared.",
    );
  const sourceProblem =
    options.sourceValid === false ||
    (comparison?.invalidIntervals ?? 0) > 0 ||
    (comparison?.overlapIntervals ?? 0) > 0;
  if (sourceProblem)
    add(
      "source_quality",
      "Invalid or overlapping source data limit this comparison. Resolve import errors before relying on its energy band.",
    );
  if ((comparison?.unavailableModelHours ?? 0) > 0)
    add(
      "unknown_model_energy",
      "Some source hours have unknown modeled energy and cannot be compared.",
    );
  if (invalidMatchedRows || duplicateMatchedRows)
    add(
      "invalid_matched_rows",
      "Invalid, incomplete or duplicate matched rows were excluded from the assessment.",
    );
  if (!hours)
    add(
      "no_matches",
      "No complete, unique hours with known observed and modeled energy are available.",
    );
  else if (numericProblem)
    add(
      "non_finite_totals",
      "Source magnitudes cannot be represented as finite energy totals; no energy assessment is possible.",
    );
  else if (!(actualKwh > 0))
    add(
      "zero_actual_energy",
      "Matched observed energy is zero; relative energy bias and normalized errors cannot be assessed.",
    );
  if (matchedDays < PRODUCTION_ASSESSMENT_POLICY.minimumMatchedDays)
    add(
      "few_dates",
      "Fewer than seven distinct UTC dates are matched; the sample is too short for the energy-total screening band.",
    );
  if (generation.hours < PRODUCTION_ASSESSMENT_POLICY.minimumGenerationHours)
    add(
      "few_generation_hours",
      "Fewer than 24 matched hours have positive observed or modeled generation; nighttime-only or very small samples provide limited evidence.",
    );
  if (inconsistentWindow)
    add(
      "inconsistent_window",
      "Matched hours do not fit the supplied source/model coverage window; period coverage is unknown.",
    );
  else if (window.expectedHours === 0)
    add(
      "no_period_overlap",
      "The uploaded source period and model dates do not overlap.",
    );
  else if (coveragePct == null)
    add(
      "unknown_coverage",
      "The full source/model overlap window is unknown, so period coverage cannot be established.",
    );
  else if (coveragePct < PRODUCTION_ASSESSMENT_POLICY.minimumCoveragePct)
    add(
      "low_coverage",
      "Fewer than 80% of the UTC hour bins in the full source/model overlap window are matched; internal gaps count against coverage.",
    );

  const testable =
    hours > 0 &&
    actualKwh > 0 &&
    options.sourceValid !== false &&
    !numericProblem;
  const sufficient =
    testable &&
    matchedDays >= PRODUCTION_ASSESSMENT_POLICY.minimumMatchedDays &&
    generation.hours >= PRODUCTION_ASSESSMENT_POLICY.minimumGenerationHours &&
    coveragePct >= PRODUCTION_ASSESSMENT_POLICY.minimumCoveragePct &&
    !sourceProblem &&
    !invalidMatchedRows &&
    !duplicateMatchedRows;
  const status = !testable
    ? "not_testable"
    : sufficient
      ? "assessed"
      : "limited";
  const energyBand =
    biasPct == null
      ? null
      : PRODUCTION_ASSESSMENT_POLICY.bands.find(
          (band) =>
            band.maxInclusivePct == null ||
            Math.abs(biasPct) <= band.maxInclusivePct + 1e-9,
        );
  const band =
    status === "assessed"
      ? { ...energyBand }
      : {
          id: status,
          label: status === "limited" ? "Limited evidence" : "Not assessable",
          tone: "neutral",
        };
  const totalStatement =
    biasPct == null
      ? "Relative energy difference cannot be assessed."
      : differenceKwh === 0
        ? "The energy totals agree over matched hours."
        : `Modeled energy is ${Math.abs(biasPct).toFixed(1)}% ${total.direction} over matched hours.`;
  const headline =
    status === "assessed"
      ? totalStatement
      : status === "limited"
        ? `Limited evidence. ${totalStatement}`
        : "Not enough valid production data for an energy assessment.";
  const nextChecks = [
    "Confirm the polygon and coordinates describe this installation, and enter its DC panel capacity, tilt and orientation, including separate roof directions.",
    "Check logger UTC offsets and timestamp alignment; a shifted clock can hide hourly mismatches even when totals agree.",
    "Confirm that the uploaded series is PV production rather than grid export or household consumption, and whether power is measured on the AC or DC side.",
    "Check local shadows and seasonal obstruction, electrical losses, inverter limits, snow, outages and curtailment.",
    "Reanalysis weather represents a grid cell; local clouds can differ. Compare more dates before changing system parameters; this screen does not automatically correct capacity.",
  ];
  return {
    status,
    band,
    headline,
    total,
    hourly,
    generation,
    coverage,
    caveats,
    nextChecks,
    policy: PRODUCTION_ASSESSMENT_POLICY,
  };
}

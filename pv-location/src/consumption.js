const HOUR = 3600000;
const QUARTER = HOUR / 4;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const stamp = (value) =>
  typeof value === "number" ? value : Date.parse(value);
const isoTime = (value) => new Date(value).toISOString();
const normalized = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
const formatters = new Map();
const offsetCache = new Map();

export const DEFAULT_CONSUMPTION = Object.freeze({
  mode: "estimate",
  dayKwh: 10,
  nightKwh: 4,
  dayStartHour: 7,
  dayEndHour: 23,
  timeZone: "Europe/Tallinn",
  importAdderEurMWh: 0,
  fillMissingWithEstimate: false,
});

function formatter(timeZone) {
  if (!formatters.has(timeZone))
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  return formatters.get(timeZone);
}

function clock(time, timeZone) {
  const out = {};
  for (const part of formatter(timeZone).formatToParts(time))
    if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}
const pad = (value) => String(value).padStart(2, "0");
const dateKey = (p) => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
const clockKey = (p) =>
  `${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
const naiveTime = (p) =>
  Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
const sameClock = (a, b) =>
  ["year", "month", "day", "hour", "minute", "second"].every(
    (key) => (a[key] ?? 0) === (b[key] ?? 0),
  );

function candidates(parts, timeZone) {
  const naive = naiveTime(parts);
  const key = `${timeZone}:${dateKey(parts)}`;
  if (!offsetCache.has(key)) {
    const offsets = new Set();
    for (const hours of [-36, -12, 12, 36]) {
      const t = naive + hours * HOUR;
      offsets.add(naiveTime(clock(t, timeZone)) - t);
    }
    offsetCache.set(key, [...offsets]);
  }
  return offsetCache
    .get(key)
    .map((offset) => naive - offset)
    .filter((t) => sameClock(clock(t, timeZone), parts))
    .sort((a, b) => a - b);
}

function parseTimestamp(text, timeZone) {
  const value = String(text).trim();
  const explicit = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const match =
    value.match(
      /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    ) ??
    value.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i,
    );
  if (!match) throw new Error("Use DD.MM.YYYY HH:mm or an ISO timestamp.");
  const estonian = /^\d{2}\.\d{2}\./.test(value);
  const parts = {
    year: +(estonian ? match[3] : match[1]),
    month: +match[2],
    day: +(estonian ? match[1] : match[3]),
    hour: +match[4],
    minute: +match[5],
    second: +(match[6] ?? 0),
  };
  if (
    parts.year < 1901 ||
    parts.year > 2099 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate() ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  )
    throw new Error(
      "The timestamp has an invalid calendar date or clock time.",
    );
  const times = explicit
    ? [stamp(value.replace(" ", "T"))].filter(Number.isFinite)
    : candidates(parts, timeZone);
  if (!times.length)
    throw new Error(
      "The local clock time does not exist (check the spring daylight-saving transition).",
    );
  return {
    times,
    localKey: explicit
      ? value
      : `${dateKey(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
    explicit,
  };
}

function safeMetadata(input = {}, timeZone) {
  const fileName =
    typeof input.fileName === "string"
      ? input.fileName.split(/[\\/]/).at(-1).slice(0, 160)
      : undefined;
  return {
    ...(fileName ? { fileName } : {}),
    format:
      input.format === "Enefit historical report"
        ? input.format
        : "interval-energy CSV",
    seriesType: "grid-import",
    timeZone,
  };
}

export function normalizeConsumptionConfig(input = {}) {
  const config = { ...DEFAULT_CONSUMPTION, ...input };
  if (!["estimate", "csv-exact", "csv-calendar"].includes(config.mode))
    throw new Error("Select estimate, csv-exact or csv-calendar consumption.");
  for (const key of ["dayKwh", "nightKwh"])
    if (!finite(config[key]) || config[key] < 0 || config[key] > 10000000)
      throw new Error(`${key} must be a nonnegative daily-period kWh value.`);
  for (const key of ["dayStartHour", "dayEndHour"])
    if (!Number.isInteger(config[key]) || config[key] < 0 || config[key] > 23)
      throw new Error(`${key} must be an integer local hour from 0 to 23.`);
  if (config.dayStartHour === config.dayEndHour)
    throw new Error("Day and night must each have a nonzero clock period.");
  if (
    !finite(config.importAdderEurMWh) ||
    config.importAdderEurMWh < -1000 ||
    config.importAdderEurMWh > 1000
  )
    throw new Error("Import adder must be between -1000 and 1000 EUR/MWh.");
  if (typeof config.fillMissingWithEstimate !== "boolean")
    throw new Error("Gap filling must be an explicit true or false choice.");
  if (typeof config.timeZone !== "string")
    throw new Error("Choose a valid IANA time zone.");
  try {
    formatter(config.timeZone);
  } catch {
    throw new Error("Choose a valid IANA time zone.");
  }
  const out = {
    mode: config.mode,
    dayKwh: config.dayKwh,
    nightKwh: config.nightKwh,
    dayStartHour: config.dayStartHour,
    dayEndHour: config.dayEndHour,
    timeZone: config.timeZone,
    importAdderEurMWh: config.importAdderEurMWh,
    fillMissingWithEstimate: config.fillMissingWithEstimate,
  };
  if (config.mode !== "estimate") {
    if (
      !Array.isArray(config.rows) ||
      !config.rows.length ||
      config.rows.length > 100000
    )
      throw new Error(
        "CSV consumption needs between 1 and 100000 validated intervals.",
      );
    out.rows = config.rows
      .map((row) => {
        if (
          typeof row.time === "string" &&
          !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(row.time)
        )
          throw new Error(
            "Validated consumption timestamps need an explicit UTC offset.",
          );
        const time =
          typeof row.time === "string"
            ? parseTimestamp(row.time, config.timeZone).times[0]
            : stamp(row.time);
        const durationHours =
          row.durationHours ??
          (row.durationMinutes != null ? row.durationMinutes / 60 : 0.25);
        if (
          !Number.isFinite(time) ||
          time % QUARTER !== 0 ||
          !finite(row.energyKwh) ||
          row.energyKwh < 0 ||
          !finite(durationHours) ||
          durationHours <= 0 ||
          durationHours > 1 ||
          (durationHours * 4) % 1 !== 0
        )
          throw new Error(
            "Consumption intervals need UTC quarter-hour starts, nonnegative kWh and durations of 15–60 minutes.",
          );
        if (
          row.reportedGridExportKwh != null &&
          (!finite(row.reportedGridExportKwh) || row.reportedGridExportKwh < 0)
        )
          throw new Error(
            "Reported grid export must be nonnegative interval kWh.",
          );
        return {
          time: isoTime(time),
          energyKwh: row.energyKwh,
          durationHours,
          ...(row.reportedGridExportKwh != null
            ? { reportedGridExportKwh: row.reportedGridExportKwh }
            : {}),
        };
      })
      .sort((a, b) => stamp(a.time) - stamp(b.time));
    for (let i = 1; i < out.rows.length; i += 1)
      if (
        stamp(out.rows[i].time) <
        stamp(out.rows[i - 1].time) + out.rows[i - 1].durationHours * HOUR
      )
        throw new Error("Consumption intervals duplicate or overlap.");
    out.metadata = safeMetadata(config.metadata, config.timeZone);
  }
  return out;
}
export const validateConsumption = normalizeConsumptionConfig;

function csvRecords(text, delimiter) {
  const rows = [];
  let fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      fields.push(field.trim());
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      fields.push(field.trim());
      if (fields.some(Boolean)) rows.push(fields);
      fields = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote.");
  fields.push(field.trim());
  if (fields.some(Boolean)) rows.push(fields);
  if (rows.length > 100200)
    throw new Error("CSV exceeds 100000 production/consumption intervals.");
  return rows;
}
const parseEnergy = (text) => {
  const value = String(text ?? "")
    .trim()
    .replace(/[\s\u00a0]/g, "")
    .replace(",", ".");
  if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
    throw new Error("Interval energy must be a nonnegative number in kWh.");
  const number = Number(value);
  if (!finite(number)) throw new Error("Interval energy is not finite.");
  return number;
};

/** Enefit semicolon report or explicit interval-energy CSV. Metadata/customer data is discarded. */
export function parseConsumptionCsv(
  text,
  { fileName, timeZone = "Europe/Tallinn" } = {},
) {
  if (typeof text !== "string" || text.length > 20 * 1024 * 1024)
    throw new Error("Consumption CSV must be text below 20 MB.");
  formatter(timeZone);
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = source.includes(";") ? ";" : ",";
  const records = csvRecords(source, delimiter);
  const headerIndex = records.findIndex((row) => {
    const h = row.map(normalized);
    return (
      (h.includes("algus") &&
        h.includes("lopp") &&
        h.some((v) => /^kogus\s*\(kwh\)$/.test(v))) ||
      (h.some((v) => ["time", "timestamp", "interval_start"].includes(v)) &&
        h.some((v) =>
          ["consumption_kwh", "energy_kwh", "import_kwh"].includes(v),
        ))
    );
  });
  if (headerIndex < 0)
    throw new Error(
      "Find Algus;Lõpp;Kogus (kWh) in an Enefit report, or time,consumption_kwh in an interval CSV.",
    );
  const header = records[headerIndex].map(normalized);
  const enefit = header.includes("algus");
  let energyIndex;
  let exportIndex = -1;
  if (enefit) {
    const quantities = header.flatMap((value, index) =>
      /^kogus\s*\(kwh\)$/.test(value) ? [index] : [],
    );
    const typeRow = records
      .slice(0, headerIndex)
      .reverse()
      .find((row) =>
        row.some(
          (value) => normalized(value).replace(/:$/, "") === "andmete tuup",
        ),
      );
    const types =
      typeRow
        ?.map(normalized)
        .filter((v) => ["tarbimine", "tootmine"].includes(v)) ?? [];
    if (!types.includes("tarbimine"))
      throw new Error(
        "The Enefit Andmete tüüp metadata must identify Tarbimine; production/export cannot stand in for consumption.",
      );
    if (types.length !== quantities.length)
      throw new Error(
        "Cannot unambiguously align Enefit Tarbimine/Tootmine with its repeated Kogus columns.",
      );
    if (types.filter((v) => v === "tarbimine").length !== 1)
      throw new Error("Import one consumption series at a time.");
    energyIndex = quantities[types.indexOf("tarbimine")];
    exportIndex = types.includes("tootmine")
      ? quantities[types.indexOf("tootmine")]
      : -1;
  } else
    energyIndex = header.findIndex((v) =>
      ["consumption_kwh", "energy_kwh", "import_kwh"].includes(v),
    );
  const precedingStart = enefit
    ? header.slice(0, energyIndex).lastIndexOf("algus")
    : -1;
  const startIndex = enefit
    ? precedingStart
    : header.findIndex((v) =>
        ["time", "timestamp", "interval_start"].includes(v),
      );
  const endIndex = enefit
    ? header.findIndex(
        (v, i) => i > startIndex && i < energyIndex && v === "lopp",
      )
    : header.findIndex((v) => ["end", "interval_end"].includes(v));
  const durationIndex = header.findIndex((v) =>
    ["duration_minutes", "interval_minutes"].includes(v),
  );
  if (startIndex < 0 || (enefit && endIndex < 0))
    throw new Error(
      "Consumption requires matching interval start and end columns.",
    );
  const errors = [];
  let errorCount = 0;
  const error = (line, message) => {
    errorCount += 1;
    if (errors.length < 100) errors.push(`Record ${line}: ${message}`);
  };
  const prepared = [];
  for (let i = headerIndex + 1; i < records.length; i += 1) {
    const row = records[i];
    if (!row[startIndex] && !row[energyIndex]) continue;
    try {
      const start = parseTimestamp(row[startIndex], timeZone);
      const end =
        endIndex >= 0 ? parseTimestamp(row[endIndex], timeZone) : null;
      const energyKwh = parseEnergy(row[energyIndex]);
      const reportedGridExportKwh =
        exportIndex >= 0 && row[exportIndex] !== ""
          ? parseEnergy(row[exportIndex])
          : undefined;
      const durationHours =
        durationIndex >= 0 ? Number(row[durationIndex]) / 60 : 0.25;
      const choices = start.times
        .flatMap((time) =>
          end
            ? end.times.map((finish) => ({
                time,
                durationHours: (finish - time) / HOUR,
              }))
            : [{ time, durationHours }],
        )
        .filter(
          (p) =>
            p.time % QUARTER === 0 &&
            p.durationHours > 0 &&
            p.durationHours <= 1 &&
            (p.durationHours * 4) % 1 === 0,
        );
      if (!choices.length)
        throw new Error(
          "Interval duration must be 15–60 real minutes on a quarter-hour boundary.",
        );
      prepared.push({
        start,
        choices,
        energyKwh,
        reportedGridExportKwh,
        record: i + 1,
      });
    } catch (e) {
      error(i + 1, e.message);
    }
  }
  const counts = new Map();
  const occurrences = new Map();
  for (const p of prepared)
    counts.set(p.start.localKey, (counts.get(p.start.localKey) ?? 0) + 1);
  const rows = [];
  let previousEnd = -Infinity;
  let gapHours = 0;
  let resolvedAmbiguousIntervals = 0;
  for (const p of prepared) {
    const occurrence = occurrences.get(p.start.localKey) ?? 0;
    occurrences.set(p.start.localKey, occurrence + 1);
    let choices = p.choices.filter((c) => c.time >= previousEnd);
    const contiguous = choices.filter((c) => c.time === previousEnd);
    if (contiguous.length) choices = contiguous;
    if (
      choices.length > 1 &&
      counts.get(p.start.localKey) >= p.start.times.length
    )
      choices = choices.filter((c) => c.time === p.start.times[occurrence]);
    if (choices.length !== 1) {
      error(
        p.record,
        choices.length
          ? "An ambiguous autumn clock time needs both ordered occurrences or an explicit UTC offset."
          : "Intervals duplicate, overlap or appear out of chronological order.",
      );
      continue;
    }
    const selected = choices[0];
    if (p.start.times.length > 1) resolvedAmbiguousIntervals += 1;
    if (previousEnd !== -Infinity)
      gapHours += (selected.time - previousEnd) / HOUR;
    previousEnd = selected.time + selected.durationHours * HOUR;
    rows.push({
      time: isoTime(selected.time),
      durationHours: selected.durationHours,
      energyKwh: p.energyKwh,
      ...(p.reportedGridExportKwh != null
        ? { reportedGridExportKwh: p.reportedGridExportKwh }
        : {}),
    });
  }
  if (!rows.length && !errorCount)
    error(headerIndex + 1, "No consumption interval rows were found.");
  const warnings = [
    "Tarbimine/grid-import readings are not total household demand when a pre-existing PV system or battery supplied part of the load. Tootmine denotes observed grid export, not gross PV generation.",
    "Historical CSV market prices are ignored; economics use the selected modeled year’s market prices.",
  ];
  if (enefit)
    warnings.push(
      `Offset-free local timestamps are interpreted in ${timeZone}; autumn duplicate clock hours require ordered occurrences.`,
    );
  if (!enefit && endIndex < 0 && durationIndex < 0)
    warnings.push(
      "No duration column was supplied; each standard CSV row is explicitly treated as a 15-minute interval.",
    );
  if (gapHours > 0)
    warnings.push(
      `${gapHours} hours are missing between source intervals; gaps remain unknown.`,
    );
  const exportRows = rows.filter((row) => finite(row.reportedGridExportKwh));
  const coveredReportedGridExportKwh = exportRows.reduce(
    (sum, row) => sum + row.reportedGridExportKwh,
    0,
  );
  return {
    rows,
    valid: errorCount === 0 && rows.length > 0,
    errors,
    errorCount,
    warnings,
    metadata: safeMetadata(
      {
        fileName,
        format: enefit ? "Enefit historical report" : "interval-energy CSV",
      },
      timeZone,
    ),
    coverage: {
      intervalCount: rows.length,
      intervalHours: rows.reduce((sum, row) => sum + row.durationHours, 0),
      gapHours,
      resolvedAmbiguousIntervals,
      reportedGridExportKwh:
        rows.length && exportRows.length === rows.length
          ? coveredReportedGridExportKwh
          : null,
      coveredReportedGridExportKwh,
      reportedGridExportIntervals: exportRows.length,
    },
  };
}

const METRICS = [
  "consumptionKwh",
  "selfConsumedKwh",
  "importKwh",
  "exportKwh",
  "avoidedImportCostEur",
  "exportRevenueEur",
  "gridImportCostEur",
  "baselineImportCostEur",
  "netBenefitEur",
  "netGridCostEur",
  "weatherSelfConsumedKwh",
  "weatherImportKwh",
  "weatherExportKwh",
  "weatherNetBenefitEur",
  "shadowNetBenefitLossEur",
];
const coveredKey = (key) => `covered${key[0].toUpperCase()}${key.slice(1)}`;
function metricSummary(rows) {
  const result = {};
  for (const key of METRICS) {
    result[coveredKey(key)] = rows.reduce(
      (sum, row) =>
        sum + (row[coveredKey(key)] ?? (finite(row[key]) ? row[key] : 0)),
      0,
    );
    result[key] = rows.every((row) => finite(row[key]))
      ? result[coveredKey(key)]
      : null;
  }
  for (const key of [
    "consumptionCoveredHours",
    "consumptionExpectedHours",
    "imputedHours",
    "pricedConsumptionHours",
  ])
    result[key] = rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  result.consumptionCoveragePct = result.consumptionExpectedHours
    ? (result.consumptionCoveredHours / result.consumptionExpectedHours) * 100
    : 0;
  result.selfConsumptionPct =
    result.selfConsumedKwh != null &&
    result.exportKwh != null &&
    result.selfConsumedKwh + result.exportKwh > 0
      ? (result.selfConsumedKwh / (result.selfConsumedKwh + result.exportKwh)) *
        100
      : null;
  result.selfSufficiencyPct =
    result.selfConsumedKwh != null && result.consumptionKwh > 0
      ? (result.selfConsumedKwh / result.consumptionKwh) * 100
      : null;
  return result;
}

/** Add demand, self-consumption and net grid economics without changing original PV comparators. */
export function applyConsumption(analysis, input = DEFAULT_CONSUMPTION) {
  const config = normalizeConsumptionConfig(input);
  if (!Array.isArray(analysis?.hourly) || !analysis.hourly.length)
    throw new Error("Consumption analysis needs modeled hourly PV intervals.");
  const localCache = new Map();
  const local = (time) => {
    if (!localCache.has(time))
      localCache.set(time, clock(time, config.timeZone));
    return localCache.get(time);
  };
  const dayPeriod = (p) =>
    config.dayStartHour < config.dayEndHour
      ? p.hour >= config.dayStartHour && p.hour < config.dayEndHour
      : p.hour >= config.dayStartHour || p.hour < config.dayEndHour;
  const periods = new Map();
  const estimate = (time) => {
    const parts = local(time);
    const key = dateKey(parts);
    if (!periods.has(key)) {
      const start = candidates(
        { ...parts, hour: 0, minute: 0, second: 0 },
        config.timeZone,
      )[0];
      const next = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day + 1),
      );
      const finish = candidates(
        {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
          hour: 0,
          minute: 0,
          second: 0,
        },
        config.timeZone,
      )[0];
      if (!Number.isFinite(start) || !Number.isFinite(finish))
        throw new Error(
          "The selected time zone has a missing midnight on this date; use an explicit interval profile.",
        );
      let dayHours = 0;
      let nightHours = 0;
      for (let t = start; t < finish; t += QUARTER) {
        if (dayPeriod(local(t))) dayHours += 0.25;
        else nightHours += 0.25;
      }
      if (
        (!dayHours && config.dayKwh > 0) ||
        (!nightHours && config.nightKwh > 0)
      )
        throw new Error(
          "The configured clock period disappears on a daylight-saving transition. Use a wider day/night period.",
        );
      periods.set(key, { dayHours, nightHours });
    }
    const p = periods.get(key);
    const day = dayPeriod(parts);
    return (
      (day ? config.dayKwh / p.dayHours : config.nightKwh / p.nightHours) / 4
    );
  };
  const source = new Map();
  let calendarDuplicates = 0;
  if (config.rows)
    for (const row of config.rows) {
      const quarters = row.durationHours * 4;
      for (let i = 0; i < quarters; i += 1) {
        const t = stamp(row.time) + i * QUARTER;
        let key = t;
        if (config.mode !== "csv-exact") {
          const parts = local(t);
          const occurrence = candidates(parts, config.timeZone).indexOf(t);
          key = `${clockKey(parts)}#${occurrence}`;
        }
        if (source.has(key)) {
          calendarDuplicates += 1;
          continue;
        }
        source.set(key, row.energyKwh / quarters);
      }
    }
  if (calendarDuplicates)
    throw new Error(
      "Calendar replay contains more than one source value for the same local month/day/clock occurrence. Use exact dates or a single historical annual cycle.",
    );
  const hourly = analysis.hourly.map((row) => {
    const duration = row.durationHours ?? 1;
    const start = stamp(row.time);
    if (
      !Number.isFinite(start) ||
      start % QUARTER !== 0 ||
      duration <= 0 ||
      duration > 1 ||
      (duration * 4) % 1 !== 0
    )
      throw new Error(
        "Modeled intervals must align to 15-minute UTC boundaries and last at most one hour.",
      );
    const quarterCount = duration * 4;
    const quarters = [];
    for (let i = 0; i < quarterCount; i += 1) {
      const time = start + i * QUARTER;
      const parts = local(time);
      const occurrence =
        config.mode === "csv-calendar"
          ? candidates(parts, config.timeZone).indexOf(time)
          : 0;
      const key =
        config.mode === "csv-exact" ? time : `${clockKey(parts)}#${occurrence}`;
      let demand =
        config.mode === "estimate" ? estimate(time) : (source.get(key) ?? null);
      const imputed = demand == null && config.fillMissingWithEstimate;
      if (imputed) demand = estimate(time);
      const q = Object.fromEntries(METRICS.map((metric) => [metric, null]));
      q.consumptionKwh = demand;
      q.consumptionExpectedHours = 0.25;
      q.consumptionCoveredHours = demand != null ? 0.25 : 0;
      q.imputedHours = imputed ? 0.25 : 0;
      q.pricedConsumptionHours = 0;
      const pv = finite(row.shadedKwh) ? row.shadedKwh / quarterCount : null;
      const weatherPv = finite(row.weatherKwh)
        ? row.weatherKwh / quarterCount
        : null;
      const importPrice = finite(row.priceEurMWh)
        ? (row.priceEurMWh + config.importAdderEurMWh) / 1000
        : null;
      const exportPrice = finite(row.priceEurMWh)
        ? (row.priceEurMWh - (analysis.system?.salesMarginEurMWh ?? 0)) / 1000
        : null;
      if (demand != null && importPrice != null)
        q.baselineImportCostEur = demand * importPrice;
      if (demand != null && pv != null) {
        q.selfConsumedKwh = Math.min(demand, pv);
        q.importKwh = Math.max(0, demand - pv);
        q.exportKwh = Math.max(0, pv - demand);
        if (importPrice != null) {
          q.avoidedImportCostEur = q.selfConsumedKwh * importPrice;
          q.exportRevenueEur = q.exportKwh * exportPrice;
          q.gridImportCostEur = q.importKwh * importPrice;
          q.netGridCostEur = q.gridImportCostEur - q.exportRevenueEur;
          q.netBenefitEur = q.baselineImportCostEur - q.netGridCostEur;
          q.pricedConsumptionHours = 0.25;
        }
      }
      if (demand != null && weatherPv != null) {
        q.weatherSelfConsumedKwh = Math.min(demand, weatherPv);
        q.weatherImportKwh = Math.max(0, demand - weatherPv);
        q.weatherExportKwh = Math.max(0, weatherPv - demand);
        if (importPrice != null)
          q.weatherNetBenefitEur =
            q.weatherSelfConsumedKwh * importPrice +
            q.weatherExportKwh * exportPrice;
      }
      if (q.weatherNetBenefitEur != null && q.netBenefitEur != null)
        q.shadowNetBenefitLossEur = q.weatherNetBenefitEur - q.netBenefitEur;
      quarters.push(q);
    }
    return { ...row, ...metricSummary(quarters) };
  });
  const summary = { ...analysis.summary, ...metricSummary(hourly) };
  const group = (key) => {
    const groups = new Map();
    for (const row of hourly) {
      const k = key(row);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
    return groups;
  };
  const months = group((row) => row.time.slice(0, 7));
  const years = group((row) => row.time.slice(0, 4));
  const monthly = [...months].map(([month, rows]) => ({
    ...(analysis.monthly?.find((m) => m.month === month) ?? { month }),
    ...metricSummary(rows),
  }));
  const annual = [...years].map(([year, rows]) => ({
    ...(analysis.annual?.find((y) => y.year === +year) ?? { year: +year }),
    ...metricSummary(rows),
  }));
  const warnings = [];
  if (config.mode !== "estimate")
    warnings.push(
      "Imported Tarbimine represents grid import. If existing PV, batteries or another generator supplied demand, this is not the full household load; Tootmine is grid export, not gross PV production.",
    );
  if (config.mode === "csv-calendar")
    warnings.push(
      "Historical interval energy is repeated by local month, day, clock time and DST occurrence into the modeled year. Dates, weekday patterns and DST-transition dates may differ; missing dates (including leap day) remain unknown unless estimate filling was explicitly selected.",
    );
  if (summary.consumptionCoveragePct < 100)
    warnings.push(
      "Consumption coverage is incomplete. Full-period consumption economics are unknown; covered totals use matching quarters without annual extrapolation.",
    );
  if (summary.imputedHours > 0)
    warnings.push(
      `${summary.imputedHours} hours were explicitly filled with the configured day/night estimate. Imputed demand is not meter evidence.`,
    );
  if (summary.pricedConsumptionHours < summary.consumptionCoveredHours)
    warnings.push(
      "Some covered demand has unknown PV generation or market prices, so financial coverage is incomplete.",
    );
  const { rows: omitted, metadata, ...publicConfig } = config;
  const provenance = {
    ...(metadata ?? {}),
    format: config.mode === "estimate" ? "day/night estimate" : metadata.format,
    seriesType:
      config.mode === "estimate" ? "assumed-total-demand" : "grid-import",
    timeZone: config.timeZone,
    matchMethod:
      config.mode === "estimate"
        ? "fixed local-day period totals"
        : config.mode === "csv-exact"
          ? "exact UTC intervals"
          : "repeat local month/day/clock (DST occurrence explicit)",
  };
  return {
    ...analysis,
    hourly,
    monthly,
    annual,
    summary,
    consumption: {
      config: publicConfig,
      provenance,
      quality: {
        status: warnings.length ? "warning" : "pass",
        warnings,
        consumptionExpectedHours: summary.consumptionExpectedHours,
        consumptionCoveredHours: summary.consumptionCoveredHours,
        consumptionCoveragePct: summary.consumptionCoveragePct,
        imputedHours: summary.imputedHours,
        pricedConsumptionHours: summary.pricedConsumptionHours,
        missingHours:
          summary.consumptionExpectedHours - summary.consumptionCoveredHours,
        sourceRows: config.rows?.length ?? 0,
      },
      assumptions: [
        "Day/night kWh are totals for each local calendar day’s clock periods; real DST duration changes the distribution rate, not that day’s total.",
        "Each modeled PV hour is divided equally into quarters before matching consumption. Hourly meter intervals are also distributed uniformly into quarters.",
        "All surplus PV is exported. Grid import uses modeled spot price plus import adder; export uses modeled spot price less PV sales margin. Historic CSV prices are ignored.",
        "Net benefit is no-PV import cost minus (with-PV import cost minus surplus export revenue). Negative prices remain signed. No fixed fees, taxes, financing, storage dispatch or import/export caps are modeled.",
      ],
    },
  };
}

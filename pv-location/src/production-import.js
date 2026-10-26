import { read, utils } from "xlsx";
import { parseOwnerCsv } from "./analysis.js";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const MAX_ROWS = 220000;
const key = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, "");
const iso = (time) => new Date(time).toISOString();
const pad = (value) => String(value).padStart(2, "0");

function offsetMinutes(value) {
  const text = String(value ?? "").trim();
  if (/^(?:UTC|GMT|Z)$/i.test(text)) return 0;
  const m = text.match(/^(?:UTC|GMT)?\s*([+-])(\d{1,2}):?(\d{2})$/i);
  if (!m || +m[2] > 14 || +m[3] > 59 || (+m[2] === 14 && +m[3] !== 0))
    throw new Error(
      "Time Zone must contain an explicit UTC offset, such as UTC+02:00.",
    );
  return (m[1] === "+" ? 1 : -1) * (+m[2] * 60 + +m[3]);
}

function sampleTime(value, zone) {
  // Spreadsheet Date values encode a wall clock, not a browser-local timezone.
  if (value instanceof Date)
    value = new Date(Math.round(value.getTime() / 1000) * 1000);
  const text =
    value instanceof Date
      ? `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
      : String(value ?? "").trim();
  const m = text.match(
    /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (!m)
    throw new Error(
      "Updated Time must contain a valid year-first date and clock time.",
    );
  const parts = m.slice(1, 7).map((v) => +(v ?? 0));
  const [y, month, day, hour, minute, second] = parts;
  const time = Date.UTC(y, month - 1, day, hour, minute, second);
  const d = new Date(time);
  if (
    y < 1901 ||
    y > 2099 ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new Error(
      "Updated Time contains an invalid calendar date or clock time.",
    );
  const offset = offsetMinutes(m[7] || zone);
  if (
    m[7] &&
    zone != null &&
    String(zone).trim() &&
    offset !== offsetMinutes(zone)
  )
    throw new Error(
      "Updated Time and Time Zone contain conflicting UTC offsets.",
    );
  return {
    time: iso(time - offset * MINUTE),
    zone: `UTC${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`,
  };
}

function integrate(
  samples,
  errors = [],
  extraWarnings = [],
  duplicateSamples = 0,
) {
  const sorted = [...samples].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );
  const unique = [];
  for (const sample of sorted) {
    const previous = unique.at(-1);
    if (previous?.time === sample.time) {
      if (previous.powerW !== sample.powerW)
        errors.push(
          `Conflicting production readings at ${sample.time}; overlapping files cannot be combined.`,
        );
      else duplicateSamples += 1;
    } else unique.push(sample);
  }
  const rows = [];
  let acceptedSegments = 0,
    gapCount = 0,
    missingSampleSlots = 0;
  for (let i = 1; i < unique.length; i++) {
    const a = unique[i - 1],
      b = unique[i];
    const start = Date.parse(a.time),
      end = Date.parse(b.time),
      duration = end - start;
    // A five-minute logger can have small timing jitter. Never integrate across missing samples.
    if (duration > 7.5 * MINUTE) {
      gapCount += 1;
      missingSampleSlots += Math.max(
        1,
        Math.round(duration / (5 * MINUTE)) - 1,
      );
      continue;
    }
    if (duration <= 0) continue;
    acceptedSegments += 1;
    for (let t = start; t < end; ) {
      const next = Math.min(end, (Math.floor(t / HOUR) + 1) * HOUR);
      const p0 = a.powerW + ((b.powerW - a.powerW) * (t - start)) / duration;
      const p1 = a.powerW + ((b.powerW - a.powerW) * (next - start)) / duration;
      rows.push({
        time: iso(t),
        durationMinutes: (next - t) / MINUTE,
        energyKwh: (((p0 + p1) / 2 / 1000) * (next - t)) / HOUR,
      });
      t = next;
    }
  }
  const coveredHours = rows.reduce(
    (sum, row) => sum + row.durationMinutes / 60,
    0,
  );
  const estimatedKwh = rows.reduce((sum, row) => sum + row.energyKwh, 0);
  const warnings = [
    "Energy is estimated by trapezoidal integration of reported PV power samples, not read from a metered kWh counter. The export does not establish the AC/DC measurement point.",
    ...extraWarnings,
    ...(gapCount
      ? [
          `${gapCount} gaps longer than 7.5 minutes (${missingSampleSlots} missing five-minute sample slots) are excluded; missing production is not filled.`,
        ]
      : []),
    ...(duplicateSamples
      ? [`${duplicateSamples} identical overlapping samples were counted once.`]
      : []),
  ];
  if (!rows.length && !errors.length)
    errors.push(
      "At least two adjacent production readings are needed to estimate energy.",
    );
  return {
    sourceFormat: "solarman-xlsx",
    valid: errors.length === 0 && rows.length > 0,
    rows,
    samples: unique,
    errors,
    warnings,
    intervalMinutes: 5,
    summary: {
      sampleCount: unique.length,
      acceptedSegments,
      duplicateSamples,
      gapCount,
      missingSampleSlots,
      coveredHours,
      estimatedKwh,
      firstTime: unique[0]?.time ?? null,
      lastTime: unique.at(-1)?.time ?? null,
      timeZones: [...new Set(unique.map((r) => r.zone).filter(Boolean))],
    },
  };
}

/** Read only the PV power and timestamp columns. Account, plant and device identifiers are discarded. */
export function parseSolarmanSheets(sheets) {
  const samples = [],
    errors = [],
    warnings = [];
  let found = false,
    omittedPower = 0;
  for (const sheet of sheets) {
    const data = sheet.data ?? [];
    const headerIndex = data
      .slice(0, 30)
      .findIndex(
        (row) =>
          row.some((v) => key(v) === "updatedtime") &&
          row.some((v) =>
            /^(?:production|pv|solar)power\((?:w|kw)\)$/.test(key(v)),
          ),
      );
    if (headerIndex < 0) continue;
    found = true;
    const header = data[headerIndex].map(key);
    const ti = header.indexOf("updatedtime"),
      zi = header.indexOf("timezone");
    const pi = header.findIndex((v) =>
      /^(?:production|pv|solar)power\((?:w|kw)\)$/.test(v),
    );
    const scale = header[pi].endsWith("(kw)") ? 1000 : 1;
    if (samples.length + data.length - headerIndex > MAX_ROWS)
      throw new Error("Production data exceed the 220,000-row browser limit.");
    for (const row of data.slice(headerIndex + 1)) {
      if (row.every((v) => v == null || v === "")) continue;
      const rawPower = row[pi];
      const powerW =
        (typeof rawPower === "string"
          ? Number(rawPower.trim().replace(",", "."))
          : rawPower) * scale;
      if (
        rawPower == null ||
        String(rawPower).trim() === "" ||
        !Number.isFinite(powerW) ||
        powerW < 0
      ) {
        omittedPower += 1;
        continue;
      }
      try {
        samples.push({ ...sampleTime(row[ti], row[zi]), powerW });
      } catch (error) {
        if (errors.length < 12) errors.push(error.message);
      }
    }
  }
  if (!found)
    throw new Error(
      "No Solarman detailed-data sheet found. Export Updated Time, Time Zone and Production Power(W) columns; grid export is not PV production.",
    );
  if (omittedPower)
    warnings.push(
      `${omittedPower} missing, negative or invalid PV power readings were omitted; their gaps are not filled.`,
    );
  return integrate(samples, errors, warnings);
}

export function combineSolarmanImports(imports) {
  return integrate(
    imports.flatMap((item) => item.samples),
    imports.flatMap((item) => item.errors),
    [
      ...new Set(
        imports
          .flatMap((item) => item.warnings)
          .filter((w) => /omitted/.test(w)),
      ),
    ],
    imports.reduce((sum, item) => sum + item.summary.duplicateSamples, 0),
  );
}

/** Files and normalized measurements stay in browser memory; no network or storage calls. */
export async function parseProductionFiles(files) {
  const list = Array.from(files ?? []);
  if (!list.length || list.length > 24)
    throw new Error("Choose between 1 and 24 monthly production files.");
  if (
    list.some((f) => f.size > 20e6) ||
    list.reduce((sum, f) => sum + (f.size ?? 0), 0) > 80e6
  )
    throw new Error("Choose files below 20 MB each and 80 MB in total.");
  const isExcel = list.map((file) => /\.xlsx$/i.test(file.name));
  if (isExcel.some(Boolean) && !isExcel.every(Boolean))
    throw new Error(
      "Import Solarman Excel files together, or interval-energy CSV files together.",
    );
  let result;
  if (isExcel.every(Boolean)) {
    const imports = [];
    // Process monthly files in order to keep peak workbook memory bounded.
    for (const file of list) {
      const workbook = read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
        UTC: true,
      });
      imports.push(
        parseSolarmanSheets(
          workbook.SheetNames.map((sheet) => ({
            sheet,
            data: utils.sheet_to_json(workbook.Sheets[sheet], {
              header: 1,
              defval: null,
              raw: true,
              UTC: true,
            }),
          })),
        ),
      );
    }
    if (imports.reduce((sum, item) => sum + item.samples.length, 0) > MAX_ROWS)
      throw new Error("Production data exceed the 220,000-row browser limit.");
    result = combineSolarmanImports(imports);
  } else {
    if (list.some((file) => !/\.csv$/i.test(file.name)))
      throw new Error(
        "Choose a Solarman .xlsx workbook or an interval-energy .csv file.",
      );
    const imports = [];
    for (const file of list) imports.push(parseOwnerCsv(await file.text()));
    const errors = imports.flatMap((item) => item.errors),
      byTime = new Map();
    for (const row of imports.flatMap((item) => item.rows)) {
      const previous = byTime.get(row.time);
      if (previous && previous.energyKwh !== row.energyKwh)
        errors.push(`Conflicting interval energy at ${row.time}.`);
      else byTime.set(row.time, row);
    }
    const rows = [...byTime.values()].sort(
      (a, b) => Date.parse(a.time) - Date.parse(b.time),
    );
    if (rows.length > MAX_ROWS)
      throw new Error("Production data exceed the 220,000-row browser limit.");
    result = {
      sourceFormat: "interval-csv",
      valid: errors.length === 0 && rows.length > 0,
      rows,
      errors,
      warnings: imports.flatMap((item) => item.warnings),
      intervalMinutes: 15,
    };
  }
  return { ...result, fileNames: list.map((file) => file.name) };
}

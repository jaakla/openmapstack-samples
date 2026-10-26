import test from "node:test";
import assert from "node:assert/strict";
import {
  combineSolarmanImports,
  parseProductionFiles,
  parseSolarmanSheets,
} from "../src/production-import.js";
import {
  SOLARMAN_HEADERS,
  solarmanWorkbook,
} from "./fixtures/solarman-workbook.js";

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const parse = (rows, headers = SOLARMAN_HEADERS) =>
  parseSolarmanSheets([
    { sheet: "Synthetic measurements", data: [headers, ...rows] },
  ]);
const sample = (time, powerW = 1000, zone = "UTC+02:00") => [
  time,
  zone,
  powerW,
  -9000,
  8000,
];
const excelFile = (name, rows, options) => {
  const bytes = solarmanWorkbook(rows, options);
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => {
      throw new Error("XLSX must use the binary reader");
    },
  };
};

test("explicit logger offset crosses UTC midnight and preserves the measurement year", () => {
  const result = parse([
    sample("2026/06/01 01:55"),
    sample("2026/06/01 02:00"),
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(
    result.samples.map((row) => row.time),
    ["2026-05-31T23:55:00.000Z", "2026-06-01T00:00:00.000Z"],
  );
  assert.deepEqual(result.summary.timeZones, ["UTC+02:00"]);
  close(result.summary.estimatedKwh, 1 / 12);
  close(result.summary.coveredHours, 1 / 12);
  assert.equal(result.rows[0].durationMinutes, 5);
  assert.match(
    result.warnings.join(" "),
    /trapezoidal.*not read from a metered kWh counter/,
  );
  assert.match(result.warnings.join(" "), /does not establish the AC\/DC/);
});

test("rising power is integrated linearly and split at UTC hour boundaries", () => {
  const result = parse([
    sample("2026-06-01 00:58", 0, "UTC"),
    sample("2026-06-01 01:03", 3000, "UTC"),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.acceptedSegments, 1);
  assert.deepEqual(
    result.rows.map(({ time, durationMinutes }) => ({ time, durationMinutes })),
    [
      { time: "2026-06-01T00:58:00.000Z", durationMinutes: 2 },
      { time: "2026-06-01T01:00:00.000Z", durationMinutes: 3 },
    ],
  );
  // A 0 -> 3 kW ramp over five minutes has 0.125 kWh, split 0.020 / 0.105.
  close(result.rows[0].energyKwh, 0.02);
  close(result.rows[1].energyKwh, 0.105);
  close(result.summary.estimatedKwh, 0.125);
});

test("missing five-minute slots are excluded without bridging or filling energy", () => {
  const result = parse([
    sample("2026/06/01 00:00"),
    sample("2026/06/01 00:05"),
    sample("2026/06/01 00:15"),
    sample("2026/06/01 00:20"),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.acceptedSegments, 2);
  assert.equal(result.summary.gapCount, 1);
  assert.equal(result.summary.missingSampleSlots, 1);
  close(result.summary.coveredHours, 1 / 6);
  close(result.summary.estimatedKwh, 1 / 6);
  assert.deepEqual(
    result.rows.map((row) => row.time),
    ["2026-05-31T22:00:00.000Z", "2026-05-31T22:15:00.000Z"],
  );
  assert.match(result.warnings.join(" "), /missing production is not filled/);
});

test("invalid or negative PV readings are omitted and their resulting gaps remain uncovered", () => {
  const result = parse([
    sample("2026/06/01 00:00"),
    sample("2026/06/01 00:05"),
    sample("2026/06/01 00:10", -2),
    sample("2026/06/01 00:15"),
    sample("2026/06/01 00:20", ""),
    sample("2026/06/01 00:25", "not a number"),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.sampleCount, 3);
  assert.equal(result.summary.acceptedSegments, 1);
  assert.equal(result.summary.gapCount, 1);
  close(result.summary.estimatedKwh, 1 / 12);
  assert.match(
    result.warnings.join(" "),
    /3 missing, negative or invalid PV power readings/,
  );
});

test("logger offsets distinguish repeated autumn wall-clock times instead of applying Tallinn DST", () => {
  const result = parse([
    sample("2026/10/25 03:00", 1000, "UTC+03:00"),
    sample("2026/10/25 03:05", 1000, "UTC+03:00"),
    sample("2026/10/25 03:00", 1000, "UTC+02:00"),
    sample("2026/10/25 03:05", 1000, "UTC+02:00"),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.sampleCount, 4);
  assert.equal(result.summary.duplicateSamples, 0);
  assert.equal(result.summary.gapCount, 1);
  assert.deepEqual(
    result.samples.map((row) => row.time),
    [
      "2026-10-25T00:00:00.000Z",
      "2026-10-25T00:05:00.000Z",
      "2026-10-25T01:00:00.000Z",
      "2026-10-25T01:05:00.000Z",
    ],
  );
  close(result.summary.estimatedKwh, 1 / 6);
});

test("timezone-free wall clocks and conflicting offsets are rejected", () => {
  const missing = parse([
    sample("2026-06-01 00:00", 1000, ""),
    sample("2026-06-01 00:05", 1000, ""),
  ]);
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join(" "), /explicit UTC offset/);
  const conflict = parse([
    sample("2026-06-01T00:00Z", 1000, "UTC+02:00"),
    sample("2026-06-01T00:05Z", 1000, "UTC+02:00"),
  ]);
  assert.equal(conflict.valid, false);
  assert.match(conflict.errors.join(" "), /conflicting UTC offsets/);
  const explicit = parse([
    sample("2026-06-01T00:00:00+02:00", 1000, ""),
    sample("2026-06-01T00:05:00+02:00", 1000, ""),
  ]);
  assert.equal(explicit.valid, true);
  assert.equal(explicit.summary.firstTime, "2026-05-31T22:00:00.000Z");
});

test("invalid dates and ambiguous locale date strings are rejected rather than normalized", () => {
  for (const bad of [
    "2026-02-30 00:00",
    "2026-06-01 25:00",
    "01/06/2026 00:00",
  ]) {
    const result = parse([sample(bad), sample("2026-06-01 00:05")]);
    assert.equal(result.valid, false, bad);
    assert.ok(result.errors.length > 0, bad);
  }
});

test("Excel Date values represent wall-clock components; unstyled serial numbers are not guessed", () => {
  const result = parse([
    sample(new Date("2026-06-01T00:00:00.000Z")),
    sample(new Date("2026-06-01T00:05:00.000Z")),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.firstTime, "2026-05-31T22:00:00.000Z");
  const rawSerials = parse([sample(46174), sample(46174 + 5 / 1440)]);
  assert.equal(rawSerials.valid, false);
  assert.equal(rawSerials.samples.length, 0);
  assert.match(rawSerials.errors.join(" "), /year-first date/);
});

test("PV power is selected by its label, supports decimal commas and converts kW to W", () => {
  const result = parse([
    sample("2026-06-01 00:00", "1000,5"),
    sample("2026-06-01 00:05", "1000,5"),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.samples[0].powerW, 1000.5);
  close(result.summary.estimatedKwh, 1.0005 / 12);
  const kw = parse(
    [
      ["2026-06-01 00:00", "UTC", "1,5"],
      ["2026-06-01 00:05", "UTC", "1,5"],
    ],
    ["Updated Time", "Time Zone", "PV Power(kW)"],
  );
  assert.equal(kw.valid, true);
  assert.equal(kw.samples[0].powerW, 1500);
  close(kw.summary.estimatedKwh, 0.125);
});

test("grid export or consumption cannot substitute for the PV production column", () => {
  assert.throws(
    () =>
      parse(
        [
          ["2026-06-01 00:00", "UTC", 1000, 1200],
          ["2026-06-01 00:05", "UTC", 1000, 1200],
        ],
        [
          "Updated Time",
          "Time Zone",
          "Feed-in Power(W)",
          "Consumption Power(W)",
        ],
      ),
    /grid export is not PV production/,
  );
});

test("metadata and other private columns are discarded from normalized output", () => {
  const result = parseSolarmanSheets([
    { sheet: "Unrelated", data: [["ignore me"]] },
    {
      sheet: "Synthetic measurements",
      data: [
        ["Synthetic account preamble", "DO-NOT-RETAIN-PREAMBLE"],
        ["Plant Name", ...SOLARMAN_HEADERS, "Device serial"],
        [
          "DO-NOT-RETAIN-PLANT",
          ...sample("2026-06-01 00:00"),
          "DO-NOT-RETAIN-SERIAL",
        ],
        [
          "DO-NOT-RETAIN-PLANT",
          ...sample("2026-06-01 00:05"),
          "DO-NOT-RETAIN-SERIAL",
        ],
      ],
    },
  ]);
  assert.equal(result.valid, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /DO-NOT-RETAIN|Synthetic account|Plant Name|Device serial/,
  );
  assert.deepEqual(Object.keys(result.samples[0]).sort(), [
    "powerW",
    "time",
    "zone",
  ]);
});

test("unsorted identical samples are counted once and conflicting samples invalidate the import", () => {
  const repeated = parse([
    sample("2026-06-01 00:05"),
    sample("2026-06-01 00:00"),
    sample("2026-06-01 00:00"),
  ]);
  assert.equal(repeated.valid, true);
  assert.equal(repeated.summary.sampleCount, 2);
  assert.equal(repeated.summary.duplicateSamples, 1);
  close(repeated.summary.estimatedKwh, 1 / 12);
  const conflict = parse([
    sample("2026-06-01 00:00"),
    sample("2026-06-01 00:00", 1001),
    sample("2026-06-01 00:05"),
  ]);
  assert.equal(conflict.valid, false);
  assert.match(conflict.errors.join(" "), /Conflicting production readings/);
});

test("monthly imports re-integrate the combined samples and deduplicate their shared endpoint", () => {
  const first = parse([sample("2026-05-31 23:55"), sample("2026-06-01 00:00")]);
  const second = parse([
    sample("2026-06-01 00:00"),
    sample("2026-06-01 00:05"),
  ]);
  const result = combineSolarmanImports([second, first]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.sampleCount, 3);
  assert.equal(result.summary.duplicateSamples, 1);
  assert.equal(result.summary.acceptedSegments, 2);
  close(result.summary.estimatedKwh, 1 / 6);
  const overlapConflict = parse([
    sample("2026-06-01 00:00", 500),
    sample("2026-06-01 00:05"),
  ]);
  assert.equal(combineSolarmanImports([first, overlapConflict]).valid, false);
});

test("actual XLSX reader parses string timestamps and sanitizes unrelated workbook columns", async () => {
  const file = excelFile(
    "synthetic-june.xlsx",
    [
      ["SYNTHETIC-IDENTIFIER", ...sample("2026/06/01 00:00")],
      ["SYNTHETIC-IDENTIFIER", ...sample("2026/06/01 00:05")],
    ],
    {
      headers: ["Plant Name", ...SOLARMAN_HEADERS],
      sheetName: "Test & measurements",
    },
  );
  const result = await parseProductionFiles([file]);
  assert.equal(result.valid, true);
  assert.equal(result.sourceFormat, "solarman-xlsx");
  assert.deepEqual(result.fileNames, ["synthetic-june.xlsx"]);
  assert.equal(result.summary.firstTime, "2026-05-31T22:00:00.000Z");
  close(result.summary.estimatedKwh, 1 / 12);
  assert.doesNotMatch(
    JSON.stringify(result),
    /SYNTHETIC-IDENTIFIER|Plant Name/,
  );
});

test("actual XLSX date styles yield wall-clock Date cells; unstyled numeric serials are rejected", async () => {
  const rows = [
    sample(new Date("2026-06-01T00:00:00.000Z")),
    sample(new Date("2026-06-01T00:05:00.000Z")),
  ];
  const styled = await parseProductionFiles([
    excelFile("synthetic-dates.xlsx", rows),
  ]);
  assert.equal(styled.valid, true);
  assert.equal(styled.summary.firstTime, "2026-05-31T22:00:00.000Z");
  close(styled.summary.estimatedKwh, 1 / 12);
  const unstyled = await parseProductionFiles([
    excelFile("synthetic-serials.xlsx", rows, { dateCells: false }),
  ]);
  assert.equal(unstyled.valid, false);
  assert.equal(unstyled.samples.length, 0);
});

test("multiple actual XLSX files combine their shared boundary without double counting", async () => {
  const result = await parseProductionFiles([
    excelFile("synthetic-may.xlsx", [
      sample("2026-05-31 23:55"),
      sample("2026-06-01 00:00"),
    ]),
    excelFile("synthetic-june.xlsx", [
      sample("2026-06-01 00:00"),
      sample("2026-06-01 00:05"),
    ]),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.duplicateSamples, 1);
  close(result.summary.estimatedKwh, 1 / 6);
});

test(
  "a synthetic full-month XLSX parses above the unzip worker-size threshold",
  { timeout: 15000 },
  async () => {
    // The uncompressed worksheet exceeds 512 KB: exercise the same decoder path as
    // a real monthly logger export, without carrying any owner's measurements.
    const start = Date.parse("2026-04-01T00:00:00Z");
    const rows = Array.from({ length: 8641 }, (_, index) =>
      sample(
        new Date(start + index * 5 * 60000).toISOString().replace(".000Z", "Z"),
        600,
        "UTC",
      ),
    );
    const result = await parseProductionFiles([
      excelFile("synthetic-full-month.xlsx", rows),
    ]);
    assert.equal(result.valid, true);
    assert.equal(result.summary.sampleCount, 8641);
    assert.equal(result.summary.acceptedSegments, 8640);
    assert.equal(result.summary.gapCount, 0);
    close(result.summary.coveredHours, 720);
    close(result.summary.estimatedKwh, 432);
  },
);

test("interval-energy CSV remains a separate measured-kWh import and combines identical overlaps", async () => {
  const csvFile = (name, body) => ({
    name,
    text: async () => `time,energy_kwh\n${body}`,
  });
  const result = await parseProductionFiles([
    csvFile(
      "synthetic-first.csv",
      "2026-06-01T00:00:00+02:00,0.5\n2026-06-01T00:15:00+02:00,0.75",
    ),
    csvFile(
      "synthetic-second.csv",
      "2026-06-01T00:15:00+02:00,0.75\n2026-06-01T00:30:00+02:00,1",
    ),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.sourceFormat, "interval-csv");
  assert.deepEqual(result.rows, [
    { time: "2026-05-31T22:00:00.000Z", energyKwh: 0.5, durationMinutes: 15 },
    { time: "2026-05-31T22:15:00.000Z", energyKwh: 0.75, durationMinutes: 15 },
    { time: "2026-05-31T22:30:00.000Z", energyKwh: 1, durationMinutes: 15 },
  ]);
  const conflict = await parseProductionFiles([
    csvFile("synthetic-first.csv", "2026-06-01T00:00:00Z,0.5"),
    csvFile("synthetic-second.csv", "2026-06-01T00:00:00Z,1"),
  ]);
  assert.equal(conflict.valid, false);
  assert.match(conflict.errors.join(" "), /Conflicting interval energy/);
});

test("file selection rejects mixed formats and resource-limit violations before reading", async () => {
  const neverRead = {
    arrayBuffer: async () => {
      throw new Error("must not read rejected files");
    },
  };
  await assert.rejects(parseProductionFiles([]), /1 and 24/);
  await assert.rejects(
    parseProductionFiles(
      Array.from({ length: 25 }, () => ({
        name: "synthetic.xlsx",
        ...neverRead,
      })),
    ),
    /1 and 24/,
  );
  await assert.rejects(
    parseProductionFiles([
      { name: "synthetic.xlsx", size: 20000001, ...neverRead },
    ]),
    /20 MB/,
  );
  await assert.rejects(
    parseProductionFiles([
      { name: "synthetic.xlsx", ...neverRead },
      { name: "synthetic.csv" },
    ]),
    /together/,
  );
  await assert.rejects(
    parseProductionFiles([{ name: "synthetic.xls", ...neverRead }]),
    /\.xlsx/,
  );
});

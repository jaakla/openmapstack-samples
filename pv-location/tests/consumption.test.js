import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONSUMPTION,
  applyConsumption,
  normalizeConsumptionConfig,
  parseConsumptionCsv,
} from "../src/consumption.js";

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const model = (rows, extra = {}) => ({
  system: { salesMarginEurMWh: 5 },
  summary: {},
  hourly: rows.map((r) => ({
    durationHours: 1,
    shadedKwh: 4,
    weatherKwh: 5,
    priceEurMWh: 100,
    ...r,
  })),
  ...extra,
});
const enefit = (rows, types = "Andmete tüüp:;;Tarbimine;;Tootmine;;") =>
  `Väljastaja:;Enefit AS\nKlient:;Anonymous example\nAadress:;Example address\nMõõtepunkt:;NONPERSONAL-EXAMPLE\nPeriood:;01.05.2023 kuni 30.04.2024\n\n${types}\n\nAlgus;Lõpp;Kogus (kWh);Börsihind (EUR / MWh);Kogus (kWh);Börsihind (EUR / MWh);\n${rows}`;
const fullDay = (start, hours) =>
  Array.from({ length: hours }, (_, i) => ({
    time: new Date(Date.parse(start) + i * 3600000).toISOString(),
    shadedKwh: 0,
    weatherKwh: 0,
  }));

test("Enefit import selects Tarbimine and separates Tootmine, decimal commas and private preamble", () => {
  const parsed = parseConsumptionCsv(
    enefit(
      "01.05.2023 00:00;01.05.2023 01:00;2,788;91,99;0,2;91,99;\n01.05.2023 01:00;01.05.2023 02:00;2,104;31,49;0;31,49;",
    ),
    { fileName: "C:\\private\\historical.csv" },
  );
  assert.equal(parsed.valid, true);
  assert.equal(parsed.rows[0].time, "2023-04-30T21:00:00.000Z");
  close(parsed.rows[0].energyKwh, 2.788);
  close(parsed.rows[0].reportedGridExportKwh, 0.2);
  assert.equal(parsed.metadata.fileName, "historical.csv");
  assert.equal(parsed.metadata.seriesType, "grid-import");
  assert.doesNotMatch(
    JSON.stringify(parsed),
    /Anonymous example|Example address|NONPERSONAL|91\.99|31\.49/,
  );
  const reversed = parseConsumptionCsv(
    enefit(
      "01.05.2023 00:00;01.05.2023 01:00;9,0;1;2,5;1;",
      "Andmete tüüp:;;Tootmine;;Tarbimine;;",
    ),
  );
  close(reversed.rows[0].energyKwh, 2.5);
  close(reversed.rows[0].reportedGridExportKwh, 9);
});

test("Enefit metadata is mandatory for repeated quantities and invalid/overlapping intervals are rejected", () => {
  assert.throws(
    () =>
      parseConsumptionCsv(
        enefit("01.05.2023 00:00;01.05.2023 01:00;1;1;0;1;", ""),
      ),
    /Andmete tüüp/,
  );
  const invalid = parseConsumptionCsv(
    enefit(
      "01.05.2023 00:00;01.05.2023 01:00;1;1;0;1;\n01.05.2023 00:30;01.05.2023 01:00;1;1;0;1;\n01.05.2023 02:00;01.05.2023 03:00;-1;1;0;1;",
    ),
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errorCount, 2);
  assert.throws(
    () =>
      normalizeConsumptionConfig({
        mode: "csv-exact",
        rows: [{ time: "2024-01-01T00:00:00Z", energyKwh: null }],
      }),
    /nonnegative/,
  );
});

test("Tallinn spring clock jump is one real hour, autumn repeated times are ordered, impossible local times rejected", () => {
  const spring = parseConsumptionCsv(
    enefit("31.03.2024 02:00;31.03.2024 04:00;1;0;0;0;"),
  );
  assert.equal(spring.valid, true);
  close(spring.rows[0].durationHours, 1);
  const autumn = parseConsumptionCsv(
    enefit(
      "27.10.2024 02:00;27.10.2024 03:00;1;0;0;0;\n27.10.2024 03:00;27.10.2024 03:00;2;0;0;0;\n27.10.2024 03:00;27.10.2024 04:00;3;0;0;0;",
    ),
  );
  assert.equal(autumn.valid, true);
  assert.deepEqual(
    autumn.rows.map((r) => r.time),
    [
      "2024-10-26T23:00:00.000Z",
      "2024-10-27T00:00:00.000Z",
      "2024-10-27T01:00:00.000Z",
    ],
  );
  close(autumn.coverage.intervalHours, 3);
  const impossible = parseConsumptionCsv(
    enefit("31.03.2024 03:00;31.03.2024 04:00;1;0;0;0;"),
  );
  assert.equal(impossible.valid, false);
  assert.match(impossible.errors[0], /does not exist/);
  const ambiguous = parseConsumptionCsv(
    enefit("27.10.2024 03:00;27.10.2024 03:15;1;0;0;0;"),
  );
  assert.equal(ambiguous.valid, false);
  assert.match(ambiguous.errors[0], /ambiguous/);
  const quarters = parseConsumptionCsv(
    enefit(
      [
        "03:00;03:15",
        "03:15;03:30",
        "03:30;03:45",
        "03:45;03:00",
        "03:00;03:15",
        "03:15;03:30",
        "03:30;03:45",
        "03:45;04:00",
      ]
        .map(
          (period) =>
            period
              .split(";")
              .map((t) => `27.10.2024 ${t}`)
              .join(";") + ";1;0;0;0;",
        )
        .join("\n"),
    ),
  );
  assert.equal(quarters.valid, true);
  close(quarters.coverage.intervalHours, 2);
});

test("15-minute input supports explicit DST offsets, unknown gaps, and rejects invalid calendar dates", () => {
  const csv = parseConsumptionCsv(
    "time,consumption_kwh\n2024-10-27T03:00:00+03:00,1\n2024-10-27T03:00:00+02:00,2",
  );
  assert.equal(csv.valid, true);
  close(csv.coverage.gapHours, 0.75);
  close(csv.rows[0].durationHours, 0.25);
  assert.equal(
    parseConsumptionCsv("time,consumption_kwh\n2024-02-30T00:00:00Z,1").valid,
    false,
  );
  assert.equal(
    parseConsumptionCsv("time,consumption_kwh\n2024-06-01T00:00:00.000Z,1")
      .valid,
    true,
  );
});

test("fixed day/night totals survive 23-hour and 25-hour local calendar days", () => {
  for (const [start, hours] of [
    ["2024-03-30T22:00:00Z", 23],
    ["2024-10-26T21:00:00Z", 25],
  ]) {
    const result = applyConsumption(
      model(fullDay(start, hours)),
      DEFAULT_CONSUMPTION,
    );
    close(result.summary.consumptionKwh, 14);
    close(result.summary.importKwh, 14);
    close(result.summary.consumptionCoveredHours, hours);
    assert.equal(result.summary.imputedHours, 0);
  }
});

test("self-consumption, surplus export and benefit obey energy/cost balances including import premium and margin", () => {
  const result = applyConsumption(model([{ time: "2024-06-01T10:00:00Z" }]), {
    mode: "estimate",
    dayKwh: 32,
    nightKwh: 0,
    importAdderEurMWh: 20,
  });
  const s = result.summary;
  close(s.consumptionKwh, 2);
  close(s.selfConsumedKwh, 2);
  close(s.importKwh, 0);
  close(s.exportKwh, 2);
  close(s.avoidedImportCostEur, 0.24);
  close(s.exportRevenueEur, 0.19);
  close(s.netBenefitEur, 0.43);
  close(s.baselineImportCostEur - s.netGridCostEur, s.netBenefitEur);
  close(s.weatherNetBenefitEur, 0.525);
  close(s.shadowNetBenefitLossEur, 0.095);
  close(s.selfConsumptionPct, 50);
  close(s.selfSufficiencyPct, 100);
});

test("negative prices remain signed for both avoided import cost and export revenue", () => {
  const result = applyConsumption(
    model([{ time: "2024-06-01T10:00:00Z", priceEurMWh: -100 }]),
    { dayKwh: 32, nightKwh: 0, importAdderEurMWh: 20 },
  );
  close(result.summary.avoidedImportCostEur, -0.16);
  close(result.summary.exportRevenueEur, -0.21);
  close(result.summary.netBenefitEur, -0.37);
  assert.ok(result.summary.shadowNetBenefitLossEur < 0);
});

test("quarter-hour allocation is performed before hourly self-consumption aggregation", () => {
  const time = "2024-06-01T10:00:00Z";
  const rows = [4, 0, 0, 0].map((energyKwh, i) => ({
    time: new Date(Date.parse(time) + i * 900000).toISOString(),
    energyKwh,
    durationHours: 0.25,
  }));
  const result = applyConsumption(model([{ time }]), {
    mode: "csv-exact",
    rows,
  });
  close(result.summary.consumptionKwh, 4);
  close(result.summary.selfConsumedKwh, 1);
  close(result.summary.importKwh, 3);
  close(result.summary.exportKwh, 3);
  assert.equal(result.summary.consumptionCoveragePct, 100);
});

test("calendar replay maps a rolling-year date consciously; absent leap day remains unknown until explicit filling", () => {
  const rows = [
    { time: "2023-05-01T10:00:00Z", energyKwh: 2, durationHours: 1 },
  ];
  const analysis = model([
    { time: "2024-05-01T10:00:00Z" },
    { time: "2024-02-29T10:00:00Z" },
  ]);
  const result = applyConsumption(analysis, { mode: "csv-calendar", rows });
  close(result.hourly[0].consumptionKwh, 2);
  assert.equal(result.hourly[1].consumptionKwh, null);
  assert.equal(result.summary.consumptionKwh, null);
  close(result.summary.coveredConsumptionKwh, 2);
  close(result.summary.consumptionCoveragePct, 50);
  assert.equal(result.summary.netBenefitEur, null);
  assert.ok(result.summary.coveredNetBenefitEur > 0);
  const filled = applyConsumption(analysis, {
    mode: "csv-calendar",
    rows,
    fillMissingWithEstimate: true,
  });
  close(filled.summary.imputedHours, 1);
  assert.ok(Number.isFinite(filled.summary.netBenefitEur));
  const exact = applyConsumption(model([{ time: "2024-05-01T10:00:00Z" }]), {
    mode: "csv-exact",
    rows,
  });
  assert.equal(exact.summary.consumptionKwh, null);
});

test("calendar DST occurrence differences stay unknown and repeated annual cycles cannot silently overwrite", () => {
  const rows = [
    { time: "2023-10-27T00:00:00Z", energyKwh: 1, durationHours: 1 },
  ]; // 03:00 EEST on an ordinary source date
  const result = applyConsumption(
    model([{ time: "2024-10-27T00:00:00Z" }, { time: "2024-10-27T01:00:00Z" }]),
    { mode: "csv-calendar", rows },
  );
  close(result.hourly[0].consumptionKwh, 1);
  assert.equal(result.hourly[1].consumptionKwh, null);
  assert.throws(
    () =>
      applyConsumption(model([{ time: "2024-05-01T10:00:00Z" }]), {
        mode: "csv-calendar",
        rows: [
          { time: "2022-05-01T10:00:00Z", energyKwh: 1, durationHours: 1 },
          { time: "2023-05-01T10:00:00Z", energyKwh: 2, durationHours: 1 },
        ],
      }),
    /more than one source value/,
  );
});

test("input objects remain unchanged, aggregates reconcile, missing prices affect economics not known demand", () => {
  const analysis = model([
    { time: "2024-01-01T10:00:00Z" },
    { time: "2024-02-01T10:00:00Z", priceEurMWh: null },
  ]);
  const config = { ...DEFAULT_CONSUMPTION };
  const before = JSON.stringify({ analysis, config });
  const result = applyConsumption(analysis, config);
  assert.equal(JSON.stringify({ analysis, config }), before);
  assert.ok(Number.isFinite(result.summary.consumptionKwh));
  assert.equal(result.summary.netBenefitEur, null);
  close(
    result.monthly.reduce((sum, row) => sum + row.coveredConsumptionKwh, 0),
    result.summary.coveredConsumptionKwh,
  );
  close(
    result.monthly.reduce((sum, row) => sum + row.coveredNetBenefitEur, 0),
    result.summary.coveredNetBenefitEur,
  );
  assert.equal(result.consumption.quality.pricedConsumptionHours, 1);
});

test("scenario validator prevents invalid values, overlaps and oversized profiles", () => {
  assert.throws(
    () => normalizeConsumptionConfig({ dayKwh: -1 }),
    /nonnegative/,
  );
  assert.throws(
    () => normalizeConsumptionConfig({ fillMissingWithEstimate: "false" }),
    /true or false/,
  );
  assert.throws(
    () => normalizeConsumptionConfig({ dayStartHour: 7, dayEndHour: 7 }),
    /nonzero/,
  );
  assert.throws(
    () => normalizeConsumptionConfig({ timeZone: "Invalid/example" }),
    /time zone/,
  );
  assert.throws(
    () =>
      normalizeConsumptionConfig({
        mode: "csv-exact",
        rows: Array(100001).fill({}),
      }),
    /100000/,
  );
  assert.throws(
    () =>
      normalizeConsumptionConfig({
        mode: "csv-exact",
        rows: [{ time: "2024-01-01T00:00:00", energyKwh: 1 }],
      }),
    /explicit UTC offset/,
  );
  assert.throws(
    () =>
      normalizeConsumptionConfig({
        mode: "csv-exact",
        rows: [{ time: "2024-02-30T00:00:00Z", energyKwh: 1 }],
      }),
    /invalid calendar/,
  );
  assert.throws(
    () =>
      normalizeConsumptionConfig({
        mode: "csv-exact",
        rows: [
          { time: "2024-01-01T00:00:00Z", energyKwh: 1, durationHours: 1 },
          { time: "2024-01-01T00:15:00Z", energyKwh: 1, durationHours: 1 },
        ],
      }),
    /overlap/,
  );
});

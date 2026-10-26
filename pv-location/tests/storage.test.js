import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyConsumption } from "../src/consumption.js";
import {
  applyStorage,
  normalizeStorageConfig,
  powerFromAmps,
} from "../src/storage.js";
const close = (a, b, e = 1e-7) =>
  assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const config = {
  enabled: true,
  capacityMode: "fixed",
  capacityKwh: 1,
  reserveSocPct: 0,
  roundTripEfficiencyPct: 100,
  cyclingCostEurKwh: 0,
};
function fixture(
  values,
  { margin = 0, adder = 0, start = "2024-06-01T06:00:00Z", system = {} } = {},
) {
  const hourly = values.map((v, i) => ({
    time: new Date(Date.parse(start) + i * 900000).toISOString(),
    durationHours: 0.25,
    shadedKwh: v.pv === null ? null : (v.pv ?? 0),
    weatherKwh: v.pv === null ? null : (v.pv ?? 0),
    priceEurMWh: v.price === null ? null : (v.price ?? 100),
  }));
  const demand = {
    mode: "csv-exact",
    importAdderEurMWh: adder,
    rows: values.flatMap((v, i) =>
      v.demand === null
        ? []
        : [
            {
              time: hourly[i].time,
              durationHours: 0.25,
              energyKwh: v.demand ?? 0,
            },
          ],
    ),
  };
  if (!demand.rows.length)
    demand.rows.push({
      time: "2023-01-01T00:00:00Z",
      durationHours: 0.25,
      energyKwh: 0,
    });
  return {
    analysis: applyConsumption(
      {
        system: { kwp: 20, salesMarginEurMWh: margin, ...system },
        hourly,
        summary: {},
      },
      demand,
    ),
    demand,
  };
}
function run(values, c = {}, options = {}) {
  const f = fixture(values, options);
  return applyStorage(f.analysis, { ...config, ...c }, f.demand).storage;
}
function invariant(s) {
  for (const r of s.hourly) {
    if (r.coveragePct < 100) continue;
    close(r.chargeKwh, r.chargePvKwh + r.chargeGridKwh);
    close(r.dischargeKwh, r.dischargeToLoadKwh + r.dischargeToGridKwh);
    close(r.internalChargedKwh, r.chargeKwh - r.chargeLossKwh);
    close(r.internalDischargedKwh, r.dischargeKwh + r.dischargeLossKwh);
    close(
      r.socEndKwh - r.socStartKwh,
      r.internalChargedKwh - r.internalDischargedKwh,
    );
    close(
      r.pvKwh + r.importKwh + r.dischargeKwh,
      r.demandKwh + r.exportKwh + r.chargeKwh + r.curtailedKwh,
    );
    close(r.availablePvKwh, r.pvKwh);
    close(r.pvGeneratedKwh + r.curtailedKwh, r.pvKwh);
    close(
      r.operatingCostEur,
      r.gridImportCostEur - r.exportRevenueEur + r.cyclingCostEur,
    );
    close(
      r.incrementalBenefitEur,
      r.noBatteryNetGridCostEur - r.operatingCostEur,
    );
    close(r.netBenefitEur, r.baselineImportCostEur - r.operatingCostEur);
    assert.ok(
      r.socStartKwh >= s.config.reserveKwh - 1e-8 &&
        r.socEndKwh <= s.config.effectiveCapacityKwh + 1e-8,
    );
    if (r.durationHours === 0.25) {
      assert.ok(
        r.chargeKwh < 1e-8 || r.dischargeKwh < 1e-8,
        "no simultaneous quarter charging and discharging",
      );
      assert.ok(
        r.importKwh < 1e-8 || r.exportKwh < 1e-8,
        "no simultaneous quarter import and export",
      );
      assert.ok(r.chargeKwh <= s.config.effectiveChargePowerKw / 4 + 1e-8);
      assert.ok(
        r.dischargeKwh <= s.config.effectiveDischargePowerKw / 4 + 1e-8,
      );
      if (s.config.gridExportLimitKw != null)
        assert.ok(r.exportKwh <= s.config.gridExportLimitKw / 4 + 1e-8);
      if (
        s.config.inverterConnection === "shared" &&
        s.config.inverterAcKw != null
      )
        assert.ok(
          r.pvGeneratedKwh - r.chargePvKwh + r.dischargeKwh <=
            s.config.inverterAcKw / 4 + 1e-8,
        );
    }
  }
  close(s.summary.socStartKwh, s.config.reserveKwh);
  close(s.summary.socEndKwh, s.config.reserveKwh);
}

test("AC amperes convert with explicit phase/voltage conventions and automatic capacity tracks PV", () => {
  close(powerFromAmps(16, { phases: 1, voltageV: 230 }), 3.68);
  close(powerFromAmps(16, { phases: 3, voltageV: 400 }), Math.sqrt(3) * 6.4);
  const c = normalizeStorageConfig(
    { powerMode: "amps", phases: 1 },
    { kwp: 12 },
  );
  close(c.effectiveCapacityKwh, 24);
  close(c.effectiveChargePowerKw, 3.68);
  assert.equal(c.voltageV, 230);
  close(
    normalizeStorageConfig({ enabled: false }, { kwp: 100000 })
      .effectiveCapacityKwh,
    200000,
  );
  assert.throws(
    () => normalizeStorageConfig({ enabled: "true" }),
    /true or false/,
  );
  assert.throws(
    () => normalizeStorageConfig({ roundTripEfficiencyPct: 101 }),
    /efficiency/,
  );
  assert.throws(
    () => normalizeStorageConfig({ cyclingCostEurKwh: -1 }),
    /Cycling/,
  );
  assert.ok(
    !(
      "privateMetadata" in
      normalizeStorageConfig({ privateMetadata: "discard" })
    ),
  );
});

test("PV charges at low opportunity cost and serves the more expensive later demand first", () => {
  const s = run([
    { pv: 1, price: 0 },
    { demand: 1, price: 50 },
    { demand: 1, price: 200 },
  ]);
  close(s.summary.chargePvKwh, 1);
  close(s.summary.chargeGridKwh, 0);
  close(s.hourly[1].importKwh, 1);
  close(s.hourly[2].importKwh, 0);
  close(s.summary.incrementalBenefitEur, 0.2);
  close(s.summary.pvSelfConsumedKwh, 1);
  invariant(s);
});

test("grid/export arbitrage needs both permissions and a spread exceeding variable costs", () => {
  const values = [{ price: 0 }, { price: 200 }];
  close(
    run(values, { allowGridCharging: false, allowBatteryExport: true }).summary
      .chargeKwh,
    0,
  );
  close(
    run(values, { allowGridCharging: true, allowBatteryExport: false }).summary
      .chargeKwh,
    0,
  );
  const s = run(values, { allowGridCharging: true, allowBatteryExport: true });
  close(s.summary.chargeGridKwh, 1);
  close(s.summary.dischargeToGridKwh, 1);
  close(s.summary.incrementalBenefitEur, 0.2);
  close(s.summary.pvSelfConsumedKwh, 0);
  invariant(s);
  close(
    run(
      values,
      { allowGridCharging: true, allowBatteryExport: true },
      { adder: 100, margin: 100 },
    ).summary.chargeKwh,
    0,
  );
  close(
    run(values, {
      allowGridCharging: true,
      allowBatteryExport: true,
      cyclingCostEurKwh: 0.2,
    }).summary.chargeKwh,
    0,
  );
});

test("efficiency losses and cycling cost stop a nominally positive but unprofitable spread", () => {
  const c = {
    allowGridCharging: true,
    allowBatteryExport: true,
    roundTripEfficiencyPct: 90,
  };
  close(run([{ price: 100 }, { price: 110 }], c).summary.chargeKwh, 0);
  const s = run([{ price: 0 }, { price: 200 }], c);
  assert.ok(s.summary.lossKwh > 0);
  close(s.summary.dischargeKwh / s.summary.chargeKwh, 0.9);
  invariant(s);
});

test("negative prices retain signs without a simultaneous-flow money machine", () => {
  const s = run([{ price: -100 }, { price: 100 }], {
    allowGridCharging: true,
    allowBatteryExport: true,
    roundTripEfficiencyPct: 90,
  });
  assert.ok(s.hourly[0].gridImportCostEur < 0);
  assert.ok(s.summary.incrementalBenefitEur > 0);
  invariant(s);
  const equal = run([{ price: 100 }, { price: 100 }], {
    allowGridCharging: true,
    allowBatteryExport: true,
  });
  close(equal.summary.chargeKwh, 0);
});

test("otherwise curtailed PV can charge storage without sacrificing capped export revenue", () => {
  const values = [
    { pv: 3, price: 200 },
    { demand: 1, price: 50 },
  ];
  const s = run(values, {}, { system: { gridExportLimitKw: 4 } });
  close(s.summary.chargePvKwh, 1);
  close(s.summary.chargeGridKwh, 0);
  close(s.summary.dischargeToLoadKwh, 1);
  close(s.summary.exportKwh, 1);
  close(s.summary.curtailedKwh, 1);
  close(s.summary.noBatteryCurtailedKwh, 2);
  close(s.summary.incrementalBenefitEur, 0.05);
  close(s.summary.pvGeneratedKwh, 2);
  invariant(s);
  // Without an export constraint the same charge would lose more revenue than it saves.
  close(run(values).summary.chargePvKwh, 0);
});

test("zero net export allows local PV and useful storage but prohibits PV and battery sales", () => {
  const s = run(
    [
      { pv: 2, demand: 0.5, price: 0 },
      { demand: 1, price: 200 },
    ],
    { allowBatteryExport: true },
    { system: { gridExportLimitKw: 0 } },
  );
  close(s.summary.pvDirectSelfConsumedKwh, 0.5);
  close(s.summary.chargePvKwh, 1);
  close(s.summary.dischargeToLoadKwh, 1);
  close(s.summary.exportKwh, 0);
  close(s.summary.dischargeToGridKwh, 0);
  close(s.summary.curtailedKwh, 0.5);
  close(s.summary.noBatteryCurtailedKwh, 1.5);
  invariant(s);
  const arbitrage = run(
    [{ price: 0 }, { price: 200 }],
    {
      allowGridCharging: true,
      allowBatteryExport: true,
    },
    { system: { gridExportLimitKw: 0 } },
  );
  close(arbitrage.summary.chargeKwh, 0);
  close(arbitrage.summary.exportKwh, 0);
  invariant(arbitrage);
});

test("PV and grid-charged battery share the same export headroom during arbitrage", () => {
  const s = run(
    [{ price: 0 }, { pv: 0.75, price: 200 }],
    {
      allowGridCharging: true,
      allowBatteryExport: true,
    },
    { system: { gridExportLimitKw: 4 } },
  );
  close(s.summary.chargeGridKwh, 0.25);
  close(s.hourly[1].exportKwh, 1);
  close(s.hourly[1].dischargeToGridKwh, 0.25);
  close(s.summary.incrementalBenefitEur, 0.05);
  invariant(s);
  const full = run(
    [{ price: 0 }, { pv: 1, price: 200 }],
    {
      allowGridCharging: true,
      allowBatteryExport: true,
    },
    { system: { gridExportLimitKw: 4 } },
  );
  close(full.summary.chargeGridKwh, 0);
  close(full.summary.dischargeToGridKwh, 0);
  invariant(full);
});

test("shared inverter output budget includes battery discharge serving local demand", () => {
  const values = [{ price: 0 }, { pv: 3, demand: 6.25, price: 200 }];
  const options = { system: { inverterAcKw: 15, gridExportLimitKw: 15 } };
  const c = {
    capacityKwh: 4,
    chargePowerKw: 10,
    dischargePowerKw: 10,
    allowGridCharging: true,
  };
  const shared = run(values, c, options);
  assert.equal(shared.config.inverterConnection, "shared");
  close(shared.hourly[1].dischargeToLoadKwh, 0.75);
  close(shared.hourly[1].pvGeneratedKwh + shared.hourly[1].dischargeKwh, 3.75);
  close(shared.hourly[1].importKwh, 2.5);
  invariant(shared);
  const separate = run(
    values,
    { ...c, inverterConnection: "separate" },
    options,
  );
  close(separate.hourly[1].dischargeToLoadKwh, 2.5);
  close(separate.hourly[1].importKwh, 0.75);
  invariant(separate);
  // A fully occupied PV inverter cannot add battery AC output even for local demand.
  const occupied = run(
    [{ price: 0 }, { pv: 3.75, demand: 6.25, price: 200 }],
    c,
    options,
  );
  close(occupied.summary.dischargeKwh, 0);
  close(occupied.summary.chargeKwh, 0);
  invariant(occupied);
  assert.throws(
    () => normalizeStorageConfig({ inverterConnection: "hybrid-dc" }),
    /shared or separate/,
  );
  assert.throws(
    () => normalizeStorageConfig({}, { inverterAcKw: 0 }),
    /inverter AC rating/,
  );
});

test("disabled storage keeps capped no-battery curtailment and incomplete inputs remain unknown", () => {
  const f = fixture([{ pv: 2, demand: 0.5 }, { demand: 1 }], {
    system: { gridExportLimitKw: 0 },
  });
  const disabled = applyStorage(
    f.analysis,
    { enabled: false },
    f.demand,
  ).storage;
  close(disabled.summary.curtailedKwh, 1.5);
  close(disabled.summary.noBatteryCurtailedKwh, 1.5);
  close(disabled.summary.pvGeneratedKwh, 0.5);
  close(disabled.summary.netBenefitEur, f.analysis.summary.netBenefitEur);
  invariant(disabled);
  const partial = run(
    [{ pv: 1, price: 0 }, { pv: null, demand: 1 }, { demand: 1 }],
    {},
    { system: { gridExportLimitKw: 0 } },
  );
  assert.equal(partial.summary.curtailedKwh, null);
  assert.equal(partial.summary.pvGeneratedKwh, null);
  assert.equal(partial.summary.incrementalBenefitEur, null);
  close(partial.summary.coveredCurtailedKwh, 1);
  close(partial.summary.coveragePct, 200 / 3);
  close(partial.summary.coveredIncrementalBenefitEur, 0);
});

test("unspecified limits preserve dispatch and do not reclaim upstream inverter clipping", () => {
  const values = [
    { pv: 1, price: 0 },
    { demand: 1, price: 200 },
  ];
  const original = run(values);
  for (const system of [{}, { inverterAcKw: null, gridExportLimitKw: null }]) {
    const s = run(values, {}, { system });
    close(s.summary.chargePvKwh, original.summary.chargePvKwh);
    close(s.summary.netBenefitEur, original.summary.netBenefitEur);
    close(s.summary.curtailedKwh, 0);
    invariant(s);
  }
  const f = fixture(values, {
    system: { inverterAcKw: 4, gridExportLimitKw: 0 },
  });
  f.analysis.hourly[0].shadedPreInverterKwh = 4;
  f.analysis.hourly[0].shadedInverterClippingKwh = 3;
  const s = applyStorage(f.analysis, config, f.demand).storage;
  close(s.summary.availablePvKwh, 1);
  close(s.summary.chargePvKwh, 1);
  close(s.summary.dischargeToLoadKwh, 1);
  invariant(s);
});

test("charge/discharge limits, reserve and a large SOC grid do not erase small quarter-hour household loads", () => {
  const s = run(
    [
      { pv: 1, price: 0 },
      { demand: 0.1, price: 200 },
      { demand: 0.1, price: 200 },
    ],
    {
      capacityKwh: 40,
      reserveSocPct: 10,
      chargePowerKw: 1,
      dischargePowerKw: 1,
    },
  );
  close(s.summary.dischargeToLoadKwh, 0.2);
  close(s.summary.chargeKwh, 0.2);
  close(s.summary.socEndKwh, 4);
  assert.ok(s.summary.incrementalBenefitEur > 0);
  invariant(s);
});

test("PV/grid mixture accounting does not count grid-charged electricity as PV self-consumption", () => {
  const s = run(
    [
      { pv: 0.5, price: 0 },
      { demand: 1, price: 200 },
    ],
    { allowGridCharging: true, capacityKwh: 1 },
  );
  close(s.summary.chargePvKwh, 0.5);
  close(s.summary.chargeGridKwh, 0.5);
  close(s.summary.pvBatteryToLoadKwh, 0.5);
  close(s.summary.gridBatteryToLoadKwh, 0.5);
  close(s.summary.pvSelfConsumedKwh, 0.5);
  close(s.summary.selfSufficiencyPct, 50);
  invariant(s);
});

test("closed local-day boundary prohibits free terminal energy and overnight carry", () => {
  const s = run(
    [{ price: 0 }, { price: 200 }],
    { allowGridCharging: true, allowBatteryExport: true },
    { start: "2024-06-01T20:45:00Z" },
  ); // 23:45 then next local midnight
  close(s.summary.chargeKwh, 0);
  close(s.summary.incrementalBenefitEur, 0);
  invariant(s);
});

test("unknown quarters split coverage and remain unknown rather than become zero or an annual profit", () => {
  const s = run([
    { pv: 1, price: 0 },
    { demand: null, price: 200 },
    { demand: 1, price: 200 },
  ]);
  assert.equal(s.summary.incrementalBenefitEur, null);
  close(s.summary.coveragePct, 200 / 3);
  close(s.summary.coveredIncrementalBenefitEur, 0);
  assert.equal(s.hourly[1].chargeKwh, null);
});

test("disabled and zero-capacity storage preserve the no-battery result and stable schema", () => {
  const f = fixture([
    { pv: 1, demand: 0, price: 100 },
    { demand: 1, price: 200 },
  ]);
  const pristine = JSON.stringify(f.analysis);
  for (const c of [{ enabled: false }, { ...config, capacityKwh: 0 }]) {
    const s = applyStorage(f.analysis, c, f.demand).storage;
    close(s.summary.chargeKwh, 0);
    close(s.summary.incrementalBenefitEur, 0);
    close(s.summary.netBenefitEur, f.analysis.summary.netBenefitEur);
    close(s.summary.importKwh, f.analysis.summary.importKwh);
    assert.deepEqual(
      Object.keys(s.hourly[0]).sort(),
      Object.keys(
        run([
          { pv: 1, price: 0 },
          { demand: 1, price: 200 },
        ]).hourly[0],
      ).sort(),
    );
  }
  assert.equal(JSON.stringify(f.analysis), pristine);
});

test("real-source year is deterministic, bounded, balanced and improves or preserves actual variable cost", () => {
  const analysis = JSON.parse(
    fs.readFileSync(new URL("../data/derived/analysis.json", import.meta.url)),
  ).years["2025"];
  const baseline = JSON.stringify(analysis.summary);
  const s = applyStorage(
    analysis,
    { enabled: true },
    analysis.consumption.config,
  ).storage;
  assert.equal(s.hourly.length, 8760);
  close(s.summary.coveragePct, 100);
  assert.ok(s.summary.chargePvKwh > 100 && s.summary.dischargeToLoadKwh > 100);
  assert.ok(s.summary.incrementalBenefitEur >= -1e-7);
  close(s.summary.noBatteryNetBenefitEur, analysis.summary.netBenefitEur);
  close(
    s.monthly.reduce((sum, row) => sum + row.netBenefitEur, 0),
    s.summary.netBenefitEur,
  );
  close(s.summary.internalChargedKwh, s.summary.internalDischargedKwh);
  close(s.summary.lossKwh, s.summary.chargeKwh - s.summary.dischargeKwh);
  assert.equal(JSON.stringify(analysis.summary), baseline);
  invariant(s);
});

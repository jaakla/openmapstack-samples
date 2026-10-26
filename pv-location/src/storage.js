import {
  createConsumptionResolver,
  DEFAULT_CONSUMPTION,
  normalizeGridExportLimitKw,
} from "./consumption.js";

const HOUR = 3600000,
  Q = HOUR / 4,
  EPS = 1e-9;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const stamp = (value) =>
  typeof value === "number" ? value : Date.parse(value);
const iso = (value) => new Date(value).toISOString();
export const DEFAULT_STORAGE = Object.freeze({
  enabled: false,
  inverterConnection: "shared",
  capacityMode: "auto",
  capacityKwh: 40,
  powerMode: "kw",
  chargePowerKw: 10,
  dischargePowerKw: 10,
  chargeCurrentA: 16,
  dischargeCurrentA: 16,
  phases: 3,
  voltageV: 400,
  roundTripEfficiencyPct: 90,
  reserveSocPct: 10,
  allowGridCharging: false,
  allowBatteryExport: false,
  cyclingCostEurKwh: 0.02,
  socSteps: 80,
});

export function powerFromAmps(
  amps,
  { phases = 3, voltageV = phases === 3 ? 400 : 230 } = {},
) {
  if (
    !finite(amps) ||
    amps < 0 ||
    ![1, 3].includes(phases) ||
    !finite(voltageV) ||
    voltageV <= 0
  )
    throw new Error(
      "AC power needs nonnegative amperes, one or three phases, and positive voltage.",
    );
  return (amps * voltageV * (phases === 3 ? Math.sqrt(3) : 1)) / 1000;
}

export function normalizeStorageConfig(input = {}, system = {}) {
  const c = Object.fromEntries(
    Object.keys(DEFAULT_STORAGE).map((key) => [
      key,
      input[key] ?? DEFAULT_STORAGE[key],
    ]),
  );
  if (input.phases != null && input.voltageV == null)
    c.voltageV = c.phases === 1 ? 230 : 400;
  for (const key of ["enabled", "allowGridCharging", "allowBatteryExport"])
    if (typeof c[key] !== "boolean")
      throw new Error(`${key} must be explicitly true or false.`);
  if (
    !["auto", "fixed"].includes(c.capacityMode) ||
    !["kw", "amps"].includes(c.powerMode)
  )
    throw new Error("Choose auto/fixed battery capacity and kw/amps power.");
  if (!["shared", "separate"].includes(c.inverterConnection))
    throw new Error("Choose a shared or separate battery inverter connection.");
  for (const key of [
    "capacityKwh",
    "chargePowerKw",
    "dischargePowerKw",
    "chargeCurrentA",
    "dischargeCurrentA",
  ])
    if (!finite(c[key]) || c[key] < 0 || c[key] > 100000)
      throw new Error(`${key} must be a nonnegative number below 100000.`);
  if (
    ![1, 3].includes(c.phases) ||
    !finite(c.voltageV) ||
    c.voltageV < 100 ||
    c.voltageV > 1000
  )
    throw new Error(
      "Use one or three AC phases and a voltage between 100 and 1000 V.",
    );
  if (
    !finite(c.roundTripEfficiencyPct) ||
    c.roundTripEfficiencyPct < 50 ||
    c.roundTripEfficiencyPct > 100
  )
    throw new Error("Round-trip efficiency must be between 50 and 100%.");
  if (!finite(c.reserveSocPct) || c.reserveSocPct < 0 || c.reserveSocPct > 100)
    throw new Error("Reserve SOC must be between 0 and 100%.");
  if (
    !finite(c.cyclingCostEurKwh) ||
    c.cyclingCostEurKwh < 0 ||
    c.cyclingCostEurKwh > 10
  )
    throw new Error(
      "Cycling cost must be between 0 and 10 EUR per discharged AC kWh.",
    );
  if (!Number.isInteger(c.socSteps) || c.socSteps < 8 || c.socSteps > 200)
    throw new Error("SOC grid steps must be an integer between 8 and 200.");
  const kwp = system.kwp ?? 20;
  if (!finite(kwp) || kwp < 0 || kwp > 1000000)
    throw new Error(
      "Automatic capacity needs a finite PV DC nameplate at most 1000000 kWp.",
    );
  c.effectiveCapacityKwh = c.capacityMode === "auto" ? 2 * kwp : c.capacityKwh;
  c.effectiveChargePowerKw =
    c.powerMode === "amps"
      ? powerFromAmps(c.chargeCurrentA, c)
      : c.chargePowerKw;
  c.effectiveDischargePowerKw =
    c.powerMode === "amps"
      ? powerFromAmps(c.dischargeCurrentA, c)
      : c.dischargePowerKw;
  c.reserveKwh = (c.effectiveCapacityKwh * c.reserveSocPct) / 100;
  c.usableCapacityKwh = c.effectiveCapacityKwh - c.reserveKwh;
  c.chargeEfficiency = Math.sqrt(c.roundTripEfficiencyPct / 100);
  c.dischargeEfficiency = c.chargeEfficiency;
  c.socStepKwh = c.usableCapacityKwh / c.socSteps;
  c.gridExportLimitKw = normalizeGridExportLimitKw(system.gridExportLimitKw);
  c.inverterAcKw = system.inverterAcKw ?? null;
  if (
    c.inverterAcKw != null &&
    (!finite(c.inverterAcKw) || c.inverterAcKw <= 0 || c.inverterAcKw > 1000000)
  )
    throw new Error(
      "PV inverter AC rating must be null or a positive kW value at most 1000000.",
    );
  return c;
}
export const validateStorage = normalizeStorageConfig;

const METRICS = [
  "pvKwh",
  "availablePvKwh",
  "pvGeneratedKwh",
  "curtailedKwh",
  "noBatteryCurtailedKwh",
  "demandKwh",
  "pvDirectSelfConsumedKwh",
  "chargeKwh",
  "chargePvKwh",
  "chargeGridKwh",
  "dischargeKwh",
  "dischargeToLoadKwh",
  "dischargeToGridKwh",
  "pvBatteryToLoadKwh",
  "gridBatteryToLoadKwh",
  "pvBatteryToGridKwh",
  "gridBatteryToGridKwh",
  "chargeLossKwh",
  "dischargeLossKwh",
  "lossKwh",
  "internalChargedKwh",
  "internalDischargedKwh",
  "importKwh",
  "exportKwh",
  "pvSelfConsumedKwh",
  "gridImportCostEur",
  "exportRevenueEur",
  "cyclingCostEur",
  "netGridCostEur",
  "operatingCostEur",
  "baselineImportCostEur",
  "noBatteryNetGridCostEur",
  "noBatteryNetBenefitEur",
  "netBenefitEur",
  "incrementalBenefitEur",
];
const ck = (key) => `covered${key[0].toUpperCase()}${key.slice(1)}`;
function aggregate(rows) {
  const out = {};
  for (const key of METRICS) {
    out[ck(key)] = rows.reduce(
      (sum, row) => sum + (row[ck(key)] ?? (finite(row[key]) ? row[key] : 0)),
      0,
    );
    out[key] = rows.every((row) => finite(row[key])) ? out[ck(key)] : null;
  }
  out.expectedHours = rows.reduce((sum, row) => sum + row.expectedHours, 0);
  out.coveredHours = rows.reduce((sum, row) => sum + row.coveredHours, 0);
  out.coveragePct = out.expectedHours
    ? (out.coveredHours / out.expectedHours) * 100
    : 0;
  out.socStartKwh = rows[0]?.socStartKwh ?? null;
  out.socEndKwh = rows.at(-1)?.socEndKwh ?? null;
  out.maxSocKwh = rows.some((row) => finite(row.maxSocKwh ?? row.socEndKwh))
    ? Math.max(...rows.map((row) => row.maxSocKwh ?? row.socEndKwh ?? 0))
    : null;
  out.pvSocEndKwh = rows.at(-1)?.pvSocEndKwh ?? null;
  out.gridSocEndKwh = rows.at(-1)?.gridSocEndKwh ?? null;
  out.selfConsumptionPct =
    out.pvSelfConsumedKwh != null && out.pvKwh > 0
      ? (out.pvSelfConsumedKwh / out.pvKwh) * 100
      : null;
  out.selfSufficiencyPct =
    out.pvSelfConsumedKwh != null && out.demandKwh > 0
      ? (out.pvSelfConsumedKwh / out.demandKwh) * 100
      : null;
  return out;
}

const cost = (net, buy, sell, exportLimit = Infinity) =>
  net >= 0 ? net * buy : Math.max(net, -exportLimit) * sell;
function bounds(q, config) {
  const n = q.demand - q.pv;
  return {
    up:
      Math.max(
        0,
        Math.min(
          config.effectiveChargePowerKw / 4,
          config.allowGridCharging ? Infinity : Math.max(-n, 0),
        ),
      ) * config.chargeEfficiency,
    down:
      Math.max(
        0,
        Math.min(
          config.effectiveDischargePowerKw / 4,
          config.allowBatteryExport
            ? Math.max(0, n + q.exportLimit)
            : Math.max(n, 0),
          Math.max(0, q.inverterLimit - q.pv),
        ),
      ) / config.dischargeEfficiency,
  };
}
function interpolate(future, energy, step, states) {
  if (energy < -EPS || energy > future.reachable + EPS) return Infinity;
  if (Math.abs(energy - future.reachable) < 1e-10) return future.endpoint;
  const values = future.grid;
  const x = clamp(energy / step, 0, states),
    low = Math.floor(x),
    fraction = x - low;
  if (fraction < 1e-10) return values[low];
  if ((low + 1) * step > future.reachable) {
    const f = (energy - low * step) / (future.reachable - low * step);
    return values[low] * (1 - f) + future.endpoint * f;
  }
  if (1 - fraction < 1e-10) return values[low + 1];
  if (!finite(values[low]) || !finite(values[low + 1])) return Infinity;
  return values[low] * (1 - fraction) + values[low + 1] * fraction;
}

// A SOC-grid value function plus exact load/surplus/power boundaries keeps small household
// quarter-hour loads feasible. The forward simulation uses continuous, bounded real energy.
function choose(q, energy, future, c) {
  const step = c.socStepKwh,
    states = c.socSteps;
  const { up, down } = q.bounds;
  const low = Math.max(0, energy - down),
    high = Math.min(c.usableCapacityKwh, energy + up, future.reachable);
  const baseNet = q.demand - q.pv;
  let best = Infinity,
    target = energy,
    movement = Infinity;
  const candidate = (next) => {
    if (next < low - EPS || next > high + EPS) return;
    const delta = next - energy;
    const charge = Math.max(0, delta) / c.chargeEfficiency;
    const discharge = Math.max(0, -delta) * c.dischargeEfficiency;
    const total =
      cost(baseNet + charge - discharge, q.buy, q.sell, q.exportLimit) +
      discharge * c.cyclingCostEurKwh +
      interpolate(future, next, step, states);
    const travel = Math.abs(delta);
    if (
      total < best - 1e-11 ||
      (Math.abs(total - best) <= 1e-11 && travel < movement)
    ) {
      best = total;
      target = next;
      movement = travel;
    }
  };
  candidate(energy);
  candidate(low);
  candidate(high);
  if (baseNet < 0) candidate(energy - baseNet * c.chargeEfficiency);
  // Charging curtailed PV has no foregone export revenue until this boundary.
  if (baseNet < -q.exportLimit)
    candidate(energy + (-baseNet - q.exportLimit) * c.chargeEfficiency);
  if (baseNet > 0) candidate(energy - baseNet / c.dischargeEfficiency);
  for (
    let j = Math.ceil((low - EPS) / step);
    j <= Math.floor((high + EPS) / step);
    j += 1
  )
    if (j >= 0 && j <= states) candidate(j * step);
  return { target, value: best };
}

function optimize(quarters, c) {
  const values = Array(quarters.length + 1);
  values[quarters.length] = {
    grid: new Float64Array(c.socSteps + 1).fill(Infinity),
    reachable: 0,
    endpoint: 0,
  };
  values[quarters.length].grid[0] = 0;
  for (let t = quarters.length - 1; t >= 0; t -= 1) {
    const reachable = Math.min(
      c.usableCapacityKwh,
      values[t + 1].reachable + quarters[t].bounds.down,
    );
    const current = {
      grid: new Float64Array(c.socSteps + 1).fill(Infinity),
      reachable,
      endpoint: 0,
    };
    for (let i = 0; i <= c.socSteps; i += 1)
      if (i * c.socStepKwh <= reachable + EPS)
        current.grid[i] = choose(
          quarters[t],
          i * c.socStepKwh,
          values[t + 1],
          c,
        ).value;
    current.endpoint = choose(quarters[t], reachable, values[t + 1], c).value;
    values[t] = current;
  }
  let energy = 0,
    actualCost = 0;
  const path = quarters.map((q, i) => {
    const selected = choose(q, energy, values[i + 1], c);
    const next = clamp(selected.target, 0, c.usableCapacityKwh);
    const delta = next - energy;
    const charge = Math.max(0, delta) / c.chargeEfficiency;
    const discharge = Math.max(0, -delta) * c.dischargeEfficiency;
    actualCost +=
      cost(q.demand - q.pv + charge - discharge, q.buy, q.sell, q.exportLimit) +
      discharge * c.cyclingCostEurKwh;
    energy = next;
    return delta;
  });
  const baseline = quarters.reduce(
    (sum, q) => sum + cost(q.demand - q.pv, q.buy, q.sell, q.exportLimit),
    0,
  );
  const fallback =
    !finite(actualCost) || energy > 1e-7 || actualCost > baseline + 1e-8;
  return { path: fallback ? quarters.map(() => 0) : path, fallback };
}

function simulate(q, delta, state, c) {
  const charge = Math.max(0, delta) / c.chargeEfficiency,
    discharge = Math.max(0, -delta) * c.dischargeEfficiency;
  const direct = Math.min(q.demand, q.pv),
    surplus = Math.max(0, q.pv - q.demand);
  const chargePv = Math.min(surplus, charge),
    chargeGrid = Math.max(0, charge - chargePv);
  const start = state.pv + state.grid;
  const pvFraction = start > EPS ? state.pv / start : 0;
  const internalOut = Math.max(0, -delta),
    internalIn = Math.max(0, delta);
  const dischargeToLoad = Math.min(Math.max(0, q.demand - q.pv), discharge);
  const dischargeToGrid = Math.max(0, discharge - dischargeToLoad);
  state.pv += chargePv * c.chargeEfficiency - internalOut * pvFraction;
  state.grid +=
    chargeGrid * c.chargeEfficiency - internalOut * (1 - pvFraction);
  if (Math.abs(state.pv) < 1e-8) state.pv = 0;
  if (Math.abs(state.grid) < 1e-8) state.grid = 0;
  const net = q.demand - q.pv + charge - discharge;
  const imported = Math.max(0, net),
    exported = Math.min(Math.max(0, -net), q.exportLimit);
  const curtailed = Math.max(0, -net - exported);
  const importCost = imported * q.buy,
    exportRevenue = exported * q.sell;
  const cycleCost = discharge * c.cyclingCostEurKwh;
  const baselineGrid = cost(q.demand - q.pv, q.buy, q.sell, q.exportLimit);
  const operatingCost = importCost - exportRevenue + cycleCost;
  return {
    pvKwh: q.pv,
    availablePvKwh: q.pv,
    pvGeneratedKwh: q.pv - curtailed,
    curtailedKwh: curtailed,
    noBatteryCurtailedKwh: Math.max(0, q.pv - q.demand - q.exportLimit),
    demandKwh: q.demand,
    pvDirectSelfConsumedKwh: direct,
    chargeKwh: charge,
    chargePvKwh: chargePv,
    chargeGridKwh: chargeGrid,
    dischargeKwh: discharge,
    dischargeToLoadKwh: dischargeToLoad,
    dischargeToGridKwh: dischargeToGrid,
    pvBatteryToLoadKwh: dischargeToLoad * pvFraction,
    gridBatteryToLoadKwh: dischargeToLoad * (1 - pvFraction),
    pvBatteryToGridKwh: dischargeToGrid * pvFraction,
    gridBatteryToGridKwh: dischargeToGrid * (1 - pvFraction),
    chargeLossKwh: charge - internalIn,
    dischargeLossKwh: internalOut - discharge,
    lossKwh: charge - internalIn + internalOut - discharge,
    internalChargedKwh: internalIn,
    internalDischargedKwh: internalOut,
    socStartKwh: c.reserveKwh + start,
    socEndKwh: c.reserveKwh + state.pv + state.grid,
    maxSocKwh: c.reserveKwh + Math.max(start, state.pv + state.grid),
    pvSocEndKwh: state.pv,
    gridSocEndKwh: state.grid,
    importKwh: imported,
    exportKwh: exported,
    pvSelfConsumedKwh: direct + dischargeToLoad * pvFraction,
    gridImportCostEur: importCost,
    exportRevenueEur: exportRevenue,
    cyclingCostEur: cycleCost,
    netGridCostEur: importCost - exportRevenue,
    operatingCostEur: operatingCost,
    baselineImportCostEur: q.demand * q.buy,
    noBatteryNetGridCostEur: baselineGrid,
    noBatteryNetBenefitEur: q.demand * q.buy - baselineGrid,
    netBenefitEur: q.demand * q.buy - operatingCost,
    incrementalBenefitEur: baselineGrid - operatingCost,
    expectedHours: 0.25,
    coveredHours: 0.25,
  };
}

function offRow(row, c) {
  const result = Object.fromEntries(METRICS.map((key) => [key, 0]));
  const mappings = {
    pvKwh: "shadedKwh",
    availablePvKwh: "shadedKwh",
    pvGeneratedKwh: "pvGeneratedKwh",
    curtailedKwh: "curtailedKwh",
    noBatteryCurtailedKwh: "curtailedKwh",
    demandKwh: "consumptionKwh",
    pvDirectSelfConsumedKwh: "selfConsumedKwh",
    importKwh: "importKwh",
    exportKwh: "exportKwh",
    pvSelfConsumedKwh: "selfConsumedKwh",
    gridImportCostEur: "gridImportCostEur",
    exportRevenueEur: "exportRevenueEur",
    netGridCostEur: "netGridCostEur",
    operatingCostEur: "netGridCostEur",
    baselineImportCostEur: "baselineImportCostEur",
    noBatteryNetGridCostEur: "netGridCostEur",
    noBatteryNetBenefitEur: "netBenefitEur",
    netBenefitEur: "netBenefitEur",
  };
  for (const [target, source] of Object.entries(mappings)) {
    result[target] = finite(row[source]) ? row[source] : null;
    if (finite(row[ck(source)])) result[ck(target)] = row[ck(source)];
  }
  // Older pinned, unconstrained baselines predate explicit curtailment fields.
  if (row.curtailedKwh === undefined && c.gridExportLimitKw == null) {
    const known = finite(row.shadedKwh) && finite(row.consumptionKwh);
    result.curtailedKwh = result.noBatteryCurtailedKwh = known ? 0 : null;
    result.pvGeneratedKwh = known ? row.shadedKwh : null;
  }
  return {
    ...result,
    time: row.time,
    durationHours: row.durationHours ?? 1,
    expectedHours: row.durationHours ?? 1,
    coveredHours:
      row.pricedConsumptionHours ??
      (finite(row.netBenefitEur) ? (row.durationHours ?? 1) : 0),
    socStartKwh: c.reserveKwh,
    socEndKwh: c.reserveKwh,
    maxSocKwh: c.reserveKwh,
    pvSocEndKwh: 0,
    gridSocEndKwh: 0,
  };
}

/** Historical daily perfect-foresight storage scenario; prior no-battery analysis is preserved. */
export function applyStorage(
  analysis,
  input = DEFAULT_STORAGE,
  consumptionInput,
) {
  if (!analysis?.hourly?.length)
    throw new Error(
      "Storage requires an analyzed PV and consumption scenario.",
    );
  const config = normalizeStorageConfig(input, analysis.system);
  const active =
    config.enabled &&
    config.usableCapacityKwh > EPS &&
    config.effectiveChargePowerKw > 0 &&
    config.effectiveDischargePowerKw > 0;
  let hourly,
    optimizedDays = 0,
    noHarmFallbackDays = 0;
  if (!active)
    hourly = analysis.hourly.map((row) => ({
      time: row.time,
      durationHours: row.durationHours ?? 1,
      ...aggregate([offRow(row, config)]),
    }));
  else {
    const demandConfig =
      consumptionInput ?? analysis.consumption?.config ?? DEFAULT_CONSUMPTION;
    const resolver = createConsumptionResolver(demandConfig);
    const quarters = [],
      byDay = new Map();
    let previousTime = -Infinity;
    for (const row of analysis.hourly) {
      const start = stamp(row.time),
        duration = row.durationHours ?? 1;
      if (
        !Number.isFinite(start) ||
        start % Q ||
        duration <= 0 ||
        duration > 1 ||
        (duration * 4) % 1 ||
        start < previousTime
      )
        throw new Error(
          "Storage input must have ordered, nonoverlapping quarter-hour-compatible UTC intervals.",
        );
      previousTime = start + duration * HOUR;
      const n = duration * 4;
      for (let i = 0; i < n; i += 1) {
        const time = start + i * Q,
          demand = resolver.at(time).energyKwh;
        const q = {
          time,
          parent: row,
          pv: finite(row.shadedKwh) ? row.shadedKwh / n : null,
          demand,
          exportLimit:
            config.gridExportLimitKw == null
              ? Infinity
              : config.gridExportLimitKw / 4,
          inverterLimit:
            config.inverterConnection === "shared" &&
            config.inverterAcKw != null
              ? config.inverterAcKw / 4
              : Infinity,
          buy: finite(row.priceEurMWh)
            ? (row.priceEurMWh + resolver.config.importAdderEurMWh) / 1000
            : null,
          sell: finite(row.priceEurMWh)
            ? (row.priceEurMWh - (analysis.system?.salesMarginEurMWh ?? 0)) /
              1000
            : null,
        };
        q.known = [q.pv, q.demand, q.buy, q.sell].every(finite);
        q.bounds = q.known ? bounds(q, config) : null;
        quarters.push(q);
        const day = resolver.dayKey(time);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(q);
      }
    }
    for (const day of byDay.values()) {
      let segment = [];
      const execute = () => {
        if (!segment.length) return;
        const { path, fallback } = optimize(segment, config);
        optimizedDays += 1;
        if (fallback) noHarmFallbackDays += 1;
        const state = { pv: 0, grid: 0 };
        segment.forEach((q, i) => {
          q.result = simulate(q, path[i], state, config);
        });
        segment = [];
      };
      for (const q of day) {
        if (!q.known) {
          execute();
          q.result = {
            ...Object.fromEntries(METRICS.map((key) => [key, null])),
            expectedHours: 0.25,
            coveredHours: 0,
            socStartKwh: null,
            socEndKwh: null,
            maxSocKwh: null,
            pvSocEndKwh: null,
            gridSocEndKwh: null,
          };
        } else {
          if (segment.length && q.time !== segment.at(-1).time + Q) execute();
          segment.push(q);
        }
      }
      execute();
    }
    let cursor = 0;
    hourly = analysis.hourly.map((row) => {
      const parts = quarters
        .slice(cursor, cursor + (row.durationHours ?? 1) * 4)
        .map((q) => q.result);
      cursor += parts.length;
      return {
        time: row.time,
        durationHours: row.durationHours ?? 1,
        ...aggregate(parts),
      };
    });
  }
  const summarizeBy = (key, field) => {
    const groups = new Map();
    for (const row of hourly) {
      const value = key(row);
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return [...groups].map(([value, rows]) => ({
      [field]: field === "year" ? +value : value,
      ...aggregate(rows),
    }));
  };
  const summary = aggregate(hourly);
  const warnings = [];
  if (active)
    warnings.push(
      "Historical daily perfect-foresight dispatch is an approximate SOC-grid optimization, not a forecast or a guaranteed global optimum. Each observed local-day segment starts and ends at reserve; energy is not carried overnight or across unknown input gaps.",
    );
  if (summary.coveragePct < 100)
    warnings.push(
      "PV, consumption or price coverage is incomplete. Full-period storage economics remain unknown; covered totals are matching-interval sums without extrapolation.",
    );
  if (noHarmFallbackDays)
    warnings.push(
      `${noHarmFallbackDays} segments used idle dispatch because the approximate path did not improve realized cost or close its SOC balance.`,
    );
  const assumptions = [
    "Automatic capacity is twice DC PV kWp in kWh; fixed capacity overrides this planning heuristic.",
    "AC charge and discharge efficiencies are both the square root of round-trip efficiency. AC amp limits assume unity power factor; three-phase voltage is line-to-line.",
    "Each quarter permits charge, idle or discharge. A single net grid flow prevents simultaneous import/export; PV is used directly before charging and battery discharge serves residual demand before export.",
    "Charging from PV has foregone export value only where that PV could otherwise be exported. PV that would exceed the grid export limit can charge storage before being curtailed. Grid charging and battery export require their separate toggles. All spot prices keep their signs; import adder, export sales margin, efficiency and cycling cost enter dispatch.",
    "The grid export kW limit constrains combined PV and battery export in every quarter, after direct local demand. Null leaves export unconstrained and zero prohibits export. Available PV is upstream inverter-clipped AC energy; generated PV is available PV minus grid curtailment. The no-battery comparison uses the same grid export limit.",
    "Shared inverter connection applies an approximate combined PV-plus-battery AC output budget at the selected PV inverter rating, with PV used first. Separate connection applies the PV inverter rating only upstream and keeps battery charge/discharge limits separate. Neither connection recovers upstream PV inverter clipping or models DC-linked charging or a manufacturer's detailed hybrid topology. Hourly-average PV cannot establish compliance at subhour peaks.",
    "SOC reserve is unavailable for dispatch and never credited as free energy. Every optimized daily or covered segment closes at reserve. PV and grid energy mix proportionally in usable storage; source-specific losses and delivered PV self-consumption are accounted separately.",
    "Cycling cost is EUR per AC kWh discharged. Net grid cost excludes cycling cost; operating cost includes it. Incremental benefit compares operating cost with the identical no-battery demand/PV baseline.",
    "Hourly PV is uniform within its quarters; the shared demand resolver preserves actual uploaded quarter-hour spikes. Boundary local days are restricted to the modeled UTC period.",
  ];
  return {
    ...analysis,
    storage: {
      config,
      summary,
      hourly,
      monthly: summarizeBy((row) => row.time.slice(0, 7), "month"),
      annual: summarizeBy((row) => row.time.slice(0, 4), "year"),
      quality: {
        status: warnings.length ? "warning" : "pass",
        warnings,
        expectedHours: summary.expectedHours,
        coveredHours: summary.coveredHours,
        coveragePct: summary.coveragePct,
        noHarmFallbackDays,
        optimizedDays,
        solver: "daily SOC-grid dynamic programming with exact flow boundaries",
        socSteps: config.socSteps,
      },
      assumptions,
    },
  };
}

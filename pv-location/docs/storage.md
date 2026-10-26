# Battery storage scenario

`src/storage.js` adds a battery scenario while preserving the original PV and no-battery household analysis. Storage is disabled in the published baseline. The default capacity rule is a **planning assumption** of twice the PV DC kWp expressed in kWh: a 20 kWp array opens with a 40 kWh battery. This rule is not a sizing recommendation or an equipment measurement.

```js
import { applyStorage, normalizeStorageConfig, DEFAULT_STORAGE } from '../src/storage.js';
const result = applyStorage(analysis, { ...DEFAULT_STORAGE, enabled: true }, consumptionConfig);
// Existing result.summary/hourly/monthly still describe the identical no-battery scenario.
// The battery scenario is result.storage.summary/hourly/monthly/annual.
```

## Configuration and units

`normalizeStorageConfig(input = {}, system = {})` returns only accepted configuration fields plus recalculated effective values. The raw keys are:

```json
{
  "enabled": false,
  "capacityMode": "auto",
  "capacityKwh": 40,
  "powerMode": "kw",
  "chargePowerKw": 10,
  "dischargePowerKw": 10,
  "chargeCurrentA": 16,
  "dischargeCurrentA": 16,
  "phases": 3,
  "voltageV": 400,
  "roundTripEfficiencyPct": 90,
  "reserveSocPct": 10,
  "allowGridCharging": false,
  "allowBatteryExport": false,
  "cyclingCostEurKwh": 0.02,
  "socSteps": 80
}
```

`capacityMode: 'auto'` uses `2 × system.kwp`; `'fixed'` uses `capacityKwh`. `powerMode: 'kw'` uses the two AC kW limits. In `'amps'` mode, `powerFromAmps(amps,{phases,voltageV})` calculates:

- Single phase: `kW = A × V / 1000`, usually 230 V.
- Three phase: `kW = sqrt(3) × A × V / 1000`, with line-to-line voltage, usually 400 V.

Power factor is assumed to be 1. For example, 16 A at 230 V single phase is 3.68 kW; at 400 V three phase it is approximately 11.09 kW. These are battery AC limits, not an inferred site connection limit. No separate site service/export cap is assumed. Changing phases without supplying a voltage chooses 230/400 V accordingly.

The normalizer adds `effectiveCapacityKwh`, `effectiveChargePowerKw`, `effectiveDischargePowerKw`, `reserveKwh`, `usableCapacityKwh`, `chargeEfficiency`, `dischargeEfficiency` and `socStepKwh`. Effective values supplied by an imported scenario are ignored and recomputed. Each conversion efficiency is the square root of the configured round-trip efficiency. Reserve is unavailable stored energy and never discharged or credited. Zero capacity, 100% reserve or a zero power limit produces the same no-dispatch result as disabled storage.

`allowGridCharging` permits charging above contemporaneous PV surplus. `allowBatteryExport` permits battery discharge above residual household demand. PV still exports directly without the latter permission; that toggle controls battery-origin export. Price arbitrage through the battery requires both permissions. Cycling cost is a variable EUR cost for each **AC kWh discharged**, separate from import and export transfer costs. Capital costs, fixed fees and financing are excluded.

## Dispatch method and interpretation

The optimizer uses the historical replay's already-known prices, PV and demand. It runs daily dynamic programming over a SOC grid, with linear interpolation between grid values and exact load/surplus/power/reachable-SOC boundary transitions. The latter preserve fractional quarter-hour household loads even when nominal SOC grid cells are larger than those loads. Forward simulation uses continuous feasible energy and actual resulting costs.

**This is an approximate daily perfect-foresight historical scenario.** It is not a forecast, a controller evaluated against unexpected weather/prices, a globally optimal annual schedule or a guaranteed physical upper bound. `socSteps` controls approximation resolution, initially 80. Future changes in tariffs, occupancy and forecast errors are not modeled. The model makes no financial return or accuracy guarantee.

Each observed local calendar-day segment begins and ends at reserve. Consequently, it cannot shift energy across local midnight. A modeled UTC year contains partial first/last local days; these boundary segments close within the observed modeled period. Unknown PV, demand or price quarters break a day into separate covered segments. The model closes SOC before a gap and restarts at reserve after it, rather than inventing the unobserved intervening battery behavior.

Idle operation is always a feasible daily comparator. After optimization, actual simulated cost is checked against the identical no-battery cost, and final usable SOC must be zero. If an approximate path increases variable operating cost, fails to close SOC, or has a nonfinite value, the whole covered segment uses idle operation and records `noHarmFallbackDays`. This prevents reporting an approximation artifact as a realized historical profit. It does not make the approximation globally optimal.

At each 15-minute step, exactly one of charge, idle or discharge is permitted. One net grid balance determines either import or export, preventing simultaneous import/export subsidies. Price signs are retained. Sequential operation in different quarters is physically distinct from simultaneous operation; with negative prices, actual loss energy can have a signed market value. Cycling cost and efficiency remain in every such decision. An aggregated hour can contain both charging/discharging or importing/exporting in **different quarters**, so the hourly aggregate must not be mistaken for simultaneous power flows.

The optimizer values PV charging at the export receipts forgone at that time. Grid charging pays the current modeled spot price plus the consumption import adder. Exports receive modeled spot less the PV sales margin. Subsequent self-use avoids the then-current import price. Only a net economic gain after these prices, losses and cycling cost warrants a cycle; a nominal positive price difference alone is insufficient.

## Shared demand and source attribution

The `consumptionConfig` argument is the same original configuration used by `applyConsumption`. `createConsumptionResolver()` is shared between the two modules: it preserves uploaded quarter-hour spikes, local day/night assumptions, DST handling, exact/calendar matching, missingness and explicit imputation. It avoids reconstructing quarter-hour demand from an hourly sum. If an enabled CSV scenario lacks its normalized source rows, the normalizer rejects it rather than silently flattening the load. An estimate can be reconstructed from `analysis.consumption.config`.

Each hourly PV amount is divided uniformly among its quarters, retaining the earlier solar model assumption. Within a quarter, PV first supplies demand. A charge uses remaining PV surplus first, with additional grid energy only when grid charging is enabled. Discharge supplies residual demand first, exporting only its remainder when allowed.

Usable stored PV and grid energy are separate ledgers. A charge adds its source energy after charge conversion losses. Discharge removes the sources in proportion to their current stored mixture, and applies discharge losses before delivered AC energy is allocated to demand/export. Grid-charged energy serving demand is not counted as PV self-consumption. `pvSocEndKwh + gridSocEndKwh = socEndKwh − reserveKwh`; reserve has no usable source credit. This proportional mixing is an accounting convention, not evidence of an installation's meter topology.

## Energy and value identities

All charge/discharge quantities except names explicitly beginning `internal` are AC kWh. SOC quantities and internal charge/discharge are stored-energy kWh.

```text
chargeKwh = chargePvKwh + chargeGridKwh
dischargeKwh = dischargeToLoadKwh + dischargeToGridKwh
internalChargedKwh = chargeKwh − chargeLossKwh
internalDischargedKwh = dischargeKwh + dischargeLossKwh
socEndKwh − socStartKwh = internalChargedKwh − internalDischargedKwh
pvKwh + importKwh + dischargeKwh = demandKwh + exportKwh + chargeKwh
lossKwh = chargeLossKwh + dischargeLossKwh
netGridCostEur = gridImportCostEur − exportRevenueEur
operatingCostEur = netGridCostEur + cyclingCostEur
netBenefitEur = baselineImportCostEur − operatingCostEur
incrementalBenefitEur = noBatteryNetGridCostEur − operatingCostEur
```

`noBatteryNetBenefitEur` is the original no-battery PV benefit for the same covered quarters; `baselineImportCostEur` is the no-PV import comparator. Thus the battery's incremental benefit is separate from the total PV-plus-battery benefit. EUR/MWh prices are divided by 1,000 for kWh valuation. Default zero import adder means spot-only avoided import cost; it does not silently include network fees or VAT.

`pvSelfConsumedKwh` includes direct PV self-use and PV-origin battery energy delivered to demand. `selfConsumptionPct` divides this delivered PV self-use by total generated PV. `selfSufficiencyPct` divides it by household demand. Storage losses and grid-origin battery energy do not inflate those fractions.

## Output and completeness

`applyStorage` returns an analysis clone with nested `storage = {config, summary, hourly, monthly, annual, quality, assumptions}`. Original no-battery analysis objects and arrays are not mutated. Disabled storage supplies deterministic zero dispatch and preserves original flows/values, with the same result schema as enabled operation.

Summed hourly/summary metrics are:

`pvKwh`, `demandKwh`, `pvDirectSelfConsumedKwh`, `chargeKwh`, `chargePvKwh`, `chargeGridKwh`, `dischargeKwh`, `dischargeToLoadKwh`, `dischargeToGridKwh`, `pvBatteryToLoadKwh`, `gridBatteryToLoadKwh`, `pvBatteryToGridKwh`, `gridBatteryToGridKwh`, `chargeLossKwh`, `dischargeLossKwh`, `lossKwh`, `internalChargedKwh`, `internalDischargedKwh`, `importKwh`, `exportKwh`, `pvSelfConsumedKwh`, `gridImportCostEur`, `exportRevenueEur`, `cyclingCostEur`, `netGridCostEur`, `operatingCostEur`, `baselineImportCostEur`, `noBatteryNetGridCostEur`, `noBatteryNetBenefitEur`, `netBenefitEur`, `incrementalBenefitEur`.

Each has a `covered…` companion, such as `coveredIncrementalBenefitEur`. Full-period metrics are `null` if a required quarter is unknown; covered companions remain matching-quarter sums without extrapolation. Disabled storage's incremental change is exactly zero even if its common baseline is partly unknown. SOC fields take the beginning/end of the period rather than being summed: `socStartKwh`, `socEndKwh`, `maxSocKwh`, `pvSocEndKwh`, `gridSocEndKwh`. Coverage is `expectedHours`, `coveredHours` and `coveragePct`. Monthly grouping uses the solar engine's UTC month boundaries; daily dispatch uses the consumption time zone.

`quality` contains status/warnings, coverage, `optimizedDays` (covered daily segments), `noHarmFallbackDays`, solver name and SOC step count. Enabled optimization always carries its historical/approximation warning. A warning is not a field-accuracy test. Tests use synthetic price/load schedules to establish constraints and arithmetic, plus the pinned real-source year to check complete coverage, aggregate parity, reserve balance and no increase in variable operating cost.

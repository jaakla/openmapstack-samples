# Consumption, self-consumption and grid economics

`src/consumption.js` adds consumption to the same modeled PV results used by the browser and the canonical Node pipeline. It does not modify the original PV-only energy or all-export revenue comparators. No external service receives an imported consumption file. The root interface decodes UTF-8 first and Windows-1257 as an explicit fallback; the parser receives decoded text.

## API

```js
import {
  DEFAULT_CONSUMPTION, normalizeConsumptionConfig,
  parseConsumptionCsv, applyConsumption,
} from '../src/consumption.js';

const parsed = parseConsumptionCsv(text, {
  fileName: 'historicalreport.csv', timeZone: 'Europe/Tallinn',
});
if (!parsed.valid) throw new Error(parsed.errors.join('\n'));

const config = normalizeConsumptionConfig({
  ...DEFAULT_CONSUMPTION,
  mode: 'csv-calendar', rows: parsed.rows, metadata: parsed.metadata,
  fillMissingWithEstimate: false,
});
const withConsumption = applyConsumption(pvAnalysis, config);
```

`validateConsumption` aliases `normalizeConsumptionConfig`. The validator returns a fresh, whitelisted configuration. Modes are `estimate`, `csv-exact` and `csv-calendar`. It rejects invalid daily totals, clock periods, time zones, import adders, ambiguous scenario timestamps, overlapping intervals and profiles above 100,000 source intervals. It preserves only normalized interval time, duration, consumption energy and optional separately reported grid-export energy. Customer names, addresses, EIC/meter identifiers, historical prices and arbitrary metadata fields are not retained. `metadata.fileName` is reduced to its basename; a filename itself can contain personal information, so generated PDF reports omit it.

`DEFAULT_CONSUMPTION` is the visible planning assumption:

```json
{
  "mode": "estimate",
  "dayKwh": 10,
  "nightKwh": 4,
  "dayStartHour": 7,
  "dayEndHour": 23,
  "timeZone": "Europe/Tallinn",
  "importAdderEurMWh": 0,
  "fillMissingWithEstimate": false
}
```

Day/night values are **kWh totals for each local calendar day's clock periods**, not average power. The day period includes its start and excludes its end. A period can cross midnight. Within each period the model uses a constant rate, computed from that date's real duration. A Tallinn spring day has 23 hours and an autumn day 25 hours; with the default 07:00–23:00 definition, the day remains 10 kWh and the remaining night remains 4 kWh. If an unusually narrow clock period disappears entirely at a DST transition, a positive total for that period is rejected. This flat profile is an assumption, not meter evidence.

## Enefit and interval CSV import

The Enefit parser accepts the semicolon report with metadata before the table, decimal-comma interval quantities, and paired consumption/export columns. For example, its anonymized test fixture contains:

```csv
Väljastaja:;Enefit AS
Klient:;Anonymous example
Andmete tüüp:;;Tarbimine;;Tootmine;;
Algus;Lõpp;Kogus (kWh);Börsihind (EUR / MWh);Kogus (kWh);Börsihind (EUR / MWh);
01.05.2023 00:00;01.05.2023 01:00;2,788;91,99;0;91,99;
```

`Andmete tüüp` determines which repeated `Kogus (kWh)` is `Tarbimine`; a production-only report or ambiguous quantity mapping is rejected. `Tootmine` is retained separately as `reportedGridExportKwh`, and is never substituted for consumption or gross PV generation. The parser intentionally discards the metadata preamble and price columns.

**Metered Tarbimine is grid import.** If existing PV, a battery or another generator already supplied some household demand, grid import is less than total demand. Using it as a future site's total load can misstate self-consumption. Likewise, reported Tootmine is export after household use, rather than all PV output. The interface and analysis warnings disclose this interpretation; the module does not reconstruct missing behind-the-meter demand.

Alternative interval CSV has `time,consumption_kwh`, optionally `interval_end` or `duration_minutes`. Without end/duration, each standard CSV record is explicitly treated as 15 minutes and emits a warning. Both hourly and 15-minute intervals are supported; every interval must begin on a UTC quarter-hour boundary and last 15–60 real minutes in 15-minute multiples. Negative or empty quantities, impossible dates, duplicate/overlapping intervals, backwards input ordering, missing endpoints and malformed quotes are rejected. Gaps are reported and remain unknown. Blank records are ignored; malformed data is not silently replaced by zero.

Offset-bearing ISO timestamps are unambiguous. Offset-free Estonian `DD.MM.YYYY HH:mm` timestamps are interpreted in the selected IANA zone, initially `Europe/Tallinn`. The parser uses the zone's actual offsets, including DST. A spring jump from 02:00 to 04:00 is one real hour; nonexistent 03:xx timestamps are rejected. Repeated autumn clock times use chronological continuity or their ordered repeated occurrences. An ambiguous isolated autumn interval must carry an explicit UTC offset; it is not guessed. Interval endpoints must admit a consistent positive real duration.

`parseConsumptionCsv` returns `{ rows, valid, errors, errorCount, warnings, metadata, coverage }`. Each normalized row contains UTC `time`, `durationHours`, `energyKwh` and optional `reportedGridExportKwh`. Callers must require `valid` before applying the profile. `coverage` describes source interval count/hours, missing hours between records, resolved ambiguous intervals and separately reported export kWh. Raw source prices do not enter the current modeled-year economics.

## Exact dates and historical calendar replay

`csv-exact` joins interval energy to the same UTC instants in the modeled year. A May 2023–April 2024 report therefore covers only its actual overlap with a 2024 model, and no 2025 intervals. Uncovered quarters are unknown.

`csv-calendar` is an explicit **historical scenario replay**. Each source interval is split uniformly into quarters, then indexed by local month, day, hour, minute and DST occurrence. Matching local calendar slots are repeated into the target modeled year. This lets a rolling May–April report inform either modeled year without pretending that its old timestamps are current measurements. Source weekdays, weather, occupancy and DST-transition dates can differ from those of the target year. No weekday correction, statistical averaging, interpolation or claimed forecasting accuracy is added.

A target February 29 without a source February 29 stays unknown. A target autumn hour with no corresponding second source occurrence stays unknown. A source DST gap can leave target ordinary-day slots unknown. More than one annual source cycle containing the same calendar key is rejected rather than choosing or averaging a value silently. Choose exact-date matching or prepare one explicitly defined historical annual cycle.

`fillMissingWithEstimate: true` explicitly substitutes the configured day/night estimate **only for missing target quarters**. It is off by default. `imputedHours` and a warning disclose the amount filled; source meter observations remain distinct from these assumptions. Without filling, incomplete annual coverage legitimately gives unknown annual economics. The corresponding `covered…` fields remain available and are never extrapolated.

## Energy and money calculation

The existing hourly PV model is split evenly into four quarters before applying consumption. An hourly meter interval is also split uniformly; actual quarter-hour consumption remains at its supplied timing. This distinction matters: a one-quarter demand spike cannot consume PV generated in a different quarter. These assumptions preserve interval energy and do not assert quarter-hour solar/weather accuracy.

For each covered quarter, with demand `C` and locally shaded PV `P` in kWh:

- `selfConsumedKwh = min(C, P)`;
- `importKwh = max(C − P, 0)`;
- `exportKwh = max(P − C, 0)`.

The energy balances are `C = selfConsumedKwh + importKwh` and `P = selfConsumedKwh + exportKwh`. Import energy is priced at the selected modeled year's spot price plus `importAdderEurMWh`; surplus exports receive spot price less the PV system's `salesMarginEurMWh`. EUR/MWh is divided by 1,000 before multiplying kWh. An import adder is a variable energy assumption; it does not model fixed network fees or taxes unless the user deliberately includes an appropriate per-energy amount.

`baselineImportCostEur` is the cost of buying all modeled demand without new PV. `gridImportCostEur` buys only remaining demand with PV, and `exportRevenueEur` sells only surplus PV. `avoidedImportCostEur` values the self-consumed energy. `netGridCostEur = gridImportCostEur − exportRevenueEur`. `netBenefitEur = baselineImportCostEur − netGridCostEur = avoidedImportCostEur + exportRevenueEur`.

The module repeats the same demand calculation with shadow-free weather PV to expose `weatherNetBenefitEur`. `shadowNetBenefitLossEur` is shadow-free benefit minus locally shaded benefit. This is the shadow effect under the selected consumption scenario. The engine's existing `shadedRevenueEur` and `shadowRevenueLossEur` retain their original all-generation-export comparator meaning. Negative prices remain signed: both avoided imports and exports may have negative value, and shade may avoid negative-price losses. No storage dispatch, export limits, financing, curtailment or taxes are modeled.

## Output and completeness

`applyConsumption` returns a fresh analysis object with augmented `hourly`, `monthly`, `annual` and `summary`; existing PV results are preserved. Added metrics are:

`consumptionKwh`, `selfConsumedKwh`, `importKwh`, `exportKwh`, `avoidedImportCostEur`, `exportRevenueEur`, `gridImportCostEur`, `baselineImportCostEur`, `netBenefitEur`, `netGridCostEur`, `weatherSelfConsumedKwh`, `weatherImportKwh`, `weatherExportKwh`, `weatherNetBenefitEur`, `shadowNetBenefitLossEur`.

Each has a parallel matching-quarter sum named `covered…`, for example `coveredConsumptionKwh`, `coveredExportKwh`, `coveredNetBenefitEur`, and `coveredShadowNetBenefitLossEur`. A full-period metric becomes `null` when any constituent quarter needed for that metric is unknown. This preserves known demand when only PV or prices are absent. Covered sums are explicitly partial and must not be labeled full-year totals. Monthly grouping follows the engine's UTC month boundaries; day/night rate definitions use local dates.

Coverage keys are `consumptionExpectedHours`, `consumptionCoveredHours`, `consumptionCoveragePct`, `imputedHours` and `pricedConsumptionHours`. `selfConsumptionPct` is self-consumed PV divided by self-consumed plus exported PV. `selfSufficiencyPct` is self-consumed PV divided by demand. Relative values are unknown when their denominator is zero or the required period is incomplete.

`analysis.consumption` contains:

- `config`: the normalized visible configuration, with source rows omitted;
- `provenance`: safe format, series type, time zone, match method and optional basename filename;
- `quality`: status/warnings, consumption coverage counts, imputed hours, priced-consumption hours, missing hours and source-row count;
- `assumptions`: the interval, day/night and pricing assumptions.

The canonical run uses the fixed estimate as a reproducible planning assumption. Uploaded meter values remain a local scenario input unless the user explicitly exports them into a scenario file. Unit tests use anonymized synthetic fixtures to verify arithmetic and edge cases; they do not establish real household or PV prediction accuracy.

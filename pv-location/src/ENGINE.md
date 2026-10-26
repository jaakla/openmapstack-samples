# PV analysis engine contract

`analysis.js` is a deterministic browser/Node ES module. Its only runtime dependency is pinned `proj4` (see `package.json`). `scripts/canonical-analysis.mjs` is the pipeline wrapper; the browser imports this same engine. Tests run with `npm test`.

```js
import { analyzePV, buildHorizon, DEFAULT_SYSTEM } from "./analysis.js";
const horizon = buildHorizon({ grid, polygon, mountingHeightM: 2 });
const result = analyzePV({
  system: { ...DEFAULT_SYSTEM, polygon },
  weather,
  prices,
  horizon,
  year: 2024,
});
```

## Inputs and coordinate conventions

- `polygon`: a WGS84 `[longitude, latitude]` outer ring, GeoJSON Polygon, or Feature. Holes are rejected. A polygon defines a planned array footprint, not observed installed panels. Metric area, perimeter, centroid and sampling use Estonia's EPSG:3301 through proj4. `polygonMetrics()` reports horizontal projected footprint area, not inclined panel surface area.
- `system`: `latitude`, `longitude`, `kwp` (DC nameplate kWp), `azimuthDeg` (true north = 0°, east = 90°, south = 180°), `tiltDeg` (horizontal = 0°), `mountingHeightM` **above local DTM terrain**, `systemLossPct`, `salesMarginEurMWh`, `albedo`, `temperatureCoefficient` (fraction/°C), and `nominalOperatingCellTemperatureC`. A polygon overrides the latitude/longitude with its centroid. `validateSystem()` rejects invalid parameters. Defaults are visible planning assumptions, not measured installation attributes.
- `weather`: rows or `{ rows }`; each row is `{ time, ghi, dni, dhi, temperatureC }`. Irradiance is the mean in W/m²; temperature is °C. Times identify the **start of a UTC hour**, with an explicit `Z` recommended. The supplied Open-Meteo normalizer subtracts one hour from its preceding-hour radiation timestamp. For unnormalized end-labelled weather use `weatherTimeBasis: 'end'`. Temperature remains the source observation at the interval end. Null/absent irradiance or temperature makes weather production unknown. The clear-sky reference uses 20°C only when source temperature is absent, with fallback-hour counts in `quality`.
- `prices`: rows or `{ rows }` of `{ time, priceEurMWh }` at UTC interval starts. Supplied October–December 2025 quarter-hour market prices are averaged into hourly prices. This is exact for the engine's constant hourly export assumption. It does not resolve intra-hour generation/price covariance. Missing price remains unknown; zero and negative prices are valid.
- `grid`: `{ crs: 'EPSG:3301', bounds: [xmin,ymin,xmax,ymax], width, height, dsm, dtm }`. Arrays are flat row-major, north-to-south then west-to-east. Pixel values are metres above sea level, and `null` means no data. DSM and DTM must have identical bounds/registration. No-data cells are never converted to clear ground.

`buildHorizon({grid, polygon, site, mountingHeightM, maxDistanceM:500, azimuthStepDeg:2, maxSamples:9})` returns equal-weight footprint sample `profiles`, an averaged display `profile`, method, coverage, warnings, source resolution and radius. For a point, `site` has latitude/longitude. The receiver elevation is sampled DTM plus mounting height, including for rooftops. Setting a receiver below the source DSM emits a warning. Up to nine interior footprint points use stratified sampling. Narrow/concave footprints may contain fewer points.

At each sample, DSM ray casting finds the largest elevation angle from 5 m (one source pixel) to 500 m. True-north azimuths are converted to local EPSG:3301 grid bearings by projecting a short due-north vector; this corrects approximately 2.3° of meridian convergence at the pilot. Each 2° bin tests its centre and both angular edges, with half-pixel distance steps. Bin maxima are conservatively interpolated; this broadens thin obstacles. Beyond-radius terrain/structures, source resolution and stale observations remain limitations. Coverage counts rays whose entire sampled extent has valid DSM cells. Incomplete coverage produces a warning; the partial shading estimate includes only observed obstacles and is not a complete obstruction assessment. The display's average horizon is not used as a substitute for individual array samples.

`horizonElevation(profile, azimuthDeg)` provides circular interpolation to the renderer. `solarPosition(date, latitude, longitude)` returns geometric elevation, north-clockwise azimuth, zenith and related quantities. `trueToGridBearing(azimuthDeg, latitude, longitude)` converts a true azimuth to local EPSG:3301 grid orientation for map ray renderers. Source-horizon arrays must be sorted, with unique azimuths in `[0,360)` and elevations in `[0,90]`. Geometry validation rejects holes, crossing/touching non-adjacent edges, duplicate consecutive vertices and footprints above 1000 vertices.

Passing `horizon: []` explicitly describes unobstructed sky. Omitting horizon, or passing an unavailable source horizon, preserves shaded production as `null`.

## Model and limits

1. Solar angles follow NOAA's Meeus equations with UTC time; no atmospheric refraction correction is applied. Four midpoint solar positions per hour integrate changing panel incidence and local direct visibility. Mean hourly source radiation is held constant within the hour, so this is not a 15-minute weather reconstruction.
2. Haurwitz clear-sky horizontal radiation (`1098 × cos(zenith) × exp(-0.059/cos(zenith))`) is decomposed by the Erbs diffuse-fraction relationship. This is a simple cloudless benchmark with no aerosol/turbidity inputs. It is not a guaranteed physical upper bound; cloud enhancement can exceed it in individual intervals. Weather retention describes this source year, not a long-term climate normal.
3. Plane-of-array radiation is DNI times positive panel incidence, plus isotropic DHI times `(1+cos(tilt))/2`, plus GHI × albedo × `(1-cos(tilt))/2`. Direct light is blocked below each sample's horizon. Isotropic diffuse visibility is integrated over sky directions at 5° resolution and weighted onto the panel plane. Ground reflection is not reduced by local obstructions.
4. Power in kW is `kwp × POA/1000 × thermalFactor × (1-systemLossPct/100)`. `thermalFactor = max(0,1+temperatureCoefficient × (cellTemperature-25))`; NOCT gives `cellTemperature = airTemperature + (NOCT-20)/800 × POA`. Interval kWh is power times interval hours. No inverter clipping, row-to-row shade, bypass-diode/string mismatch, snow cover, leaf transmission, degradation, curtailment, storage or self-consumption is modeled. Opaque DSM canopy represents the source surface in all seasons.
5. All production is sold. Net EUR is `kWh × (priceEurMWh-salesMarginEurMWh)/1000`. Negative prices are retained. A negative shadow revenue loss means shading avoided an export loss in those hours; local shade always reduces energy.

## Results and missingness

`analyzePV()` returns `{ system, hourly, monthly, annual, summary, quality, assumptions }`. It fills each selected UTC calendar year deterministically (8,784 hours for 2024; 8,760 for 2025). `year` selects one year; without it, the supplied weather determines selected years. Duplicate weather/price timestamps are rejected. Input source data and horizon objects are not mutated.

Hourly fields: `time`, `durationHours`, `clearKwh`, `weatherKwh`, `shadedKwh`, `shadingLossKwh`, `sunVisibleFraction`, `priceEurMWh`, `netPriceEurKwh`, `temperatureC`, `ghi`, `clearRevenueEur`, `weatherRevenueEur`, `shadedRevenueEur`, `shadowRevenueLossEur`.

Monthly rows add `month: 'YYYY-MM'`; annual rows add numeric `year`. Both use the same fields as `summary`: `clearKwh`, `weatherKwh`, `shadedKwh`, `shadingLossKwh`, `shadingLossPct`, `weatherRetentionPct`, `solarRetentionPct` (shaded/clear), `specificYieldKwhKwp`, `capacityFactorPct`, the four revenue fields above, and hour counts. Full-period weather and shaded totals become `null` if an interval is unknown. `coveredWeatherKwh` and `coveredShadedKwh` remain the observed/modelled subset, without extrapolation. Full-period revenue becomes `null` if any price interval is absent. `pricedClearRevenueEur`, `pricedWeatherRevenueEur`, `pricedShadedRevenueEur` and `pricedShadowRevenueLossEur` expose matching-interval sums. Quality includes expected/weather/priced hours and horizon coverage; warnings propagate.

## Owner-provided validation

`parseOwnerCsv(text)` accepts UTF-8 comma CSV `time,energy_kwh`, or semicolon CSV with decimal commas. `time`/`timestamp`/`interval_start` and `energy_kwh`/`production_kwh`/`kwh` are accepted headers. Values are **15-minute interval energy**, not cumulative meter readings or kW. Times must lie on a 15-minute boundary and include `Z` or a numeric UTC offset; offset-free local times are rejected to avoid DST ambiguity. Negative/empty/non-numeric energy, duplicate times and malformed rows produce errors. The return object has `{ rows, valid, errors, warnings, missingIntervals, intervalMinutes }`; callers should require `valid` before presenting a successful import. Gaps are reported and never filled.

`compareOwnerData(parsedOrRows, analysis)` splits each modelled hour into four equal energy quarters and joins the uploaded intervals only. It returns matched rows, coverage counts, actual/model kWh, MAE, RMSE, mean bias, aggregate bias percentage and normalized MAE. All-zero actual production has an unknown relative error. Uploaded timestamps outside the modeled years and unknown model intervals are counted separately. This compares interval energy under an explicit uniform-within-hour assumption, not observed 15-minute cloud/shadow timing. It never extrapolates uploaded coverage to annual totals. Without owner measurements, validation is `not_testable`; synthetic test fixtures do not validate field performance.

## Primary method references

- [NOAA solar calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html), and the [NREL SPA report](https://www.nrel.gov/docs/fy08osti/34302.pdf), whose independent worked example is used in the angle test.
- [pvlib clear-sky methods](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.haurwitz.html) and [Erbs decomposition](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.erbs.html), used as equation references; pvlib itself is not a JavaScript dependency.
- [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api) for radiation units, preceding-hour means, model/grid resolution and temperature timing.

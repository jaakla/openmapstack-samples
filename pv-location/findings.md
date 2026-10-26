---
schema: openmapstack-findings/v1
project_id: tartu-pv-location
question: Estimate hypothetical PV production, local shadow losses and historical
  energy value with local consumption and optional storage; select bounded Estonian
  contexts and export a reviewable scenario PDF.
run_id: run-20261026-144837
scope: one hypothetical 20 kWp array within the retained manifest AOI, complete UTC
  years 2024 and 2025
validation:
  status: warning
  checks:
  - id: source_hashes_match
    status: passed
  - id: canonical_consumption_is_public_estimate
    status: passed
  - id: canonical_storage_config_explicit
    status: passed
  - id: scenario_geometry_valid
    status: passed
  - id: canonical_context_matches_declared_aoi
    status: passed
  - id: overrides_applied
    status: passed
  - id: horizon_source_coverage
    status: warning
  - id: hourly_coverage_2024
    status: passed
  - id: price_coverage_2024
    status: passed
  - id: energy_ordering_2024
    status: passed
  - id: finite_summary_2024
    status: passed
  - id: prices_matched_2024
    status: passed
  - id: monthly_annual_parity_2024
    status: passed
  - id: consumption_energy_balance_2024
    status: passed
  - id: consumption_coverage_2024
    status: passed
  - id: consumption_value_balance_2024
    status: passed
  - id: consumption_monthly_parity_2024
    status: passed
  - id: storage_energy_balance_2024
    status: passed
  - id: storage_value_balance_2024
    status: passed
  - id: storage_coverage_2024
    status: passed
  - id: storage_disabled_parity_2024
    status: passed
  - id: storage_monthly_parity_2024
    status: passed
  - id: hourly_coverage_2025
    status: passed
  - id: price_coverage_2025
    status: passed
  - id: energy_ordering_2025
    status: passed
  - id: finite_summary_2025
    status: passed
  - id: prices_matched_2025
    status: passed
  - id: monthly_annual_parity_2025
    status: passed
  - id: consumption_energy_balance_2025
    status: passed
  - id: consumption_coverage_2025
    status: passed
  - id: consumption_value_balance_2025
    status: passed
  - id: consumption_monthly_parity_2025
    status: passed
  - id: storage_energy_balance_2025
    status: passed
  - id: storage_value_balance_2025
    status: passed
  - id: storage_coverage_2025
    status: passed
  - id: storage_disabled_parity_2025
    status: passed
  - id: storage_monthly_parity_2025
    status: passed
  - id: owner_15min_field_validation
    status: not_testable
  - id: aerial_pv_detection_validation
    status: not_testable
  - id: government_installation_reconciliation
    status: not_testable
  - id: canonical_pdf_generated
    status: passed
  - id: hosted_table_matches_canonical
    status: passed
validation_report: validation/latest-report.json
context_sha256: sha256:4fb0578b81190fc6365de95360b2f9067ada03fe64a043e59333672691f4ef8b
assumptions:
- id: hypothetical
  statement: The initial 30 × 12 m, 20 kWp array is a hypothetical planning scenario,
    not an observed PV installation or suitability recommendation.
  rationale: 'Issue #4 requests manual polygon planning; the open-surface patch was
    selected from the frozen DSM without inferring rights or engineering suitability.'
- id: metric_crs
  statement: All metric geometry and horizon distances use EPSG:3301; GeoJSON coordinates
    are WGS84 longitude, latitude.
  rationale: Estonia's projected CRS supports metre-based calculations without Web
    Mercator area distortion.
- id: weather
  statement: Hourly ERA5 weather is a grid estimate shared across this bounded pilot;
    it is not site-measured irradiance.
  rationale: Site irradiance and a matching installation have not been independently
    verified for canonical field calibration; private browser uploads do not become
    retained calibration evidence.
- id: surface_time
  statement: The frozen 5 m DSM/DTM download is not asserted contemporaneous with
    either 2024 or 2025.
  rationale: Per-cell LiDAR acquisition dates are not exposed by the selected WCS
    response.
- id: horizon
  statement: Local shadows use equal-weight polygon receiver samples and a 500 m DSM
    horizon at 2° azimuth intervals, with 2 m mounting height initially.
  rationale: A bounded horizon approximation captures major buildings and vegetation
    while remaining interactive; module electrical mismatch is outside scope.
- id: revenue
  statement: Surplus export revenue is exported kWh / 1000 × (EE spot EUR/MWh − sales
    margin); on-site PV avoids imports at spot price plus the explicit import adder.
  rationale: The extended planning scenario separates self-consumption value from
    surplus sales; the original all-generation-export comparison is retained and labeled.
- id: time
  statement: All source and model timestamps use UTC interval starts; weather radiation
    averages are aligned by the acquisition transformation.
  rationale: Explicit interval semantics prevent the one-hour radiation shift and
    daylight-saving duplicate hours.
- id: consumption_profile
  statement: The canonical consumption assumption is 10 kWh during local daytime 07:00–23:00
    and 4 kWh during the remaining local night, in Europe/Tallinn.
  rationale: No household measurements were supplied; this explicit editable planning
    profile supports on-site use estimates without presenting assumed demand as observations.
- id: import_price
  statement: The canonical import-price adder is 0 EUR/MWh, so avoided import cost
    uses spot prices only; VAT and grid fees are not assumed.
  rationale: Actual retail and network contracts were not supplied. A configurable
    adder remains an explicitly user-entered scenario assumption.
- id: consumption_matching
  statement: PV and demand are matched on the model time axis for the comparison without
    storage; optional battery dispatch is reported separately. Missing uploaded demand
    remains unknown unless estimate filling is explicitly enabled.
  rationale: Imports, exports and self-use must balance while preserving uncertainty
    and partial profile coverage.
- id: private_consumption
  statement: Uploaded household consumption is processed in browser memory and excluded
    from the repository and PDF reports; a user-initiated scenario export may explicitly
    include the normalized profile.
  rationale: The public canonical baseline contains only a generic estimate, not personal
    household observations.
- id: pdf_snapshot
  statement: A downloaded scenario PDF describes the current modeled scenario and
    its limitations; the published canonical PDF uses the pinned baseline and canonical
    run time.
  rationale: The report is a reviewable view over the analysis, and does not validate
    a scenario or establish financial returns.
- id: exploratory_aoi
  statement: The canonical source AOI remains the pinned Tartu pilot. Another selected
    Estonian area loads its own bounded terrain and weather context and remains exploratory,
    with request-time provenance.
  rationale: Tartu terrain and weather cannot establish shading or weather at another
    location; live request hashes do not substitute for retained raw source pins.
- id: storage_dispatch
  statement: Storage is explicitly disabled in the canonical baseline. Optional historical
    dispatch uses configured capacity, charge/discharge limits, efficiency, reserve,
    permitted grid charging/export and cycling cost, with finite state resolution
    and historical price knowledge.
  rationale: Storage results are separate from the comparison without storage; perfect
    historical information does not establish live achievable returns or a recommended
    battery size.
- id: storage_capacity
  statement: Automatic battery capacity is twice PV kWp in kWh; the canonical 20 kWp
    array therefore proposes 40 kWh while storage remains disabled.
  rationale: The multiplier is an explicit editable scenario assumption, not an engineering
    or investment recommendation.
- id: private_production
  statement: Private production workbooks and CSVs may be compared in the browser
    using date-matched historical weather, but are not retained in the canonical source
    inputs.
  rationale: Exploratory overlap statistics do not independently verify installation
    location, equipment, meter meaning or model field accuracy. Production values,
    filenames and account identifiers are excluded from weather requests and repository
    evidence.
- id: production_interpolation
  statement: Solarman power-sample comparisons estimate energy by linear interpolation
    between adjacent observations over their actual elapsed time. The editable maximum
    interpolation span defaults to 30 minutes, with longer spans excluded; accepted
    integrals are clipped at UTC hour boundaries.
  rationale: Logging intervals can vary. The observed modal interval is a diagnostic
    separate from the selected interpolation limit. Accepted extended spans, their
    duration and excluded-span duration remain visible; complete-hour comparison statistics
    describe estimated energy rather than metered interval energy or independently
    verified field accuracy.
warnings:
- id: MODEL
  severity: medium
  issue: model
  statement: Energy is an uncalibrated planning estimate from ERA5 and a 5 m horizon
    model. Field accuracy has not been established against an independently verified
    matching installation and retained calibration inputs; private browser uploads
    are not canonical source evidence.
  mitigation: Inspect source provenance and methodology before using the planning
    estimate.
- id: SURFACE
  severity: medium
  issue: surface
  statement: DSM catalog metadata describes acquisition campaigns in 2017–2020; exact
    cell dates are unknown. The frozen 5 m surface may differ from 2024/2025 and omits
    small objects, seasonal foliage and electrical mismatch.
  mitigation: Inspect source provenance and methodology before using the planning
    estimate.
- id: SCOPE
  severity: medium
  issue: scope
  statement: The retained canonical source context is a 2 × 2 km Tartu pilot. Another
    selected Estonian area loads its own bounded source context and remains exploratory;
    missing context is not extrapolated from Tartu.
  mitigation: Inspect source provenance and methodology before using the planning
    estimate.
- id: MARKET
  severity: medium
  issue: market
  statement: Energy value uses explicit consumption and price assumptions; optional
    storage is a separate historical dispatch comparison. Figures exclude taxes, unentered
    grid charges, curtailment and financing. The default import adder is zero, and
    2025 quarter-hour prices are averaged hourly.
  mitigation: Inspect source provenance and methodology before using the planning
    estimate.
- id: LICENSE
  severity: medium
  issue: license
  statement: Elering price-data reuse licensing was not verified in the public API
    documentation; source attribution and the unresolved status are retained.
  mitigation: Inspect source provenance and methodology before using the planning
    estimate.
- id: ML
  severity: medium
  issue: ml
  statement: Aerial PV detection and installation-level government reconciliation
    are not evaluated; available government data are municipality aggregates.
  mitigation: Inspect source provenance and methodology before using the planning
    estimate.
- id: CONSUMPTION
  severity: medium
  issue: assumed_demand
  statement: The published 10 kWh day / 4 kWh night household demand is an estimate,
    not a measured household profile. Partial CSV imports do not establish full-year
    demand or savings.
  mitigation: Use a complete, correctly interpreted Enefit consumption export and
    enter actual import-price components before assessing household savings.
- id: STORAGE
  severity: warning
  issue: model
  statement: Optional battery dispatch uses historical price knowledge, finite state
    resolution and explicit losses/limits; storage is disabled in the canonical baseline.
    The model excludes battery investment and does not guarantee trading returns.
  mitigation: Review demand coverage, operating assumptions and the comparison without
    storage; evaluate actual equipment and tariffs before investment.
findings:
- id: season_2024
  statement: '2024: clear-sky estimate 31780.8 kWh; weather-adjusted shadow-free 19890.7
    kWh; locally shaded 19234.4 kWh. Local shadow loss 656.3 kWh (3.30%). If all generation
    were exported, wholesale revenue after margin would be 1136.90 EUR; the corresponding
    all-export shadow loss would be 58.44 EUR. With the declared day/night consumption
    assumption, demand is 5124.0 kWh, self-consumed PV 2438.2 kWh, surplus export
    16796.2 kWh and grid import 2685.8 kWh. Surplus sales are 943.98 EUR and avoided
    import cost 205.11 EUR, giving net PV benefit 1149.09 EUR. Local shadows reduce
    this combined value by 58.72 EUR versus shadow-free weather. Storage is explicitly
    disabled; the configured capacity would be 40 kWh. The separate storage table
    retains the same imports, exports and benefit with zero dispatch.'
  evidence:
  - seasonal_summary
  - planning_scenario
  - hourly_results
  - storage_summary
  limitations:
  - Hypothetical array and estimated 10 kWh daytime / 4 kWh nighttime local daily
    demand in Europe/Tallinn; daytime is 07:00–23:00. The import adder is 0 EUR/MWh;
    charges are included only when explicitly represented in that adder. Independently
    verified field calibration is not established.
- id: season_2025
  statement: '2025: clear-sky estimate 31969.9 kWh; weather-adjusted shadow-free 18647.6
    kWh; locally shaded 18012.8 kWh. Local shadow loss 634.8 kWh (3.40%). If all generation
    were exported, wholesale revenue after margin would be 759.04 EUR; the corresponding
    all-export shadow loss would be 49.67 EUR. With the declared day/night consumption
    assumption, demand is 5110.0 kWh, self-consumed PV 2417.1 kWh, surplus export
    15595.7 kWh and grid import 2692.9 kWh. Surplus sales are 595.91 EUR and avoided
    import cost 175.22 EUR, giving net PV benefit 771.13 EUR. Local shadows reduce
    this combined value by 49.93 EUR versus shadow-free weather. Storage is explicitly
    disabled; the configured capacity would be 40 kWh. The separate storage table
    retains the same imports, exports and benefit with zero dispatch.'
  evidence:
  - seasonal_summary
  - planning_scenario
  - hourly_results
  - storage_summary
  limitations:
  - Hypothetical array and estimated 10 kWh daytime / 4 kWh nighttime local daily
    demand in Europe/Tallinn; daytime is 07:00–23:00. The import adder is 0 EUR/MWh;
    charges are included only when explicitly represented in that adder. Independently
    verified field calibration is not established.
evidence:
  seasonal_summary:
    definition:
      path: data/derived/seasonal-summary.csv
      format: CSV
      kind: table
      generated_by: export
      table:
        key:
        - year
        columns:
        - name: year
          type: integer
          unit: year
        - name: clearKwh
          type: number
          unit: kWh
        - name: weatherKwh
          type: number
          unit: kWh
        - name: shadedKwh
          type: number
          unit: kWh
        - name: coveredWeatherKwh
          type: number
          unit: kWh
        - name: coveredShadedKwh
          type: number
          unit: kWh
        - name: shadingLossKwh
          type: number
          unit: kWh
        - name: shadingLossPct
          type: number
          unit: '%'
        - name: weatherRetentionPct
          type: number
          unit: '%'
        - name: solarRetentionPct
          type: number
          unit: '%'
        - name: specificYieldKwhKwp
          type: number
          unit: kWh/kWp
        - name: capacityFactorPct
          type: number
          unit: '%'
        - name: expectedHours
          type: number
          unit: h
        - name: intervalHours
          type: number
          unit: h
        - name: weatherHours
          type: number
          unit: h
        - name: shadedHours
          type: number
          unit: h
        - name: pricedHours
          type: number
          unit: h
        - name: negativePriceHours
          type: number
          unit: h
        - name: pricedClearRevenueEur
          type: number
          unit: EUR
        - name: clearRevenueEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: pricedWeatherRevenueEur
          type: number
          unit: EUR
        - name: weatherRevenueEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: pricedShadedRevenueEur
          type: number
          unit: EUR
        - name: shadedRevenueEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: pricedShadowRevenueLossEur
          type: number
          unit: EUR
        - name: shadowRevenueLossEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: coveredConsumptionKwh
          type: number
          unit: kWh
        - name: consumptionKwh
          type: number
          unit: kWh
          description: Modeled demand; imported meter readings remain a demand proxy
            when pre-existing PV supplied unobserved on-site load.
        - name: coveredSelfConsumedKwh
          type: number
          unit: kWh
        - name: selfConsumedKwh
          type: number
          unit: kWh
          description: Modeled PV used on site within matching intervals.
        - name: coveredImportKwh
          type: number
          unit: kWh
        - name: importKwh
          type: number
          unit: kWh
          description: Modeled remaining demand purchased from the grid.
        - name: coveredExportKwh
          type: number
          unit: kWh
        - name: exportKwh
          type: number
          unit: kWh
          description: Surplus modeled PV sold to the grid.
        - name: coveredAvoidedImportCostEur
          type: number
          unit: EUR
        - name: avoidedImportCostEur
          type: number
          unit: EUR
          description: Self-use valued at modeled spot plus the explicit import adder;
            no unentered VAT or grid charge.
        - name: coveredExportRevenueEur
          type: number
          unit: EUR
        - name: exportRevenueEur
          type: number
          unit: EUR
          description: Surplus export valued at modeled spot less sales margin.
        - name: coveredGridImportCostEur
          type: number
          unit: EUR
        - name: gridImportCostEur
          type: number
          unit: EUR
        - name: coveredBaselineImportCostEur
          type: number
          unit: EUR
        - name: baselineImportCostEur
          type: number
          unit: EUR
        - name: coveredNetBenefitEur
          type: number
          unit: EUR
        - name: netBenefitEur
          type: number
          unit: EUR
          description: Avoided import cost plus surplus export revenue, before capital
            cost and unentered charges.
        - name: coveredNetGridCostEur
          type: number
          unit: EUR
        - name: netGridCostEur
          type: number
          unit: EUR
          description: Grid import cost minus surplus export revenue; negative values
            indicate net receipts.
        - name: coveredWeatherSelfConsumedKwh
          type: number
          unit: kWh
        - name: weatherSelfConsumedKwh
          type: number
          unit: kWh
        - name: coveredWeatherImportKwh
          type: number
          unit: kWh
        - name: weatherImportKwh
          type: number
          unit: kWh
        - name: coveredWeatherExportKwh
          type: number
          unit: kWh
        - name: weatherExportKwh
          type: number
          unit: kWh
        - name: coveredWeatherNetBenefitEur
          type: number
          unit: EUR
        - name: weatherNetBenefitEur
          type: number
          unit: EUR
          description: Same demand applied to shadow-free weather production.
        - name: coveredShadowNetBenefitLossEur
          type: number
          unit: EUR
        - name: shadowNetBenefitLossEur
          type: number
          unit: EUR
          description: Shadow-free weather net PV benefit minus locally shaded net
            PV benefit.
        - name: consumptionCoveredHours
          type: number
          unit: h
        - name: consumptionExpectedHours
          type: number
          unit: h
        - name: imputedHours
          type: number
          unit: h
        - name: pricedConsumptionHours
          type: number
          unit: h
        - name: consumptionCoveragePct
          type: number
          unit: '%'
        - name: selfConsumptionPct
          type: number
          unit: '%'
        - name: selfSufficiencyPct
          type: number
          unit: '%'
      downloads:
      - csv
    files:
    - path: data/derived/seasonal-summary.csv
      sha256: sha256:d69c4c9c730bbf6e92488f9013811142514fd4affde245f3b3ea4e8083ccf40b
  planning_scenario:
    definition:
      path: data/derived/planning-scenario.geojson
      format: GeoJSON EPSG:4326
      kind: geodata
      generated_by: export
      crs: EPSG:4326
    files:
    - path: data/derived/planning-scenario.geojson
      sha256: sha256:a10e3c78e6549c65d6e46d0fa300f0aca9b26574c2d06468f8969ab48d5fe420
  hourly_results:
    definition:
      path: data/derived/hourly.csv
      format: CSV
      kind: table
      generated_by: export
      table:
        key:
        - year
        - time
        columns:
        - name: year
          type: integer
          unit: year
        - name: time
          type: datetime
        - name: durationHours
          type: number
          unit: h
        - name: clearKwh
          type: number
          unit: kWh
        - name: weatherKwh
          type: number
          unit: kWh
        - name: shadedKwh
          type: number
          unit: kWh
        - name: shadingLossKwh
          type: number
          unit: kWh
        - name: sunVisibleFraction
          type: number
        - name: priceEurMWh
          type: number
          unit: EUR/MWh
        - name: netPriceEurKwh
          type: number
          unit: EUR/kWh
        - name: temperatureC
          type: number
          unit: °C
        - name: ghi
          type: number
          unit: W/m²
        - name: clearRevenueEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: weatherRevenueEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: shadedRevenueEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: shadowRevenueLossEur
          type: number
          unit: EUR
          description: All-generation-export comparator; use exportRevenueEur and
            netBenefitEur for the consumption scenario.
        - name: coveredConsumptionKwh
          type: number
          unit: kWh
        - name: consumptionKwh
          type: number
          unit: kWh
          description: Modeled demand; imported meter readings remain a demand proxy
            when pre-existing PV supplied unobserved on-site load.
        - name: coveredSelfConsumedKwh
          type: number
          unit: kWh
        - name: selfConsumedKwh
          type: number
          unit: kWh
          description: Modeled PV used on site within matching intervals.
        - name: coveredImportKwh
          type: number
          unit: kWh
        - name: importKwh
          type: number
          unit: kWh
          description: Modeled remaining demand purchased from the grid.
        - name: coveredExportKwh
          type: number
          unit: kWh
        - name: exportKwh
          type: number
          unit: kWh
          description: Surplus modeled PV sold to the grid.
        - name: coveredAvoidedImportCostEur
          type: number
          unit: EUR
        - name: avoidedImportCostEur
          type: number
          unit: EUR
          description: Self-use valued at modeled spot plus the explicit import adder;
            no unentered VAT or grid charge.
        - name: coveredExportRevenueEur
          type: number
          unit: EUR
        - name: exportRevenueEur
          type: number
          unit: EUR
          description: Surplus export valued at modeled spot less sales margin.
        - name: coveredGridImportCostEur
          type: number
          unit: EUR
        - name: gridImportCostEur
          type: number
          unit: EUR
        - name: coveredBaselineImportCostEur
          type: number
          unit: EUR
        - name: baselineImportCostEur
          type: number
          unit: EUR
        - name: coveredNetBenefitEur
          type: number
          unit: EUR
        - name: netBenefitEur
          type: number
          unit: EUR
          description: Avoided import cost plus surplus export revenue, before capital
            cost and unentered charges.
        - name: coveredNetGridCostEur
          type: number
          unit: EUR
        - name: netGridCostEur
          type: number
          unit: EUR
          description: Grid import cost minus surplus export revenue; negative values
            indicate net receipts.
        - name: coveredWeatherSelfConsumedKwh
          type: number
          unit: kWh
        - name: weatherSelfConsumedKwh
          type: number
          unit: kWh
        - name: coveredWeatherImportKwh
          type: number
          unit: kWh
        - name: weatherImportKwh
          type: number
          unit: kWh
        - name: coveredWeatherExportKwh
          type: number
          unit: kWh
        - name: weatherExportKwh
          type: number
          unit: kWh
        - name: coveredWeatherNetBenefitEur
          type: number
          unit: EUR
        - name: weatherNetBenefitEur
          type: number
          unit: EUR
          description: Same demand applied to shadow-free weather production.
        - name: coveredShadowNetBenefitLossEur
          type: number
          unit: EUR
        - name: shadowNetBenefitLossEur
          type: number
          unit: EUR
          description: Shadow-free weather net PV benefit minus locally shaded net
            PV benefit.
        - name: consumptionCoveredHours
          type: number
          unit: h
        - name: consumptionExpectedHours
          type: number
          unit: h
        - name: imputedHours
          type: number
          unit: h
        - name: pricedConsumptionHours
          type: number
          unit: h
        - name: consumptionCoveragePct
          type: number
          unit: '%'
        - name: selfConsumptionPct
          type: number
          unit: '%'
        - name: selfSufficiencyPct
          type: number
          unit: '%'
      downloads:
      - csv
    files:
    - path: data/derived/hourly.csv
      sha256: sha256:63421e282fe8bde4c4b603afb15a8e5d8442a52a5d2e9d8211f0b830dc9c34d0
  storage_summary:
    definition:
      path: data/derived/storage-summary.csv
      format: CSV
      kind: table
      generated_by: export
      table:
        columns:
        - name: year
          type: integer
        - name: pvKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: demandKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: pvDirectSelfConsumedKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: chargeKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: chargePvKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: chargeGridKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: dischargeKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: dischargeToLoadKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: dischargeToGridKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: pvBatteryToLoadKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: gridBatteryToLoadKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: pvBatteryToGridKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: gridBatteryToGridKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: chargeLossKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: dischargeLossKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: lossKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: internalChargedKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: internalDischargedKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: importKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: exportKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: pvSelfConsumedKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: gridImportCostEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: exportRevenueEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: cyclingCostEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: netGridCostEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: operatingCostEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: baselineImportCostEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: noBatteryNetGridCostEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: noBatteryNetBenefitEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: netBenefitEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: incrementalBenefitEur
          type: number
          unit: EUR
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: coveredPvKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredDemandKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredPvDirectSelfConsumedKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredChargeKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredChargePvKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredChargeGridKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredDischargeKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredDischargeToLoadKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredDischargeToGridKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredPvBatteryToLoadKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredGridBatteryToLoadKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredPvBatteryToGridKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredGridBatteryToGridKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredChargeLossKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredDischargeLossKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredLossKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredInternalChargedKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredInternalDischargedKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredImportKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredExportKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredPvSelfConsumedKwh
          type: number
          unit: kWh
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredGridImportCostEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredExportRevenueEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredCyclingCostEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredNetGridCostEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredOperatingCostEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredBaselineImportCostEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredNoBatteryNetGridCostEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredNoBatteryNetBenefitEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredNetBenefitEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: coveredIncrementalBenefitEur
          type: number
          unit: EUR
          description: Total over matched intervals only; not extrapolated to missing
            periods.
        - name: expectedHours
          type: number
          unit: h
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: coveredHours
          type: number
          unit: h
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: socStartKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: socEndKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: maxSocKwh
          type: number
          unit: kWh
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: selfConsumptionPct
          type: number
          unit: '%'
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: selfSufficiencyPct
          type: number
          unit: '%'
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: coveragePct
          type: number
          unit: '%'
          description: Separate optional-storage comparison; full-period energy/value
            is unknown when coverage is incomplete.
        - name: pvSocEndKwh
          type: number
          unit: kWh
          description: Usable stored energy attributed to PV or grid input at the
            end of the period; excludes reserve.
        - name: gridSocEndKwh
          type: number
          unit: kWh
          description: Usable stored energy attributed to PV or grid input at the
            end of the period; excludes reserve.
        key:
        - year
      downloads:
      - csv
    files:
    - path: data/derived/storage-summary.csv
      sha256: sha256:1131544e3f1e165bef094b3ddd6d3603a1edff97fffd7b2c82de786e6dbfa78b
---
# Findings

Estimate hypothetical PV production, local shadow losses and historical energy value with local consumption and optional storage; select bounded Estonian contexts and export a reviewable scenario PDF.

Scope: one hypothetical 20 kWp array within the retained manifest AOI, complete UTC years 2024 and 2025. Run: `run-20261026-144837`. Validation: **warning**.

## season_2024

2024: clear-sky estimate 31780.8 kWh; weather-adjusted shadow-free 19890.7 kWh; locally shaded 19234.4 kWh. Local shadow loss 656.3 kWh (3.30%). If all generation were exported, wholesale revenue after margin would be 1136.90 EUR; the corresponding all-export shadow loss would be 58.44 EUR. With the declared day/night consumption assumption, demand is 5124.0 kWh, self-consumed PV 2438.2 kWh, surplus export 16796.2 kWh and grid import 2685.8 kWh. Surplus sales are 943.98 EUR and avoided import cost 205.11 EUR, giving net PV benefit 1149.09 EUR. Local shadows reduce this combined value by 58.72 EUR versus shadow-free weather. Storage is explicitly disabled; the configured capacity would be 40 kWh. The separate storage table retains the same imports, exports and benefit with zero dispatch.

Evidence:

- [seasonal_summary](data/derived/seasonal-summary.csv)
- [planning_scenario](data/derived/planning-scenario.geojson)
- [hourly_results](data/derived/hourly.csv)
- [storage_summary](data/derived/storage-summary.csv)

Limitation: Hypothetical array and estimated 10 kWh daytime / 4 kWh nighttime local daily demand in Europe/Tallinn; daytime is 07:00–23:00. The import adder is 0 EUR/MWh; charges are included only when explicitly represented in that adder. Independently verified field calibration is not established.

## season_2025

2025: clear-sky estimate 31969.9 kWh; weather-adjusted shadow-free 18647.6 kWh; locally shaded 18012.8 kWh. Local shadow loss 634.8 kWh (3.40%). If all generation were exported, wholesale revenue after margin would be 759.04 EUR; the corresponding all-export shadow loss would be 49.67 EUR. With the declared day/night consumption assumption, demand is 5110.0 kWh, self-consumed PV 2417.1 kWh, surplus export 15595.7 kWh and grid import 2692.9 kWh. Surplus sales are 595.91 EUR and avoided import cost 175.22 EUR, giving net PV benefit 771.13 EUR. Local shadows reduce this combined value by 49.93 EUR versus shadow-free weather. Storage is explicitly disabled; the configured capacity would be 40 kWh. The separate storage table retains the same imports, exports and benefit with zero dispatch.

Evidence:

- [seasonal_summary](data/derived/seasonal-summary.csv)
- [planning_scenario](data/derived/planning-scenario.geojson)
- [hourly_results](data/derived/hourly.csv)
- [storage_summary](data/derived/storage-summary.csv)

Limitation: Hypothetical array and estimated 10 kWh daytime / 4 kWh nighttime local daily demand in Europe/Tallinn; daytime is 07:00–23:00. The import adder is 0 EUR/MWh; charges are included only when explicitly represented in that adder. Independently verified field calibration is not established.

## Assumptions and limitations

- The initial 30 × 12 m, 20 kWp array is a hypothetical planning scenario, not an observed PV installation or suitability recommendation. Issue #4 requests manual polygon planning; the open-surface patch was selected from the frozen DSM without inferring rights or engineering suitability.
- All metric geometry and horizon distances use EPSG:3301; GeoJSON coordinates are WGS84 longitude, latitude. Estonia's projected CRS supports metre-based calculations without Web Mercator area distortion.
- Hourly ERA5 weather is a grid estimate shared across this bounded pilot; it is not site-measured irradiance. Site irradiance and a matching installation have not been independently verified for canonical field calibration; private browser uploads do not become retained calibration evidence.
- The frozen 5 m DSM/DTM download is not asserted contemporaneous with either 2024 or 2025. Per-cell LiDAR acquisition dates are not exposed by the selected WCS response.
- Local shadows use equal-weight polygon receiver samples and a 500 m DSM horizon at 2° azimuth intervals, with 2 m mounting height initially. A bounded horizon approximation captures major buildings and vegetation while remaining interactive; module electrical mismatch is outside scope.
- Surplus export revenue is exported kWh / 1000 × (EE spot EUR/MWh − sales margin); on-site PV avoids imports at spot price plus the explicit import adder. The extended planning scenario separates self-consumption value from surplus sales; the original all-generation-export comparison is retained and labeled.
- All source and model timestamps use UTC interval starts; weather radiation averages are aligned by the acquisition transformation. Explicit interval semantics prevent the one-hour radiation shift and daylight-saving duplicate hours.
- The canonical consumption assumption is 10 kWh during local daytime 07:00–23:00 and 4 kWh during the remaining local night, in Europe/Tallinn. No household measurements were supplied; this explicit editable planning profile supports on-site use estimates without presenting assumed demand as observations.
- The canonical import-price adder is 0 EUR/MWh, so avoided import cost uses spot prices only; VAT and grid fees are not assumed. Actual retail and network contracts were not supplied. A configurable adder remains an explicitly user-entered scenario assumption.
- PV and demand are matched on the model time axis for the comparison without storage; optional battery dispatch is reported separately. Missing uploaded demand remains unknown unless estimate filling is explicitly enabled. Imports, exports and self-use must balance while preserving uncertainty and partial profile coverage.
- Uploaded household consumption is processed in browser memory and excluded from the repository and PDF reports; a user-initiated scenario export may explicitly include the normalized profile. The public canonical baseline contains only a generic estimate, not personal household observations.
- A downloaded scenario PDF describes the current modeled scenario and its limitations; the published canonical PDF uses the pinned baseline and canonical run time. The report is a reviewable view over the analysis, and does not validate a scenario or establish financial returns.
- The canonical source AOI remains the pinned Tartu pilot. Another selected Estonian area loads its own bounded terrain and weather context and remains exploratory, with request-time provenance. Tartu terrain and weather cannot establish shading or weather at another location; live request hashes do not substitute for retained raw source pins.
- Storage is explicitly disabled in the canonical baseline. Optional historical dispatch uses configured capacity, charge/discharge limits, efficiency, reserve, permitted grid charging/export and cycling cost, with finite state resolution and historical price knowledge. Storage results are separate from the comparison without storage; perfect historical information does not establish live achievable returns or a recommended battery size.
- Automatic battery capacity is twice PV kWp in kWh; the canonical 20 kWp array therefore proposes 40 kWh while storage remains disabled. The multiplier is an explicit editable scenario assumption, not an engineering or investment recommendation.
- Private production workbooks and CSVs may be compared in the browser using date-matched historical weather, but are not retained in the canonical source inputs. Exploratory overlap statistics do not independently verify installation location, equipment, meter meaning or model field accuracy. Production values, filenames and account identifiers are excluded from weather requests and repository evidence.
- Solarman power-sample comparisons estimate energy by linear interpolation between adjacent observations over their actual elapsed time. The editable maximum interpolation span defaults to 30 minutes, with longer spans excluded; accepted integrals are clipped at UTC hour boundaries. Logging intervals can vary. The observed modal interval is a diagnostic separate from the selected interpolation limit. Accepted extended spans, their duration and excluded-span duration remain visible; complete-hour comparison statistics describe estimated energy rather than metered interval energy or independently verified field accuracy.
- Energy is an uncalibrated planning estimate from ERA5 and a 5 m horizon model. Field accuracy has not been established against an independently verified matching installation and retained calibration inputs; private browser uploads are not canonical source evidence.
- DSM catalog metadata describes acquisition campaigns in 2017–2020; exact cell dates are unknown. The frozen 5 m surface may differ from 2024/2025 and omits small objects, seasonal foliage and electrical mismatch.
- The retained canonical source context is a 2 × 2 km Tartu pilot. Another selected Estonian area loads its own bounded source context and remains exploratory; missing context is not extrapolated from Tartu.
- Energy value uses explicit consumption and price assumptions; optional storage is a separate historical dispatch comparison. Figures exclude taxes, unentered grid charges, curtailment and financing. The default import adder is zero, and 2025 quarter-hour prices are averaged hourly.
- Elering price-data reuse licensing was not verified in the public API documentation; source attribution and the unresolved status are retained.
- Aerial PV detection and installation-level government reconciliation are not evaluated; available government data are municipality aggregates.
- The published 10 kWh day / 4 kWh night household demand is an estimate, not a measured household profile. Partial CSV imports do not establish full-year demand or savings.
- Optional battery dispatch uses historical price knowledge, finite state resolution and explicit losses/limits; storage is disabled in the canonical baseline. The model excludes battery investment and does not guarantee trading returns.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)

---
schema: openmapstack-findings/v1
project_id: tallinn-tram-options
question: Tallinn has been discussing several options for a new tram line, with different
  routes. Analyse them in depth and provide a dashboard of the options, considering
  population, services, general strategies and plans.
run_id: run-20261124-072758
scope: 13 tram line options inside Tallinn, measured at a 500 m network walk to modelled
  stops; population 2024, other data November 2026
validation:
  status: warning
  checks:
  - id: geometry_valid
    status: passed
  - id: crs_known
    status: passed
  - id: row_count_gt_zero
    status: passed
  - id: no_duplicate_option
    status: passed
  - id: no_null_option
    status: passed
  - id: source_semantics_verified
    status: passed
  - id: source_result_complete
    status: passed
  - id: source_licenses_resolved
    status: warning
  - id: overrides_applied
    status: passed
  - id: manifest_graph_resolves
    status: passed
  - id: view_controls_match_pipeline
    status: passed
  - id: population_conserved
    status: warning
  - id: tallinn_population_plausible
    status: passed
  - id: population_matches_register
    status: passed
  - id: network_connected
    status: passed
  - id: options_follow_declared_streets
    status: passed
  - id: options_match_published_corridors
    status: warning
  - id: option_length_plausible
    status: passed
  - id: option_stops_on_network
    status: passed
  - id: catchments_monotonic
    status: passed
  - id: new_not_more_than_total
    status: passed
  - id: scores_consistent
    status: passed
  - id: table_totals_consistent
    status: passed
  - id: manifest_report_parity
    status: passed
validation_report: validation/latest-report.json
context_sha256: sha256:596ab5a4af36708783471e4e714ea32624a38d037eab24cc65e0c58e2bf5f4e8
assumptions:
- id: A1
  statement: 'The options are the 13 alignments in scenarios/tram-options.yaml: the
    lines and variants discussed in city documents and news between 2019 and November
    2026 that lie inside Tallinn. Lines to Viimsi, Peetri/Jüri, Maardu and Tabasalu
    are left out.'
  rationale: The building register layer used for residents and workplaces covers
    Tallinn only, so a line outside the city could not be measured on the same basis.
- id: A2
  statement: A place is within reach of a stop when the walk along the path network
    is at most 500 m (about 6 minutes at 4.8 km/h), including the straight-line gaps
    between the building or stop and the nearest path. Distances of 300, 400, 600
    and 800 m are also computed.
  rationale: 400-500 m is the usual planning catchment of a tram stop; the Tallinn
    2035 strategy uses 400 m. The other distances let the reader test the sensitivity.
- id: A3
  statement: Stops of a proposed line are modelled every 500 m along it, with a stop
    at each end. A modelled stop within 80 m of an existing tram stop is treated as
    that stop.
  rationale: Stop locations are published for almost none of the options. 500 m is
    close to the spacing of the existing network. Modelled stops are not planned stop
    locations.
- id: A4
  statement: Each line is the shortest path between its declared waypoints over the
    street network, with streets the option does not name costing 8 times their length.
    Where the described corridor has no street (the Putukaväil corridor, the planned
    Rahu tee) a named stand-in street or the city's published corridor drawing is
    used, and the option says so.
  rationale: The sources describe alignments by street names, not coordinates. Routing
    by name on real geometry avoids hand-drawn lines and can be checked against the
    corridors the city has published.
- id: A5
  statement: 'Residents per building are estimated: the population of each Statistics
    Estonia 1 km grid cell (2024) is shared among the existing registered dwellings
    in the cell in proportion to their net floor area. Where Tallinn holds less than
    half of a boundary cell, only that share of the cell''s population is allocated.'
  rationale: No open dataset gives residents per building. The grid fixes the totals
    per square kilometre; registered dwelling floor area is the best open proxy inside
    a cell.
- id: A6
  statement: 'Workplaces and destinations are measured as the net floor area of existing
    registered non-residential buildings: hospitality, offices, retail and services,
    transport and communication buildings, industry and warehouses, and public buildings.
    Garages and outbuildings are not counted. Floor area is a proxy, not a count of
    jobs.'
  rationale: No open dataset gives jobs at building or block level in Tallinn.
- id: A7
  statement: 'Development in preparation is measured two ways: the floor area of registered
    dwellings that are planned or under construction, and the area of detailed plans
    in process (initiated, adopted for display or applied for) inside the drawn catchment.
    The growth criterion is the average of the two, each relative to the best option.'
  rationale: Neither measure is a forecast of new residents. Planned buildings appear
    in the layer only once they have a footprint; a plan in process says where development
    is being prepared, not how much.
- id: A8
  statement: 'The score is a weighted sum of seven criteria, each expressed as the
    option''s value divided by the best option''s value: residents newly in reach,
    all residents in reach, workplace floor area, public services, growth, residents
    in reach per km of new track, and strategy fit. The accepted weighting is ''balanced''
    (20, 10, 15, 10, 15, 15, 15 %); four other weightings are published.'
  rationale: The question asks to consider population, services, strategies and plans
    together; any single ranking needs weights. The weights are a judgement, so the
    alternatives are computed by the pipeline and shown next to the accepted one.
- id: A9
  statement: 'Strategy fit (0-3) is the sum of three scores of 0-1 recorded per option
    with their sources: its place in the mobility plan SUMP 2035, its stage in the
    2019 feasibility study, and the city government''s position in 2026.'
  rationale: Strategies and political decisions are documents, not geodata. A fixed
    rubric applied to every option, with the evidence listed, keeps the judgement
    inspectable.
- id: A10
  statement: Published costs and ridership are quoted per option for reference and
    are not part of the score.
  rationale: The estimates come from different years (2019 to 2026), price levels
    and alignments, and are missing for some options.
warnings:
- id: SCENARIO-001
  severity: high
  layer: tram_options
  issue: hypothetical_alignments
  statement: Every proposed line is a modelled reading of public descriptions, routed
    along the street network. It is not a designed track alignment, and the stops,
    placed every 500 m, are not planned stops. Results near the ends of a line and
    for short lines depend most on these choices.
  mitigation: Use the results to compare corridors, not to judge a design. Replace
    an option with surveyed design geometry in data/overrides when it is published.
- id: METHOD-001
  severity: medium
  layer: option_scores
  issue: score_depends_on_weights
  statement: The ranking depends on the weights and on which criteria are included.
    Longer lines reach more people in total; the per-kilometre criterion only partly
    offsets that. Ridership, travel time, construction cost and traffic effects are
    not modelled.
  mitigation: Compare the five published weightings and read the indicators themselves;
    do not treat one score as a cost-benefit result.
- id: METHOD-002
  severity: medium
  layer: buildings
  issue: population_is_estimated
  statement: Residents per building are estimated from the 2024 1 km population grid
    and registered dwelling floor area. Totals per grid cell are official; the split
    inside a cell is a model. Workplace floor area is a proxy for jobs and visitors,
    not a count.
  mitigation: Read differences between options of a few hundred residents as ties.
- id: METHOD-003
  severity: medium
  layer: tram_options
  issue: strategy_fit_is_a_judgement
  statement: Strategy fit is a rubric applied by the analyst to documents and news
    up to 24 November 2026. Political positions change; the Liivalaia and Pelguranna
    decisions both changed within the last year.
  mitigation: Check the evidence listed for each option and update scenarios/tram-options.yaml
    when a decision changes.
- id: DATA-001
  severity: medium
  layer: pipeline_buildings
  issue: growth_indicators_incomplete
  statement: Planned and under-construction buildings are in the layer only when they
    already have a footprint in the topographic database, and detailed plans in process
    carry no dwelling numbers. Large future districts such as the former Kopli goods
    station are therefore under-represented.
  mitigation: Treat the growth criterion as indicative; add planned capacities from
    the comprehensive plans when they are published as data.
- id: DATA-002
  severity: low
  layer: buildings
  issue: license_not_stated
  statement: The Tallinn city ArcGIS services and the GTFS feed do not publish explicit
    licence text for these layers.
  mitigation: Confirm reuse terms with Tallinn City Government before redistributing
    the source snapshots.
- id: DATA-003
  severity: low
  layer: buildings
  issue: temporal_mismatch
  statement: Population refers to 2024; buildings, plans, services, timetables and
    the street network to November 2026. Homes completed after 2024 carry too few
    residents.
  mitigation: Rerun when Statistics Estonia publishes a newer grid.
findings:
- id: ranking
  evidence:
  - option_summary
  - option_scores
  statement: 'With the balanced weighting and a 500 m walk to a stop, the highest-scoring
    of the 13 options are Lasnamäe – Gonsiori and Laagna tee (67.1 of 100); Mustamäe
    – Sõpruse pst to Ehitajate tee (59.5 of 100); Sõle – Kristiine to Kopli line (59.0
    of 100). The top option changes with the weighting: Balanced: Lasnamäe – Gonsiori
    and Laagna tee; People first: Lasnamäe – Gonsiori and Laagna tee; Growth and jobs:
    Sõle – Kristiine to Kopli line; Plan-led: Lasnamäe – Narva mnt and the Rahu tee
    corridor; Value per km: Mustamäe – Sõpruse pst to Ehitajate tee. Options that
    stay in the top five under all five weightings: Sõle – Kristiine to Kopli line.'
  limitations:
  - The score is a declared weighting of seven indicators, not a cost-benefit result;
    ridership, travel time and construction cost are not modelled.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: existing_network
  evidence:
  - existing_tram_coverage
  statement: Today 66 407 residents, 14.6 % of an estimated 454 042, live within a
    500 m walk of one of the 81 existing tram stops.
  limitations:
  - Residents per building are estimated from the 2024 1 km population grid and registered
    dwelling floor area.
- id: new_coverage
  evidence:
  - option_summary
  - option_matrix
  statement: 'Mustamäe – Sõpruse pst to Ehitajate tee would bring the most residents
    newly within reach of a tram: 32 600 over 5.0 km of new track. Kristiine – Kaarli
    pst, Estonia pst, Gonsiori reaches the most workplace floor area (898 thousand
    m²), and Liivalaia – Pärnu mnt to Tartu mnt the most residents per kilometre (7
    990).'
  limitations:
  - Workplace floor area is a proxy for jobs and visitors, not a count.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: pelguranna
  evidence:
  - option_matrix
  - option_summary
  statement: The funded Pelguranna route (Putukaväil to Kolde pst, modelled 1.83 km)
    puts 10 254 residents within 500 m, 9 135 of them not near a tram today. The route
    dropped in February 2026 (Puhangu to Stroomi park, 2.11 km) would reach 13 166
    and 12 326. The funded route has the highest strategy fit of all options (2.50
    of 3) but ranks 11 of 13 on the balanced score.
  limitations:
  - Beyond Sõle the funded route runs in a corridor with no mapped street; the parallel
    part of Puhangu street stands in for it, up to 100 m away.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: city_centre_link
  evidence:
  - option_summary
  - option_matrix
  statement: 'The abandoned Liivalaia section (1.34 km) and the Kaarli pst – Estonia
    pst alternative (1.91 km) both run through areas already served: only 4 619 and
    4 702 residents would be newly within reach. Their strength is destinations: 765
    and 898 thousand m² of workplace floor area. Extending the Liivalaia line to Kristiine
    raises newly reached residents to 8 870.'
  limitations:
  - A link through the centre mainly shortens journeys and relieves existing lines;
    this analysis measures reach only.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: lasnamae
  evidence:
  - option_summary
  - option_matrix
  statement: In Lasnamäe the Laagna tee corridor reaches 35 047 residents (28 203
    new) and the Rahu tee corridor 29 748 (26 859 new). The city has chosen trolleybuses
    for Laagna tee, which leaves it a strategy fit of 1.00 against 2.00 for the Rahu
    tee corridor.
  limitations:
  - The Rahu tee line follows the city's published corridor drawing because the street
    is not built.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: jarve
  evidence:
  - option_summary
  statement: The Järve extension (1.70 km) would bring 677 residents newly within
    reach, the fewest of all options, and ranks 13 of 13; it serves 326 thousand m²
    of workplace floor area around Järve keskus.
  limitations:
  - Park-and-ride and interchange with the railway, which the 2022 study names as
    the purpose of this line, are not measured.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: strategy
  evidence:
  - option_summary
  - tram_options
  statement: Strategy fit and measured reach point in different directions. Pelguranna
    – Putukaväil to Kolde pst has the highest strategy fit (2.50 of 3) and ranks 11
    on the balanced score; the top-ranked option, Lasnamäe – Gonsiori and Laagna tee,
    has a strategy fit of 1.00.
  limitations:
  - Strategy fit is a rubric applied to documents and news up to 24 November 2026;
    positions change.
evidence:
  option_summary:
    definition:
      path: data/derived/option-summary.csv
      format: CSV
      kind: table
      generated_by: summarise
      table:
        key:
        - option
        columns:
        - name: rank_balanced
          type: integer
          label: Rank (balanced)
        - &id001
          name: option
          type: string
          label: Option
        - name: title
          type: string
          label: Line
        - name: family
          type: string
          label: Area
        - name: status_label
          type: string
          label: Status
        - name: score_balanced
          type: number
          label: Score (balanced)
          unit: points of 100
        - &id003
          name: length_km
          type: number
          label: New track (modelled)
          unit: km
        - name: published_length_km
          type: number
          label: Published length
          unit: km
        - &id002
          name: catchment_m
          type: integer
          label: Walk to stop
          unit: m
        - &id004
          name: stops_modelled
          type: integer
          label: Stops (modelled)
        - &id005
          name: stops_new
          type: integer
          label: New stops (modelled)
        - &id006
          name: residents
          type: integer
          label: Residents in reach
          unit: residents
        - &id007
          name: residents_new
          type: integer
          label: Residents newly in reach of a tram
          unit: residents
        - &id008
          name: workplace_floor_m2
          type: integer
          label: Workplace floor area in reach
          unit: m2
        - &id009
          name: workplace_floor_new_m2
          type: integer
          label: Workplace floor area newly in reach
          unit: m2
        - &id010
          name: pipeline_home_m2
          type: integer
          label: Homes planned or under construction
          unit: m2
        - &id011
          name: pipeline_work_m2
          type: integer
          label: Workplaces planned or under construction
          unit: m2
        - &id012
          name: plans_in_process_ha
          type: number
          label: Detailed plans in process
          unit: ha
        - &id013
          name: services
          type: integer
          label: Public services in reach
        - &id014
          name: svc_school
          type: integer
          label: Schools
        - &id015
          name: svc_kindergarten
          type: integer
          label: Kindergartens
        - &id016
          name: svc_higher_education
          type: integer
          label: Higher and vocational education
        - &id017
          name: svc_hospital
          type: integer
          label: Hospitals
        - &id018
          name: svc_pharmacy
          type: integer
          label: Pharmacies
        - &id019
          name: svc_shopping
          type: integer
          label: Shopping centres and markets
        - &id020
          name: svc_library
          type: integer
          label: Libraries
        - &id021
          name: bus_departures_weekday
          type: integer
          label: Bus departures along the line
          unit: departures per weekday
        - &id022
          name: residents_per_km
          type: integer
          label: Residents in reach per km
          unit: residents per km
        - &id023
          name: residents_new_per_km
          type: integer
          label: Newly reached residents per km
          unit: residents per km
        - &id024
          name: published_cost_meur
          type: number
          label: Published cost estimate
          unit: million EUR
        - &id025
          name: published_cost_year
          type: integer
          label: Price year of the estimate
        - &id026
          name: published_cost_meur_per_km
          type: number
          label: Published cost per modelled km
          unit: million EUR per km
        - &id027
          name: strategy_fit
          type: number
          label: Strategy fit (0-3)
        - &id028
          name: plan_corridor_share_pct
          type: integer
          label: In a planning-document corridor
          unit: '%'
        - &id029
          name: study_2019_share_pct
          type: integer
          label: In a 2019 study corridor
          unit: '%'
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/option-summary.csv
      sha256: sha256:245a1c3cb582916f232a2f06a08c539c382708b1a7401f0c6bc9475e0303a5d1
    - path: data/derived/option-summary.xlsx
      sha256: sha256:cc8a97e10622e7f4eb35eccda4e41093bbbc52b800266b1c9001d5661a307e72
  option_scores:
    definition:
      path: data/derived/option-scores.csv
      format: CSV
      kind: table
      generated_by: score_options
      table:
        key:
        - option
        - catchment_m
        - profile
        columns:
        - *id001
        - *id002
        - name: profile
          type: string
          label: Weighting
        - name: score
          type: number
          label: Score
          unit: points of 100
        - name: rank
          type: integer
          label: Rank
        - name: canonical
          type: boolean
          label: Accepted setting
        - name: c_new_residents
          type: number
          label: 'Criterion: new residents (0-1)'
        - name: c_residents
          type: number
          label: 'Criterion: residents (0-1)'
        - name: c_workplaces
          type: number
          label: 'Criterion: workplaces (0-1)'
        - name: c_services
          type: number
          label: 'Criterion: services (0-1)'
        - name: c_growth
          type: number
          label: 'Criterion: growth (0-1)'
        - name: c_efficiency
          type: number
          label: 'Criterion: efficiency (0-1)'
        - name: c_strategy
          type: number
          label: 'Criterion: strategy (0-1)'
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/option-scores.csv
      sha256: sha256:92bc1f59e6f0b37566f9b8d18a94d60e42f6b21a7746279efc99decce290c316
    - path: data/derived/option-scores.xlsx
      sha256: sha256:d24244481156532d62de7af0722a9ecb23786bde41bb71ff22f88e1771f9649a
  existing_tram_coverage:
    definition:
      path: data/derived/existing-tram-coverage.csv
      format: CSV
      kind: table
      generated_by: summarise
      table:
        key:
        - catchment_m
        columns:
        - *id002
        - name: tram_stops
          type: integer
          label: Tram stops
        - name: residents
          type: integer
          label: Residents in reach
          unit: residents
        - name: share_of_city_pct
          type: number
          label: Share of residents
          unit: '%'
        - name: workplace_floor_m2
          type: integer
          label: Workplace floor area in reach
          unit: m2
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/existing-tram-coverage.csv
      sha256: sha256:3009770278bd37dd08f464bceb463bcfd74ff0495a76f717d466ca68698656a6
    - path: data/derived/existing-tram-coverage.xlsx
      sha256: sha256:61c9a8de5944b2ea9b2c8d6942a85cb77d4091ef77623c6aaa2c1bd47cdfef9c
  option_matrix:
    definition:
      path: data/derived/option-matrix.csv
      format: CSV
      kind: table
      generated_by: summarise
      table:
        key:
        - option
        - catchment_m
        columns:
        - *id001
        - *id002
        - name: canonical
          type: boolean
          label: Accepted setting
        - *id003
        - *id004
        - *id005
        - *id006
        - *id007
        - *id008
        - *id009
        - *id010
        - *id011
        - *id012
        - *id013
        - *id014
        - *id015
        - *id016
        - *id017
        - *id018
        - *id019
        - *id020
        - *id021
        - *id022
        - *id023
        - *id024
        - *id025
        - *id026
        - *id027
        - *id028
        - *id029
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/option-matrix.csv
      sha256: sha256:45601144e442bd065cc7723b5397e9d00e6574a79272f097d10f83e0d9908431
    - path: data/derived/option-matrix.xlsx
      sha256: sha256:1f32a862f0bb9a75a40f0118b16e9931edbc617c03b65d73547a8c4c8587a96c
  tram_options:
    definition:
      path: data/derived/tram-options.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: summarise
      note: HYPOTHETICAL lines routed from scenarios/tram-options.yaml, with the indicators
        of the accepted setting.
    files:
    - path: data/derived/tram-options.geojson
      sha256: sha256:e3dda1f3d5315c1012e880989ea62bdac41a556f6696da2e0bf57969f4896a22
---
# Findings

Tallinn has been discussing several options for a new tram line, with different routes. Analyse them in depth and provide a dashboard of the options, considering population, services, general strategies and plans.

Scope: 13 tram line options inside Tallinn, measured at a 500 m network walk to modelled stops; population 2024, other data November 2026. Run: `run-20261124-072758`. Validation: **warning**.

## ranking

With the balanced weighting and a 500 m walk to a stop, the highest-scoring of the 13 options are Lasnamäe – Gonsiori and Laagna tee (67.1 of 100); Mustamäe – Sõpruse pst to Ehitajate tee (59.5 of 100); Sõle – Kristiine to Kopli line (59.0 of 100). The top option changes with the weighting: Balanced: Lasnamäe – Gonsiori and Laagna tee; People first: Lasnamäe – Gonsiori and Laagna tee; Growth and jobs: Sõle – Kristiine to Kopli line; Plan-led: Lasnamäe – Narva mnt and the Rahu tee corridor; Value per km: Mustamäe – Sõpruse pst to Ehitajate tee. Options that stay in the top five under all five weightings: Sõle – Kristiine to Kopli line.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_scores](data/derived/option-scores.csv)
- [option_scores (xlsx)](data/derived/option-scores.xlsx)

Limitation: The score is a declared weighting of seven indicators, not a cost-benefit result; ridership, travel time and construction cost are not modelled.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## existing_network

Today 66 407 residents, 14.6 % of an estimated 454 042, live within a 500 m walk of one of the 81 existing tram stops.

Evidence:

- [existing_tram_coverage](data/derived/existing-tram-coverage.csv)
- [existing_tram_coverage (xlsx)](data/derived/existing-tram-coverage.xlsx)

Limitation: Residents per building are estimated from the 2024 1 km population grid and registered dwelling floor area.

## new_coverage

Mustamäe – Sõpruse pst to Ehitajate tee would bring the most residents newly within reach of a tram: 32 600 over 5.0 km of new track. Kristiine – Kaarli pst, Estonia pst, Gonsiori reaches the most workplace floor area (898 thousand m²), and Liivalaia – Pärnu mnt to Tartu mnt the most residents per kilometre (7 990).

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)

Limitation: Workplace floor area is a proxy for jobs and visitors, not a count.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## pelguranna

The funded Pelguranna route (Putukaväil to Kolde pst, modelled 1.83 km) puts 10 254 residents within 500 m, 9 135 of them not near a tram today. The route dropped in February 2026 (Puhangu to Stroomi park, 2.11 km) would reach 13 166 and 12 326. The funded route has the highest strategy fit of all options (2.50 of 3) but ranks 11 of 13 on the balanced score.

Evidence:

- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)
- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)

Limitation: Beyond Sõle the funded route runs in a corridor with no mapped street; the parallel part of Puhangu street stands in for it, up to 100 m away.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## city_centre_link

The abandoned Liivalaia section (1.34 km) and the Kaarli pst – Estonia pst alternative (1.91 km) both run through areas already served: only 4 619 and 4 702 residents would be newly within reach. Their strength is destinations: 765 and 898 thousand m² of workplace floor area. Extending the Liivalaia line to Kristiine raises newly reached residents to 8 870.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)

Limitation: A link through the centre mainly shortens journeys and relieves existing lines; this analysis measures reach only.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## lasnamae

In Lasnamäe the Laagna tee corridor reaches 35 047 residents (28 203 new) and the Rahu tee corridor 29 748 (26 859 new). The city has chosen trolleybuses for Laagna tee, which leaves it a strategy fit of 1.00 against 2.00 for the Rahu tee corridor.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)

Limitation: The Rahu tee line follows the city's published corridor drawing because the street is not built.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## jarve

The Järve extension (1.70 km) would bring 677 residents newly within reach, the fewest of all options, and ranks 13 of 13; it serves 326 thousand m² of workplace floor area around Järve keskus.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)

Limitation: Park-and-ride and interchange with the railway, which the 2022 study names as the purpose of this line, are not measured.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## strategy

Strategy fit and measured reach point in different directions. Pelguranna – Putukaväil to Kolde pst has the highest strategy fit (2.50 of 3) and ranks 11 on the balanced score; the top-ranked option, Lasnamäe – Gonsiori and Laagna tee, has a strategy fit of 1.00.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [tram_options](data/derived/tram-options.geojson)

Limitation: Strategy fit is a rubric applied to documents and news up to 24 November 2026; positions change.

## Assumptions and limitations

- The options are the 13 alignments in scenarios/tram-options.yaml: the lines and variants discussed in city documents and news between 2019 and November 2026 that lie inside Tallinn. Lines to Viimsi, Peetri/Jüri, Maardu and Tabasalu are left out. The building register layer used for residents and workplaces covers Tallinn only, so a line outside the city could not be measured on the same basis.
- A place is within reach of a stop when the walk along the path network is at most 500 m (about 6 minutes at 4.8 km/h), including the straight-line gaps between the building or stop and the nearest path. Distances of 300, 400, 600 and 800 m are also computed. 400-500 m is the usual planning catchment of a tram stop; the Tallinn 2035 strategy uses 400 m. The other distances let the reader test the sensitivity.
- Stops of a proposed line are modelled every 500 m along it, with a stop at each end. A modelled stop within 80 m of an existing tram stop is treated as that stop. Stop locations are published for almost none of the options. 500 m is close to the spacing of the existing network. Modelled stops are not planned stop locations.
- Each line is the shortest path between its declared waypoints over the street network, with streets the option does not name costing 8 times their length. Where the described corridor has no street (the Putukaväil corridor, the planned Rahu tee) a named stand-in street or the city's published corridor drawing is used, and the option says so. The sources describe alignments by street names, not coordinates. Routing by name on real geometry avoids hand-drawn lines and can be checked against the corridors the city has published.
- Residents per building are estimated: the population of each Statistics Estonia 1 km grid cell (2024) is shared among the existing registered dwellings in the cell in proportion to their net floor area. Where Tallinn holds less than half of a boundary cell, only that share of the cell's population is allocated. No open dataset gives residents per building. The grid fixes the totals per square kilometre; registered dwelling floor area is the best open proxy inside a cell.
- Workplaces and destinations are measured as the net floor area of existing registered non-residential buildings: hospitality, offices, retail and services, transport and communication buildings, industry and warehouses, and public buildings. Garages and outbuildings are not counted. Floor area is a proxy, not a count of jobs. No open dataset gives jobs at building or block level in Tallinn.
- Development in preparation is measured two ways: the floor area of registered dwellings that are planned or under construction, and the area of detailed plans in process (initiated, adopted for display or applied for) inside the drawn catchment. The growth criterion is the average of the two, each relative to the best option. Neither measure is a forecast of new residents. Planned buildings appear in the layer only once they have a footprint; a plan in process says where development is being prepared, not how much.
- The score is a weighted sum of seven criteria, each expressed as the option's value divided by the best option's value: residents newly in reach, all residents in reach, workplace floor area, public services, growth, residents in reach per km of new track, and strategy fit. The accepted weighting is 'balanced' (20, 10, 15, 10, 15, 15, 15 %); four other weightings are published. The question asks to consider population, services, strategies and plans together; any single ranking needs weights. The weights are a judgement, so the alternatives are computed by the pipeline and shown next to the accepted one.
- Strategy fit (0-3) is the sum of three scores of 0-1 recorded per option with their sources: its place in the mobility plan SUMP 2035, its stage in the 2019 feasibility study, and the city government's position in 2026. Strategies and political decisions are documents, not geodata. A fixed rubric applied to every option, with the evidence listed, keeps the judgement inspectable.
- Published costs and ridership are quoted per option for reference and are not part of the score. The estimates come from different years (2019 to 2026), price levels and alignments, and are missing for some options.
- Every proposed line is a modelled reading of public descriptions, routed along the street network. It is not a designed track alignment, and the stops, placed every 500 m, are not planned stops. Results near the ends of a line and for short lines depend most on these choices.
- The ranking depends on the weights and on which criteria are included. Longer lines reach more people in total; the per-kilometre criterion only partly offsets that. Ridership, travel time, construction cost and traffic effects are not modelled.
- Residents per building are estimated from the 2024 1 km population grid and registered dwelling floor area. Totals per grid cell are official; the split inside a cell is a model. Workplace floor area is a proxy for jobs and visitors, not a count.
- Strategy fit is a rubric applied by the analyst to documents and news up to 24 November 2026. Political positions change; the Liivalaia and Pelguranna decisions both changed within the last year.
- Planned and under-construction buildings are in the layer only when they already have a footprint in the topographic database, and detailed plans in process carry no dwelling numbers. Large future districts such as the former Kopli goods station are therefore under-represented.
- The Tallinn city ArcGIS services and the GTFS feed do not publish explicit licence text for these layers.
- Population refers to 2024; buildings, plans, services, timetables and the street network to November 2026. Homes completed after 2024 carry too few residents.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)

---
schema: openmapstack-findings/v1
project_id: tallinn-tram-options
question: Tallinn has been discussing several options for a new tram line, with different
  routes. Analyse them in depth and provide a dashboard of the options, considering
  population, services, general strategies and plans.
run_id: run-20261126-120953
scope: 28 tram line options in Tallinn and the municipalities around it, measured
  at a 500 m network walk to modelled stops; population 2024, other data November
  2026
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
  - id: study_2019_figures_consistent
    status: passed
  - id: study_stages_complete
    status: warning
  - id: option_stops_on_network
    status: warning
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
context_sha256: sha256:1068fb83555ca6f4aa186af69abe10b6266d42b2d4d3f87bb83618825661f683
assumptions:
- id: A1
  statement: 'The options are the 28 alignments in scenarios/tram-options.yaml: the
    13 lines and variants discussed in city documents and news between 2019 and November
    2026, and 15 further corridors of the 2019 feasibility and cost-benefit study,
    among them the corridors that leave Tallinn (Peetri and Assaku, Jüri, Tabasalu
    and its extension, Maardu, and the Viimsi line to Haabneeme). Not compared as
    options, but shown on the map by stage (A12): the study''s railway services (Balti
    jaam – Vesse, the Bekkeri branch), connecting links under 1 km (the airport –
    Lubja tunnel link 5C, the Rahu tee – Laagna tee link 3A+) and the loop inside
    Mustamäe drawn with corridor 7A. Corridors the study itself dropped (Paljassaare,
    Veerenni, Tondi, Mustamäe tee) are in neither.'
  rationale: The study plans a network for Tallinn and Harju county, and its first
    stage already leaves the city. Buildings of the municipalities around Tallinn
    come from the national copy of the same building layer (A13), so a line outside
    the city is measured on the same basis for residents and workplaces.
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
    used, and the option says so. The fifteen corridors added from the 2019 study,
    like the Rahu tee line, are taken from the city's published drawing of the study
    corridors, between named ends of its lines, and are not routed on the street network.
  rationale: The sources describe alignments by street names, not coordinates. Routing
    by name on real geometry avoids hand-drawn lines and can be checked against the
    corridors the city has published.
- id: A5
  statement: 'Residents per building are estimated: the population of each Statistics
    Estonia 1 km grid cell (2024) is shared among the existing registered dwellings
    in the cell in proportion to their net floor area. Buildings cover the whole frame,
    so a cell on the city boundary is shared between the dwellings on both sides of
    it.'
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
    The growth criterion is the average of the two, each relative to the best option.
    Planned buildings are measured in and around Tallinn; detailed plans in process
    are those of the Tallinn planning register only.'
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
    2019 feasibility study, and the city government''s position in 2026. The study
    stage is read from the city''s drawing of the study corridors, because the report
    shows the stages on maps only.'
  rationale: Strategies and political decisions are documents, not geodata. A fixed
    rubric applied to every option, with the evidence listed, keeps the judgement
    inspectable.
- id: A10
  statement: Published costs and ridership are quoted per option for reference and
    are not part of the score.
  rationale: The estimates come from different years (2019 to 2026), price levels
    and alignments, and are missing for some options.
- id: A11
  statement: 'The 2019 study''s own results are quoted per option and are not part
    of the score: stage, infrastructure cost, and the benefit-cost ratio and net present
    value of the tram variant in its four scenarios (final report, Tables 45, 61 and
    62). Tables show the ratio for ''Tallinn++ with free public transport''.'
  rationale: The study measures something this model does not (travel time, traffic,
    environmental and health effects from a transport model), for corridors that do
    not always match an option's extent. Putting its ratio in the score would mix
    two methods and count 2019 assumptions as current. Tallinn++ is the scenario the
    study recommends, and its authors advise comparing on the free-public-transport
    runs.
- id: A12
  statement: 'The five development stages of the 2019 study (report chapter 1.6) are
    shown in full: every line of the city''s drawing of the study corridors, in and
    outside Tallinn, grouped by stage and named with the corridor code printed on
    the report''s maps (scenarios/study-2019-stages.yaml). A study corridor counts
    as compared when at least half of it lies within 75 m of an option. The stage
    layer itself takes no part in the score; the options that stand for its corridors
    do.'
  rationale: The study plans a network for Tallinn and Harju county, and its first
    stage already leaves the city (Peetri and Assaku). Showing only the options would
    hide the stage each belongs to and the corridors that are not compared.
- id: A13
  statement: Outside Tallinn, residents, workplaces and planned buildings are measured
    from the national layer of ETAK building footprints with Building Register attributes,
    of which the city's layer is a copy; inside the city the city's copy is used and
    a building is never counted from both. Public services and detailed plans in process
    are the city's own layers and are counted in Tallinn only. The existing tram network
    is compared with Tallinn's population. The frame reaches at least 2 km beyond
    every study corridor.
  rationale: The two building layers have the same origin and fields and agree on
    status and use for over 99.8 % of the buildings in Tallinn, so the residents and
    workplace criteria are comparable across the boundary. No open layer of services
    or plans in process covers the neighbouring municipalities on the city's definitions;
    counting them in Tallinn only understates a line outside the city on two criteria,
    which is reported per option rather than hidden.
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
- id: SCENARIO-002
  severity: medium
  layer: tram_options
  issue: study_corridors_as_drawn
  statement: Fifteen options are corridors of the 2019 study taken from the city's
    drawing of them, a schematic line that was not checked against the street network.
    The 2019 benefit-cost figures shown per option are quoted, refer to the study's
    corridors (which may be longer than the option or shared by several options) and
    to 2019 assumptions. The Jüri, Tabasalu and Maardu options continue lines that
    are not built and are measured on their own.
  mitigation: Read each option's note on the study figures.
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
    licence text for these layers. The national building layer carries the Maa- ja
    Ruumiamet open data licence.
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
- id: DATA-004
  severity: medium
  layer: tram_options
  issue: services_and_plans_tallinn_only
  statement: Six options leave Tallinn. Residents, workplaces and planned buildings
    are measured outside the city from the national building layer, but public services
    and detailed plans in process are the city's own layers and are counted in Tallinn
    only. For those options the services criterion (10 % of the balanced score) and
    half of the growth criterion (7.5 %) are a lower bound. Bus departures come from
    the Tallinn timetable feed only.
  mitigation: Compare the options beyond Tallinn on residents, workplaces and residents
    per km; the share of each line inside Tallinn is in the tables (length_in_tallinn_pct).
    Add service and plan layers of Viimsi, Rae, Harku, Jõelähtme and Maardu to score
    them fully.
findings:
- id: ranking
  evidence:
  - option_summary
  - option_scores
  statement: 'With the balanced weighting and a 500 m walk to a stop, the highest-scoring
    of the 28 options are Lasnamäe – Gonsiori and Laagna tee (72.3 of 100); Mustamäe
    – Sõpruse pst to Ehitajate tee (56.9 of 100); Sõle – Kristiine to Kopli line (55.7
    of 100). The top option changes with the weighting: Balanced: Lasnamäe – Gonsiori
    and Laagna tee; People first: Lasnamäe – Gonsiori and Laagna tee; Growth and jobs:
    Lasnamäe – Gonsiori and Laagna tee; Plan-led: Lasnamäe – Narva mnt and the Rahu
    tee corridor; Value per km: Lasnamäe – Gonsiori and Laagna tee.'
  limitations:
  - The score is a declared weighting of seven indicators, not a cost-benefit result;
    ridership, travel time and construction cost are not modelled.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: existing_network
  evidence:
  - existing_tram_coverage
  statement: Today 66 447 residents, 14.6 % of an estimated 456 531, live within a
    500 m walk of one of the 81 existing tram stops.
  limitations:
  - Residents per building are estimated from the 2024 1 km population grid and registered
    dwelling floor area.
- id: new_coverage
  evidence:
  - option_summary
  - option_matrix
  statement: 'Lasnamäe – Gonsiori and Laagna tee would bring the most residents newly
    within reach of a tram: 38 155 over 8.7 km of new track. Lasnamäe – Gonsiori and
    Laagna tee reaches the most workplace floor area (927 thousand m²), and Liivalaia
    – Pärnu mnt to Tartu mnt the most residents per kilometre (7 990).'
  limitations:
  - Workplace floor area is a proxy for jobs and visitors, not a count.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: pelguranna
  evidence:
  - option_matrix
  - option_summary
  statement: The funded Pelguranna route (Putukaväil to Kolde pst, modelled 1.83 km)
    puts 10 254 residents within 500 m, 9 135 of them not near a tram today. The route
    dropped in February 2026 (Puhangu to Stroomi park, 2.11 km) would reach 13 332
    and 12 493. The funded route has the highest strategy fit of all options (2.50
    of 3) but ranks 13 of 28 on the balanced score.
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
  statement: In Lasnamäe the Laagna tee corridor reaches 45 159 residents (38 155
    new) and the Rahu tee corridor 29 754 (26 864 new). The city has chosen trolleybuses
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
    reach, fewer than all but 2 of the other options, and ranks 19 of 28; it serves
    326 thousand m² of workplace floor area around Järve keskus.
  limitations:
  - Park-and-ride and interchange with the railway, which the 2022 study names as
    the purpose of this line, are not measured.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: study_2019_appraisal
  evidence:
  - option_summary
  - tram_options
  statement: 'The 2019 feasibility study gives every corridor compared here a benefit-cost
    ratio above 1: in its scenario ''Tallinn++, free public transport'' the ratios
    run from 1.4 to 8.5. Its highest ratios are for Kristiine – Endla, Suur-Ameerika,
    Liivalaia (8.5, corridor 10A); Haabersti – Paldiski mnt (7.8, corridor 8A); Kristiine
    – Kaarli pst, Estonia pst, Gonsiori (7.3, corridor 10B). This model''s balanced
    ranking and the study''s ratios agree in part (rank correlation 0.74 over 28 options).
    The study rates higher than this model: Ülemiste City – Valukoja (study 11, here
    25), Mustamäe to Väike-Õismäe – Akadeemia tee (study 7, here 17), Haabersti –
    Paldiski mnt (study 3, here 11). This model rates higher than the study: Väike-Õismäe
    and Astangu – Haabersti to Astangu (here 10, study 18), Järve – Tondi to Järve
    keskus (here 19, study 27), Pelguranna – Putukaväil to Kolde pst (here 13, study
    20).'
  limitations:
  - The study's ratio counts travel-time, traffic, environmental and health effects
    from a transport model of 2018; this model counts who and what is within a walk
    of a stop.
  - The study appraises corridors that are not always the same extent as an option
    here; several options share one corridor's figures, and some figures cover more
    than the option (see each option's note).
  - The figures are from 2019 and assume the study's Tallinn++ policy package; they
    are quoted, not recomputed.
- id: study_2019_corridors
  evidence:
  - option_summary
  - option_matrix
  statement: '15 corridors of the 2019 study that are not in current debate were measured
    on the same basis, drawn as the city published them. They rank: 9 City centre
    – Juhkentali, Odra to Laagna tee (15 721 residents in reach, 7 521 new, study
    stage 2); 10 Väike-Õismäe and Astangu – Haabersti to Astangu (23 205 residents
    in reach, 23 205 new, study stage 3); 15 Mustamäe – Tammsaare tee, Järvevana tee
    to Ülemiste (21 070 residents in reach, 21 070 new, study stage 4); 16 City centre
    – Toompuiestee, Tõnismägi to Balti jaam (8 412 residents in reach, 3 423 new,
    study stage 4); 17 Mustamäe to Väike-Õismäe – Akadeemia tee (11 537 residents
    in reach, 11 537 new, study stage 3); 18 Pirita and Viimsi – Pirita tee, Merivälja
    tee to Haabneeme (5 357 residents in reach, 5 353 new, study stage 2); 20 Rae
    – airport to Peetri and Assaku (2 690 residents in reach, 2 670 new, study stage
    1); 21 Uuslinn and Sikupilli – Narva mnt to Majaka (6 828 residents in reach,
    3 638 new, study stage 2); 22 Järve to Mustamäe – Tervise (8 625 residents in
    reach, 8 625 new, study stage 5); 23 Tabasalu – Haabersti junction to Tabasalu
    (5 205 residents in reach, 5 205 new, study stage 3); 24 Maardu – from the end
    of Laagna tee to Kallavere (10 250 residents in reach, 10 250 new, study stage
    5); 25 Ülemiste City – Valukoja (21 residents in reach, 0 new, study stage 4);
    26 Rae – Assaku to Jüri (2 065 residents in reach, 2 065 new, study stage 4);
    27 Tabasalu – extension within Tabasalu (995 residents in reach, 995 new, study
    stage 3); 28 Lasnamäe industrial area – Peterburi tee (30 residents in reach,
    0 new, study stage 5).'
  limitations:
  - These lines follow the city's drawing of the study corridors and were not checked
    against the street network.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: beyond_tallinn
  evidence:
  - option_summary
  - option_matrix
  - buildings
  statement: '6 options leave Tallinn. Buildings of the municipalities around the
    city, from the national building layer, give them residents and workplaces on
    the same basis as inside it: 92 067 residents in 17 312 buildings outside Tallinn
    are in the model. They rank: 18 Pirita and Viimsi – Pirita tee, Merivälja tee
    to Haabneeme (29.5; 5 357 residents in reach, 3 212 of them outside Tallinn; 75
    % of the line in Tallinn); 20 Rae – airport to Peetri and Assaku (26.6; 2 690
    residents in reach, 2 575 of them outside Tallinn; 33 % of the line in Tallinn);
    23 Tabasalu – Haabersti junction to Tabasalu (20.4; 5 205 residents in reach,
    763 of them outside Tallinn; 51 % of the line in Tallinn); 24 Maardu – from the
    end of Laagna tee to Kallavere (18.5; 10 250 residents in reach, 9 643 of them
    outside Tallinn; 5 % of the line in Tallinn); 26 Rae – Assaku to Jüri (10.2; 2
    065 residents in reach, 2 065 of them outside Tallinn; 0 % of the line in Tallinn);
    27 Tabasalu – extension within Tabasalu (8.3; 995 residents in reach, 609 of them
    outside Tallinn; 0 % of the line in Tallinn).'
  limitations:
  - Public services and detailed plans in process are the city's own layers and are
    counted in Tallinn only. For a line outside the city the services criterion (10
    % of the balanced score) and half of the growth criterion (7.5 %) are therefore
    a lower bound.
  - Bus departures are from the Tallinn timetable feed; county lines are not in it.
  - The Jüri, Tabasalu and Maardu lines each continue a line that is not built; they
    are measured on their own.
  - Lines and stops are modelled from public descriptions, not designed alignments.
- id: study_2019_stages
  evidence:
  - study_stages
  - study_corridor_table
  - study_corridors
  statement: 'The 2019 study orders its corridors in five stages. All 31 corridors
    of the city''s drawing of them (123.9 km, 26.7 km of it outside Tallinn) are on
    the map by stage. Stage 1: 7 corridors, 23.2 km in the report (23.9 km drawn),
    benefit-cost ratio 6.8. Stage 2: 7 corridors, 28.1 km in the report (28.9 km drawn),
    benefit-cost ratio 5.7. Stage 3: 7 corridors, 21.3 km in the report (21.0 km drawn),
    benefit-cost ratio 5.3. Stage 4: 6 corridors, 23.1 km in the report (22.9 km drawn),
    benefit-cost ratio 3.4. Stage 5: 4 corridors, 16.1 km in the report (16.3 km drawn),
    benefit-cost ratio 2.5. 27 corridors are compared as options here, those leaving
    Tallinn included. Not compared: Balti jaam – Vesse, Bekkeri – Balti jaam (existing
    railways); 3A+, 5C (short links).'
  limitations:
  - Corridor codes, stage totals and benefit-cost ratios are transcribed from the
    report (chapter 1.6, Tables 45, 61, 62 and 65); the lines are the city's schematic
    drawing.
  - The benefit-cost ratio is the study's, for the tram variant in its scenario 'Tallinn++,
    free public transport', in 2019 assumptions.
  - 'Shown on the report''s maps but not in the city''s drawing, so not on the map:
    5A'' alternative (stage 1).'
- id: strategy
  evidence:
  - option_summary
  - tram_options
  statement: Strategy fit and measured reach point in different directions. Pelguranna
    – Putukaväil to Kolde pst has the highest strategy fit (2.50 of 3) and ranks 13
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
        - &id030
          name: length_in_tallinn_pct
          type: integer
          label: Line inside Tallinn
          unit: '%'
        - &id031
          name: residents_outside_tallinn
          type: integer
          label: Residents in reach outside Tallinn
        - name: study_2019_corridor
          type: string
          label: 2019 study corridor
        - name: study_2019_stage
          type: integer
          label: 2019 study stage (1-5)
        - name: study_2019_bcr
          type: number
          label: 2019 study benefit-cost ratio (Tallinn++, free public transport)
        - name: study_2019_bcr_low
          type: number
          label: 2019 study benefit-cost ratio, lowest scenario
        - name: study_2019_bcr_high
          type: number
          label: 2019 study benefit-cost ratio, highest scenario
        - name: study_2019_enpv_meur
          type: number
          label: 2019 study net present value (Tallinn++, free public transport)
          unit: million EUR
        - name: study_2019_cost_meur
          type: number
          label: 2019 study infrastructure cost of the corridor
          unit: million EUR
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/option-summary.csv
      sha256: sha256:9d125da1cde7732fd35985ea3dab9c254b8f71d4d313bdef2cf51ac88039a4e4
    - path: data/derived/option-summary.xlsx
      sha256: sha256:a9d2cd5f35451952492fa25a1f5c7a49e3aa8489cf054c26b5bfc2f05317655c
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
      sha256: sha256:d4bca765398cd056bb338f13718da014033e271234daafa166f583bf392a412a
    - path: data/derived/option-scores.xlsx
      sha256: sha256:8c5a78e7e86189b9353c1f4591b769cda7f25520f3dcc8fa07ecd8681526c37c
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
      sha256: sha256:a7915266392ea640c85dd511d4704edc805491a20fb4d35876cdd42447e9d38c
    - path: data/derived/existing-tram-coverage.xlsx
      sha256: sha256:30e395a9efac0afd5aa254b8c1b5c7807923597e10db5d10588ade5ba2ea2cba
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
        - *id030
        - *id031
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/option-matrix.csv
      sha256: sha256:fd7385fb9c51434d691a6d4ebe1706319aa8f9ed104360cb4704a477b6174383
    - path: data/derived/option-matrix.xlsx
      sha256: sha256:2e4fa14f2f34a9f3c50ec6c7cb83d3e72ec095019016d71342f5af959361b7bc
  tram_options:
    definition:
      path: data/derived/tram-options.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: summarise
      note: HYPOTHETICAL lines routed from scenarios/tram-options.yaml, with the indicators
        of the accepted setting.
    files:
    - path: data/derived/tram-options.geojson
      sha256: sha256:c00e117027b5fd3143b5e66cf12dd061d5d9ed46d9b4a396a3d465ec6cd9c55f
  buildings:
    definition:
      path: data/derived/buildings.parquet
      format: GeoParquet (EPSG:3301)
      generated_by: measure_features
    files:
    - path: data/derived/buildings.parquet
      sha256: sha256:0a9ee69445cd41e6cbeb5c5a8600d73cbee1c78aec2dcfa86bd1147193fed317
  study_stages:
    definition:
      path: data/derived/study-2019-stages.csv
      format: CSV
      kind: table
      generated_by: stage_study_corridors
      table:
        key:
        - stage
        columns:
        - name: stage
          type: integer
          label: Stage
        - name: title
          type: string
          label: Name
        - name: corridors
          type: integer
          label: Corridors
        - name: corridor_codes
          type: string
          label: Corridor codes
        - name: length_report_km
          type: number
          label: Length in the report
          unit: km
        - name: length_drawn_km
          type: number
          label: Length as drawn
          unit: km
        - name: length_difference_pct
          type: number
          label: Drawn vs report
          unit: '%'
        - name: length_in_tallinn_km
          type: number
          label: Of it inside Tallinn
          unit: km
        - name: corridors_compared
          type: integer
          label: Corridors compared as options
        - name: study_bcr_tram
          type: number
          label: Study BCR, tram
          unit: Tallinn++, free PT
        - name: study_bcr_tram_low
          type: number
          label: Study BCR tram, lowest scenario
        - name: study_bcr_tram_high
          type: number
          label: Study BCR tram, highest scenario
        - name: study_bcr_brt
          type: number
          label: Study BCR, bus rapid transit
          unit: Tallinn++, free PT
        - name: study_enpv_meur
          type: number
          label: Study net present value, tram
          unit: M EUR
        - name: summary
          type: string
          label: What the stage builds
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/study-2019-stages.csv
      sha256: sha256:5f5c5e2369fc2cb3778738a1d0ddb8cc7e86400c7f2cbc2a7a581128b11fc94f
    - path: data/derived/study-2019-stages.xlsx
      sha256: sha256:6a0122fc6a5dea711685ed9a4cb4d9a3358ea1f394534ba4b0b7aa2d2d28b616
  study_corridor_table:
    definition:
      path: data/derived/study-2019-corridors.csv
      format: CSV
      kind: table
      generated_by: stage_study_corridors
      table:
        key:
        - corridor
        columns:
        - name: stage
          type: integer
          label: Stage
        - name: corridor
          type: string
          label: Corridor
        - name: name
          type: string
          label: Route
        - name: mode
          type: string
          label: Mode
        - name: length_km
          type: number
          label: Length as drawn
          unit: km
        - name: tallinn_share
          type: number
          label: Share inside Tallinn
          unit: 0-1
        - name: compared
          type: string
          label: Compared as option
        - name: options
          type: string
          label: Options that stand for it
        - name: option_share
          type: number
          label: Share within 75 m of the option
          unit: 0-1
        - name: not_compared_reason
          type: string
          label: Why not compared
        - name: study_table_row
          type: string
          label: Row in the study tables
        - name: study_cost_meur
          type: number
          label: Study cost
          unit: M EUR (2019)
        - name: study_bcr
          type: number
          label: Study benefit-cost ratio
          unit: Tallinn++, free PT
        - name: study_bcr_low
          type: number
          label: Study BCR, lowest scenario
        - name: study_bcr_high
          type: number
          label: Study BCR, highest scenario
        - name: study_enpv_meur
          type: number
          label: Study net present value
          unit: M EUR
        - name: note
          type: string
          label: Note
        - name: source_fids
          type: string
          label: Lines of the city drawing (FID)
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/study-2019-corridors.csv
      sha256: sha256:96329e010081de1aef01bd69145b66ce19b5d8e0f1e80231f86399ba2811f4c1
    - path: data/derived/study-2019-corridors.xlsx
      sha256: sha256:b26b931b7ffc630ce26c0c6a9dcc24d99a070e330db9674801ad9bfb24da16f1
  study_corridors:
    definition:
      path: data/derived/study-2019-corridors.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: stage_study_corridors
    files:
    - path: data/derived/study-2019-corridors.geojson
      sha256: sha256:a6f6ec9ec11c6121539beb4cf1d5df534fa544f0ee3865d496972246d0b61e58
---
# Findings

Tallinn has been discussing several options for a new tram line, with different routes. Analyse them in depth and provide a dashboard of the options, considering population, services, general strategies and plans.

Scope: 28 tram line options in Tallinn and the municipalities around it, measured at a 500 m network walk to modelled stops; population 2024, other data November 2026. Run: `run-20261126-120953`. Validation: **warning**.

## ranking

With the balanced weighting and a 500 m walk to a stop, the highest-scoring of the 28 options are Lasnamäe – Gonsiori and Laagna tee (72.3 of 100); Mustamäe – Sõpruse pst to Ehitajate tee (56.9 of 100); Sõle – Kristiine to Kopli line (55.7 of 100). The top option changes with the weighting: Balanced: Lasnamäe – Gonsiori and Laagna tee; People first: Lasnamäe – Gonsiori and Laagna tee; Growth and jobs: Lasnamäe – Gonsiori and Laagna tee; Plan-led: Lasnamäe – Narva mnt and the Rahu tee corridor; Value per km: Lasnamäe – Gonsiori and Laagna tee.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_scores](data/derived/option-scores.csv)
- [option_scores (xlsx)](data/derived/option-scores.xlsx)

Limitation: The score is a declared weighting of seven indicators, not a cost-benefit result; ridership, travel time and construction cost are not modelled.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## existing_network

Today 66 447 residents, 14.6 % of an estimated 456 531, live within a 500 m walk of one of the 81 existing tram stops.

Evidence:

- [existing_tram_coverage](data/derived/existing-tram-coverage.csv)
- [existing_tram_coverage (xlsx)](data/derived/existing-tram-coverage.xlsx)

Limitation: Residents per building are estimated from the 2024 1 km population grid and registered dwelling floor area.

## new_coverage

Lasnamäe – Gonsiori and Laagna tee would bring the most residents newly within reach of a tram: 38 155 over 8.7 km of new track. Lasnamäe – Gonsiori and Laagna tee reaches the most workplace floor area (927 thousand m²), and Liivalaia – Pärnu mnt to Tartu mnt the most residents per kilometre (7 990).

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)

Limitation: Workplace floor area is a proxy for jobs and visitors, not a count.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## pelguranna

The funded Pelguranna route (Putukaväil to Kolde pst, modelled 1.83 km) puts 10 254 residents within 500 m, 9 135 of them not near a tram today. The route dropped in February 2026 (Puhangu to Stroomi park, 2.11 km) would reach 13 332 and 12 493. The funded route has the highest strategy fit of all options (2.50 of 3) but ranks 13 of 28 on the balanced score.

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

In Lasnamäe the Laagna tee corridor reaches 45 159 residents (38 155 new) and the Rahu tee corridor 29 754 (26 864 new). The city has chosen trolleybuses for Laagna tee, which leaves it a strategy fit of 1.00 against 2.00 for the Rahu tee corridor.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)

Limitation: The Rahu tee line follows the city's published corridor drawing because the street is not built.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## jarve

The Järve extension (1.70 km) would bring 677 residents newly within reach, fewer than all but 2 of the other options, and ranks 19 of 28; it serves 326 thousand m² of workplace floor area around Järve keskus.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)

Limitation: Park-and-ride and interchange with the railway, which the 2022 study names as the purpose of this line, are not measured.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## study_2019_appraisal

The 2019 feasibility study gives every corridor compared here a benefit-cost ratio above 1: in its scenario 'Tallinn++, free public transport' the ratios run from 1.4 to 8.5. Its highest ratios are for Kristiine – Endla, Suur-Ameerika, Liivalaia (8.5, corridor 10A); Haabersti – Paldiski mnt (7.8, corridor 8A); Kristiine – Kaarli pst, Estonia pst, Gonsiori (7.3, corridor 10B). This model's balanced ranking and the study's ratios agree in part (rank correlation 0.74 over 28 options). The study rates higher than this model: Ülemiste City – Valukoja (study 11, here 25), Mustamäe to Väike-Õismäe – Akadeemia tee (study 7, here 17), Haabersti – Paldiski mnt (study 3, here 11). This model rates higher than the study: Väike-Õismäe and Astangu – Haabersti to Astangu (here 10, study 18), Järve – Tondi to Järve keskus (here 19, study 27), Pelguranna – Putukaväil to Kolde pst (here 13, study 20).

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [tram_options](data/derived/tram-options.geojson)

Limitation: The study's ratio counts travel-time, traffic, environmental and health effects from a transport model of 2018; this model counts who and what is within a walk of a stop.

Limitation: The study appraises corridors that are not always the same extent as an option here; several options share one corridor's figures, and some figures cover more than the option (see each option's note).

Limitation: The figures are from 2019 and assume the study's Tallinn++ policy package; they are quoted, not recomputed.

## study_2019_corridors

15 corridors of the 2019 study that are not in current debate were measured on the same basis, drawn as the city published them. They rank: 9 City centre – Juhkentali, Odra to Laagna tee (15 721 residents in reach, 7 521 new, study stage 2); 10 Väike-Õismäe and Astangu – Haabersti to Astangu (23 205 residents in reach, 23 205 new, study stage 3); 15 Mustamäe – Tammsaare tee, Järvevana tee to Ülemiste (21 070 residents in reach, 21 070 new, study stage 4); 16 City centre – Toompuiestee, Tõnismägi to Balti jaam (8 412 residents in reach, 3 423 new, study stage 4); 17 Mustamäe to Väike-Õismäe – Akadeemia tee (11 537 residents in reach, 11 537 new, study stage 3); 18 Pirita and Viimsi – Pirita tee, Merivälja tee to Haabneeme (5 357 residents in reach, 5 353 new, study stage 2); 20 Rae – airport to Peetri and Assaku (2 690 residents in reach, 2 670 new, study stage 1); 21 Uuslinn and Sikupilli – Narva mnt to Majaka (6 828 residents in reach, 3 638 new, study stage 2); 22 Järve to Mustamäe – Tervise (8 625 residents in reach, 8 625 new, study stage 5); 23 Tabasalu – Haabersti junction to Tabasalu (5 205 residents in reach, 5 205 new, study stage 3); 24 Maardu – from the end of Laagna tee to Kallavere (10 250 residents in reach, 10 250 new, study stage 5); 25 Ülemiste City – Valukoja (21 residents in reach, 0 new, study stage 4); 26 Rae – Assaku to Jüri (2 065 residents in reach, 2 065 new, study stage 4); 27 Tabasalu – extension within Tabasalu (995 residents in reach, 995 new, study stage 3); 28 Lasnamäe industrial area – Peterburi tee (30 residents in reach, 0 new, study stage 5).

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)

Limitation: These lines follow the city's drawing of the study corridors and were not checked against the street network.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## beyond_tallinn

6 options leave Tallinn. Buildings of the municipalities around the city, from the national building layer, give them residents and workplaces on the same basis as inside it: 92 067 residents in 17 312 buildings outside Tallinn are in the model. They rank: 18 Pirita and Viimsi – Pirita tee, Merivälja tee to Haabneeme (29.5; 5 357 residents in reach, 3 212 of them outside Tallinn; 75 % of the line in Tallinn); 20 Rae – airport to Peetri and Assaku (26.6; 2 690 residents in reach, 2 575 of them outside Tallinn; 33 % of the line in Tallinn); 23 Tabasalu – Haabersti junction to Tabasalu (20.4; 5 205 residents in reach, 763 of them outside Tallinn; 51 % of the line in Tallinn); 24 Maardu – from the end of Laagna tee to Kallavere (18.5; 10 250 residents in reach, 9 643 of them outside Tallinn; 5 % of the line in Tallinn); 26 Rae – Assaku to Jüri (10.2; 2 065 residents in reach, 2 065 of them outside Tallinn; 0 % of the line in Tallinn); 27 Tabasalu – extension within Tabasalu (8.3; 995 residents in reach, 609 of them outside Tallinn; 0 % of the line in Tallinn).

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [option_matrix](data/derived/option-matrix.csv)
- [option_matrix (xlsx)](data/derived/option-matrix.xlsx)
- [buildings](data/derived/buildings.parquet)

Limitation: Public services and detailed plans in process are the city's own layers and are counted in Tallinn only. For a line outside the city the services criterion (10 % of the balanced score) and half of the growth criterion (7.5 %) are therefore a lower bound.

Limitation: Bus departures are from the Tallinn timetable feed; county lines are not in it.

Limitation: The Jüri, Tabasalu and Maardu lines each continue a line that is not built; they are measured on their own.

Limitation: Lines and stops are modelled from public descriptions, not designed alignments.

## study_2019_stages

The 2019 study orders its corridors in five stages. All 31 corridors of the city's drawing of them (123.9 km, 26.7 km of it outside Tallinn) are on the map by stage. Stage 1: 7 corridors, 23.2 km in the report (23.9 km drawn), benefit-cost ratio 6.8. Stage 2: 7 corridors, 28.1 km in the report (28.9 km drawn), benefit-cost ratio 5.7. Stage 3: 7 corridors, 21.3 km in the report (21.0 km drawn), benefit-cost ratio 5.3. Stage 4: 6 corridors, 23.1 km in the report (22.9 km drawn), benefit-cost ratio 3.4. Stage 5: 4 corridors, 16.1 km in the report (16.3 km drawn), benefit-cost ratio 2.5. 27 corridors are compared as options here, those leaving Tallinn included. Not compared: Balti jaam – Vesse, Bekkeri – Balti jaam (existing railways); 3A+, 5C (short links).

Evidence:

- [study_stages](data/derived/study-2019-stages.csv)
- [study_stages (xlsx)](data/derived/study-2019-stages.xlsx)
- [study_corridor_table](data/derived/study-2019-corridors.csv)
- [study_corridor_table (xlsx)](data/derived/study-2019-corridors.xlsx)
- [study_corridors](data/derived/study-2019-corridors.geojson)

Limitation: Corridor codes, stage totals and benefit-cost ratios are transcribed from the report (chapter 1.6, Tables 45, 61, 62 and 65); the lines are the city's schematic drawing.

Limitation: The benefit-cost ratio is the study's, for the tram variant in its scenario 'Tallinn++, free public transport', in 2019 assumptions.

Limitation: Shown on the report's maps but not in the city's drawing, so not on the map: 5A' alternative (stage 1).

## strategy

Strategy fit and measured reach point in different directions. Pelguranna – Putukaväil to Kolde pst has the highest strategy fit (2.50 of 3) and ranks 13 on the balanced score; the top-ranked option, Lasnamäe – Gonsiori and Laagna tee, has a strategy fit of 1.00.

Evidence:

- [option_summary](data/derived/option-summary.csv)
- [option_summary (xlsx)](data/derived/option-summary.xlsx)
- [tram_options](data/derived/tram-options.geojson)

Limitation: Strategy fit is a rubric applied to documents and news up to 24 November 2026; positions change.

## Assumptions and limitations

- The options are the 28 alignments in scenarios/tram-options.yaml: the 13 lines and variants discussed in city documents and news between 2019 and November 2026, and 15 further corridors of the 2019 feasibility and cost-benefit study, among them the corridors that leave Tallinn (Peetri and Assaku, Jüri, Tabasalu and its extension, Maardu, and the Viimsi line to Haabneeme). Not compared as options, but shown on the map by stage (A12): the study's railway services (Balti jaam – Vesse, the Bekkeri branch), connecting links under 1 km (the airport – Lubja tunnel link 5C, the Rahu tee – Laagna tee link 3A+) and the loop inside Mustamäe drawn with corridor 7A. Corridors the study itself dropped (Paljassaare, Veerenni, Tondi, Mustamäe tee) are in neither. The study plans a network for Tallinn and Harju county, and its first stage already leaves the city. Buildings of the municipalities around Tallinn come from the national copy of the same building layer (A13), so a line outside the city is measured on the same basis for residents and workplaces.
- A place is within reach of a stop when the walk along the path network is at most 500 m (about 6 minutes at 4.8 km/h), including the straight-line gaps between the building or stop and the nearest path. Distances of 300, 400, 600 and 800 m are also computed. 400-500 m is the usual planning catchment of a tram stop; the Tallinn 2035 strategy uses 400 m. The other distances let the reader test the sensitivity.
- Stops of a proposed line are modelled every 500 m along it, with a stop at each end. A modelled stop within 80 m of an existing tram stop is treated as that stop. Stop locations are published for almost none of the options. 500 m is close to the spacing of the existing network. Modelled stops are not planned stop locations.
- Each line is the shortest path between its declared waypoints over the street network, with streets the option does not name costing 8 times their length. Where the described corridor has no street (the Putukaväil corridor, the planned Rahu tee) a named stand-in street or the city's published corridor drawing is used, and the option says so. The fifteen corridors added from the 2019 study, like the Rahu tee line, are taken from the city's published drawing of the study corridors, between named ends of its lines, and are not routed on the street network. The sources describe alignments by street names, not coordinates. Routing by name on real geometry avoids hand-drawn lines and can be checked against the corridors the city has published.
- Residents per building are estimated: the population of each Statistics Estonia 1 km grid cell (2024) is shared among the existing registered dwellings in the cell in proportion to their net floor area. Buildings cover the whole frame, so a cell on the city boundary is shared between the dwellings on both sides of it. No open dataset gives residents per building. The grid fixes the totals per square kilometre; registered dwelling floor area is the best open proxy inside a cell.
- Workplaces and destinations are measured as the net floor area of existing registered non-residential buildings: hospitality, offices, retail and services, transport and communication buildings, industry and warehouses, and public buildings. Garages and outbuildings are not counted. Floor area is a proxy, not a count of jobs. No open dataset gives jobs at building or block level in Tallinn.
- Development in preparation is measured two ways: the floor area of registered dwellings that are planned or under construction, and the area of detailed plans in process (initiated, adopted for display or applied for) inside the drawn catchment. The growth criterion is the average of the two, each relative to the best option. Planned buildings are measured in and around Tallinn; detailed plans in process are those of the Tallinn planning register only. Neither measure is a forecast of new residents. Planned buildings appear in the layer only once they have a footprint; a plan in process says where development is being prepared, not how much.
- The score is a weighted sum of seven criteria, each expressed as the option's value divided by the best option's value: residents newly in reach, all residents in reach, workplace floor area, public services, growth, residents in reach per km of new track, and strategy fit. The accepted weighting is 'balanced' (20, 10, 15, 10, 15, 15, 15 %); four other weightings are published. The question asks to consider population, services, strategies and plans together; any single ranking needs weights. The weights are a judgement, so the alternatives are computed by the pipeline and shown next to the accepted one.
- Strategy fit (0-3) is the sum of three scores of 0-1 recorded per option with their sources: its place in the mobility plan SUMP 2035, its stage in the 2019 feasibility study, and the city government's position in 2026. The study stage is read from the city's drawing of the study corridors, because the report shows the stages on maps only. Strategies and political decisions are documents, not geodata. A fixed rubric applied to every option, with the evidence listed, keeps the judgement inspectable.
- Published costs and ridership are quoted per option for reference and are not part of the score. The estimates come from different years (2019 to 2026), price levels and alignments, and are missing for some options.
- The 2019 study's own results are quoted per option and are not part of the score: stage, infrastructure cost, and the benefit-cost ratio and net present value of the tram variant in its four scenarios (final report, Tables 45, 61 and 62). Tables show the ratio for 'Tallinn++ with free public transport'. The study measures something this model does not (travel time, traffic, environmental and health effects from a transport model), for corridors that do not always match an option's extent. Putting its ratio in the score would mix two methods and count 2019 assumptions as current. Tallinn++ is the scenario the study recommends, and its authors advise comparing on the free-public-transport runs.
- The five development stages of the 2019 study (report chapter 1.6) are shown in full: every line of the city's drawing of the study corridors, in and outside Tallinn, grouped by stage and named with the corridor code printed on the report's maps (scenarios/study-2019-stages.yaml). A study corridor counts as compared when at least half of it lies within 75 m of an option. The stage layer itself takes no part in the score; the options that stand for its corridors do. The study plans a network for Tallinn and Harju county, and its first stage already leaves the city (Peetri and Assaku). Showing only the options would hide the stage each belongs to and the corridors that are not compared.
- Outside Tallinn, residents, workplaces and planned buildings are measured from the national layer of ETAK building footprints with Building Register attributes, of which the city's layer is a copy; inside the city the city's copy is used and a building is never counted from both. Public services and detailed plans in process are the city's own layers and are counted in Tallinn only. The existing tram network is compared with Tallinn's population. The frame reaches at least 2 km beyond every study corridor. The two building layers have the same origin and fields and agree on status and use for over 99.8 % of the buildings in Tallinn, so the residents and workplace criteria are comparable across the boundary. No open layer of services or plans in process covers the neighbouring municipalities on the city's definitions; counting them in Tallinn only understates a line outside the city on two criteria, which is reported per option rather than hidden.
- Every proposed line is a modelled reading of public descriptions, routed along the street network. It is not a designed track alignment, and the stops, placed every 500 m, are not planned stops. Results near the ends of a line and for short lines depend most on these choices.
- Fifteen options are corridors of the 2019 study taken from the city's drawing of them, a schematic line that was not checked against the street network. The 2019 benefit-cost figures shown per option are quoted, refer to the study's corridors (which may be longer than the option or shared by several options) and to 2019 assumptions. The Jüri, Tabasalu and Maardu options continue lines that are not built and are measured on their own.
- The ranking depends on the weights and on which criteria are included. Longer lines reach more people in total; the per-kilometre criterion only partly offsets that. Ridership, travel time, construction cost and traffic effects are not modelled.
- Residents per building are estimated from the 2024 1 km population grid and registered dwelling floor area. Totals per grid cell are official; the split inside a cell is a model. Workplace floor area is a proxy for jobs and visitors, not a count.
- Strategy fit is a rubric applied by the analyst to documents and news up to 24 November 2026. Political positions change; the Liivalaia and Pelguranna decisions both changed within the last year.
- Planned and under-construction buildings are in the layer only when they already have a footprint in the topographic database, and detailed plans in process carry no dwelling numbers. Large future districts such as the former Kopli goods station are therefore under-represented.
- The Tallinn city ArcGIS services and the GTFS feed do not publish explicit licence text for these layers. The national building layer carries the Maa- ja Ruumiamet open data licence.
- Population refers to 2024; buildings, plans, services, timetables and the street network to November 2026. Homes completed after 2024 carry too few residents.
- Six options leave Tallinn. Residents, workplaces and planned buildings are measured outside the city from the national building layer, but public services and detailed plans in process are the city's own layers and are counted in Tallinn only. For those options the services criterion (10 % of the balanced score) and half of the growth criterion (7.5 %) are a lower bound. Bus departures come from the Tallinn timetable feed only.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)

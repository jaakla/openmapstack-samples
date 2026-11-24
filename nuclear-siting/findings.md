---
schema: openmapstack-findings/v1
project_id: nuclear-siting
question: 'Site selection for a future nuclear power station in Estonia: which known
  and logical preconditions apply, how strong is each, and which land remains when
  a chosen set of them is applied?'
run_id: run-20261122-175153
scope: All land of Estonia (15 counties), screened on a grid of about 260 m cells.
validation:
  status: warning
  checks:
  - id: geometry_valid
    status: passed
  - id: crs_known
    status: passed
  - id: layers_within_aoi
    status: passed
  - id: row_count_gt_zero
    status: passed
  - id: no_duplicate_cell
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
  - id: land_area_plausible
    status: passed
  - id: stored_units_reproduce_rules
    status: passed
  - id: screen_monotonic
    status: passed
  - id: candidate_areas_consistent
    status: passed
  - id: official_sites_located
    status: passed
  - id: manifest_report_parity
    status: passed
validation_report: validation/latest-report.json
context_sha256: sha256:d119c42cc5902cacd6ac266bc6e0f40bc4f29e4dcc35fdacac59bdd517b79ad3
assumptions:
- id: A1
  statement: 'The study area is the land of Estonia: every grid cell whose centre
    lies inside a county polygon of the official administrative division.'
  rationale: A plant stands on land. County polygons follow the shoreline and include
    islands; inland lakes are handled by their own criterion.
- id: A2
  statement: 'The screen is made on a grid aligned to Web Mercator with 500 m steps,
    about 255 to 270 m on the ground. Every test is made at the cell centre: a cell
    is inside an area when its centre is, and distances run from the centre.'
  rationale: A fixed grid lets any set of criteria be combined in the view without
    measuring in the browser. Aligning it to the map projection lets it be drawn exactly.
    All measuring is done in EPSG:3301.
- id: A3
  statement: The accepted run applies every mapped criterion of class 'exclusion'
    at the official threshold and no criterion of class 'consideration' or 'suitability'.
  rationale: The official method removes exclusion areas first and weighs the other
    criteria site by site, without a summed score. Considerations are reported per
    candidate area and can be switched on in the view.
- id: A4
  statement: 'Cooling water is taken from the sea, and the accepted threshold is the
    open-cycle one: at most 3 km from the sea in a straight line.'
  rationale: The ministry states that no Estonian river has enough flow. The 2023
    analysis used 3 km for open-cycle and 10 km for closed-cycle cooling; both are
    offered.
- id: A5
  statement: Every bedrock fault of the 1:400 000 geological map is buffered by 5
    km, as the 2023 screening did, although no Estonian fault is proven active.
  rationale: The official criterion concerns active faults, which only site investigations
    can establish. Buffering all mapped faults is the conservative screening choice
    and is switchable.
- id: A6
  statement: A cell is too close to homes when its centre is nearer than 350 m to
    a residential building footprint.
  rationale: The plan keeps 350 m between dwellings and the reactor. Public buildings
    and plot boundaries, which the plan also excludes, are not in the open layer used.
- id: A7
  statement: Enough land means remaining cells joined edge to edge that add up to
    at least 95 ha.
  rationale: The plan estimates 95 ha for two BWRX-300 units with their buffer. Diagonal
    contact does not join cells.
- id: A8
  statement: Distances are straight lines from the cell centre to points placed every
    25 m along the target lines and outlines, and are stored in whole units (50, 100
    or 250 m) rounded down.
  rationale: The error is at most about 13 m, far below the cell size. Every offered
    threshold is a multiple of the unit, so stored values reproduce each rule exactly.
- id: A9
  statement: Where the official rule needs data that is not open, a stand-in is used
    and the criterion is marked 'proxy'; where there is no usable stand-in the criterion
    is listed as 'not mapped' and plays no part.
  rationale: The catalogue should show the whole official list and be explicit about
    what this screen can and cannot reproduce.
- id: A10
  statement: 'Three exclusion criteria come from outside the plan''s 47-row screening
    table: limited-conservation areas (an exclusion layer of the plan''s public map),
    lakes and reservoirs, and 5 km from the land border (both exclusions of the 2023
    nationwide analysis).'
  rationale: The plan's table was written for a planning area that these do not touch;
    a nationwide screen needs them.
warnings:
- id: METHOD-001
  severity: high
  layer: candidate_areas
  issue: screening_not_suitability
  statement: This is a desk screen on open data, not a site assessment. Four official
    exclusion criteria are not mapped (aerodrome protection zones, species protection
    sites, category I animals, feasibility of the emergency plan), and the non-public
    security criteria are absent. A remaining cell is not a suitable site.
  mitigation: Read candidate areas as land that survives the mapped exclusions. The
    state special plan and its strategic environmental assessment decide suitability.
- id: METHOD-002
  severity: medium
  layer: screening_grid
  issue: grid_resolution
  statement: Cells are about 260 m across and tested at their centre. Features narrower
    than a cell, such as single-object zones, monument zones, small key habitats and
    the shore building-ban zone, are sampled rather than fully represented, and the
    350 m dwelling distance is measured from the centre.
  mitigation: Use the grid for regional comparison. Check any area of interest against
    the source layers at full detail.
- id: METHOD-003
  severity: medium
  layer: screening_grid
  issue: fault_buffer_is_conservative
  statement: The fault criterion buffers every mapped bedrock fault by 5 km. No Estonian
    fault is proven active, and the official plan judges faults site by site. This
    criterion alone removes several hundred square kilometres of coast.
  mitigation: Switch the criterion off, or change its distance, to see its effect.
- id: DATA-001
  severity: medium
  layer: official_sites
  issue: defence_criteria_not_public
  statement: The plan dropped its three Lüganuse sites in October 2026 on defence
    grounds that are not public. Public defence sites and their zones are mapped here;
    the non-public considerations are not.
  mitigation: Do not read a remaining cell as cleared on defence grounds.
- id: DATA-002
  severity: low
  layer: official_sites
  issue: license_not_stated
  statement: The map service that publishes the official sites and planning area (gis.skpk.ee)
    states no licence. The geometries are public planning material of a state special
    plan.
  mitigation: Confirm reuse terms with the Ministry of Economic Affairs and Communications
    before redistributing the snapshots.
- id: DATA-003
  severity: low
  layer: screening_grid
  issue: source_records_unplaceable
  statement: Four monument-zone records were served with coordinates that are not
    L-EST97 metres and were left out at acquisition. They are listed in data/source/acquisition.json.
  mitigation: Recheck when the heritage register corrects the records.
- id: DATA-004
  severity: low
  layer: screening_grid
  issue: temporal_mismatch
  statement: Population refers to 2024; all other layers are snapshots of 22 November
    2026. The criteria follow the plan documents of 4 November 2026, which are a draft
    under public consultation.
  mitigation: Rerun acquire.py and the pipeline when the plan or the sources change.
findings:
- id: remaining_land
  statement: With the 14 mapped exclusion criteria applied, 462 km² of Estonia's 43,468
    km² of land (1.06 %) remains, in 95 contiguous areas of at least 95 ha. Before
    the minimum-area rule 564 km² remains.
  evidence:
  - screening_grid
  - candidate_areas
  - candidate_areas_table
  limitations:
  - 'A screening remainder, not a list of suitable sites: 4 official exclusion criteria
    could not be mapped (Aerodrome protection zones and limitation surfaces; Species
    protection sites; Category I animals; Emergency plan cannot be implemented).'
  - Cells are about 260 m across and are tested at their centre, so features narrower
    than a cell are only sampled.
- id: where
  statement: 'Candidate areas lie in 7 coastal counties: Harju maakond 97 km² in 13
    areas; Pärnu maakond 95 km² in 25 areas; Lääne maakond 87 km² in 15 areas; Saare
    maakond 60 km² in 19 areas; Hiiu maakond 52 km² in 14 areas; Ida-Viru maakond
    36 km² in 5 areas; Lääne-Viru maakond 35 km² in 4 areas.'
  evidence:
  - county_summary
- id: largest_areas
  statement: 'The five largest areas are: no. 1 Vormsi vald, Lääne maakond (3,797
    ha); no. 2 Viru-Nigula vald, Lääne-Viru maakond (2,478 ha); no. 3 Jõelähtme vald,
    Harju maakond (2,237 ha); no. 4 Lääne-Harju vald, Harju maakond (1,857 ha); no.
    5 Saaremaa vald, Saare maakond (1,808 ha).'
  evidence:
  - candidate_areas_table
  limitations:
  - Size is not suitability. Consideration and suitability criteria are reported per
    area but not applied in the accepted run.
- id: official_sites
  statement: 'Of the six official candidate sites of the state special plan, the three
    still under assessment keep most of their 95 ha area in this screen: Letipea 93
    %; Madala 92 %; Malla 88 %. The three sites the plan dropped in October 2026:
    Aa - mets 0 % (centre fails: Distance to the sea (cooling water)); Aa - rand 38
    %; Moldova 0 % (centre fails: Distance from bedrock faults).'
  evidence:
  - official_sites
  - official_sites_check
  limitations:
  - The plan dropped the Lüganuse sites on defence grounds that are not public; this
    screen cannot reproduce that decision.
- id: what_excludes
  statement: 'Distance to the sea decides most: 90 % of the land is farther than 3
    km from it. Among the others, the criteria that alone remove the most land are:
    Distance from dwellings 885 km²; Distance from bedrock faults 556 km².'
  evidence:
  - criteria_catalogue
  limitations:
  - The fault criterion buffers every mapped bedrock fault; none is proven active.
- id: coverage_of_official_criteria
  statement: 'The catalogue holds 53 criteria: 21 mapped as stated, 13 mapped with
    a stand-in, 19 not mapped. Of the 44 catalogue entries taken from the official
    screening table, 26 are mapped.'
  evidence:
  - criteria_catalogue
evidence:
  screening_grid:
    definition:
      path: data/derived/screening-grid.parquet
      format: GeoParquet (EPSG:3301)
      generated_by: require_contiguous_land
      note: One point per land cell (its centre) with every measured value, the result
        of each criterion and the accepted screen.
    files:
    - path: data/derived/screening-grid.parquet
      sha256: sha256:49ab3cc093c744d4b187dcada803b8f3f7114b73caaecdd3159adf65c548d538
  candidate_areas:
    definition:
      path: data/derived/candidate-areas.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: delineate_candidate_areas
    files:
    - path: data/derived/candidate-areas.geojson
      sha256: sha256:c783b3354e579318ce36019a32277194bbdf87daa008e81e900352c30b37f129
  candidate_areas_table:
    definition:
      path: data/derived/candidate-areas.csv
      format: CSV
      kind: table
      generated_by: delineate_candidate_areas
      table:
        key:
        - area_id
        columns:
        - name: area_id
          type: integer
          label: No.
        - name: county
          type: string
          label: County
        - name: municipality
          type: string
          label: Municipality
        - name: area_ha
          type: number
          label: Area
          unit: ha
        - name: cells
          type: integer
          label: Cells
        - name: lon
          type: number
          label: Longitude
          unit: °
        - name: lat
          type: number
          label: Latitude
          unit: °
        - name: sea_km_min
          type: number
          label: Nearest sea
          unit: km
        - name: elevation_m_median
          type: integer
          label: Median height
          unit: m
        - name: grid_330kv_km_min
          type: number
          label: Nearest 330 kV line
          unit: km
        - name: main_road_km_min
          type: number
          label: Nearest main road
          unit: km
        - name: port_km_min
          type: number
          label: Nearest port
          unit: km
        - name: dwelling_m_median
          type: integer
          label: Median distance to a dwelling
          unit: m
        - name: residents_5km_median
          type: integer
          label: Residents within 5 km (median)
          unit: residents
        - name: considerations_flagged
          type: integer
          label: Considerations flagged
        - name: considerations_list
          type: string
          label: Flagged considerations
        - name: advantages_met
          type: integer
          label: Advantages met
        - name: advantages_list
          type: string
          label: Advantages
        - name: in_rep_planning_area
          type: boolean
          label: In the official planning area
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/candidate-areas.csv
      sha256: sha256:07e4a0fc8953d6e96da6105ef5197e6da90d88fedf52610917b98c3f7f7bd1ea
    - path: data/derived/candidate-areas.xlsx
      sha256: sha256:ba683685471142255e0b593162bf3203721c1115583907d84aa2852dccbd0899
  county_summary:
    definition:
      path: data/derived/county-summary.csv
      format: CSV
      kind: table
      generated_by: summarise
      table:
        key:
        - county
        columns:
        - name: county
          type: string
          label: County
        - name: land_km2
          type: number
          label: Land
          unit: km²
        - name: within_cooling_distance_km2
          type: number
          label: Within 3 km of the sea
          unit: km²
        - name: remaining_km2
          type: number
          label: Remaining
          unit: km²
        - name: candidate_km2
          type: number
          label: In candidate areas
          unit: km²
        - name: candidate_areas
          type: integer
          label: Candidate areas
        - name: largest_area_ha
          type: number
          label: Largest area
          unit: ha
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/county-summary.csv
      sha256: sha256:2a6a99f9a601f8dee30de97e5099180ddc91d85e46237890de96313cd4054e51
    - path: data/derived/county-summary.xlsx
      sha256: sha256:0cea5d53c28b2624277aa102b0a29696395923371d75fb55d71148d82f2614db
  official_sites:
    definition:
      path: data/derived/official-sites.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: check_official_sites
    files:
    - path: data/derived/official-sites.geojson
      sha256: sha256:55475337b556d318b747257528ceb4516f4aa470c4bd1e0fe7304df9a73fa399
  official_sites_check:
    definition:
      path: data/derived/official-sites-check.csv
      format: CSV
      kind: table
      generated_by: check_official_sites
      table:
        key:
        - site
        columns:
        - name: site
          type: string
          label: Official site
        - name: rep_status
          type: string
          label: Status in the plan
        - name: municipality
          type: string
          label: Municipality
        - name: cells_in_95ha_area
          type: integer
          label: Cells in the 95 ha area
        - name: cells_remaining
          type: integer
          label: Cells remaining
        - name: cells_in_candidate_area
          type: integer
          label: Cells in a candidate area
        - name: share_remaining_pct
          type: number
          label: Share remaining
          unit: '%'
        - name: centre_passes
          type: boolean
          label: Centre passes
        - name: centre_fails
          type: string
          label: Centre fails
        - name: main_exclusions_in_area
          type: string
          label: Exclusions inside the area
        - name: sea_km
          type: number
          label: Sea
          unit: km
        - name: elevation_m
          type: integer
          label: Height
          unit: m
        - name: grid_330kv_km
          type: number
          label: 330 kV line
          unit: km
        - name: residents_5km
          type: integer
          label: Residents within 5 km
          unit: residents
        - name: lon
          type: number
          label: Longitude
          unit: °
        - name: lat
          type: number
          label: Latitude
          unit: °
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/official-sites-check.csv
      sha256: sha256:ddd8c9ec614d989e49e38f375e27a9775c4a6bcb81793f86f3ebce3c3a342e3e
    - path: data/derived/official-sites-check.xlsx
      sha256: sha256:6c981e51504253da16d2d7df195719826bb5fb5a04895141a9eb95e366e377dd
  criteria_catalogue:
    definition:
      path: data/derived/criteria-catalogue.csv
      format: CSV
      kind: table
      generated_by: summarise
      table:
        key:
        - id
        columns:
        - name: id
          type: string
          label: Id
        - name: group
          type: string
          label: Group
        - name: name
          type: string
          label: Criterion
        - name: name_et
          type: string
          label: Official name (Estonian)
        - name: class
          type: string
          label: Class
        - name: origin
          type: string
          label: Origin
        - name: official_ref
          type: number
          label: Official row
        - name: status
          type: string
          label: Mapping status
        - name: in_accepted_run
          type: boolean
          label: In the accepted run
        - name: rule
          type: string
          label: Rule
        - name: threshold
          type: number
          label: Threshold
        - name: unit
          type: string
          label: Unit
        - name: fails_km2
          type: number
          label: Land failing
          unit: km²
        - name: fails_pct_of_land
          type: number
          label: Land failing
          unit: '%'
        - name: sole_exclusion_km2
          type: number
          label: Removed by this criterion alone
          unit: km²
        - name: official_threshold
          type: string
          label: Official threshold
        - name: note
          type: string
          label: Note
      downloads:
      - csv
      - xlsx
    files:
    - path: data/derived/criteria-catalogue.csv
      sha256: sha256:0d2c29e4ef078f8cebbd49259426977c8893e3563000a312d2c0e85394b81faf
    - path: data/derived/criteria-catalogue.xlsx
      sha256: sha256:9d5fbcfab7e23b265db28b93e1d798cea519c631e7961f80c22daa2b369ba260
---
# Findings

Site selection for a future nuclear power station in Estonia: which known and logical preconditions apply, how strong is each, and which land remains when a chosen set of them is applied?

Scope: All land of Estonia (15 counties), screened on a grid of about 260 m cells.. Run: `run-20261122-175153`. Validation: **warning**.

## remaining_land

With the 14 mapped exclusion criteria applied, 462 km² of Estonia's 43,468 km² of land (1.06 %) remains, in 95 contiguous areas of at least 95 ha. Before the minimum-area rule 564 km² remains.

Evidence:

- [screening_grid](data/derived/screening-grid.parquet)
- [candidate_areas](data/derived/candidate-areas.geojson)
- [candidate_areas_table](data/derived/candidate-areas.csv)
- [candidate_areas_table (xlsx)](data/derived/candidate-areas.xlsx)

Limitation: A screening remainder, not a list of suitable sites: 4 official exclusion criteria could not be mapped (Aerodrome protection zones and limitation surfaces; Species protection sites; Category I animals; Emergency plan cannot be implemented).

Limitation: Cells are about 260 m across and are tested at their centre, so features narrower than a cell are only sampled.

## where

Candidate areas lie in 7 coastal counties: Harju maakond 97 km² in 13 areas; Pärnu maakond 95 km² in 25 areas; Lääne maakond 87 km² in 15 areas; Saare maakond 60 km² in 19 areas; Hiiu maakond 52 km² in 14 areas; Ida-Viru maakond 36 km² in 5 areas; Lääne-Viru maakond 35 km² in 4 areas.

Evidence:

- [county_summary](data/derived/county-summary.csv)
- [county_summary (xlsx)](data/derived/county-summary.xlsx)

## largest_areas

The five largest areas are: no. 1 Vormsi vald, Lääne maakond (3,797 ha); no. 2 Viru-Nigula vald, Lääne-Viru maakond (2,478 ha); no. 3 Jõelähtme vald, Harju maakond (2,237 ha); no. 4 Lääne-Harju vald, Harju maakond (1,857 ha); no. 5 Saaremaa vald, Saare maakond (1,808 ha).

Evidence:

- [candidate_areas_table](data/derived/candidate-areas.csv)
- [candidate_areas_table (xlsx)](data/derived/candidate-areas.xlsx)

Limitation: Size is not suitability. Consideration and suitability criteria are reported per area but not applied in the accepted run.

## official_sites

Of the six official candidate sites of the state special plan, the three still under assessment keep most of their 95 ha area in this screen: Letipea 93 %; Madala 92 %; Malla 88 %. The three sites the plan dropped in October 2026: Aa - mets 0 % (centre fails: Distance to the sea (cooling water)); Aa - rand 38 %; Moldova 0 % (centre fails: Distance from bedrock faults).

Evidence:

- [official_sites](data/derived/official-sites.geojson)
- [official_sites_check](data/derived/official-sites-check.csv)
- [official_sites_check (xlsx)](data/derived/official-sites-check.xlsx)

Limitation: The plan dropped the Lüganuse sites on defence grounds that are not public; this screen cannot reproduce that decision.

## what_excludes

Distance to the sea decides most: 90 % of the land is farther than 3 km from it. Among the others, the criteria that alone remove the most land are: Distance from dwellings 885 km²; Distance from bedrock faults 556 km².

Evidence:

- [criteria_catalogue](data/derived/criteria-catalogue.csv)
- [criteria_catalogue (xlsx)](data/derived/criteria-catalogue.xlsx)

Limitation: The fault criterion buffers every mapped bedrock fault; none is proven active.

## coverage_of_official_criteria

The catalogue holds 53 criteria: 21 mapped as stated, 13 mapped with a stand-in, 19 not mapped. Of the 44 catalogue entries taken from the official screening table, 26 are mapped.

Evidence:

- [criteria_catalogue](data/derived/criteria-catalogue.csv)
- [criteria_catalogue (xlsx)](data/derived/criteria-catalogue.xlsx)

## Assumptions and limitations

- The study area is the land of Estonia: every grid cell whose centre lies inside a county polygon of the official administrative division. A plant stands on land. County polygons follow the shoreline and include islands; inland lakes are handled by their own criterion.
- The screen is made on a grid aligned to Web Mercator with 500 m steps, about 255 to 270 m on the ground. Every test is made at the cell centre: a cell is inside an area when its centre is, and distances run from the centre. A fixed grid lets any set of criteria be combined in the view without measuring in the browser. Aligning it to the map projection lets it be drawn exactly. All measuring is done in EPSG:3301.
- The accepted run applies every mapped criterion of class 'exclusion' at the official threshold and no criterion of class 'consideration' or 'suitability'. The official method removes exclusion areas first and weighs the other criteria site by site, without a summed score. Considerations are reported per candidate area and can be switched on in the view.
- Cooling water is taken from the sea, and the accepted threshold is the open-cycle one: at most 3 km from the sea in a straight line. The ministry states that no Estonian river has enough flow. The 2023 analysis used 3 km for open-cycle and 10 km for closed-cycle cooling; both are offered.
- Every bedrock fault of the 1:400 000 geological map is buffered by 5 km, as the 2023 screening did, although no Estonian fault is proven active. The official criterion concerns active faults, which only site investigations can establish. Buffering all mapped faults is the conservative screening choice and is switchable.
- A cell is too close to homes when its centre is nearer than 350 m to a residential building footprint. The plan keeps 350 m between dwellings and the reactor. Public buildings and plot boundaries, which the plan also excludes, are not in the open layer used.
- Enough land means remaining cells joined edge to edge that add up to at least 95 ha. The plan estimates 95 ha for two BWRX-300 units with their buffer. Diagonal contact does not join cells.
- Distances are straight lines from the cell centre to points placed every 25 m along the target lines and outlines, and are stored in whole units (50, 100 or 250 m) rounded down. The error is at most about 13 m, far below the cell size. Every offered threshold is a multiple of the unit, so stored values reproduce each rule exactly.
- Where the official rule needs data that is not open, a stand-in is used and the criterion is marked 'proxy'; where there is no usable stand-in the criterion is listed as 'not mapped' and plays no part. The catalogue should show the whole official list and be explicit about what this screen can and cannot reproduce.
- Three exclusion criteria come from outside the plan's 47-row screening table: limited-conservation areas (an exclusion layer of the plan's public map), lakes and reservoirs, and 5 km from the land border (both exclusions of the 2023 nationwide analysis). The plan's table was written for a planning area that these do not touch; a nationwide screen needs them.
- This is a desk screen on open data, not a site assessment. Four official exclusion criteria are not mapped (aerodrome protection zones, species protection sites, category I animals, feasibility of the emergency plan), and the non-public security criteria are absent. A remaining cell is not a suitable site.
- Cells are about 260 m across and tested at their centre. Features narrower than a cell, such as single-object zones, monument zones, small key habitats and the shore building-ban zone, are sampled rather than fully represented, and the 350 m dwelling distance is measured from the centre.
- The fault criterion buffers every mapped bedrock fault by 5 km. No Estonian fault is proven active, and the official plan judges faults site by site. This criterion alone removes several hundred square kilometres of coast.
- The plan dropped its three Lüganuse sites in October 2026 on defence grounds that are not public. Public defence sites and their zones are mapped here; the non-public considerations are not.
- The map service that publishes the official sites and planning area (gis.skpk.ee) states no licence. The geometries are public planning material of a state special plan.
- Four monument-zone records were served with coordinates that are not L-EST97 metres and were left out at acquisition. They are listed in data/source/acquisition.json.
- Population refers to 2024; all other layers are snapshots of 22 November 2026. The criteria follow the plan documents of 4 November 2026, which are a draft under public consultation.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)

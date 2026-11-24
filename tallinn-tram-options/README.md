# Tallinn new tram line options

**Question.** Tallinn has been discussing several options for a new tram line, with different routes. Which of them
would serve the most people, workplaces and services, and how do they stand in the city's strategies and plans?

**Answer (run of 24 November 2026).** Thirteen alignments discussed between 2019 and November 2026 were routed along
the real street network and measured at a 500 m walk to modelled stops. **No option is best on every count, and the
one funded line is not among the strongest on reach.**

| # | Line | Status in November 2026 | km | Residents in reach | of them new to tram | Workplace floor, 1000 m² | Services | Strategy fit (0–3) | Score |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Lasnamäe – Gonsiori and Laagna tee | Study corridor; trolleybus chosen | 7.0 | 35,047 | 28,203 | 832 | 42 | 1.00 | 67.1 |
| 2 | Mustamäe – Sõpruse pst | Study corridor; trolleybus policy | 5.0 | 32,600 | 32,600 | 224 | 26 | 1.00 | 59.5 |
| 3 | Sõle – Kristiine to Kopli line | Study corridor, prospective | 4.0 | 22,572 | 19,212 | 279 | 34 | 1.75 | 59.0 |
| 4 | Lasnamäe – Narva mnt and Rahu tee | Named as a candidate in 2026 | 6.4 | 29,748 | 26,859 | 169 | 15 | 2.00 | 57.8 |
| 5 | Kristiine – Endla, Suur-Ameerika, Liivalaia | Shelved with the Liivalaia tram | 2.3 | 14,126 | 8,870 | 794 | 39 | 2.00 | 56.5 |
| 6 | Liivalaia – Pärnu mnt to Tartu mnt | Abandoned December 2025 | 1.3 | 10,707 | 4,619 | 765 | 34 | 2.00 | 53.5 |
| 7 | Lasnamäe – Narva mnt, Lavamaa, Läänemere tee | Study variant, judged too tight | 7.6 | 27,711 | 24,715 | 201 | 16 | 1.75 | 53.4 |
| 8 | Kristiine – Kaarli pst, Estonia pst, Gonsiori | Alternative in the draft Kesklinn plan | 1.9 | 10,754 | 4,702 | 898 | 48 | 1.50 | 52.9 |
| 9 | Haabersti – Paldiski mnt | Study corridor; trolleybus chosen | 5.3 | 13,545 | 13,545 | 449 | 18 | 1.00 | 41.9 |
| 10 | Kalaranna – Tööstuse to Kopli | Studied 2019 and 2022 | 3.6 | 12,743 | 6,864 | 350 | 12 | 1.25 | 39.9 |
| 11 | **Pelguranna – Putukaväil to Kolde pst** | **Funded, in design (2029)** | 1.8 | 10,254 | 9,135 | 147 | 7 | 2.50 | 37.7 |
| 12 | Pelguranna – Puhangu to Stroomi park | Dropped February 2026 | 2.1 | 13,166 | 12,326 | 146 | 9 | 1.50 | 37.1 |
| 13 | Järve – Tondi to Järve keskus | Planned in SUMP 2035, no funding | 1.7 | 5,174 | 677 | 326 | 10 | 1.75 | 27.4 |

Score: the "balanced" weighting, out of 100. What the numbers say:

- **The largest gains are in districts with no tram.** Lasnamäe (Laagna tee or the Rahu tee corridor) and Mustamäe
  would each bring 27–33 thousand residents newly within reach. Today 66,400 residents (14.6 %) live within 500 m
  of a tram stop. The city has chosen trolleybuses for Laagna tee, Mustamäe and Paldiski mnt.
- **City-centre links add destinations, not residents.** Liivalaia and the Kaarli pst – Estonia pst alternative
  reach 765–898 thousand m² of workplace floor area but fewer than 5,000 new residents each.
- **Pelguranna.** The funded route reaches about 3,000 fewer residents than the route dropped in February 2026. It
  has the best strategy fit of all options and ranks 11th on reach.
- **Sõle** is the only option in the top five under all five weightings. **Järve** adds the fewest new residents.
- **The top option depends on the weighting:** people first – Laagna tee; growth and jobs – Sõle; value per km –
  Mustamäe; plan-led – the Rahu tee corridor.

`findings.md` holds the full statements with their evidence and limits.

## Open it

- **Dashboard:** `dashboard.html` (serve the folder: `python -m http.server`, then open `/dashboard.html`). Walking
  distance (300–800 m) and weighting are live controls; anything other than 500 m and "balanced" is labelled
  exploratory. Select a line to see its catchment, the buildings it would newly reach, its indicators, the documents
  behind its strategy fit and how it was drawn.
- **Tables:** `data/derived/option-summary`, `option-matrix`, `option-scores`, `existing-tram-coverage` (CSV and XLSX).

## Method

1. **Options** are declared in `scenarios/tram-options.yaml`: ordered waypoints (existing stops, street junctions,
   one registered address), the streets followed, published figures, a strategy rubric and the evidence. No
   coordinate is typed by hand.
2. **Routing.** Each line is the shortest path between its waypoints over the Overture Maps street network, where a
   street the option does not name costs eight times its length. The Rahu tee line follows the city's published
   drawing of the 2019 study corridor, because the street is not built. `build_scenarios.py` stores the lines in
   `data/overrides/options/`; every run re-routes the definitions and rejects an option whose stored geometry
   disagrees.
3. **Check against the city's own drawings.** 12 of 13 routed lines lie at least 60 % within 75 m of a corridor the
   city has published (2019 study or planning documents); most are above 85 %.
4. **Stops** are modelled every 500 m. Walking distance is measured along paths from every building to the nearest
   stop, for the existing network and for each option.
5. **Residents:** the Statistics Estonia 1 km grid (2024) shared among registered dwellings by net floor area. The
   estimate (454,042) is within 0.3 % of the city's register total, and correlates 0.997 with it over the 84
   sub-districts, which the model does not use.
6. **Workplaces:** net floor area of registered non-residential buildings (offices, retail, hospitality, industry,
   public buildings). **Services:** the city's lists of schools, kindergartens, higher education, hospitals,
   pharmacies, shopping centres, markets and libraries. **Growth:** registered homes planned or under construction,
   and detailed plans in process.
7. **Strategy fit (0–3):** place in the mobility plan SUMP 2035, stage in the 2019 feasibility study, and the city
   government's position in 2026, scored with one rubric and listed with sources per option.
8. **Score:** seven criteria, each as a share of the best option, under five declared weightings.

All metric work is in EPSG:3301 (L-EST97). `project.yaml` holds every source, assumption, parameter and step.

An outside comparison: the city's own note on the Pelguranna route gives 5,169 residents within 400 m of stops for
the funded route and 7,689 for the dropped one. This model gives 5,348 and 8,381 at a 400 m network walk.

## Limits

- **The lines are hypothetical.** They are a reading of public descriptions, not designed alignments, and the stops
  are placed by rule. Use the results to compare corridors, not to judge a design.
- **The score is not a cost-benefit result.** Ridership, travel time, construction cost and traffic effects are not
  modelled. Longer lines reach more people in total. Published costs are quoted per option but come from different
  years and extents, so they are not in the score.
- **Strategy fit is a judgement** applied to documents and news up to 24 November 2026. Both the Liivalaia and the
  Pelguranna decisions changed within the last year.
- **Growth is under-measured.** Planned buildings are counted only once they have a footprint, and plans in process
  carry no dwelling numbers. Large future districts such as the Kopli goods station are under-represented.
- **Lines outside Tallinn** (Viimsi, Peetri and Jüri, Maardu, Tabasalu) are left out: the building register layer
  covers the city only.
- **Licence:** the Tallinn city ArcGIS services and the GTFS feed publish no licence text. This is why the run status
  is `warning`, not `validated`.

## Rerun

```bash
python -m pip install -r requirements.txt
openmapstack validate project.yaml          # audit the manifest and the last run
openmapstack run project.yaml               # canonical run (about 25 s)
openmapstack verify project.yaml --rerun    # rebuild in an empty workspace and compare
```

`python pipeline.py` is the same canonical path without the CLI. It reads only `data/source/`, `data/overrides/` and
`scenarios/`; nothing is downloaded during a run. `python acquire.py` re-pulls the source snapshots and records
counts and hashes in `data/source/acquisition.json`; update the pins in `project.yaml` after a refresh. After
editing `scenarios/tram-options.yaml`, run `python build_scenarios.py` to regenerate the stored scenario geometry.

## Files

| Path | What |
|---|---|
| `project.yaml` | Canonical manifest (`openmapstack-project/v1`) |
| `scenarios/tram-options.yaml` | The 13 options: waypoints, streets, published figures, strategy rubric, evidence |
| `pipeline.py` | Analysis, in fifteen commented steps |
| `view.py`, `dashboard.template.html` | Validation stage, dashboard, findings, run record |
| `acquire.py`, `build_scenarios.py` | How the source snapshots and the scenario geometry were made |
| `data/source/` | Immutable source snapshots (32 MB) and `acquisition.json` |
| `data/overrides/options/` | Scenario geometry of each option (hypothetical) |
| `data/derived/` | Outputs: options, stops, catchments, buildings (GeoParquet), services, plans, tables |
| `findings.md`, `validation/latest-report.json`, `runs/` | Findings, machine-readable checks, run records |
| `vendor/` | MapLibre GL JS 5.6.0 (BSD-3-Clause) |

## Sources and attribution

- Tallinn City Government GIS – districts, building register copy (ETAK and EHR), planning register, services,
  tram tracks, corridors of the 2019 study and of planning documents.
- Tallinn Transport Department – GTFS timetables.
- Statistics Estonia – population on a 1 km grid, via the Maa- ja Ruumiamet INSPIRE service.
- Overture Maps Foundation – transportation segments, © OpenStreetMap contributors (ODbL).
- Basemap: © OpenStreetMap contributors, Protomaps tiles by goplex.ee.
- Documents: Tallinn sustainable urban mobility plan 2035; Tallinn and Harju light-rail feasibility study (2019);
  tram street-space study (2022); city releases and ERR reporting, linked per option in the dashboard.

Made with AI using the free [OpenMapStack toolkit](https://github.com/jaakla/openmapstack-skills).

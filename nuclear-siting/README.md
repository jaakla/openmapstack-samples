# Estonia – screening for a nuclear power plant site

**Question.** Which preconditions apply to siting a nuclear power plant in Estonia, how strong is each, and which
land remains when a chosen set of them is applied?

**Answer (run of 22 November 2026).** With the 14 exclusion criteria that open data can support, **462 km² of
Estonia's 43,468 km² of land (1.06 %) remains, in 95 contiguous areas of at least 95 ha**, all within 3 km of the
sea in seven coastal counties. This is a desk screen, not a site assessment: four official exclusion criteria and
the non-public security criteria are not mapped, so a remaining area is not a suitable site.

| County | Remaining | Areas |
|---|---:|---:|
| Harju | 97 km² | 13 |
| Pärnu | 95 km² | 25 |
| Lääne | 87 km² | 15 |
| Saare | 60 km² | 19 |
| Hiiu | 52 km² | 14 |
| Ida-Viru | 36 km² | 5 |
| Lääne-Viru | 35 km² | 4 |

The screen agrees with the official process where the two can be compared. The second-largest area (2,478 ha,
Viru-Nigula) holds the three sites the state special plan still assesses, and they keep 88–93 % of their 95 ha in
this screen. Of the three Lüganuse sites the plan dropped in October 2026, two fail here as well (Aa-mets is
3.7 km from the sea, Moldova is within 5 km of a mapped fault); the plan dropped them on defence grounds that are
not public.

Distance to the sea decides most: 90 % of the land is more than 3 km from it. Among the rest, the 350 m distance
from dwellings alone removes 885 km² and the fault buffer 556 km².

## Open it

- **Dashboard:** `dashboard.html` (serve the folder: `python -m http.server`, then open it). The **Criteria** tab
  lists every mapped criterion with a switch, its threshold and a **Show** button that draws the cells failing it.
  Anything other than the accepted run is labelled exploratory. Click the map for the measured values of a cell.
- **Findings:** `findings.md`, written by the pipeline from the run's results.
- **Tables:** `data/derived/candidate-areas`, `criteria-catalogue`, `county-summary`, `official-sites-check`
  (`.csv` and `.xlsx`).
- **Grid:** `data/derived/screening-grid.parquet`, one point per cell with every measured value (EPSG:3301).

## Prestudy: the criteria

Estonia is choosing a site through a state special plan (riigi eriplaneering) led by the Ministry of Economic
Affairs and Communications. The ministry's adviser spoke of 40 criteria in September 2026. The published tables
are longer:

- **Screening table**, 4 November 2026: 47 rows in 11 groups. 17 are exclusionary (*välistav*), 26 are
  considerations (*kaalutluskoht*) and 4 are positive considerations, where nearness is an advantage.
- **Comparison table**, same date: 46 criteria in 10 groups, used to rank the sites that survive. Each gets a plus,
  zero or minus per site. There are no weights and no summed score.
- **Priority criteria:** security, external hazards, population and sensitive objects in the urgent
  protective-action area, and distance from the sea. A significant minus on one cannot be offset by the others.
- **2023 nationwide analysis**, which the screening table descends from: 60 criteria. It added a 5 km distance
  from the land border and treated flood areas and salmon rivers as exclusions; the plan downgraded those.

`criteria.yaml` holds the catalogue: every screening-table row, the extra spatial criteria of 2023 and four
criteria this project adds, with the Estonian name, class, official threshold and how it is mapped. The dashboard
and `criteria-catalogue.csv` are written from it.

| Class | In the catalogue | Mapped as stated | Mapped with a stand-in | Not mapped |
|---|---:|---:|---:|---:|
| Exclusion | 18 | 12 | 2 | 4 |
| Consideration | 31 | 7 | 9 | 15 |
| Suitability | 4 | 2 | 2 | 0 |

Rows 22–25 of the screening table (strict reserves, national parks, nature and landscape protection areas) are
one catalogue entry, because one register layer holds them. Row 40 (existing buildings) is a consideration in the
table, but its note makes dwellings exclusionary, and the catalogue follows the note.

**Exclusion criteria applied in the accepted run**

| Criterion | Rule | Official basis |
|---|---|---|
| Cooling water | more than 3 km from the sea fails | row 3; 3 km open cycle, 10 km closed cycle |
| Bedrock faults | closer than 5 km fails | row 18; 5 km from an active fault |
| Dwellings | closer than 350 m fails | row 40; 350 m from dwellings to the reactor |
| Land border | closer than 5 km fails | 2023 criterion 6 |
| Underground mining | inside fails | row 17 |
| Heritage monuments and zones | inside fails | row 21 |
| Protected areas | inside fails | rows 22–25 |
| Natura 2000 | inside fails | row 26 |
| Limited-conservation areas | inside fails | exclusion layer of the plan's public map |
| Protected single objects | inside fails | row 27 |
| Woodland key habitats | inside fails | row 28 |
| Defence sites and zones | inside fails | row 41 |
| Lakes and reservoirs | inside fails | 2023 criterion 57 |
| Enough land | remaining cells joined edge to edge below 95 ha fail | row 47; 95 ha for two BWRX-300 units |

**Exclusion criteria that are not mapped:** aerodrome protection zones and limitation surfaces (row 9, no open
nationwide layer), species protection sites (row 29) and category I animals (row 33, both served to authorised
users only), and the feasibility of the emergency plan (row 46, an expert assessment).

**Considerations offered as switches, off in the accepted run:** ground elevation (below 20 or 50 m), population
density (200 per km²), residents within 5 km, densely built-up areas, hazardous establishments, aerodromes,
gas transmission pipelines, karst, mires, mineral deposits, basement faults, flood areas, green network,
unprotected groundwater and the shore building-ban zone. **Suitability:** 330 kV grid, main road, railway and port
within reach.

**Not reproduced at all:** depth of the sea, tanker traffic, slopes, liquefaction, buried valleys, erosion,
protected species records, salmon rivers, infrastructure zones, land value and use, and the Ministry of Defence's
consideration areas.

Official documents: [screening table](https://riigiplaneering.ee/sites/default/files/documents/2026-11/3.%20Screening%20kriteeriumite%20tabel_T%C3%A4iendatud.pdf),
[comparison table](https://riigiplaneering.ee/sites/default/files/documents/2026-11/2.%20V%C3%B5rdluskriteeriumite%20tabel_t%C3%A4iendatud.pdf),
[initial positions and assessment programme](https://riigiplaneering.ee/sites/default/files/documents/2026-11/LS-programm.pdf),
[2023 spatial analysis](https://kliimaministeerium.ee/sites/default/files/documents/2023-04/Tuumaelektrijaama%20ja%20kasutatud%20tuumk%C3%BCtuse%20l%C3%B5ppladustuspaiga%20potentsiaalsete%20asukohtade%20ruumianal%C3%BC%C3%BCs.pdf),
[its interim report with thresholds](https://kliimaministeerium.ee/sites/default/files/documents/2023-01/Ruumianal%C3%BC%C3%BCsi%20vahearuanne.pdf).
The plan documents are a draft under public consultation. English criterion names are this project's translations.

## Method

1. **Grid.** A grid aligned to Web Mercator with 500 m steps, about 255–270 m on the ground: 641,370 land cells.
   A cell is land when its centre lies in a county polygon. Aligning the grid to the map projection lets the
   browser draw it exactly; nothing is measured in that projection.
2. **Measuring.** Everything is measured at the cell centre in EPSG:3301 (L-EST97). A cell is inside an area when
   its centre is. Distances are straight lines to points placed every 25 m along the target lines and outlines.
   Cell areas are geodesic.
3. **Rules.** Each mapped criterion is a rule on a measured value. Distances are stored in whole units of 50, 100
   or 250 m, rounded down, and every offered threshold is a multiple of the unit, so the stored value reproduces
   the rule exactly.
4. **Accepted run.** Every mapped exclusion criterion at its official threshold, no consideration or suitability
   criterion. Remaining cells joined edge to edge must then add up to 95 ha.
5. **View.** The dashboard holds the measured values of every cell and re-applies the rules for whichever
   criteria and thresholds are switched on. It measures nothing itself. At the accepted settings it recomputes the
   pipeline's result and says whether the two agree.

`project.yaml` holds every source, assumption, parameter and step.

## Limits

- **A screen, not a siting decision.** Unmapped exclusion criteria, non-public security criteria and all site
  investigations are missing. The state special plan and its strategic environmental assessment decide suitability.
- **Resolution.** Cells are about 260 m across and tested at their centre. Features narrower than a cell (single
  objects, monument zones, small key habitats, the shore building-ban zone) are sampled, not fully represented.
- **Faults.** Every mapped bedrock fault of the 1:400 000 geological map is buffered by 5 km, as the 2023 screening
  did. No Estonian fault is proven active, and the plan judges faults site by site.
- **Stand-ins.** Hazardous establishments, aerodromes and gas pipelines use fixed distances where the official rule
  is a per-object legal zone. Grid connection is measured to 330 kV lines, not substations. The port layer does not
  separate cargo ports. Key habitats include uncontracted ones on private land. Dwellings do not include public
  buildings or plot boundaries.
- **Dates.** Population is for 2024; other layers are snapshots of 22 November 2026.
- **Source defects.** Four monument-zone records were served with coordinates that are not L-EST97 metres and were
  left out; they are listed in `data/source/acquisition.json`.
- **Licence.** The map service that publishes the official sites and planning area states no licence. This is why
  the run status is `warning`, not `validated`.

## Rerun

```bash
python -m pip install -r requirements.txt
openmapstack validate project.yaml          # audit the manifest and the last run
openmapstack run project.yaml               # canonical run (about 50 s)
openmapstack verify project.yaml --rerun    # rebuild in an empty workspace and compare
```

`python pipeline.py` is the same canonical path without the CLI. It reads only `data/source/` and `criteria.yaml`;
nothing is downloaded during a run. `python acquire.py` re-pulls the snapshots (it needs network access to
gsavalik.envir.ee, teenus.maaamet.ee, inspire.geoportaal.ee and gis.skpk.ee) and records counts and hashes in
`data/source/acquisition.json`; update the pins in `project.yaml` after a refresh.

To change a criterion, edit `criteria.yaml` and the matching control in `project.yaml`; validation fails when the
two disagree.

## Files

| Path | What |
|---|---|
| `project.yaml` | Canonical manifest (`openmapstack-project/v1`) |
| `criteria.yaml` | The criteria catalogue: class, official threshold, rule, mapping status |
| `pipeline.py` | Analysis, in ten commented steps |
| `view.py`, `dashboard.template.html` | Validation stage, dashboard, findings, run record |
| `acquire.py` | How the source snapshots were pulled |
| `data/source/` | Immutable source snapshots (189 MB) and `acquisition.json` |
| `data/derived/` | Screening grid, candidate areas, official sites, reference features, tables |
| `findings.md`, `validation/latest-report.json`, `runs/` | Findings, machine-readable checks, run records |
| `vendor/` | MapLibre GL JS 5.6.0 (BSD-3-Clause) |

## Sources and attribution

- Maa- ja Ruumiamet (Land and Spatial Development Board): administrative boundaries, Estonian Topographic Database
  (sea, power lines, main roads, railways), terrain model, geological base map, register of mineral deposits,
  restrictions register (defence, gas), residential buildings, points of interest (airfields, ports).
- Keskkonnaagentuur (Estonian Environment Agency), EELIS nature register: protected and conservation areas,
  Natura 2000, key habitats, single objects, karst, lakes, mires, flood areas.
- Muinsuskaitseamet (National Heritage Board): monuments and their protection zones.
- Päästeamet (Rescue Board): hazardous establishments.
- Statistics Estonia: population on a 1 km grid, 2024.
- Ministry of Economic Affairs and Communications with Skepast&Puhkim OÜ: candidate sites and planning area of the
  state special plan.
- Basemap: © OpenStreetMap contributors, Protomaps tiles by goplex.ee.

Made with AI using the free [OpenMapStack toolkit](https://github.com/jaakla/openmapstack-skills).

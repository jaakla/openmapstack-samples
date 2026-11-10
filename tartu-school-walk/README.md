# Tartu schools – 15-minute walking coverage

**Question.** Which parts of Tartu, and what share of its residents, are more than a 15-minute walk from a school?

**Answer (run of 10 November 2026).** About **16.8 % of residents – roughly 16,700 of 99,400 – live beyond a
15-minute walk (1,200 m along paths) of the nearest basic school.** Two areas hold almost half of them:

| # | Unserved area | Residents (est.) | Median walk |
|---|---|---:|---:|
| 1 | Raadi-Kruusamäe, Kvissentali and the northern edge of Ülejõe | 4,590 | 29 min |
| 2 | Ihaste | 3,240 | 37 min |
| 3 | Western Tammelinna, Variku edge, Maarjamõisa | 1,950 | 17 min |
| 4 | Ränilinna | 1,360 | 26 min |
| 5 | Märja | 570 | 43 min |

Ihaste, Ränilinna, Kvissentali and most rural settlements have no home within 15 minutes; the centre, Vaksali,
Veeriku and Ilmatsalu alevik are fully covered. `data/derived/area-summary.csv` has every district and settlement.

The result moves with the definition, and the pipeline measures all of these:

| Schools counted | 10 min | **15 min** | 20 min |
|---|---:|---:|---:|
| Basic schools, municipal and private (23) | 36.3 % | **16.8 %** | 12.1 % |
| Municipal basic schools only (16) | 40.1 % | 19.2 % | 13.6 % |
| Every school record, incl. special-needs and upper-secondary (40) | 31.8 % | 14.8 % | 11.7 % |

Residents per building are an estimate, and schools outside Tartu are not counted; read the limits below before
using the numbers.

## Open it

- **Dashboard:** `dashboard.html` (open the file, or serve the folder: `python -m http.server`). Walk limit and
  school set are live controls; anything other than the accepted run is labelled exploratory.
- **QGIS:** `project.qgz`, opened from this folder. Same layers and styles, EPSG:3301, Maa- ja Ruumiamet base map.
- **Tables:** `data/derived/area-summary.{csv,xlsx}`, `data/derived/coverage-matrix.{csv,xlsx}`.

## Method

1. **Schools** come from Tartu City Government's education layer (42 school records). The accepted set is the
   basic schools open to ordinary enrolment: type 1 (school of residence), 2 (citywide) and 4 (other, mostly
   private). Two type-4 records are excluded by documented overrides: the University of Tartu Youth Academy and
   the basic stage of Tartu Adult Gymnasium.
2. **Walking network:** Overture Maps transportation segments (OpenStreetMap-derived, release 2026-10-21.0),
   split at connectors into a 3,125 km graph with a routing node at least every 20 m. Motorways and segments
   closed to pedestrians are excluded.
3. **Distance:** shortest network distance from every node to the nearest school, plus the straight-line gaps at
   both ends. 4.8 km/h, so 15 minutes is 1,200 m.
4. **Residents:** Statistics Estonia's official 1 km population grid (2024) is shared among residential building
   footprints in each cell by footprint area × floors. A footprint is residential if Overture classes it as a
   dwelling, or if it is unclassed and stands on a cadastral parcel with residential land use.
5. **Served or not** is decided per building from its own measured distance. Walkshed polygons only draw the
   network reach; unserved areas are unserved homes buffered by 60 m and merged.

All metric work is in EPSG:3301 (L-EST97). `project.yaml` holds every source, assumption, parameter and step.

## Limits

- **Residents per building are modelled.** Cell totals are official; the split inside a cell is not. District
  percentages are solid, counts for small pockets are indicative. The estimated total (99,425) is in line with
  the roughly 98–100 thousand residents Statistics Estonia reports for Tartu.
- **Schools outside Tartu are missing.** Märja and other border areas may have a closer school in a neighbouring
  municipality, so their walking times are upper bounds.
- **Network quality is OpenStreetMap's.** School points are not verified gates; fences and informal shortcuts are
  not modelled. 4.8 km/h is an adult speed.
- **Dates differ:** population 2024, schools and parcels November 2026, network and footprints October 2026.
- **Licence:** the Tartu city ArcGIS services publish no licence text for the school and boundary layers. This is
  why the run status is `warning`, not `validated`.

## Rerun

```bash
python -m pip install -r requirements.txt 'openmapstack[geo]==0.4.0'
openmapstack validate project.yaml          # audit the manifest and the last run
openmapstack run project.yaml               # canonical run (about 30 s)
openmapstack verify project.yaml --rerun    # rebuild in an empty workspace and compare
```

`python pipeline.py` is the same canonical path without the CLI. It reads only `data/source/`; nothing is
downloaded during a run. `python acquire.py` re-pulls the source snapshots (it needs network access to
gis.tartulv.ee, inspire.geoportaal.ee and the Overture S3 bucket) and records counts and hashes in
`data/source/acquisition.json`; update the pins in `project.yaml` after a refresh.

QGIS is optional. When PyQGIS is importable (set `OMS_QGIS_PYTHON` to its interpreter if it is not found),
`qgis_build.py` writes `project.qgz` through the QGIS API, reopens it and checks that every layer is valid and
paints. Without QGIS a standalone XML builder writes the same layer tree and the runtime check is reported
`not_testable`.

## Files

| Path | What |
|---|---|
| `project.yaml` | Canonical manifest (`openmapstack-project/v1`) |
| `pipeline.py` | Analysis, in fifteen commented steps |
| `view.py`, `qgis_build.py`, `dashboard.template.html` | QGIS project, validation stage, dashboard, run record |
| `acquire.py` | How the source snapshots were pulled |
| `data/source/` | Immutable source snapshots (19 MB) and `acquisition.json` |
| `data/derived/` | Outputs: buildings (GeoParquet), schools, walksheds, unserved areas, tables, GeoPackage for QGIS |
| `validation/latest-report.json`, `runs/` | Machine-readable checks and run records |
| `vendor/` | MapLibre GL JS 5.6.0 (BSD-3-Clause) |

## Sources and attribution

- Tartu City Government GIS – education institutions, administrative division, cadastral parcels.
- Statistics Estonia – population on a 1 km grid, via the Maa- ja Ruumiamet INSPIRE service (CC0).
- Overture Maps Foundation – transportation and buildings, © OpenStreetMap contributors (ODbL), includes
  Microsoft ML Buildings.
- Basemap: © OpenStreetMap contributors, Protomaps tiles by goplex.ee.

Made with AI using the free [OpenMapStack toolkit](https://github.com/jaakla/openmapstack-skills).

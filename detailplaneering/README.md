# Idaringtee 21 · 3D planning atlas

An interactive review of the supplied Idaringtee 21 detailed plan in Ihaste, Tartu, with existing buildings and terrain within 1 km of its boundary. Built using the latest OpenMapStack GitHub main fetched on 26 October 2026, pinned to [`a3df1cb8126d5222fbb27e3f1dba49aca01b6302`](https://github.com/jaakla/openmapstack-skills/commit/a3df1cb8126d5222fbb27e3f1dba49aca01b6302).

Live: https://jaakla.github.io/openmapstack-samples/detailplaneering/

GitHub Pages publishes `published/index.html`, a byte-identical snapshot of the verified canonical `dist/index.html`. `scripts/prepare-pages.mjs` checks the pinned run inventory before assembling the page, six PDFs and GeoJSON downloads. To update the publication after a successful canonical build and independent verification, copy the new `dist/index.html` to `published/index.html` and update `published/manifest.json` to the corresponding run record.

## Explore

Open `dist/index.html` after running the pipeline, or start the local development server:

```sh
cd detailplaneering
npm ci
npm run data
npm run dev -- --port 5178
```

The user interface is in Estonian, including map controls, feature details, source notes and number formatting. The browser view offers proposal/existing comparison, orbiting 3D and overhead 2D, plan/neighbourhood camera presets, map/aerial imagery, terrain relief, independently switchable layers, and the georeferenced original drawing. Click a building or plot to inspect its source and height basis. The Sources panel includes all six supplied PDFs, assumptions, credits and GeoJSON downloads. The built map embeds its data and images; adjacent `dist/documents` and `dist/data` provide the downloads. The default OSM vector basemap uses goplex.ee and needs internet access, without an API key. Its light/dark styles, dated TileJSON and successful tile/font/sprite checks are pinned in `data/source/vector-basemap/`. The local Maa-amet raster and orthophoto remain available offline.

Rotation uses MapLibre GL, not Three.js. Use the visible left/right rotation buttons, the bearing and pitch sliders, or switch to **Lohistamine: pööra** and drag with the left mouse button. Right-drag / Ctrl-drag and touch rotation also remain available. Basemap theme changes preserve the analytical layers and selections.

## What is modelled

- 31 plots, totalling 10.18 ha, recovered from the main PDF's `DP_krunt` vector layer. Each plot area agrees with the printed rights table within 1 m².
- 32 main-building symbols: one commercial, seven apartment, fifteen terraced and nine semi-detached; plus nine sheds and one substation.
- 1,115 existing ETAK building footprints intersecting an exact 1,000 m buffer from the plan boundary. Whole intersecting footprints are retained. Of these, 55 lack a usable height and remain flat footprints.
- Twelve utility categories, including water, sewerage, stormwater, drainage, electricity, telecom, gas, surface overflow and protection/servitude markings, extracted from `Tehnovorgud.pdf`.
- Forty functional-context features from `Mojuala_seosed.pdf`: movement-direction markings, six bus-stop symbols, surrounding land-use notes, cadastral lines and drainage/gas connections. They reflect the supplied drawing, not present-day service verification. Two common parcel centroids fit each thematic registration; 29 held-out centroids have maximum residuals of about 0.02 m and 0.07 m.
- Official terrain sampled at 5 m for display, official map and aerial image snapshots, and paved surfaces recovered from the main drawing.

Coordinates and distances are analysed in **L-EST97 / EPSG:3301**, with **EH2000** heights; browser vectors use EPSG:4326. Two printed coordinate crosses fit a similarity transformation, with a third held out for a registration check. The extremely small residual measures internal PDF consistency, **not survey accuracy**.

The building forms are illustrative maximum-height masses, not final architecture. Heights subtract the nearest proposed spot level within each plot from the table's absolute parapet limit. Existing terrain is not reshaped into proposed earthworks. Relief is applied only when the viewport fits the retained DTM coverage; wider views use a flat surface with building masses and an explanatory UI note, preventing gaps beyond the local terrain grid. Roof slopes, façades and vegetation volumes are not reconstructed. Utility lines and symbols are recovered from their source drawing and projected onto the map surface; depth is unknown. PDF clipping scopes are applied to hatch paths. The earlier ditch beside Uus-Ihaste tee is distinguished from the differently coloured proposed swales inside the plan, with a regression check on its location.

## Sources and qualifications

The [municipal decision no. 737, 13 October 2026](https://dokumendid.tartu.ee/dhs.nsf/web/viited/TLVK2026101300737) accepts the plan for public display on 26 October–9 November 2026; it does not establish final adoption. The main drawing is by AB Artes Terrae OÜ, dated 17 September 2026.

The decision summary says 21 buildable plots, whereas the drawing contains 24 residential/commercial plots. Pos 14 permits two buildings but depicts one connected footprint. The explanatory report describes a 10.9 ha site; recovered plotted parcels total 10.18 ha. The model follows the drawing and preserves these differences.

Official context comes from Maa- ja Ruumiamet: ETAK building WFS, DTM WCS and map/orthophoto WMS, retrieved 26 October 2026. Observation dates vary; retrieval does not prove present field conditions. Drawing reuse terms have not been independently verified. Full source requests, checksums, licences and limitations are retained in `sources.json`, `data/source/context/acquisition.json`, `project.yaml` and `findings.md`.

## Reproduce

The tested numerical runtime is Python 3.14.4 and system GDAL 3.12.3. GDAL Python bindings must match the installed system library. With GDAL and Node/npm available:

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements.txt
npm ci --cache /tmp/detailplaneering-npm-cache
.venv/bin/python pipeline.py
.venv/bin/openmapstack validate project.yaml
.venv/bin/openmapstack run project.yaml
.venv/bin/openmapstack verify project.yaml --rerun
```

The pipeline uses retained source files and does not reacquire services. Its clean-rerun path can reinstall frontend dependencies from the prepared npm cache. `acquire.py` is an explicit network refresh tool; refreshing snapshots requires reviewing updated source pins before accepting a new run. GeoJSON overrides contain the three coordinate references and 31 manually transcribed table rows, with source-backed geometry and provenance.

Independent spatial/browser verification additionally needs the toolkit's spatial and visual extras, DuckDB's spatial extension and Playwright Chromium. In this workspace the extension cache is `/tmp/detailplaneering-spatial-extensions` and can be selected with `OPENMAPSTACK_SPATIAL_EXTENSION_DIR`. Use `npm run test:browser` against the running server; `DP_URL` selects another URL, including the built `file://` artifact, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects Chromium. Browser plugin was unavailable, so QA uses Playwright.

`project.yaml` is the canonical specification; `pipeline.py` is the canonical executable. `validation/latest-report.json`, `runs/`, `delivery/dashboard-evidence.json` and `findings.md` record results and byte-level provenance. A successful run retains explicit warnings for model uncertainty, document differences, data vintage, planning status, terrain and drawing licensing.

## Design

The interface uses separate commercial, apartment, terraced and duplex palettes, with saturated buildings and pale matching plot colours and a map-first desktop layout with responsive mobile controls. `design/concept.png` is an AI-generated interface reference, not geographic evidence. Actual footprints, terrain, aerial imagery and map texture come exclusively from the sources above. `design/design-system.md` records intentional differences from the reference.

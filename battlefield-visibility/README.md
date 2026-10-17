# Helsinki visibility

An independent, reproducible [OpenMapStack](https://github.com/jaakla/openmapstack-skills)
demo for [issue #1](https://github.com/jaakla/openmapstack-samples/issues/1).
All UAVs, their movement, forecasts, and zone results are **SIMULATED**.
This is an exploratory geometric visibility model, **not operational intelligence**.
GREEN means no visibility found under the sampled model; it does not establish safety.

The canonical definition is [project.yaml](project.yaml), schema
`openmapstack-project/v1`. [pipeline.py](pipeline.py) is the only implementation
that creates the declared GIS, model, desktop and view products. The React/Three.js
view reads those products; live zones are explicitly exploratory browser computations.
There are no imports, data dependencies, or processing calls into `toompea-3d`.

## Run the prepared demo

Requires Node 24 (tested 24.19.0). The compact derived products and licensed GLBs
are committed, so ordinary development and Pages CI need no GIS packages, keys,
LiDAR download, LFS checkout, or live geodata service.

```sh
cd battlefield-visibility
npm ci
npm test
node scripts/verify-products.mjs
npm run dev
npm run build -- --base=/openmapstack-samples/battlefield-visibility/
```

The production path is reserved by the shared Pages workflow. This PR does not
publish it. PR CI builds/tests both demos and assembles one Pages artifact;
the deployment job only runs on `main`, after owner approval/merge.
The root page is a gallery linking both independent demos.

Orbit with one finger or mouse drag; pan with two fingers/right drag; pinch or
scroll to zoom. Tap the ground or enter a full **MGRS** reference such as
`35V LG 85200 71300` to move own position (2 m AGL). A reference selects the
centre of its one-metre square. Invalid/outside-area references leave the target
unchanged and show an error. **Find UAV** or a tracked UAV row focuses the model.

The **Scenario / Layers / Sources** tabs contain collapsible sections. Configure
10–150 m UAV AGL, 0–3 UAVs and playback speed; toggle analysis, LOS vectors, traces,
forecasts, uncertainty, affiliation labels and source context. Reset restores the
manifest's defaults, layer visibility, target, playback and exact t=0 snapshot.
Changed analytical controls, relocated targets and playback label the scenario
exploratory. Source versions, retrieval dates, licensing and assumptions are visible.

The dark C2-style interface uses monospace telemetry and APP-6-inspired **red
diamond hostile UAVs / blue rectangle own position**. These are simulation
annotations, not certified military symbols. Affiliation is independent of LOS:
red = visible now; yellow = sampled forecast visibility within five minutes;
green = no sampled visibility; grey = unknown. Each drone has its own coloured
3D vector to own position, even if another drone makes the aggregate status RED.
A legend explains symbols, statuses, dotted history, dashed future and speed envelope.

Positions on the map, tracked UAV rows, tap readouts and **Export snapshot** use
MGRS. The user export contains MGRS own/drone locations and per-drone status; it
contains no raw XY position arrays. Optional secondary EPSG:3067 readout is off
by default and resets off. Project GIS outputs retain their declared metric CRS.
All sensors, lines, paths, zones and status share a timestamped worker snapshot.

## Recompile the GIS project

Raw input is about **840 MB**, excluded by `data/source/*` in this project's
`.gitignore`. Do not add the LAZ files or original source bundles
to normal git. Keep `sources.lock.json`, which records each exact URL, retrieval
time, byte size, license and SHA-256. If maintaining a long-lived archive, mirror
those exact bytes in an external archive or Git LFS and preserve the same hashes.
Remote availability is not an immutability guarantee: a changed response fails
acquisition rather than silently changing the project.

The tested runtime is Python 3.14.4, GDAL 3.12.2 / PROJ via pyproj 3.7.2,
QGIS 3.40.15-Bratislava, NumPy 2.5.4, laspy 2.6.1 / lazrs 0.8.1, and OpenMapStack
CLI 0.1.0. `requirements.txt` pins the Python processing libraries; npm's lockfile
pins the frontend, Proj4js 2.22.0 and geographiclib-mgrs 1.0.5. Use a GDAL/PROJ/QGIS system or
conda-forge environment whose Python can import `osgeo` and `qgis.core` before
creating the venv. A standalone pip-only GDAL/QGIS installation is not assumed.
QGIS is required for this project's declared desktop output.

Dependency audit (2026-10-17): the unused model optimizer and its dependencies
were removed. `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities.
The original CC0 UAV GLB is copied unchanged; no model optimizer is required.

```sh
# Substitute the Python executable belonging to your GIS runtime.
uv venv --python /usr/bin/python3 --system-site-packages .venv
uv pip install --python .venv/bin/python -r requirements.txt
# Install the CLI from the OpenMapStack skill distribution used for this project.
uv pip install --python .venv/bin/python /path/to/open-map-stack
npm ci
.venv/bin/python acquire.py
.venv/bin/openmapstack validate project.yaml --preflight
QT_QPA_PLATFORM=offscreen .venv/bin/openmapstack run project.yaml --strict
.venv/bin/openmapstack validate project.yaml --strict
npm test
node scripts/verify-products.mjs
npm run build
```

`acquire.py` always consumes the committed lock. On a fresh clone it restores
**the exact original WFS, Overpass and LoD2 tileset responses** from committed gzip archives in
`data/archive/` and downloads other missing files from their recorded fixed URLs.
The small archives are part of the Git revision, outside the browser payload. Both
the compressed archive SHA-256 and restored original response SHA-256 are verified,
even when a raw copy is cached. Original query URLs, parameters, data cutoff,
retrieval timestamps, licensing and the original wrappers are preserved unchanged.
Reproduction never re-queries the live WFS/Overpass/tileset wrappers: service timestamps
make a new response a different byte snapshot even with the same features.

**Fresh acquisition of a new version** is a separate reviewed operation: query the
upstream services, retain and archive the complete new responses, review the source
selection/licenses, update the explicit lock/manifest, then regenerate the run.
`acquire.py` does not regenerate a missing lock or silently refresh sources. It
never strips wrapper fields or bypasses a checksum. An unavailable fixed download,
missing archive, changed checksum or corrupt cached source is an explicit error;
there is no synthetic terrain/network fallback. No key or account is needed for
the selected inputs. See [archive provenance](data/archive/README.md).

The pipeline and tests place their temporary files under ignored `.cache/`. Keep
`TMPDIR` and tool caches inside the worktree when running on a space-constrained
host. If file watchers are exhausted, `CHOKIDAR_USEPOLLING=true npm run dev` is a
local workaround.

Each full run verifies immutable inputs, processes every ordered manifest stage,
runs the analytic/product tests, reloads and checks all QGIS layers, and writes
`validation/latest-report.json` plus a real `runs/run-*.json` with path-aware input
and output hashes. The report contains each manifest check exactly once.
The CLI audits schema, source pinning, overrides, graph, paths, CRS, report parity,
and those inventories. `verify-products.mjs` checks committed output hashes in CI
without acquiring raw survey data. `project.qgz` uses relative paths, grouped
source layers, a regional orthophoto and the static SIMULATED default-zone raster.
It is a desktop companion; browser movement is not a QGIS time simulation.

## Pinned sources and licenses

Source selection followed the independently verified
[research handoff](https://github.com/jaakla/openmapstack-samples/issues/1#issuecomment-6233311665),
re-read before downloads. The lock is the complete file inventory; the manifest
records selections, schema, rationale and licenses, and the view surfaces them.

| Source | Pinned selection | License / credit |
| --- | --- | --- |
| [Helsinki 2021 all-points LiDAR](https://hri.fi/data/en_GB/dataset/helsingin-laserkeilausaineistot) | Flights 11–15 June 2021; 40 points/m² nadir; nine 500 m tiles `672496a,b,c,d`, `672497a,b`, `673496a,c`, `673497a` | CC BY 4.0; © Helsingin kaupunkimittauspalvelut 2021. Modified: reprojection, gridding, interpolation, subsampling. |
| [City tile index](https://kartta.hel.fi/ws/geoserver/avoindata/wfs) | `avoindata:Karttalehtijako_05x05_km`, AOI query; 9 matched / 9 returned | CC BY 4.0; City of Helsinki |
| [City orthophoto](https://kartta.hel.fi/ws/geoserver/avoindata/wms) | Advertised `avoindata:Ortoilmakuva_2021_5cm`; 1300×1200 EPSG:3067 GetMap, checksum-pinned snapshot retrieved 2026-10-17 | CC BY 4.0; City of Helsinki; georeferenced/reprojected snapshot |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Overpass historical query cutoff `2026-10-16T00:00:00Z`, buffered bbox `(60.161,24.928,60.175,24.957)`, saved topology and versions | ODbL 1.0; © OpenStreetMap contributors. The derived `network.gpkg`, `roads.json`, scenario route database and copied node anchors retain ODbL. |
| [Official Helsinki LoD2](https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d) | Official untextured tileset `16fc3fd5-df6d-4f48-bfd5-9aeee430a02f`, version `291269823412`; 15 selected leaf b3dm tiles; HTTP export 11 May 2026; actual acquisition epoch unknown | City of Helsinki, CC BY 4.0. Modified: decoding, reprojection, clipping, 2 cm quantization, tactical materials. Display only. |
| [Quadcopter with flight electronics](https://www.innerscene.com/tools/library/3d-parts/quadcopter-with-flight-electronics-a25968c1) | Innerscene model `a25968c1`, original 274,220-byte GLB, SHA-256 `0d38b6f44eef969fe17f0c8a54d6747b7a0efb8a3b2e9ab875221d182a6dfb12` | CC0 1.0; Innerscene; original geometry unchanged. |

Full model credits accompany the actual files in
[public/models/ATTRIBUTION.txt](public/models/ATTRIBUTION.txt).
The 2023+ city scan is not substituted: the official city metadata says it is
no longer open data. NLS's restricted 5 p product is not used. The UAV model and LoD2 mesh are self-contained glTF 2; no decoder downloads or model-service API
calls are needed in the browser. Proj4js and GeographicLib-based MGRS ship MIT license texts, retaining Beckman and
Karney notices. Proj4js also retains transitive legacy OpenMap notices. All are
shipped in `public/licenses/coordinates.txt` and linked from Sources. QA's independent
GeographicLib C++ 2.7 metre-boundary reference is a regression fixture. The display approximation between ETRS89 and WGS84 does
not imply survey accuracy or alter analytical geometry.

### Official building conversion

QA's [Iteration 2 source handoff](https://github.com/jaakla/openmapstack-samples/issues/1#issuecomment-6234522031)
was read before acquisition. The official viewer's configuration identifies the
[untextured tileset](https://kartta.hel.fi/3d/datasource-data/16fc3fd5-df6d-4f48-bfd5-9aeee430a02f/tileset.json).
The archived manifest selects all 15 AOI-intersecting leaf tiles:
`15/{37306..37310}/{5429..5431}.b3dm`. They total **23,882,112 bytes**;
raw tiles are ignored, strictly checksum-verified and never browser downloads.
A long-lived reproduction after an upstream update requires an external archive
or LFS mirror of those exact bytes; checksum failure never triggers a silent refresh.

`building_mesh.py`, called by `pipeline.py`, decodes glTF node matrices, Y-up to
Z-up, RTC translation and tile transforms in the OGC order. ECEF XY is reprojected
to EPSG:3067; numeric elevations retain the city's documented N2000 convention,
without a fitted vertical offset. Actual triangles are clipped at the projected
AOI boundaries, including crossing walls, with source-plane Z interpolation.
The resulting GLB uses 2 cm position quantization and compact normals, removes
collapsed/duplicate faces and needs no decoder. Roof shapes and source building IDs
are retained; **802 IDs / 172,639 triangles / 6,234,632 bytes** in this snapshot.
The Khronos validator reports zero errors, warnings, infos or hints.

`public/data/building-mesh.json` records selection completeness, source IDs,
bounds and alignment against the independent 2021 class-6 roof raster. For
50,376 roof samples: median mesh-minus-LiDAR **−0.18 m**, median absolute difference
**0.31 m**, p95 absolute difference **4.10 m**. Separate source epochs and roof
modelling explain remaining differences; the model is continuously maintained and
11 May 2026 is an export date, not a verified acquisition epoch. No visual mesh
enters LOS: the **original 1 m LiDAR building+vegetation DSM remains unchanged**.
QGIS additionally receives source roof PolygonZ surfaces with city IDs.
The OSM extrusion fallback is unnecessary; no assumed levels or roof heights are used.

## Method and limits

- **AOI/CRS:** `[385200,6671300,386500,6672500]`, a chosen 1.3×1.2 km downtown
  Helsinki cartographic rectangle. Source LiDAR XY in EPSG:3879 is transformed to
  EPSG:3067; N2000 Z is unchanged. Every metric operation uses EPSG:3067.
- **Measured ground:** mean ground class 2 and ground keypoint class 8 returns per
  1 m cell; GDAL inverse-distance interpolation fills up to 60 m. Beyond measured
  coverage/interpolation limits remains unknown. Valid DTM coverage is 98.43%.
- **Obstructions:** per-cell maximum of class 6 buildings, class 17 bridge decks,
  and classes 3/4/5 vegetation at least 2 m above the DTM, combined with terrain.
  Other classifications are excluded. This is an opaque 2.5D column model: no
  windows, underpasses, interiors or calibrated canopy transmission.
- **Quantization/display:** DTM rounded to 0.1 m, DSM rounded upward to 0.1 m;
  `65535` is NoData. A 4 m terrain mesh and deterministic real vegetation returns
  provide context. Buildings use an independent source-backed GLB layer contract
  (`src/buildings.js`): local east, N2000 up, negative north. Replacing that layer
  never changes the LiDAR DSM. UAV props are magnified 9× for legibility and never
  obstruct analytical rays.
- **Movement:** three hypothetical anchors in `data/overrides/scenario.geojson`
  copy actual OSM node IDs, versions and coordinates, verified before application.
  UAVs follow those sourced route shapes as an explicit illustration at 8 m/s,
  default 50 m AGL. The retained graph excludes tunnels, bridges, nonzero layers,
  prohibited/private motor access and non-motor road types; initial paths respect
  `oneway`. Route-end reversal is simulated, not flight or routing guidance.
- **History/uncertainty:** faint dotted traces cover at most the preceding 120 s,
  beginning at simulation t=0. Amber dashed routes cover the next 300 s and retain
  all crossed source vertices. A translucent terminal ribbon spans travel between
  the 0.8× and 1.2× speed hypotheses. Its 16 m display width is an annotation,
  not lateral location uncertainty, sensor coverage or a probability contour.
- **Prediction:** five-minute horizon, samples at +60/120/180/240/300 seconds, three
  equally weighted future speed hypotheses 0.8/1.0/1.2 starting from the current
  position. A hypothesis counts once if any sampled future position can see the
  target. Yellow uses a threshold of ≥0.25 **per vector**; this is an uncalibrated
  scenario weight, not time-frequency or a statistical confidence interval.
  Drawn paths include all crossed source vertices; sparse samples are not joined
  with chords through city blocks. Short visibility windows can be missed.
- **LOS/zones:** conservative supercover traversal tests every crossed 1 m DSM
  cell at the lowest ray altitude within it; all cells touching either endpoint
  are included, even a face/corner touched only at t=0 or t=1. Grazing rays block
  consistently in either direction. Crossings are computed from cell boundaries;
  crossing products within eight relative floating-point epsilons include both
  side cells at interior corners. This conservative numerical tolerance does not
  snap geometry by a fixed spatial distance. A canonical endpoint order makes
  both directions execute identical arithmetic. Own position
  is 2 m AGL. Zone targets are sampled on a 20 m grid, not continuous coverage of
  every location within a colored square. Exact tapped-position status is computed
  separately. Current LOS from any sensor is RED; future sampled probability above
  threshold is YELLOW; no sampled visibility is GREEN. Missing coverage or a ground
  target inside an opaque canopy/building column is UNKNOWN, left uncolored.
- **Live engine:** the same pure JS engine creates the canonical t=0 snapshot and
  runs in a Web Worker. During playback it requests a new snapshot about every
  1.2 wall-clock seconds after completion; sensors/paths/zones update together.
  Stale generations are discarded when settings/target/reset change. A pending
  target is labeled computing. Tab hiding pauses the simulation clock; idle scenes
  render on demand. Forecast sampling and coarse target spacing bound CPU cost.
- **Limitations:** 2021 leaf-on conditions, classification and interpolation errors,
  later construction/demolition, foliage seasonality and sensor physics are not
  resolved. Curvature/refraction, detection range/FOV, weather and detection
  capability are omitted. Displaying a model is not identification of a real asset.

## Verification

`npm test` covers analytic flat ground, a one-cell ridge, grazing/corner rays,
vertical rays, endpoint-only faces/corners against an independent segment/AABB
oracle, the interior t=1/3 corner regression, and 200,000 sparse 16×16 half-metre
lattice cases (seed 12345) against an exact BigInt rational segment/AABB oracle in
both directions. These include NoData and endpoint/interior touches. Tests also
cover out-of-bounds inputs, class precedence,
scenario-probability thresholds, route reversal/corners, AGL forecasts and their
current-position anchoring. Additional tests cover MGRS reference/round-trip/error
handling, per-UAV LOS versus aggregate status, history, and MGRS-only user exports.
Product checks verify grid dimensions, DSM ≥ DTM,
source-edge identifiers, exact default snapshot reproduction, self-contained GLBs
and absence of external decoders. The run inventory verifies all declared outputs. Python tests cover closed 3D
triangle clipping, vertical walls, transform order, quantization/duplicate removal,
and offline strict archive restoration. Product tests run the Khronos GLB validator.

Browser QA uses Playwright Chromium because the Browser plugin is unavailable.
The checked flows are initial load → meaningful 3D scene → height change → live
play/pause → exact t=0 reset → sources → tap relocation → layer/count controls and
model focus. Desktop 1536×1024 and mobile 320×700 / 390×844 are checked for overflow, errors,
readable controls and working interactions. Physical mid-range-phone/GPU and iOS
Safari performance remain unmeasured; viewport emulation does not establish that.
Temporary QA scripts are ignored under `.cache/`. Requested review screenshots
are committed under `docs/` and linked in the PR; they are not browser payload.

The generated concept guides dark palette, monospace readouts, tab/section
hierarchy, restrained borders, map overlays and mobile map-first stacking. All
geographic geometry and imagery in the implementation come from pinned sources;
the concept image is never a map asset. Concept legend wording is corrected to
the owner's RED=visible semantics; controls retain the published 10–150 m range.

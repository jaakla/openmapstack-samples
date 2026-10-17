# Helsinki visibility

An independent, reproducible [OpenMapStack](https://github.com/jaakla/openmapstack-skills)
demo for [issue #1](https://github.com/jaakla/openmapstack-samples/issues/1).
All vehicles, their movement, forecasts, and zone results are **SIMULATED**.
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
scroll to zoom. Tap the ground or enter EPSG:3067 easting/northing to move the
2 m AGL green target. **Find tank / Find UAV** inspect the licensed models.
The Simulation tab exposes heights, 0–3 vectors of each type, playback/speed,
layer toggles and reset. Sources exposes source versions, dates and assumptions.
Reset restores the manifest's defaults, layers, playback, target and t=0.
The displayed sensors, predicted paths, zones and target status share one
worker snapshot; its simulation timestamp and computation duration remain visible.

## Recompile the GIS project

Raw input is about **952 MB**, excluded by `data/source/*` in this project's
`.gitignore`. Do not add the LAZ files, original tank textures or source bundles
to normal git. Keep `sources.lock.json`, which records each exact URL, retrieval
time, byte size, license and SHA-256. If maintaining a long-lived archive, mirror
those exact bytes in an external archive or Git LFS and preserve the same hashes.
Remote availability is not an immutability guarantee: a changed response fails
acquisition rather than silently changing the project.

The tested runtime is Python 3.14.4, GDAL 3.12.2 / PROJ via pyproj 3.7.2,
QGIS 3.40.15-Bratislava, NumPy 2.5.4, laspy 2.6.1 / lazrs 0.8.1, and OpenMapStack
CLI 0.1.0. `requirements.txt` pins the Python processing libraries; npm's lockfile
pins the frontend and glTF Transform 4.3.0. Use a GDAL/PROJ/QGIS system or
conda-forge environment whose Python can import `osgeo` and `qgis.core` before
creating the venv. A standalone pip-only GDAL/QGIS installation is not assumed.
QGIS is required for this project's declared desktop output.

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
**the exact original WFS and Overpass responses** from committed gzip archives in
`data/archive/` and downloads other missing files from their recorded fixed URLs.
The small archives are part of the Git revision, outside the browser payload. Both
the compressed archive SHA-256 and restored original response SHA-256 are verified,
even when a raw copy is cached. Original query URLs, parameters, data cutoff,
retrieval timestamps, licensing and the original wrappers are preserved unchanged.
Reproduction never re-queries the live WFS/Overpass wrappers: service timestamps
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
| [Tank by dannzjs](https://sketchfab.com/3d-models/abrams-m1a2-sepv3-eb6f5560198740269507e9948376414c) | Source title “Abrams M1A2 SEPv3”; licensed mirror commit `b51a51a5b58962f4d07931e1871cbc6effd27c3e`; source glTF extras and license retained | CC BY 4.0; dannzjs. Simplified, 256 px WebP textures, repackaged GLB; generic tank label does not certify vehicle identification. |
| [Quadcopter with flight electronics](https://www.innerscene.com/tools/library/3d-parts/quadcopter-with-flight-electronics-a25968c1) | Innerscene model `a25968c1`, original 274,220-byte GLB, SHA-256 `0d38b6f44eef969fe17f0c8a54d6747b7a0efb8a3b2e9ab875221d182a6dfb12` | CC0 1.0; Innerscene; original geometry unchanged. |

Full model credits accompany the actual files in
[public/models/ATTRIBUTION.txt](public/models/ATTRIBUTION.txt).
The 2023+ city scan is not substituted: the official city metadata says it is
no longer open data. NLS's restricted 5 p product is not used. Both selected
models are self-contained glTF 2; no decoder downloads or model-service API calls
are needed in the browser. The 182.29 MB source tank is compacted to about 7.71 MB.

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
  `65535` is NoData. Rendering uses a coarser 2 m measured roof-column mesh, a 4 m
  terrain mesh and a deterministic sample of real vegetation returns. Walls
  smaller than 1 m are omitted from the display to reduce draw cost; the 1 m DSM
  remains unchanged. Props are visibly magnified (tank 2.4×, UAV 9×) for legibility;
  their display meshes never obstruct the analytical rays.
- **Movement:** three hypothetical anchor points in `data/overrides/scenario.geojson`
  copy actual OSM node IDs, versions and coordinates. The pipeline verifies them
  before applying the scenario. Tank routes use source nodes/edges from the surface
  motor-road graph, excluding bridges, tunnels, nonzero layers and prohibited/private
  motor access. Initial directed paths respect `oneway`; reversal at path ends is
  an illustrative simulated turn, not legal/feasible routing guidance. UAVs follow
  the sourced route shapes as an explicit scenario pattern. Defaults: one tank at
  4 m/s, sensor 3 m AGL; one UAV at 8 m/s, sensor 50 m AGL.
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
  consistently in either direction. The green target
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
oracle, LOS reciprocity, NoData, out-of-bounds inputs, class precedence,
scenario-probability thresholds, route reversal/corners, AGL forecasts and their
current-position anchoring. Product checks verify grid dimensions, DSM ≥ DTM,
source-edge identifiers, exact default snapshot reproduction, self-contained GLBs
and absence of external decoders. The run inventory verifies all declared outputs.

Browser QA uses Playwright Chromium because the Browser plugin is unavailable.
The checked flows are initial load → meaningful 3D scene → height change → live
play/pause → exact t=0 reset → sources → tap relocation → layer/count controls and
model focus. Desktop 1536×1024 and mobile 320×700 / 390×844 are checked for overflow, errors,
readable controls and working interactions. Physical mid-range-phone/GPU and iOS
Safari performance remain unmeasured; viewport emulation does not establish that.
Temporary QA scripts/screenshots are ignored under `.cache/`, not shipped assets.

The generated visual concept was used for layout, typography, colors, sidebar,
map/readout and phone adaptation. Final source geometry intentionally uses measured
LiDAR columns/returns instead of the concept's illustrative photographic city mesh.
Model-focus buttons and explicit UNKNOWN/pending feedback support the real workflow.

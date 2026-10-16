# Toompea Digital Atlas

A source-backed Three.js explorer of Toompea hill, Tallinn. The application renders actual City of Tallinn survey meshes, high-density 2023 airborne LiDAR returns, a ground surface derived from those returns, and national aerial photography. There is no generated landmark geometry.

[![Preview of the Toompea Digital Atlas, showing surveyed architecture and explorer controls](docs/toompea-preview.png)](https://jaakla.github.io/openmapstack-samples/toompea-3d/)

## Run the explorer

```bash
npm ci
npm run dev -- --port 5173
```

Open http://localhost:5173. Prepared browser datasets are in `public/data/`; the viewer makes no live geodata requests and needs no API keys. `npm run build` creates a static site in `dist/`. The full immutable source archive remains outside the web bundle.

Use the three modes to explore architecture, recorded laser returns, and ground elevation. Layer switches isolate buildings, terrain, vegetation, and place labels. Select a landmark to fly to it, or choose Inspect and click a roof/ground surface or an actual laser return in point-cloud mode. The source panel exposes epochs, coordinate systems, sampling, transformations, and limitations. The canvas supports arrow-key panning when focused, and scroll/pinch zoom. Home restores the canonical view; changed visualization settings show an Exploratory view label. Lighting is illustrative.

## Recompile the geospatial project

`project.yaml` is the canonical openmapstack-project/v1 manifest. `pipeline.py` is the sole implementation producing all declared outputs, the QGIS companion, the validation report, and hash inventories.

The numerical runtime is pinned in `requirements.lock`. The desktop output additionally requires a system installation of QGIS, GDAL/OGR, and their Python bindings. This environment uses Python 3.13.15 for numerical processing and Debian system Python for PyQGIS.

```bash
npm ci
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.lock
.venv/bin/python pipeline.py
# If the OpenMapStack CLI is installed:
openmapstack validate project.yaml
openmapstack run project.yaml
```

The manifest stores the canonical executable command and all transformations use EPSG:3301 for metric coordinates. Source CityGML uses northing/easting axis order; the rendered city comes from the more detailed I3S survey, whose coordinates are longitude/latitude/height. Three.js uses a local metre frame: X = E − 542000, Y = source height, Z = 6589000 − N. Quantized building positions have 0.025 m steps, with at most 0.0125 m quantization error per component; this is a storage precision, **not a claim of survey accuracy**.

For a new immutable acquisition, inspect `scripts/acquire.py` and `scripts/acquire-places.py` before running them. Remote services can change; the retained bytes and SHA-256 inventory define the delivered snapshot. The four 2023 LAZ downloads and their exact URLs are recorded in `data/source/*laz.json`. Downloads total approximately 1.2 GB. Source metadata and accepted settings live in `project.yaml`; edit that manifest deliberately rather than recreating it.

## Source evidence

- **Airborne LiDAR:** Maa- ja Ruumiamet, low-altitude 2023 scan. Complete sheets `588541`, `588542`, `589541`, `589542`. Class 2 is ground; classes 3–5 are vegetation; class 6 is buildings. Classified noise and withheld returns are excluded. The view displays every twentieth valid source return, selected by the original record index within each complete file, so the sample is deterministic. Raw files are immutable and are not shipped to the browser. The derived display sample retains XYZ, classification, and RGB; other LAS fields are omitted/defaulted and must not be interpreted as observations. Use the immutable raw tiles for intensity, pulse, return-order, or acquisition-time analysis. [Official elevation downloads](https://geoportaal.maaamet.ee/eng/spatial-data/elevation-data/download-elevation-data-p664.html).
- **Architecture:** City of Tallinn `Tallinn_vanalinn_2020` I3S service, version `084A2D09-8129-499F-B2A0-2CF2007210FE`. Every root child is tested for AOI overlap. One complete root-child LOD is retained; parents and children are never displayed simultaneously. Triangle geometry is decoded directly, reprojected, cropped by triangle bounding overlap, and quantized. Source textures are sampled at original mesh vertices; this preserves observations but loses photographic detail between vertices. [City model description](https://www.tallinn.ee/en/tallinnovatsioon/tallinn-city-model).
- **National reference model:** official Tallinn LoD2 CityGML archive, downloaded 2026-10-15, Last-Modified 2026-10-12. Retained for inspectable source context; it is not drawn over the city model.
- **Photography:** Maa- ja Ruumiamet `EESTIFOTO`, immutable WMS image snapshot retrieved 2026-10-15, EPSG:3301 bbox `[541450, 6588400, 542650, 6589600]`, 2048×2048 pixels. The image response does not declare the flight epoch; do not interpret retrieval date as capture date.
- **Place labels:** six selected Nominatim/OSM lookups, retrieved 2026-10-15. This is a curated selection, not an exhaustive POI inventory. Labels link to their original OSM IDs. OSM is ODbL 1.0. Short place descriptions link to official tourism/parliament references.

National spatial data uses the [Maa- ja Ruumiamet open-data license, 2025-01-01](https://geoportaal.maaruum.ee/avaandmete-litsents), which requires source, dataset, and age/extract-time attribution. Its original PDF is retained in `data/source/maa-ruum-license-2025.pdf`. The project owner has confirmed City of Tallinn model redistribution under [Tallinn’s Open Spatial Data Simple Licence Agreement](https://www.tallinn.ee/et/media/307955). Source, dataset, survey/extract dates and a link to the agreement are rendered in the page and source panel. The project author’s credit is separate from the data-provider credit. Nothing in this repository purports to grant rights beyond the source providers’ terms.

## Important scientific limits

1. The city model is a 2020 archive and LiDAR is from 2023. This is not a simultaneous capture or a claim about current condition.
2. City metadata declares EGM96 heights; LiDAR declares EH2000. Values remain as supplied, with no invented correction. Sub-metre cross-source vertical alignment is not certified.
3. Ground is a **derived 2 m surface**, using minima of class-2 returns in each grid bin and nearest-cell interpolation where no ground returns occur. Source LiDAR density and displayed terrain resolution are different concepts.
4. Airborne LiDAR can miss facades and surfaces hidden below foliage. No unobserved architecture has been filled in manually.
5. The AOI is a cartographic rectangle, not a legal boundary of Toompea or the UNESCO site. A 100 m scale is measured in the local projected frame and represents horizontal screen scale under the current orthographic zoom; perspective foreshortening varies with viewing direction.
6. The QGIS companion is an audit view containing valid source layers, terrain, orthophotography, point cloud, and **mesh bounding hulls**. These hulls are explicitly labeled context, not building footprints. QGIS 2D styles cannot exactly reproduce the Three.js 3D material view, so style parity is recorded as a warning.
7. This is an exhibition/research explorer, not an engineering-certified digital twin. The validation status remains `warning` while these limitations are unresolved.

## Project contents

- `src/`: accessible responsive React interface and Three.js renderer.
- `public/data/`: prepared browser assets and inspectable `atlas.json` provenance.
- `data/source/`: immutable external snapshots.
- `data/derived/`: COG terrain/orthophoto, sampled LAZ, and GeoPackage desktop layers.
- `project.qgz`: QGIS source-audit companion; every layer is checked using `isValid()`.
- `validation/latest-report.json`: declared domain checks and propagated uncertainty.
- `validation/openmapstack-audit.json`: canonical CLI audit; 43 passed, zero failed, with source-quality qualifications propagated.
- `runs/`: real per-run file inventories with SHA-256 hashes.
- `design/interface-concept.png`: generated UI composition reference, never used as geographic data or rendered scene imagery.

The interface concept was made with the built-in image generation tool, prompted for a warm ivory museum atlas with a left explorer panel, source controls, and a large survey canvas. Its geographical illustration is not part of the application; all scene surfaces are external measured data. `design/design-system.md` records the implementable UI specification.

## Distance, cross sections, and sun studies

**Measure** in the bottom toolbar picks two actual visible source surfaces or laser returns. The panel reports a straight Euclidean chord, horizontal separation in EPSG:3301, and signed height B − A. It does not calculate a walking route or a surface-following length. City mesh endpoints retain the declared EGM96 datum; terrain/LiDAR endpoints retain EH2000. If the two datums differ, only horizontal distance is reported: 3D length and height difference remain unknown. Undo, clear, and JSON export preserve source identities, the base run, projected coordinates, and exploratory status. Picking precision and displayed decimal places are not a survey-accuracy claim.

**Section** clips the actual 3D surfaces with a vertical plane. Change its grid bearing and perpendicular offset; choose a cutaway or a finite-width thin slice; reverse the kept side or use **Face section** to view across the cut. A worker intersects the published source triangles with the centre plane and displays their source-height profile. Architecture and terrain remain separately labeled by datum. Layer switches also filter section outlines, profiles, and exported CSV endpoints. Empty cells, building interiors, and subsurface strata are not reconstructed. The profile uses independent horizontal/vertical axis scales and is not an equal-scale engineering drawing. In point-cloud mode, the same slice clips the sampled laser returns; the profile continues to show the source terrain and architectural surface intersections, not a fitted point-cloud surface.

**Sun study** uses a selected calendar day and local time in `Europe/Tallinn`, independent of the computer's own time zone. SunCalc 2.1.1 calculates apparent solar altitude and true azimuth from Meeus astronomical algorithms. The compiler derives the reference latitude/longitude and meridian convergence from the published EPSG:3301 scene origin, and the renderer rotates solar bearings into that projected grid. The panel shows EET/EEST, the UTC offset, sunrise, and sunset. A skipped spring clock time is rejected; the first occurrence of a repeated autumn time is explicitly labeled. Inputs are limited to 2000–2100.

Architecture and terrain cast directional shadows; direct sunlight and sun shadows turn off when the solar centre is below the horizon. Point-cloud foliage does not cast shadows. Neutral study materials avoid combining newly calculated shadows with shadows baked into the source photography. **Survey view** restores recorded image/model colors and illustrative lighting. Sky brightness, material response, shadow-map resolution/softness, and light intensity are presentation models, not measured weather, irradiance, certified insolation, or current-condition predictions. Point-cloud colors remain as recorded. The underlying 2020/2023 geometry and datum limitations still apply to every study date.

The user-requested instruments compute exploratory measurements over the existing metre-frame data in the browser. They are explicitly separate from published GIS results, do not mutate source/canonical geodata, and expose their basis and source run in exports. The manifest records this interactive exception to the default project workflow. Their source code, dependency lock, and independent calculation tests are included in run input hashes.

```bash
npm test
```

The calculation checks use analytic unit fixtures rather than invented geographic baseline data: a known 3–4–12 chord, indexed triangle-plane intersections, mixed-datum behavior, source-coordinate export, seasonal solar geometry, grid convergence, and both Tallinn daylight-saving transitions.

### Pikk Hermann national flag

The flag is rendered in every mode, including point cloud, elevation, overhead views and cross sections, and remains independent of the source layer and label toggles. City I3S node `2873` contains the actual folded cloth triangles; the compiler copies those positions and their original texture V coordinates into `public/data/pikk-hermann-flag.bin`. Equal horizontal blue–black–white bands use the State Chancellery reference colors `#0072CE`, `#000000`, `#FFFFFF`, with sRGB national hues, subtle fixed world-space fold shading and no scene tone mapping. The source geometry and sampled photographic colors are retained unchanged.

The flag always uses the surveyed folded 3D mesh, including overhead views; it never switches to a screen-facing sprite. Uniform display magnification about the existing hoist vertex keeps the cloth readable at distant zooms (24 pixel 3D bounding extent). A gentle shader ripple gives the cloth a little movement: vertices within 0.16 m of the pole stay pinned, and displacement grows toward the free edge to at most 8% of the source cloth's horizontal reach, with a much smaller vertical flutter. The display animation is capped at 24 frames per second, stops for reduced-motion preferences, and pauses in hidden tabs. Its settings are recorded in `presentation.landmark_flag.animation` in `project.yaml`.

The wind ripple, magnification and subtle world-space fill shading are illustrative presentation effects, not measured dimensions, observed wind or night illumination. Source buffers, measurement geometry and section inputs remain unchanged. Source architecture drawing omits only the original gray cloth faces, while the immutable source geometry and analysis arrays remain complete. The flag remains exempt from layer switches and section clipping. The [official reference](https://www.riigikantselei.ee/et/eestilipp) defines the national bands; its linked SVG is retained at `data/source/estonian-flag-reference-2022.svg`.

The sun-study local time is selected with a full-day slider (00:00–23:59, one-minute steps). The visible time and accessible slider value stay in Tallinn civil time; the date picker and EET/EEST handling are unchanged.

A subtle warm vignette darkens only the map edges, with an unchanged central area. It is rendered in WebGL, so exported scene images include it, while labels and controls remain clear.

## Publication metadata and static hosting

The author-provided metadata is stored in `project.publication` in `project.yaml`: last update `2026-10-07T00:00:00Z`, status `published`, author Jaak Laineste (`jaak@goplex.ee`), generated with [OpenMapStack](https://github.com/jaakla/openmapstack-skills). These values are copied into `atlas.json` and emitted by Vite into the final HTML as visible attribution, standard metadata and a JSON metadata block. Publication date/status remain distinct from the GIS validation status and actual processing timestamps. The build does not alter the supplied publication date.

The live atlas is published at https://jaakla.github.io/openmapstack-samples/toompea-3d/. The repository's `Deploy GitHub Pages` workflow runs calculation tests and builds with `npm run build -- --base=/openmapstack-samples/toompea-3d/` on every push to `main`. It deploys the built `dist/` bytes under `toompea-3d/`; the site root redirects there. The default local build uses Vite-relative asset URLs, so it also supports other project directories. The static site contains the prepared datasets and needs no server, API keys, raw survey downloads or Python runtime.

Original source LAZ files can be versioned using Git LFS. `.gitattributes` selects only `data/source/*.laz`, leaving all web assets in ordinary Git. Run `git lfs install` in the future repository before committing. GitHub Pages does not directly serve LFS objects: keep prepared `public/data/` files outside LFS and publish their actual built bytes. A Pages workflow that only builds these prepared assets can use checkout with `lfs: false` and skip the raw archive. Full GIS recompilation requires fetching the source LFS objects first. LFS downloads (including Actions downloads) count against the repository owner’s quota.

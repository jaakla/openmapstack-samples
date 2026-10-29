# OpenMapStack samples

Source-backed geospatial applications built with [OpenMapStack](https://github.com/jaakla/openmapstack-skills).

## Website usage and performance

The gallery and the five GitHub Pages apps use one EU PostHog project. The shared
configuration is [shared/analytics.js](shared/analytics.js). Its project token is
a public browser credential, not an administrative API key.

- Collection runs only at `jaakla.github.io/openmapstack-samples/`, excluding
  localhost, automated/headless browsers, offline mode and Do Not Track/GPC.
- Each event has a `site` field: `gallery`, `tallinn-transit`, `pv-location`,
  `toompea-3d`, `battlefield-visibility` or `detailplaneering`.
- Page views, page leaves and numeric Web Vitals are collected. The apps add
  `map_ready`, `planner_ready`, `route_search_completed`, `calculation_completed`,
  `feature_used` and gallery `demo_opened` events where applicable. Filter
  `initial=false` to separate rider-initiated searches/calculations from startup.
- Session recordings, input autocapture, heatmaps, surveys, console recordings
  and person profiles are disabled. Only approved event properties are sent;
  URL queries/fragments, addresses, coordinates and arbitrary DOM data are removed.
- Analytics is optional and loaded asynchronously. A blocked SDK cannot prevent
  an app from loading. The Tallinn offline manifest includes the local wrapper;
  the external SDK is not required for offline routing or maps.

In PostHog open **Web Analytics** (including its **Web Vitals** tab), filter by
path or `site`, and create an insight for a custom event with a `site` breakdown.
The public project token cannot create dashboards or read their data; that needs
an authenticated PostHog account. Validate collection by opening a published app
in a normal browser; automated tests deliberately do not count as visitors.

Vite includes the wrapper before inventories/offline manifests are generated.
Each app pins the shared runtime and build plugin hash in its inventoried Vite
configuration; update all four pins when either shared source changes.
The planning atlas retains its accepted canonical snapshot in `published/`;
`prepare-pages.mjs` records the added script's source/served HTML hashes in
`delivery-transform.json` without altering analytical inputs or geometries.
The two externally hosted Worker demos linked from the gallery are not instrumented;
their outbound gallery clicks are counted.

Run `node --test shared/analytics.test.mjs` to check the collection guards and
payload filtering. Those checks also run in the Pages workflow.

## Tallinn liigub

Tallinn bus and tram map with live vehicles, direction arrows and clearly labelled average-speed estimates, stop and address search, scheduled departures, and local departure-time/arrival-deadline journey planning. Save the app, GTFS schedules and city basemap for offline use. A small relay handles public GPS requests; journeys stay on the device.

- [Run locally, sources, tests and reproducible pipeline](tallinn-transit/README.md)
- [Open the public app](https://jaakla.github.io/openmapstack-samples/tallinn-transit/)
- GPS and address search use the deployed Cloudflare Worker; maps, timetables and walking routes also work offline after downloading the app's data package.

## Detailplaneering · Idaringtee 21

Explore the Idaringtee 21 detailed plan in Tartu in 3D, with 32 proposed main-building masses, official terrain, aerial imagery and 1,115 existing building footprints within 1 km. Compare the proposal with the existing situation and inspect the original georeferenced drawing. The interface is in Estonian, with light/dark OSM basemaps and switchable utility and functional-context layers.

[![Idaringtee 21 detailed plan](gallery/detailplaneering-preview.png)](https://jaakla.github.io/openmapstack-samples/detailplaneering/)

- [Run the atlas, sources and reproducible pipeline](detailplaneering/README.md)

## Solar Atlas

Choose an area on Estonian land, load official terrain and imagery, then draw a hypothetical PV site. The pinned Tartu scenario remains the reproducible baseline. Compare clear-sky, weather-adjusted and locally shaded production; add day/night consumption or an Enefit historical CSV for on-site use and grid economics. Model battery capacity, AC power limits, efficiency and historical price arbitrage, then export a scenario PDF with maps, charts, assumptions and sources. Storage-enabled reports include a fourth comparison page.

[![Solar Atlas planning workspace with a hypothetical PV footprint, annual energy and revenue estimates](gallery/pv-location-preview.png)](https://jaakla.github.io/openmapstack-samples/pv-location/)

- [Open Solar Atlas](https://jaakla.github.io/openmapstack-samples/pv-location/)
- [Project documentation, reproducible pipeline and limitations](pv-location/README.md)
- [Example scenario PDF](pv-location/public/data/canonical-report.pdf)

This bounded planning prototype implements the core of [issue #4](https://github.com/jaakla/openmapstack-samples/issues/4). Regional aerial PV detection and owner field calibration remain pending.

## Toompea Digital Atlas

Explore surveyed architecture, airborne LiDAR, terrain, cross sections, measurements, and sun studies of Toompea hill in Tallinn.

[![Preview of the Toompea Digital Atlas, showing surveyed architecture and explorer controls](toompea-3d/docs/toompea-preview.png)](https://jaakla.github.io/openmapstack-samples/toompea-3d/)

- [Open the live atlas](https://jaakla.github.io/openmapstack-samples/toompea-3d/)
- [Project documentation and source evidence](toompea-3d/README.md)

## UAV visibility

Explore simulated hostile UAVs over downtown Helsinki using 2021 city LiDAR, including vegetation, and official LoD2 buildings. Live RED/YELLOW/GREEN line-of-sight zones for a 2 m observer, a five-minute forecast, and MGRS contact reports describe the simulated situation.

[![Preview of UAV visibility, showing simulated UAV contacts and line-of-sight zones over downtown Helsinki](battlefield-visibility/docs/uav-visibility-preview.png)](https://jaakla.github.io/openmapstack-samples/battlefield-visibility/)

- [Open the live demo](https://jaakla.github.io/openmapstack-samples/battlefield-visibility/)
- [Project documentation and source evidence](battlefield-visibility/README.md)

### Tartu bridge analysis

Compare proposed Emajõgi crossings and their impact on walking and cycling accessibility.

[![Tartu bridge analysis with proposed crossings and accessibility gains](gallery/tartu-sillad-preview.png)](https://tartu-sillad.jaak-laineste.workers.dev/)

### Urban Heat Island

Explore a kriged temperature surface, census block groups, model settings and heat-risk screening in Madison, Wisconsin.

[![Urban Heat Island kriging dashboard with temperature surface and model controls](gallery/urban-heat-dashboard-preview.png)](https://urban-heat-dashboard.jaak-laineste.workers.dev/)

## Publishing

The shared `Deploy GitHub Pages` workflow tests and builds the existing demos and verifies the prepared Idaringtee 21 publication on pull requests and pushes to `main`. Pushes to `main` publish the prepared browser assets under `detailplaneering/`, `pv-location/`, `toompea-3d/` and `battlefield-visibility/`; the [site root](https://jaakla.github.io/openmapstack-samples/) is a gallery linking these local demos and the external Cloudflare demos. Solar Atlas also runs browser interaction tests and rebuilds its canonical analysis and provenance from committed source snapshots.

Normal Pages builds use committed browser assets and skip raw Git LFS downloads. Toompea's original large LAZ survey files use Git LFS; full GIS recompilation requires `git lfs pull` and the numerical/desktop dependencies documented in that project. UAV visibility's raw acquisitions are excluded from normal git; its project documentation describes acquisition and full recompilation.

## Web analytics

Cloudflare Web Analytics is installed on the GitHub Pages gallery, Toompea atlas and UAV demo. All three use the `jaakla.github.io` site in the Cloudflare Web Analytics dashboard; filter by URL path to distinguish them. The beacon token in the HTML is a public tracking identifier, not an API credential. The separately hosted Cloudflare demos need their own snippets.

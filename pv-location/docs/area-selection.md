# Estonia area acquisition

The canonical Tartu analysis remains pinned and unchanged. An exploratory selection can acquire a **2 × 2 km measured context anywhere on Estonian land**, including islands. This requires network access to the sources below; it is supported directly from a static HTTPS site and does not require a secret key or a proxy. Source availability is not guaranteed.

Provider documentation and actual browser-compatible responses were checked on 26 October 2026. Each tested endpoint returned `Access-Control-Allow-Origin: *` for an Origin of `https://jaakla.github.io`.

| Input | Actual service and bounded request |
|---|---|
| Land validation | [Current administrative boundaries WFS](https://teenus.maaamet.ee/ows/ajakohane-haldusjaotus?service=WFS&request=GetCapabilities&version=2.0.0), `ms:omavalitsus_pind`, WFS2 `resultType=hits` and approximately 1 cm point box in **CRS84 longitude/latitude**. This is the land layer, not the distinct `*_merel` layers extending to marine boundaries. |
| Surface | [Official DSM WCS](https://teenus.maaamet.ee/ows/wcs-dsm?service=WCS&request=GetCapabilities&version=1.0.0), `dsm-5`, EPSG:3301 bbox with aligned 400×400 5 m cells. |
| Terrain | [Official DTM WCS](https://teenus.maaamet.ee/ows/wcs-dtm?service=WCS&request=GetCapabilities&version=1.0.0), `dtm-1`, same grid, nearest-neighbour sampling at 5 m. |
| Building context | [ETAK WFS](https://gsavalik.envir.ee/geoserver/etak/wfs?service=WFS&request=GetCapabilities&version=2.0.0), `etak:e_401_hoone_ka`, exact requested bbox overlap, GeoJSON, pages of 5,000 with stable `fid` sort and total-count/duplicate checks. Bounded maximum 20,000 features. |
| Aerial context | [Official geographic WMS capabilities](https://kaart.maaamet.ee/wms/alus-geo?service=WMS&request=GetCapabilities&version=1.1.1), `EESTIFOTO`, **EPSG:3857**, one 1,200×1,200 rendered JPEG. Unlike the earlier `fotokaart` endpoint, this endpoint advertises EPSG:3857. The requested image rectangle and four corners align directly with MapLibre; no approximate reprojection or screenshot inference is used. Source acquisition date/native GSD remain unknown. |
| Weather | [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api), ERA5 for the newly selected longitude/latitude, complete 2024 and 2025 UTC calendars. The actual returned grid coordinates/elevation are retained. Radiation is shifted from preceding-hour endpoint means to interval starts. No Tartu weather substitution occurs. |
| Prices | Existing pinned EE price files. Estonia shares the same EE market price zone across these selected locations, so a new site does not require a different historical market series. |

The [official service directory](https://geoportaal.maaruum.ee/est/teenused/wms-wfs-wcs-teenused-p65.html) is the discovery entry point. Source reuse follows the [Maa- ja Ruumiamet open-data licence](https://geoportaal.maaruum.ee/avaandmete-litsents) and [service terms](https://geoportaal.maaruum.ee/est/teenused/wms-wfs-wcs-teenused/maa-ja-ruumiameti-kaarditeenuste-kasutustingimused-p24.html). Weather data use the [Open-Meteo terms](https://open-meteo.com/en/terms), including CC BY 4.0 attribution and non-commercial access restrictions on the free API. This is bounded, explicit user acquisition, not background nationwide scraping.

## Module API

```js
const area = await loadEstoniaArea(
  { longitude: 24.7536, latitude: 59.437 },
  { signal: controller.signal, onProgress: ({ stage, message }) => update(message), years: [2024, 2025] },
);
// area.terrain, area.buildings, area.weather[2024/2025]
// area.aerialURL is embedded JPEG; area.aerialMetadata.coordinates are NW,NE,SE,SW.
// area.sources retain URLs, retrieval timestamps, raw-response SHA-256 and licences.
const snapshotText = await serializeAreaBundle(area);
const replay = await parseAreaBundle(snapshotText);
```

Both historical years are required because the application exposes a 2024/2025 selector. The caller replaces the active inputs only after this promise resolves, and cancels an earlier request when a new selection begins. `AbortError` is preserved. A failed land check, elevation request, unexpected georeferencing or incomplete annual weather rejects the selection; the existing active scenario can remain usable. Optional aerial/building failures are recorded in warnings and building completeness metadata, without treating an empty layer as confirmed absence. No recorded building has a PV detection attribute set true.

Land membership is checked against authoritative geometry, not an Estonia bounding box. Live checks accepted Tallinn and Kuressaare, and rejected Riga and an offshore point at 24.7536° E, 59.6° N. The **selected centre** is checked: its contextual rectangle can cross a coast or international boundary. Land membership is not construction permission or a cadastral suitability assessment. For a new live footprint, `verifyEstoniaFootprint(polygon, {signal})` checks every unique vertex plus the metric centroid against the same official land service, with at most three concurrent requests and a clear 64-vertex limit. It returns verification time, checked-point count, method and request provenance; cancellation aborts pending checks. These samples do not certify the full extent of each long edge or exclude an enclosed offshore gap.

WFS axis order differs between the providers. This MapServer's WFS2 `EPSG:3301` bbox expects northing/easting; the ETAK GeoServer request uses its verified east/north convention. The land check avoids ambiguity with CRS84. A longitude/latitude bbox without an explicit CRS84 identifier must not be copied into the boundary request.

## Raster and temporal quality

[GeoTIFF.js](https://geotiffjs.github.io/geotiff.js/) 3.0.5 decodes the response ArrayBuffers locally without a worker pool or third-party decoder service. Width, height, band count, EPSG code and all four bounds are verified before the values enter the analysis. No rendered WMS colour values are treated as elevation measurements.

Nonfinite/declared nodata/nonpositive heights are unknown. DSM values more than 2 m below aligned DTM are also unknown under the conservative plausibility rule used in the Tartu pilot. Nonpositive filtering may exclude valid sea-level/coastal cells because the service does not reliably distinguish its missing cells. Such cells remain unknown; zero-height open ground is not invented to make an area usable. Entirely unusable surface/terrain responses reject the area; partial coverage is exposed for horizon validation.

The DSM catalogue describes 2017–2020 acquisition campaigns; local dates are unresolved and may differ from current buildings and 2024/2025 weather. The orthophoto is display context with unresolved acquisition date. Nothing here establishes installation detections, roof tilt, module counts, rights to build, or measured PV accuracy.

A real Tallinn acquisition at 24.7536° E, 59.437° N produced aligned 400² grids, 2,106 building records, a real EPSG:3857 aerial JPEG, and new ERA5 grid coordinates 59.5° N, 24.75° E for both years. The coastal context included 5,193 unknown DSM cells and 4,348 unknown DTM cells; these counts are properties of that live response, not a national quality guarantee.

## Snapshot portability

An area bundle contains the normalized terrain, full selected annual weather, sanitized building context, embedded aerial JPEG, georeferencing and acquisition provenance. It does not include consumption CSVs, meter identifiers or the user's household identity. Source records hash the original response bytes; the wrapper hashes the exact normalized JSON snapshot used for replay. Import checks corruption, bounded display/provenance strings, both annual weather calendars and requested-location consistency, grid alignment, aerial coordinates against the recomputed EPSG:3857 rectangle, building CRS84 geometry with bbox overlap (boundary-crossing features remain allowed), safe image data URLs and source/licence URL allowlists. A checksum detects changes; it is not a government signature or certification of an externally supplied file.

The EE price snapshots remain host-application inputs. Area bundles replay local source data without re-fetching mutable “latest” services. They do not overwrite `sources.lock.json`, canonical Tartu outputs, or the canonical run identity.

A second real island probe at Kuressaare (22.485° E, 58.252° N) retrieved 4,053 complete building records, real measured grids and ERA5 grid58.25° N/22.5° E; Riga and offshore checks were rejected. These network probes establish access at the checked sites, not universal uptime or data completeness.

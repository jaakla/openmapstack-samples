import fs from "node:fs";
import { gunzipSync } from "node:zlib";
// Real pinned responses isolate module loading from mutable external services.
// The boundary response is a test stub; it is not geographic validation evidence.
export async function mockAreaSources(page) {
  const source = (path) =>
    fs.readFileSync(new URL(`../../data/source/${path}`, import.meta.url));
  await page.route(
    "https://teenus.maaamet.ee/ows/ajakohane-haldusjaotus?**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/xml",
        body: '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="1"/>',
      }),
  );
  await page.route("https://teenus.maaamet.ee/ows/wcs-*?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/tiff",
      body: source(
        route.request().url().includes("wcs-dsm")
          ? "raw/dsm.tif"
          : "raw/dtm.tif",
      ),
    }),
  );
  await page.route("https://gsavalik.envir.ee/geoserver/etak/wfs?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: gunzipSync(source("raw/buildings.geojson.gz")),
    }),
  );
  await page.route("https://kaart.maaamet.ee/wms/alus-geo?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/jpeg",
      body: source("aerial.jpg"),
    }),
  );
  await page.route(
    "https://archive-api.open-meteo.com/v1/archive?**",
    (route) => {
      const year = new URL(route.request().url()).searchParams
        .get("start_date")
        .slice(0, 4);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: gunzipSync(source(`raw/weather-${year}.json.gz`)),
      });
    },
  );
}

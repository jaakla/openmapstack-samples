import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  decodeAreaRaster,
  estoniaAreaBounds,
  loadEstoniaArea,
  normalizeAreaTerrain,
  normalizeAreaWeather,
  parseAreaBundle,
  serializeAreaBundle,
  verifyEstoniaFootprint,
  verifyEstoniaLand,
} from "../src/areas.js";
const root = new URL("../data/source/", import.meta.url);
const point = { longitude: 26.72, latitude: 58.37 };
const raw = (name) => fs.readFileSync(new URL(name, root));
const unpack = (name) => JSON.parse(gunzipSync(raw(`raw/${name}.gz`)));
const bytes = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
function mockedFetch(url) {
  const u = new URL(url);
  if (u.hostname === "teenus.maaamet.ee" && u.pathname.includes("haldusjaotus"))
    return Promise.resolve(
      new Response(
        '<wfs:FeatureCollection numberMatched="1" numberReturned="0"/>',
        { headers: { "content-type": "text/xml" } },
      ),
    );
  if (u.pathname.includes("wcs-dsm"))
    return Promise.resolve(new Response(raw("raw/dsm.tif")));
  if (u.pathname.includes("wcs-dtm"))
    return Promise.resolve(new Response(raw("raw/dtm.tif")));
  if (u.hostname === "archive-api.open-meteo.com")
    return Promise.resolve(
      Response.json(
        unpack(`weather-${u.searchParams.get("start_date").slice(0, 4)}.json`),
      ),
    );
  if (u.pathname.includes("/etak/wfs"))
    return Promise.resolve(Response.json(unpack("buildings.geojson")));
  if (u.pathname.includes("/wms/"))
    return Promise.resolve(new Response(raw("raw/aerial-3301.jpg")));
  throw new Error(`Unexpected source ${url}`);
}

test("official land check uses longitude/latitude CRS84; outside and unavailable are distinct failures", async () => {
  let queried;
  const hit = async (url) => {
    queried = new URL(url);
    return new Response('<wfs:FeatureCollection numberMatched="1"/>');
  };
  assert.equal(
    await verifyEstoniaLand(
      { longitude: 22.485, latitude: 58.252 },
      { fetchImpl: hit },
    ),
    true,
  );
  assert.match(
    queried.searchParams.get("bbox"),
    /urn:ogc:def:crs:OGC:1.3:CRS84$/,
  );
  assert.equal(queried.searchParams.get("typeNames"), "ms:omavalitsus_pind");
  assert.ok(queried.searchParams.get("bbox").startsWith("22.484"));
  await assert.rejects(
    verifyEstoniaLand(
      { longitude: 24.1, latitude: 56.9 },
      {
        fetchImpl: async () =>
          new Response('<wfs:FeatureCollection numberMatched="0"/>'),
      },
    ),
    /offshore or outside Estonia/,
  );
  await assert.rejects(
    verifyEstoniaLand(point, {
      fetchImpl: async () => new Response("<ExceptionReport/>"),
    }),
    /boundary check is unavailable/,
  );
});

test("decodes actual pinned measured GeoTIFF and rejects misaligned extents", async () => {
  const bounds = estoniaAreaBounds(point);
  assert.deepEqual(bounds, [658125, 6472170, 660125, 6474170]);
  const decoded = await decodeAreaRaster(bytes(raw("raw/dsm.tif")), bounds);
  assert.equal(decoded.values.length, 160000);
  assert.ok(decoded.values.some((value) => value > 70));
  await assert.rejects(
    decodeAreaRaster(bytes(raw("raw/dsm.tif")), [0, 0, 2000, 2000]),
    /unexpected CRS, extent, or grid size/,
  );
});

test("surface quality filtering preserves unknowns and flags physically inconsistent heights", () => {
  const dsm = { values: new Float32Array(160000).fill(12), nodata: null },
    dtm = { values: new Float32Array(160000).fill(10), nodata: null };
  dsm.values[0] = 0;
  dsm.values[1] = 5;
  dtm.values[2] = NaN;
  const t = normalizeAreaTerrain(dsm, dtm, [0, 0, 2000, 2000]);
  assert.equal(t.dsm[0], null);
  assert.equal(t.dsm[1], null);
  assert.equal(t.dtm[2], null);
  assert.equal(t.quality.invalidBelowTerrain, 1);
  assert.equal(t.dsm[3], 12);
});

test("weather shifts preceding-hour means, records the requested and returned grid coordinates, and rejects gaps", () => {
  const w = normalizeAreaWeather(unpack("weather-2024.json"), 2024, point);
  assert.equal(w.rows.length, 8784);
  assert.equal(w.rows[0].time, "2024-01-01T00:00:00.000Z");
  assert.deepEqual(w.requestedLocation, { latitude: 58.37, longitude: 26.72 });
  assert.equal(w.gridLocation.latitude, 58.25);
  const broken = unpack("weather-2024.json");
  broken.hourly.shortwave_radiation[10] = null;
  assert.throws(
    () => normalizeAreaWeather(broken, 2024, point),
    /no Tartu weather or gap filling/,
  );
});

test("area bundle replays all normalized data and rejects changed checksums or executable imagery", async () => {
  const progress = [];
  const area = await loadEstoniaArea(point, {
    fetchImpl: mockedFetch,
    onProgress: (p) => progress.push(p.stage),
  });
  assert.deepEqual(progress, ["boundary", "sources", "decode", "complete"]);
  assert.equal(area.buildings.completeness.complete, true);
  assert.equal(area.weather[2025].rows.length, 8760);
  assert.ok(area.aerialURL.startsWith("data:image/jpeg;base64,"));
  assert.ok(
    area.sources.every((source) => /^[a-f0-9]{64}$/.test(source.pin.sha256)),
  );
  assert.ok(area.sources.some((source) => source.id === "dsm"));
  const text = await serializeAreaBundle(area);
  const replay = await parseAreaBundle(text);
  assert.deepEqual(replay.terrain.dsm, area.terrain.dsm);
  assert.deepEqual(replay.weather[2025], area.weather[2025]);
  const changed = JSON.parse(text);
  changed.area.terrain.dsm[0] = 999;
  await assert.rejects(
    parseAreaBundle(JSON.stringify(changed)),
    /checksum mismatch/,
  );
  await assert.rejects(
    serializeAreaBundle({ ...area, aerialURL: "javascript:alert(1)" }),
    /embedded JPEG/,
  );
  await assert.rejects(
    serializeAreaBundle({ ...area, warnings: "not an array" }),
    /warnings/,
  );
  await assert.rejects(
    serializeAreaBundle({ ...area, provenance: [] }),
    /provenance/,
  );
  await assert.rejects(
    serializeAreaBundle({ ...area, weather: { 2024: area.weather[2024] } }),
    /weather/,
  );
  const misplacedImage = {
    ...area.aerialMetadata,
    coordinates: area.aerialMetadata.coordinates.map((p) => [
      p[0] + 0.01,
      p[1],
    ]),
  };
  await assert.rejects(
    serializeAreaBundle({ ...area, aerialMetadata: misplacedImage }),
    /aerial coordinates/,
  );
  const building = area.buildings.features[0];
  const swappedBuilding = {
    ...building,
    geometry: {
      type: "Polygon",
      coordinates: building.geometry.coordinates.map((ring) =>
        ring.map((p) => [p[1], p[0]]),
      ),
    },
  };
  await assert.rejects(
    serializeAreaBundle({
      ...area,
      buildings: { type: "FeatureCollection", features: [swappedBuilding] },
    }),
    /does not overlap/,
  );
});

test("cancelled selection aborts before making source requests", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadEstoniaArea(point, {
      signal: controller.signal,
      fetchImpl: () => {
        throw new Error("Must not fetch");
      },
    }),
    { name: "AbortError" },
  );
});

test("footprint checks every unique vertex and metric centroid with bounded concurrency", async () => {
  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [24.75, 59.43],
        [24.751, 59.43],
        [24.751, 59.431],
        [24.75, 59.431],
        [24.75, 59.43],
      ],
    ],
  };
  const calls = [];
  let active = 0,
    maximum = 0;
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return new Response('<wfs:FeatureCollection numberMatched="1"/>');
  };
  const result = await verifyEstoniaFootprint(polygon, { fetchImpl });
  assert.equal(result.verified, true);
  assert.equal(result.checkedPoints, 5);
  assert.equal(calls.length, 5);
  assert.ok(maximum <= 3);
  assert.match(result.method, /edges are not certified/);
  await assert.rejects(
    verifyEstoniaFootprint(polygon, {
      fetchImpl: async () =>
        new Response('<wfs:FeatureCollection numberMatched="0"/>'),
    }),
    /outside Estonia/,
  );
  const ring = Array.from({ length: 65 }, (_, i) => [
    24.75 + 0.001 * Math.cos((i * Math.PI * 2) / 65),
    59.43 + 0.001 * Math.sin((i * Math.PI * 2) / 65),
  ]);
  ring.push(ring[0]);
  await assert.rejects(
    verifyEstoniaFootprint(
      { type: "Polygon", coordinates: [ring] },
      { fetchImpl },
    ),
    /at most 64/,
  );
});

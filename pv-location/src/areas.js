import { polygonMetrics, projectCoordinate } from "./analysis.js";

const SIZE = 400;
const RESOLUTION = 5;
const MAX_BUILDINGS = 20000;
const PAGE_SIZE = 5000;
const LICENSE = {
  name: "Maa- ja Ruumiameti avaandmete litsents",
  url: "https://geoportaal.maaruum.ee/avaandmete-litsents",
};
const ENDPOINTS = {
  boundary: "https://teenus.maaamet.ee/ows/ajakohane-haldusjaotus",
  dsm: "https://teenus.maaamet.ee/ows/wcs-dsm",
  dtm: "https://teenus.maaamet.ee/ows/wcs-dtm",
  buildings: "https://gsavalik.envir.ee/geoserver/etak/wfs",
  aerial: "https://kaart.maaamet.ee/wms/alus-geo",
  weather: "https://archive-api.open-meteo.com/v1/archive",
};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const abortError = () =>
  new DOMException("Area loading cancelled.", "AbortError");
const checkAbort = (signal) => {
  if (signal?.aborted) throw abortError();
};
const urlFor = (endpoint, params) =>
  `${endpoint}?${new URLSearchParams(params)}`;
const iso = (time) => new Date(time).toISOString();
const round = (n) => Math.round(n * 100) / 100;

export function estoniaAreaBounds({ longitude, latitude }) {
  if (
    !finite(longitude) ||
    !finite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  )
    throw new Error("Enter finite longitude and latitude coordinates.");
  const point = projectCoordinate([longitude, latitude]);
  const [x, y] = point.map(
    (value) => Math.round(value / RESOLUTION) * RESOLUTION,
  );
  return [x - 1000, y - 1000, x + 1000, y + 1000];
}

function aerialExtent(bounds) {
  const corners = [
    [bounds[0], bounds[3]],
    [bounds[2], bounds[3]],
    [bounds[2], bounds[1]],
    [bounds[0], bounds[1]],
  ];
  const mercator = corners.map((p) =>
    projectCoordinate(p, "EPSG:3301", "EPSG:3857"),
  );
  const imageBounds = [
    Math.min(...mercator.map((p) => p[0])),
    Math.min(...mercator.map((p) => p[1])),
    Math.max(...mercator.map((p) => p[0])),
    Math.max(...mercator.map((p) => p[1])),
  ];
  const imageCoordinates = [
    [imageBounds[0], imageBounds[3]],
    [imageBounds[2], imageBounds[3]],
    [imageBounds[2], imageBounds[1]],
    [imageBounds[0], imageBounds[1]],
  ].map((p) => projectCoordinate(p, "EPSG:3857", "EPSG:4326"));
  return { imageBounds, imageCoordinates };
}

function validateBuildings(buildings, bounds) {
  if (
    buildings?.type !== "FeatureCollection" ||
    !Array.isArray(buildings.features) ||
    buildings.features.length > MAX_BUILDINGS
  )
    throw new Error("Building bundle is missing or exceeds the bounded limit.");
  const ids = new Set();
  for (const feature of buildings.features) {
    if (
      feature.type !== "Feature" ||
      !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) ||
      typeof feature.id !== "string" ||
      ids.has(feature.id)
    )
      throw new Error("Building geometry or IDs are invalid.");
    ids.add(feature.id);
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length)
      throw new Error("Building polygon coordinates are invalid.");
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length)
        throw new Error("Building polygon coordinates are invalid.");
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4)
          throw new Error("Building polygon ring is invalid.");
        for (const point of ring) {
          if (
            !Array.isArray(point) ||
            point.length < 2 ||
            point.length > 3 ||
            !point.every(finite) ||
            Math.abs(point[0]) > 180 ||
            Math.abs(point[1]) > 90
          )
            throw new Error(
              "Building coordinates must be CRS84 longitude/latitude.",
            );
          const [x, y] = projectCoordinate(point.slice(0, 2));
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
          throw new Error("Building polygon ring is not closed.");
      }
    }
    if (
      maxX < bounds[0] - 0.1 ||
      minX > bounds[2] + 0.1 ||
      maxY < bounds[1] - 0.1 ||
      minY > bounds[3] + 0.1
    )
      throw new Error(
        "Building geometry does not overlap the selected metric area; check CRS/axis order.",
      );
  }
}

async function hash(bytes) {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Secure browser cryptography is unavailable. Open the HTTPS site or a modern browser.",
    );
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function request(
  url,
  {
    signal,
    sources,
    role,
    provider,
    dataset,
    license = LICENSE,
    maxBytes = 25000000,
    fetchImpl = fetch,
  },
) {
  checkAbort(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok)
      throw new Error(`${dataset}: source returned HTTP ${response.status}.`);
    const declaredBytes = Number(response.headers.get("content-length"));
    if (declaredBytes > maxBytes)
      throw new Error(`${dataset}: response exceeds the bounded area limit.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes)
      throw new Error(`${dataset}: response exceeds the bounded area limit.`);
    checkAbort(signal);
    sources.push({
      id:
        role === "buildings"
          ? `${role}-${sources.filter((s) => s.role === role).length + 1}`
          : role,
      role,
      provider,
      dataset,
      source_url: url,
      access: {
        method: "HTTP GET, browser CORS",
        retrieved_at: iso(Date.now()),
      },
      pin: {
        class: "response_hash",
        sha256: await hash(bytes),
        bytes: bytes.byteLength,
      },
      license,
    });
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut)
      throw new Error(
        `${dataset}: request timed out; retry the area selection.`,
      );
    if (error.name === "TypeError")
      throw new Error(
        `${dataset}: network or browser CORS access failed. The current area has not been replaced.`,
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
const json = (bytes) => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(
      "A source returned invalid JSON; no replacement data were accepted.",
    );
  }
};

/** Land membership uses the official municipal land polygons, including islands; not a bounding rectangle. */
export async function verifyEstoniaLand(point, options = {}) {
  estoniaAreaBounds(point);
  const { longitude, latitude } = point;
  const epsilon = 0.0000001; // ~1cm: a bounded intersection, not an offshore proximity buffer.
  // CRS84 is explicitly longitude/latitude. WFS2 EPSG:3301 is northing/easting on this MapServer.
  const url = urlFor(ENDPOINTS.boundary, {
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "ms:omavalitsus_pind",
    bbox: `${longitude - epsilon},${latitude - epsilon},${longitude + epsilon},${latitude + epsilon},urn:ogc:def:crs:OGC:1.3:CRS84`,
    resultType: "hits",
  });
  const bytes = await request(url, {
    ...options,
    sources: options.sources || [],
    role: "estonia-land-boundary",
    provider: "Maa- ja Ruumiamet",
    dataset: "Current administrative municipal land polygons",
  });
  const text = new TextDecoder().decode(bytes);
  const count = text.match(/\bnumberMatched\s*=\s*["'](\d+)["']/i);
  if (!count || /ExceptionReport|ServiceException/i.test(text))
    throw new Error(
      "The official Estonia land boundary check is unavailable. Retry instead of assuming coverage.",
    );
  if (Number(count[1]) < 1)
    throw new Error(
      "Choose a location on Estonian land, including its islands. This point is offshore or outside Estonia.",
    );
  return true;
}

/** Bounded official checks for every vertex and the footprint centroid; not exact edge containment. */
export async function verifyEstoniaFootprint(
  polygon,
  { signal, fetchImpl = fetch } = {},
) {
  const metrics = polygonMetrics(polygon);
  const ring =
    polygon.type === "Feature"
      ? polygon.geometry.coordinates[0]
      : polygon.coordinates[0];
  const points = [
    ...new Map(
      ring.map((p) => [`${p[0]},${p[1]}`, { longitude: p[0], latitude: p[1] }]),
    ).values(),
  ];
  if (points.length > 64)
    throw new Error(
      "Use at most 64 vertices for the bounded Estonia land check.",
    );
  points.push({ longitude: metrics.longitude, latitude: metrics.latitude });
  const sources = [],
    controller = new AbortController();
  const cancel = () => controller.abort();
  checkAbort(signal);
  signal?.addEventListener("abort", cancel, { once: true });
  let next = 0;
  try {
    await Promise.all(
      [0, 1, 2].map(async () => {
        while (next < points.length) {
          const point = points[next++];
          await verifyEstoniaLand(point, {
            signal: controller.signal,
            sources,
            fetchImpl,
          });
        }
      }),
    );
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  return {
    verified: true,
    method:
      "Official municipal land intersection at all unique vertices and metric centroid; edges are not certified",
    checkedPoints: points.length,
    checkedAt: iso(Date.now()),
    sources,
  };
}

export async function decodeAreaRaster(bytes, bounds, signal) {
  checkAbort(signal);
  const { fromArrayBuffer } = await import("geotiff");
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const actual = image.getBoundingBox();
  if (
    image.getWidth() !== SIZE ||
    image.getHeight() !== SIZE ||
    image.getSamplesPerPixel() !== 1 ||
    image.getGeoKeys().ProjectedCSTypeGeoKey !== 3301 ||
    actual.some((value, i) => Math.abs(value - bounds[i]) > 0.01)
  )
    throw new Error(
      "The elevation source returned an unexpected CRS, extent, or grid size.",
    );
  const values = await image.readRasters({ samples: [0], interleave: true });
  checkAbort(signal);
  return { values, nodata: image.getGDALNoData() };
}

export function normalizeAreaTerrain(dsm, dtm, bounds) {
  if (dsm.values.length !== SIZE * SIZE || dtm.values.length !== SIZE * SIZE)
    throw new Error("Elevation cell count does not match the requested area.");
  const terrain = [],
    surface = [];
  let invalidBelowTerrain = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = dsm.values[i],
      b = dtm.values[i];
    const valid = (v, nodata) =>
      finite(v) && v > 0 && (nodata == null || v !== nodata);
    const ground = valid(b, dtm.nodata) ? round(b) : null;
    const mismatch = ground != null && valid(a, dsm.nodata) && a < b - 2;
    if (mismatch) invalidBelowTerrain++;
    terrain.push(ground);
    surface.push(valid(a, dsm.nodata) && !mismatch ? round(a) : null);
  }
  const nullCells = {
    dsm: surface.filter((v) => v == null).length,
    dtm: terrain.filter((v) => v == null).length,
  };
  if (nullCells.dtm === SIZE * SIZE || nullCells.dsm === SIZE * SIZE)
    throw new Error(
      "No usable measured surface/terrain cells cover this area. Choose another land location.",
    );
  return {
    provider: "Maa- ja Ruumiamet",
    crs: "EPSG:3301",
    bounds,
    width: SIZE,
    height: SIZE,
    resolutionM: RESOLUTION,
    order: "row-major, north to south, west to east",
    units: "metres above sea level",
    dsm: surface,
    dtm: terrain,
    nullCells,
    quality: {
      invalidBelowTerrain,
      rule: "Nonfinite, declared nodata and nonpositive heights are unknown; DSM more than 2m below DTM is unknown. Zero can be valid at sea level but the source does not reliably distinguish its missing cells; conservative masking may exclude coastal cells.",
    },
    observationDate: null,
    observationDateNote:
      "Live WCS mosaic. DSM service catalogue describes 2017–2020 acquisitions; exact local surface dates are unknown.",
  };
}

export function normalizeAreaWeather(raw, year, point) {
  const h = raw.hourly;
  if (!h?.time || raw.utc_offset_seconds !== 0)
    throw new Error("Weather response has no usable UTC hourly series.");
  const rows = [];
  for (let i = 0; i < h.time.length; i++) {
    const end = Date.parse(`${h.time[i]}Z`),
      start = end - 3600000;
    if (new Date(start).getUTCFullYear() !== year) continue;
    const values = [
      "shortwave_radiation",
      "direct_normal_irradiance",
      "diffuse_radiation",
      "temperature_2m",
    ].map((key) => h[key]?.[i]);
    if (!values.every(finite))
      throw new Error(
        `Weather is incomplete for ${year}; no Tartu weather or gap filling was substituted.`,
      );
    rows.push({
      time: iso(start),
      ghi: values[0],
      dni: values[1],
      dhi: values[2],
      temperatureC: values[3],
    });
  }
  const expected = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3600000;
  if (
    rows.length !== expected ||
    rows.some(
      (r, i) => Date.parse(r.time) !== Date.UTC(year, 0, 1) + i * 3600000,
    )
  )
    throw new Error(
      `The location-specific ${year} weather calendar is incomplete or duplicated.`,
    );
  return {
    provider: "Open-Meteo / Copernicus ERA5",
    model: "era5",
    requestedLocation: { latitude: point.latitude, longitude: point.longitude },
    gridLocation: {
      latitude: raw.latitude,
      longitude: raw.longitude,
      elevationM: raw.elevation,
    },
    intervalHours: 1,
    timeBasis: "interval_start_utc",
    radiationBasis: "preceding-hour mean shifted to interval start",
    temperatureBasis: "instantaneous provider value at interval end",
    rows,
  };
}

async function loadBuildings(bounds, options) {
  const features = [],
    seen = new Set();
  let matched = null;
  for (let start = 0; start < MAX_BUILDINGS; start += PAGE_SIZE) {
    const url = urlFor(ENDPOINTS.buildings, {
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "etak:e_401_hoone_ka",
      bbox: `${bounds.join(",")},EPSG:3301`,
      srsName: "EPSG:4326",
      outputFormat: "application/json",
      count: PAGE_SIZE,
      startIndex: start,
      sortBy: "fid",
    });
    const data = json(
      await request(url, {
        ...options,
        role: "buildings",
        provider: "Maa- ja Ruumiamet",
        dataset: "ETAK building footprints, paginated bounded query",
      }),
    );
    const count = Number(data.numberMatched ?? data.totalFeatures);
    if (
      !Array.isArray(data.features) ||
      !Number.isInteger(count) ||
      count < 0 ||
      data.numberReturned !== data.features.length
    )
      throw new Error(
        "Building service did not expose trustworthy pagination counts.",
      );
    if (matched != null && matched !== count)
      throw new Error(
        "Building records changed during pagination; retry to obtain a coherent area.",
      );
    matched = count;
    if (matched > MAX_BUILDINGS)
      throw new Error(
        `Building context exceeds ${MAX_BUILDINGS} features; no incomplete layer was accepted.`,
      );
    for (const f of data.features) {
      if (!f.id || seen.has(f.id))
        throw new Error(
          "Building pagination returned duplicate or missing IDs; no partial layer was accepted.",
        );
      seen.add(f.id);
      if (!["Polygon", "MultiPolygon"].includes(f.geometry?.type))
        throw new Error("Building service returned unexpected geometry.");
      features.push({
        type: "Feature",
        id: f.id,
        geometry: f.geometry,
        properties: {
          building_id: f.id,
          etak_id: f.properties?.etak_id,
          height_m_reported: f.properties?.korgus_m ?? null,
          type: f.properties?.tyyp_tekst ?? null,
          geometry_updated: f.properties?.geom_muutmisaeg ?? null,
          source: "Maa- ja Ruumiamet ETAK WFS",
          pv_evidence: false,
        },
      });
    }
    if (features.length === matched) {
      const result = {
        type: "FeatureCollection",
        features,
        completeness: {
          numberMatched: matched,
          numberReturned: features.length,
          complete: true,
        },
      };
      validateBuildings(result, bounds);
      return result;
    }
    if (!data.features.length) break;
  }
  throw new Error(
    "Building pagination ended before the complete bounded layer was retrieved.",
  );
}

function dataUrl(bytes, type) {
  const a = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < a.length; i += 16384)
    binary += String.fromCharCode(...a.subarray(i, i + 16384));
  return `data:${type};base64,${btoa(binary)}`;
}

/** Acquire an actual bounded 2km context at any verified Estonia land location; no canonical inputs are mutated. */
export async function loadEstoniaArea(
  point,
  {
    onProgress = () => {},
    signal,
    years = [2024, 2025],
    fetchImpl = fetch,
  } = {},
) {
  const bounds = estoniaAreaBounds(point),
    sources = [],
    warnings = [];
  if (
    !Array.isArray(years) ||
    new Set(years).size !== 2 ||
    !years.includes(2024) ||
    !years.includes(2025) ||
    years.some((year) => ![2024, 2025].includes(year))
  )
    throw new Error(
      "This replay supports complete historical weather years 2024 and 2025.",
    );
  const options = { signal, sources, fetchImpl };
  const progress = (stage, message) => {
    checkAbort(signal);
    onProgress({ stage, message });
  };
  progress("boundary", "Checking official Estonia land coverage…");
  await verifyEstoniaLand(point, options);
  progress(
    "sources",
    "Loading measured surface, terrain, buildings and local weather…",
  );
  const coverage = (kind) =>
    request(
      urlFor(ENDPOINTS[kind], {
        service: "WCS",
        request: "GetCoverage",
        version: "1.0.0",
        coverage: kind === "dsm" ? "dsm-5" : "dtm-1",
        crs: "EPSG:3301",
        response_crs: "EPSG:3301",
        bbox: bounds.join(","),
        width: SIZE,
        height: SIZE,
        format: "GTiff",
        interpolation: "nearest neighbor",
      }),
      {
        ...options,
        role: kind,
        provider: "Maa- ja Ruumiamet",
        dataset:
          kind === "dsm"
            ? "Measured surface, dsm-5 WCS"
            : "Measured terrain, dtm-1 WCS sampled at5m",
      },
    );
  const weatherPromise = Promise.all(
    [...new Set(years)].map(async (year) => {
      const raw = json(
        await request(
          urlFor(ENDPOINTS.weather, {
            latitude: point.latitude,
            longitude: point.longitude,
            start_date: `${year}-01-01`,
            end_date: `${year + 1}-01-01`,
            hourly:
              "temperature_2m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
            timezone: "UTC",
            models: "era5",
          }),
          {
            ...options,
            role: `weather-${year}`,
            provider: "Open-Meteo / Copernicus",
            dataset: `Location-specific ERA5 ${year}`,
            license: {
              name: "CC-BY-4.0 data; free API for non-commercial access",
              url: "https://open-meteo.com/en/terms",
            },
          },
        ),
      );
      return [year, normalizeAreaWeather(raw, year, point)];
    }),
  );
  const { imageBounds, imageCoordinates } = aerialExtent(bounds);
  const imagePromise = request(
    urlFor(ENDPOINTS.aerial, {
      service: "WMS",
      request: "GetMap",
      version: "1.1.1",
      layers: "EESTIFOTO",
      styles: "",
      srs: "EPSG:3857",
      bbox: imageBounds.join(","),
      width: 1200,
      height: 1200,
      format: "image/jpeg",
    }),
    {
      ...options,
      role: "aerial-context",
      provider: "Maa- ja Ruumiamet",
      dataset: "Rendered latest orthophoto context, WMS EPSG3857",
    },
  )
    .then((bytes) => {
      const a = new Uint8Array(bytes);
      if (a[0] !== 255 || a[1] !== 216)
        throw new Error("Orthophoto source did not return a JPEG.");
      return dataUrl(bytes, "image/jpeg");
    })
    .catch((error) => {
      if (error.name === "AbortError") throw error;
      warnings.push(error.message);
      return null;
    });
  const buildingPromise = loadBuildings(bounds, options).catch((error) => {
    if (error.name === "AbortError") throw error;
    warnings.push(error.message);
    return {
      type: "FeatureCollection",
      features: [],
      completeness: { complete: false, error: error.message },
    };
  });
  const [dsmBytes, dtmBytes, weatherEntries, buildings, aerialURL] =
    await Promise.all([
      coverage("dsm"),
      coverage("dtm"),
      weatherPromise,
      buildingPromise,
      imagePromise,
    ]);
  progress("decode", "Decoding and checking the measured 5m elevation grids…");
  const [dsm, dtm] = await Promise.all([
    decodeAreaRaster(dsmBytes, bounds, signal),
    decodeAreaRaster(dtmBytes, bounds, signal),
  ]);
  const terrain = normalizeAreaTerrain(dsm, dtm, bounds);
  if (terrain.nullCells.dsm || terrain.nullCells.dtm)
    warnings.push(
      `Unknown source cells: DSM ${terrain.nullCells.dsm}; DTM ${terrain.nullCells.dtm}. Horizon coverage must be checked at the footprint.`,
    );
  warnings.push(
    "Live surface acquisition dates are unresolved and can predate the historical weather year; no site measurements or inventory detection were added.",
  );
  const capturedAt = iso(Date.now());
  const area = {
    schema: "solar-atlas-area/v1",
    id: `ee-${bounds[0]}-${bounds[1]}`,
    name: `${point.latitude.toFixed(4)}° N, ${point.longitude.toFixed(4)}° E`,
    center: { longitude: point.longitude, latitude: point.latitude },
    bounds,
    terrain,
    buildings,
    weather: Object.fromEntries(weatherEntries),
    aerialURL,
    aerialMetadata: {
      crs: "EPSG:3857",
      bounds: imageBounds,
      coordinates: imageCoordinates,
      width: 1200,
      height: 1200,
      acquisitionDate: null,
      nativeGsdM: null,
      role: "Rendered context only, not native inference imagery",
      attribution: `Maa- ja Ruumiameti ortofoto, extracted ${capturedAt.slice(0, 10)}`,
    },
    sources: sources.sort(
      (a, b) =>
        a.role.localeCompare(b.role) ||
        a.source_url.localeCompare(b.source_url),
    ),
    warnings,
    provenance: {
      capturedAt,
      areaCrs: "EPSG:3301",
      sourceScope:
        "Live bounded exploratory area; canonical Tartu source pins are unchanged",
      landCheck: "Official municipal land polygon intersection in CRS84",
      priceInputs:
        "Use the host application pinned EE 2024/2025 price series; prices are zone-wide, not site weather.",
    },
  };
  progress(
    "complete",
    "Area ready. Inspect source coverage before placing the array.",
  );
  return area;
}

export async function serializeAreaBundle(area) {
  validateAreaBundle(area);
  const snapshot = JSON.stringify(area);
  return JSON.stringify(
    {
      schema: "solar-atlas-area-bundle/v1",
      sha256: await hash(new TextEncoder().encode(snapshot)),
      area,
    },
    null,
    2,
  );
}

function validateAreaBundle(area) {
  if (
    typeof area?.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(area.id) ||
    typeof area.name !== "string" ||
    !area.name.trim() ||
    area.name.length > 200
  )
    throw new Error("Area id/name is invalid.");
  if (
    !Array.isArray(area.warnings) ||
    area.warnings.length > 100 ||
    area.warnings.some(
      (warning) => typeof warning !== "string" || warning.length > 2000,
    )
  )
    throw new Error("Area warnings must be bounded text entries.");
  if (
    !area.provenance ||
    typeof area.provenance !== "object" ||
    Array.isArray(area.provenance) ||
    Object.keys(area.provenance).length > 20 ||
    Object.values(area.provenance).some(
      (value) => typeof value !== "string" || value.length > 3000,
    ) ||
    !Number.isFinite(Date.parse(area.provenance.capturedAt))
  )
    throw new Error("Area provenance is invalid.");
  if (
    area?.schema !== "solar-atlas-area/v1" ||
    !Array.isArray(area.bounds) ||
    area.bounds.length !== 4 ||
    !area.bounds.every(finite) ||
    area.bounds[2] - area.bounds[0] !== 2000 ||
    area.bounds[3] - area.bounds[1] !== 2000
  )
    throw new Error("This is not a bounded Solar Atlas area bundle.");
  if (
    area.terrain?.crs !== "EPSG:3301" ||
    area.terrain.width !== SIZE ||
    area.terrain.height !== SIZE ||
    JSON.stringify(area.terrain.bounds) !== JSON.stringify(area.bounds)
  )
    throw new Error("Area grid metadata is inconsistent.");
  for (const key of ["dsm", "dtm"])
    if (
      !Array.isArray(area.terrain[key]) ||
      area.terrain[key].length !== SIZE * SIZE ||
      area.terrain[key].some((v) => v !== null && !finite(v))
    )
      throw new Error("Area contains invalid elevation cells.");
  if (
    area.aerialURL != null &&
    (typeof area.aerialURL !== "string" ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(area.aerialURL))
  )
    throw new Error(
      "Bundle imagery must be embedded JPEG data; external or executable URLs are not imported.",
    );
  validateBuildings(area.buildings, area.bounds);
  if (
    !Array.isArray(area.sources) ||
    area.sources.length > 50 ||
    area.sources.some((source) => {
      try {
        const url = new URL(source.source_url),
          license = new URL(source.license?.url);
        return (
          typeof source.id !== "string" ||
          source.id.length > 150 ||
          !/^[a-f0-9]{64}$/.test(source.pin?.sha256) ||
          !Number.isFinite(Date.parse(source.access?.retrieved_at)) ||
          url.protocol !== "https:" ||
          !Object.values(ENDPOINTS).some(
            (endpoint) => new URL(endpoint).hostname === url.hostname,
          ) ||
          license.protocol !== "https:" ||
          !["geoportaal.maaruum.ee", "open-meteo.com"].includes(
            license.hostname,
          )
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      "Bundle provenance contains unsupported source or licence URLs.",
    );
  if (
    !area.center ||
    !finite(area.center.longitude) ||
    !finite(area.center.latitude) ||
    JSON.stringify(estoniaAreaBounds(area.center)) !==
      JSON.stringify(area.bounds)
  )
    throw new Error("Bundle centre and metric extent do not agree.");
  if (
    !Array.isArray(area.aerialMetadata?.coordinates) ||
    area.aerialMetadata.coordinates.length !== 4 ||
    area.aerialMetadata.coordinates.some(
      (p) => !Array.isArray(p) || p.length !== 2 || !p.every(finite),
    )
  )
    throw new Error("Bundle aerial georeferencing is invalid.");
  const expectedImage = aerialExtent(area.bounds);
  if (
    area.aerialMetadata.crs !== "EPSG:3857" ||
    !Array.isArray(area.aerialMetadata.bounds) ||
    area.aerialMetadata.bounds.length !== 4 ||
    area.aerialMetadata.bounds.some(
      (v, i) => !finite(v) || Math.abs(v - expectedImage.imageBounds[i]) > 0.01,
    ) ||
    area.aerialMetadata.coordinates.some((point, i) =>
      point.some(
        (v, j) => Math.abs(v - expectedImage.imageCoordinates[i][j]) > 1e-8,
      ),
    )
  )
    throw new Error(
      "Bundle aerial coordinates do not match the selected area.",
    );
  if (
    !area.weather ||
    Object.keys(area.weather).length !== 2 ||
    !area.weather[2024] ||
    !area.weather[2025] ||
    Object.entries(area.weather).some(
      ([year, w]) =>
        !["2024", "2025"].includes(year) ||
        w.requestedLocation?.latitude !== area.center?.latitude ||
        w.requestedLocation?.longitude !== area.center?.longitude ||
        w.rows?.length !== (Number(year) === 2024 ? 8784 : 8760) ||
        w.rows.some(
          (row, i) =>
            Date.parse(row.time) !==
              Date.UTC(Number(year), 0, 1) + i * 3600000 ||
            !["ghi", "dni", "dhi", "temperatureC"].every((key) =>
              finite(row[key]),
            ),
        ),
    )
  )
    throw new Error(
      "Bundle weather is incomplete or belongs to a different requested location.",
    );
}

export async function parseAreaBundle(text) {
  if (typeof text !== "string" || text.length > 50000000)
    throw new Error("Area bundle exceeds the 50 MB limit.");
  let wrapper;
  try {
    wrapper = JSON.parse(text);
  } catch {
    throw new Error("Area bundle is not valid JSON.");
  }
  if (
    wrapper?.schema !== "solar-atlas-area-bundle/v1" ||
    typeof wrapper.sha256 !== "string"
  )
    throw new Error("Unrecognized area bundle format.");
  if (
    (await hash(new TextEncoder().encode(JSON.stringify(wrapper.area)))) !==
    wrapper.sha256
  )
    throw new Error(
      "Area bundle checksum mismatch; its snapshot has been changed.",
    );
  validateAreaBundle(wrapper.area);
  return wrapper.area;
}

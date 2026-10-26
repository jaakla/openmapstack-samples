import proj4 from "proj4";

// EPSG:3301 is the national metric CRS. Coordinates elsewhere are [longitude, latitude].
proj4.defs(
  "EPSG:3301",
  "+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +units=m +no_defs",
);

const RAD = Math.PI / 180;
const HOUR = 3600000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value) => ((value % 360) + 360) % 360;
const timestamp = (value) =>
  value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
const utc = (value) => new Date(value).toISOString();

export const DEFAULT_SYSTEM = Object.freeze({
  latitude: 58.37,
  longitude: 26.72,
  kwp: 10,
  azimuthDeg: 180,
  tiltDeg: 35,
  mountingHeightM: 2,
  systemLossPct: 14,
  salesMarginEurMWh: 3,
  albedo: 0.2,
  temperatureCoefficient: -0.004,
  nominalOperatingCellTemperatureC: 45,
});

export function projectCoordinate(
  coordinate,
  from = "EPSG:4326",
  to = "EPSG:3301",
) {
  return proj4(from, to, coordinate);
}

/** Convert a true-north azimuth to the local projected-grid bearing. */
export function trueToGridBearing(azimuthDeg, latitude, longitude) {
  const here = projectCoordinate([longitude, latitude]);
  const north = projectCoordinate([longitude, latitude + 0.00001]);
  return wrap(
    azimuthDeg + Math.atan2(north[0] - here[0], north[1] - here[1]) / RAD,
  );
}

function polygonRing(polygon) {
  if (polygon?.type === "Feature") return polygonRing(polygon.geometry);
  if (polygon?.type === "Polygon") {
    if (polygon.coordinates.length !== 1)
      throw new Error(
        "PV footprints with holes are not supported; draw a single array footprint.",
      );
    return polygon.coordinates[0];
  }
  return Array.isArray(polygon) ? polygon : [];
}

/** Metric footprint area and centroid, measured in EPSG:3301; polygon holes are unsupported. */
export function polygonMetrics(polygon) {
  const ring = polygonRing(polygon);
  if (ring.length < 3)
    throw new Error("Draw a polygon with at least three vertices.");
  if (ring.length > 1001)
    throw new Error("Use at most 1000 vertices for a PV planning footprint.");
  if (
    ring.some(
      (p) =>
        !Array.isArray(p) ||
        !finite(p[0]) ||
        !finite(p[1]) ||
        p[0] < -180 ||
        p[0] > 180 ||
        p[1] < -90 ||
        p[1] > 90,
    )
  ) {
    throw new Error(
      "Polygon vertices must be finite WGS84 [longitude, latitude] coordinates.",
    );
  }
  const points = ring.map((point) => projectCoordinate(point));
  const origin = points[0];
  // Subtract an origin before cross products to avoid cancellation in national coordinates.
  const local = points.map(([x, y]) => [x - origin[0], y - origin[1]]);
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  let perimeterM = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
    perimeterM += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (Math.abs(twiceArea) < 0.02)
    throw new Error("The polygon has no measurable area.");
  // Reject crossing non-adjacent edges; a signed area alone cannot detect every bow tie.
  const orientation = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const vertices =
    local.length > 3 && Math.hypot(local.at(-1)[0], local.at(-1)[1]) < 0.001
      ? local.slice(0, -1)
      : local;
  for (let i = 0; i < vertices.length; i += 1) {
    if (
      Math.hypot(
        vertices[i][0] - vertices[(i + 1) % vertices.length][0],
        vertices[i][1] - vertices[(i + 1) % vertices.length][1],
      ) < 0.001
    )
      throw new Error("The PV polygon has a duplicate consecutive vertex.");
  }
  const onSegment = (a, b, p) =>
    Math.abs(orientation(a, b, p)) < 1e-7 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-7;
  for (let i = 0; i < vertices.length; i += 1)
    for (let j = i + 2; j < vertices.length; j += 1) {
      if (i === 0 && j === vertices.length - 1) continue;
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const c = vertices[j];
      const d = vertices[(j + 1) % vertices.length];
      if (
        (orientation(a, b, c) * orientation(a, b, d) < 0 &&
          orientation(c, d, a) * orientation(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        throw new Error("The PV polygon crosses or touches itself.");
    }
  const centroidProjected = [
    cx / (3 * twiceArea) + origin[0],
    cy / (3 * twiceArea) + origin[1],
  ];
  const [longitude, latitude] = projectCoordinate(
    centroidProjected,
    "EPSG:3301",
    "EPSG:4326",
  );
  return {
    areaM2: Math.abs(twiceArea) / 2,
    perimeterM,
    centroid: [longitude, latitude],
    longitude,
    latitude,
    centroidProjected,
    projectedRing: points,
    crs: "EPSG:3301",
  };
}

export function validateSystem(input = {}) {
  const system = { ...DEFAULT_SYSTEM, ...input };
  if (input.lat != null) system.latitude = input.lat;
  if (input.lon != null) system.longitude = input.lon;
  if (input.polygon)
    Object.assign(system, {
      latitude: polygonMetrics(input.polygon).latitude,
      longitude: polygonMetrics(input.polygon).longitude,
    });
  const rules = {
    latitude: [-89.9, 89.9],
    longitude: [-180, 180],
    kwp: [0.001, 1000000],
    azimuthDeg: [0, 360],
    tiltDeg: [0, 90],
    mountingHeightM: [0, 500],
    systemLossPct: [0, 99.9],
    salesMarginEurMWh: [0, 1000],
    albedo: [0, 1],
    temperatureCoefficient: [-0.02, 0],
    nominalOperatingCellTemperatureC: [20, 80],
  };
  for (const [key, [min, max]] of Object.entries(rules)) {
    if (!finite(system[key]) || system[key] < min || system[key] > max)
      throw new Error(`${key} must be a number between ${min} and ${max}.`);
  }
  system.azimuthDeg = wrap(system.azimuthDeg);
  return system;
}

/** NOAA/Meeus geometric solar position. Azimuth is clockwise from true north. */
export function solarPosition(date, latitude, longitude) {
  const time = timestamp(date);
  if (!Number.isFinite(time) || !finite(latitude) || !finite(longitude))
    throw new Error("Invalid solar-position date or coordinates.");
  const t = (time / 86400000 + 2440587.5 - 2451545) / 36525;
  const meanLongitude = wrap(280.46646 + t * (36000.76983 + t * 0.0003032));
  const meanAnomaly = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD;
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLongitude =
    (meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const obliquity =
    (23 +
      (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 +
      0.00256 * Math.cos(omega)) *
    RAD;
  const declination = Math.asin(
    Math.sin(obliquity) * Math.sin(apparentLongitude),
  );
  const y = Math.tan(obliquity / 2) ** 2;
  const l = meanLongitude * RAD;
  const equationOfTime =
    (4 / RAD) *
    (y * Math.sin(2 * l) -
      2 * eccentricity * Math.sin(meanAnomaly) +
      4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * l) -
      0.5 * y * y * Math.sin(4 * l) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly));
  const d = new Date(time);
  const minutes =
    d.getUTCHours() * 60 +
    d.getUTCMinutes() +
    d.getUTCSeconds() / 60 +
    d.getUTCMilliseconds() / 60000;
  const hourAngle =
    (((((minutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440) / 4 -
      180) *
    RAD;
  const lat = latitude * RAD;
  const sinElevation = clamp(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  const elevationDeg = Math.asin(sinElevation) / RAD;
  const azimuthDeg = wrap(
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) -
        Math.tan(declination) * Math.cos(lat),
    ) /
      RAD +
      180,
  );
  return {
    elevationDeg,
    altitudeDeg: elevationDeg,
    azimuthDeg,
    zenithDeg: 90 - elevationDeg,
    sinElevation,
    declinationDeg: declination / RAD,
    equationOfTimeMinutes: equationOfTime,
  };
}

/** Haurwitz GHI, with Erbs decomposition. A simple clear-sky reference, not a maximum bound. */
export function clearSkyIrradiance(date, position) {
  const sine = Math.max(
    0,
    position.sinElevation ?? Math.sin(position.elevationDeg * RAD),
  );
  if (sine <= 0) return { ghi: 0, dni: 0, dhi: 0 };
  const ghi = 1098 * sine * Math.exp(-0.059 / sine);
  const day =
    (timestamp(date) -
      Date.UTC(new Date(timestamp(date)).getUTCFullYear(), 0, 0)) /
    86400000;
  const extra = 1366.1 * (1 + 0.033 * Math.cos((2 * Math.PI * day) / 365));
  const kt = clamp(ghi / (extra * sine), 0, 1);
  const fraction =
    kt <= 0.22
      ? 1 - 0.09 * kt
      : kt <= 0.8
        ? 0.9511 -
          0.1604 * kt +
          4.388 * kt ** 2 -
          16.638 * kt ** 3 +
          12.336 * kt ** 4
        : 0.165;
  const dhi = ghi * clamp(fraction, 0, 1);
  return { ghi, dhi, dni: (ghi - dhi) / sine };
}

export function planeOfArray(
  irradiance,
  position,
  system,
  directVisibility = 1,
  diffuseVisibility = 1,
) {
  const tilt = system.tiltDeg * RAD;
  const elevation = position.elevationDeg * RAD;
  const cosIncidence = Math.max(
    0,
    Math.sin(elevation) * Math.cos(tilt) +
      Math.cos(elevation) *
        Math.sin(tilt) *
        Math.cos((position.azimuthDeg - system.azimuthDeg) * RAD),
  );
  const direct =
    position.elevationDeg > 0
      ? irradiance.dni * cosIncidence * directVisibility
      : 0;
  const diffuse =
    ((irradiance.dhi * (1 + Math.cos(tilt))) / 2) * diffuseVisibility;
  const reflected = (irradiance.ghi * system.albedo * (1 - Math.cos(tilt))) / 2;
  return {
    direct,
    diffuse,
    reflected,
    total: Math.max(0, direct + diffuse + reflected),
  };
}

function pointInside(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function sampleGrid(grid, x, y, band) {
  const [xmin, ymin, xmax, ymax] = grid.bounds;
  if (x < xmin || x >= xmax || y <= ymin || y > ymax) return null;
  const col = Math.floor(((x - xmin) / (xmax - xmin)) * grid.width);
  const row = Math.floor(((ymax - y) / (ymax - ymin)) * grid.height);
  const data = grid[band];
  const value = Array.isArray(data?.[0])
    ? data[row]?.[col]
    : data?.[row * grid.width + col];
  return finite(value) &&
    value !== grid.nodata &&
    value > -1000 &&
    value < 10000
    ? value
    : null;
}

/** Source DSM horizon at equal-weight polygon samples. Heights are above source DTM. */
export function buildHorizon({
  grid,
  polygon,
  site,
  mountingHeightM = 2,
  maxDistanceM = 500,
  azimuthStepDeg = 2,
  maxSamples = 9,
} = {}) {
  if (
    !grid ||
    grid.crs !== "EPSG:3301" ||
    !grid.dsm ||
    !grid.dtm ||
    !grid.bounds ||
    !grid.width ||
    !grid.height
  ) {
    return {
      profiles: [],
      profile: [],
      method: "unavailable",
      coveragePct: 0,
      warnings: [
        "A source DSM and DTM in EPSG:3301 are required for local shading.",
      ],
    };
  }
  if (
    !finite(mountingHeightM) ||
    mountingHeightM < 0 ||
    !finite(maxDistanceM) ||
    maxDistanceM <= 0 ||
    !finite(azimuthStepDeg) ||
    azimuthStepDeg < 0.5 ||
    azimuthStepDeg > 30
  )
    throw new Error("Invalid horizon height, distance or angular step.");
  const metrics = polygon ? polygonMetrics(polygon) : null;
  const center =
    metrics?.centroidProjected ??
    projectCoordinate([
      site?.longitude ?? site?.lon,
      site?.latitude ?? site?.lat,
    ]);
  let points = [center];
  if (metrics && maxSamples > 1) {
    const ring = metrics.projectedRing;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const count = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(maxSamples))));
    points = [];
    for (let iy = 0; iy < count; iy += 1)
      for (let ix = 0; ix < count; ix += 1) {
        const p = [
          minX + ((ix + 0.5) / count) * (maxX - minX),
          minY + ((iy + 0.5) / count) * (maxY - minY),
        ];
        if (pointInside(p, ring)) points.push(p);
      }
    if (!points.length) {
      if (pointInside(center, ring)) points = [center];
      else {
        // A concave polygon's area centroid may be outside. Find a true interior receiver.
        for (let i = 0; i < ring.length && !points.length; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (!length) continue;
          for (const side of [-1, 1]) {
            const p = [
              (a[0] + b[0]) / 2 + ((side * (b[1] - a[1])) / length) * 0.01,
              (a[1] + b[1]) / 2 - ((side * (b[0] - a[0])) / length) * 0.01,
            ];
            if (pointInside(p, ring)) {
              points = [p];
              break;
            }
          }
        }
      }
    }
    points = points.slice(0, maxSamples);
  }
  const resolutionM = Math.min(
    (grid.bounds[2] - grid.bounds[0]) / grid.width,
    (grid.bounds[3] - grid.bounds[1]) / grid.height,
  );
  const distanceStepM = Math.max(1, resolutionM / 2);
  const bins = Math.ceil(360 / azimuthStepDeg);
  const step = 360 / bins;
  let validRays = 0;
  let totalRays = 0;
  let belowSurface = 0;
  const profiles = [];
  for (const point of points) {
    const terrain = sampleGrid(grid, ...point, "dtm");
    const surface = sampleGrid(grid, ...point, "dsm");
    if (terrain == null) continue;
    const observerElevationM = terrain + mountingHeightM;
    const coordinate = projectCoordinate(point, "EPSG:3301", "EPSG:4326");
    const gridNorthBearingDeg = trueToGridBearing(
      0,
      coordinate[1],
      coordinate[0],
    );
    if (surface != null && surface > observerElevationM + 1) belowSurface += 1;
    const profile = [];
    for (let bin = 0; bin < bins; bin += 1) {
      const azimuthDeg = bin * step;
      let highest = 0;
      let rayComplete = true;
      // Centre + bin edges reduce the chance of missing a narrow source cell.
      for (const offset of [-0.5, 0, 0.5]) {
        const bearing =
          (azimuthDeg + offset * step + gridNorthBearingDeg) * RAD;
        for (
          let distance = Math.max(resolutionM, 2);
          distance <= maxDistanceM;
          distance += distanceStepM
        ) {
          const elevation = sampleGrid(
            grid,
            point[0] + Math.sin(bearing) * distance,
            point[1] + Math.cos(bearing) * distance,
            "dsm",
          );
          if (elevation == null) {
            rayComplete = false;
            continue;
          }
          highest = Math.max(
            highest,
            Math.atan2(elevation - observerElevationM, distance) / RAD,
          );
        }
      }
      totalRays += 1;
      if (rayComplete) validRays += 1;
      profile.push({
        azimuthDeg,
        elevationDeg: highest,
        complete: rayComplete,
      });
    }
    profiles.push({ profile, weight: 1, coordinate, observerElevationM });
  }
  const profile = profiles.length
    ? Array.from({ length: bins }, (_, i) => ({
        azimuthDeg: i * step,
        elevationDeg:
          profiles.reduce((sum, p) => sum + p.profile[i].elevationDeg, 0) /
          profiles.length,
      }))
    : [];
  const coveragePct = totalRays ? (validRays / totalRays) * 100 : 0;
  const warnings = [];
  if (coveragePct < 100)
    warnings.push(
      "DSM/DTM coverage is incomplete within the requested shading radius; the horizon records only observed obstacles.",
    );
  if (profiles.length < points.length)
    warnings.push(
      "Some PV footprint samples are outside valid terrain coverage.",
    );
  if (belowSurface)
    warnings.push(
      `${belowSurface} receiver samples lie below the source DSM. Check mounting height above terrain, especially for rooftops.`,
    );
  return {
    profiles,
    profile,
    method: profiles.length ? "source-dsm-ray-horizon" : "unavailable",
    coveragePct,
    sampleCount: profiles.length,
    radiusM: maxDistanceM,
    resolutionM,
    azimuthStepDeg: step,
    warnings,
  };
}

/** Circular interpolation, including across the 359°/0° seam. Profiles must be sorted. */
export function horizonElevation(input, azimuthDeg) {
  const profile = Array.isArray(input) ? input : (input?.profile ?? []);
  if (!profile.length) return 0;
  const az = wrap(azimuthDeg);
  let low = 0;
  let high = profile.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (profile[middle].azimuthDeg <= az) low = middle + 1;
    else high = middle;
  }
  const a = profile[(low - 1 + profile.length) % profile.length];
  const b = profile[low % profile.length];
  const width = wrap(b.azimuthDeg - a.azimuthDeg) || 360;
  const fraction = wrap(az - a.azimuthDeg) / width;
  return a.elevationDeg + (b.elevationDeg - a.elevationDeg) * fraction;
}

function normalizeProfiles(horizon) {
  if (horizon?.method === "unavailable") return null;
  if (Array.isArray(horizon)) return [{ profile: horizon, weight: 1 }];
  if (horizon?.profiles?.length) return horizon.profiles;
  if (horizon?.profile?.length)
    return [{ profile: horizon.profile, weight: 1 }];
  return null;
}

// Integrate visible isotropic sky onto the actual panel plane. This is orientation sensitive.
function diffuseSkyVisibility(profile, system) {
  if (!profile.length) return 1;
  let all = 0;
  let visible = 0;
  for (let az = 2.5; az < 360; az += 5) {
    const horizon = horizonElevation(profile, az);
    for (let alt = 2.5; alt < 90; alt += 5) {
      const incidence = Math.max(
        0,
        Math.sin(alt * RAD) * Math.cos(system.tiltDeg * RAD) +
          Math.cos(alt * RAD) *
            Math.sin(system.tiltDeg * RAD) *
            Math.cos((az - system.azimuthDeg) * RAD),
      );
      const value = incidence * Math.cos(alt * RAD);
      all += value;
      if (alt > horizon) visible += value;
    }
  }
  return all ? visible / all : 1;
}

function energyFromPoa(poa, temperatureC, system, durationHours) {
  const cellTemperature =
    temperatureC + ((system.nominalOperatingCellTemperatureC - 20) / 800) * poa;
  const thermal = Math.max(
    0,
    1 + system.temperatureCoefficient * (cellTemperature - 25),
  );
  return (
    ((system.kwp * poa) / 1000) *
    thermal *
    (1 - system.systemLossPct / 100) *
    durationHours
  );
}

const sumKnown = (rows, key) =>
  rows.reduce((sum, row) => sum + (finite(row[key]) ? row[key] : 0), 0);
function aggregate(
  rows,
  system,
  expectedHours = rows.reduce((sum, row) => sum + row.durationHours, 0),
) {
  const weatherRows = rows.filter((row) => finite(row.weatherKwh));
  const shadedRows = rows.filter((row) => finite(row.shadedKwh));
  const priced = rows.filter((row) => finite(row.priceEurMWh));
  const completeWeather = weatherRows.length === rows.length;
  const completeShade = shadedRows.length === rows.length;
  const completePrice = priced.length === rows.length;
  const clearKwh = sumKnown(rows, "clearKwh");
  const coveredWeatherKwh = sumKnown(rows, "weatherKwh");
  const coveredShadedKwh = sumKnown(rows, "shadedKwh");
  const weatherKwh = completeWeather ? coveredWeatherKwh : null;
  const shadedKwh = completeShade ? coveredShadedKwh : null;
  const summary = {
    clearKwh,
    weatherKwh,
    shadedKwh,
    coveredWeatherKwh,
    coveredShadedKwh,
    shadingLossKwh:
      completeWeather && completeShade
        ? Math.max(0, coveredWeatherKwh - coveredShadedKwh)
        : null,
    shadingLossPct:
      completeWeather && completeShade && coveredWeatherKwh > 0
        ? (1 - coveredShadedKwh / coveredWeatherKwh) * 100
        : null,
    weatherRetentionPct:
      weatherKwh != null && clearKwh > 0 ? (weatherKwh / clearKwh) * 100 : null,
    solarRetentionPct:
      shadedKwh != null && clearKwh > 0 ? (shadedKwh / clearKwh) * 100 : null,
    specificYieldKwhKwp: shadedKwh != null ? shadedKwh / system.kwp : null,
    capacityFactorPct:
      shadedKwh != null && expectedHours
        ? (shadedKwh / (system.kwp * expectedHours)) * 100
        : null,
    expectedHours,
    intervalHours: rows.reduce((sum, row) => sum + row.durationHours, 0),
    weatherHours: weatherRows.reduce((sum, row) => sum + row.durationHours, 0),
    shadedHours: shadedRows.reduce((sum, row) => sum + row.durationHours, 0),
    pricedHours: priced.reduce((sum, row) => sum + row.durationHours, 0),
    negativePriceHours: rows
      .filter((row) => row.priceEurMWh < 0)
      .reduce((sum, row) => sum + row.durationHours, 0),
  };
  for (const key of [
    "clearRevenueEur",
    "weatherRevenueEur",
    "shadedRevenueEur",
    "shadowRevenueLossEur",
  ]) {
    const coveredKey = `priced${key[0].toUpperCase()}${key.slice(1)}`;
    summary[coveredKey] = sumKnown(rows, key);
    summary[key] =
      completePrice &&
      (key === "clearRevenueEur" ||
        (key === "weatherRevenueEur" ? completeWeather : completeShade))
        ? summary[coveredKey]
        : null;
  }
  return summary;
}

/** Deterministic hourly production and net export revenue; rows represent UTC interval STARTS. */
export function analyzePV({
  system: inputSystem = {},
  weather = [],
  prices = [],
  horizon,
  year,
  weatherTimeBasis = "start",
  durationHours = 1,
  substeps = 4,
} = {}) {
  const system = validateSystem(inputSystem);
  if (
    !["start", "end"].includes(weatherTimeBasis) ||
    !finite(durationHours) ||
    durationHours <= 0 ||
    durationHours > 1 ||
    !Number.isInteger(substeps) ||
    substeps < 1 ||
    substeps > 12
  )
    throw new Error("Invalid weather interval or integration settings.");
  const weatherRows = Array.isArray(weather) ? weather : (weather.rows ?? []);
  const priceRows = Array.isArray(prices) ? prices : (prices.rows ?? []);
  const priceMap = new Map();
  for (const row of priceRows) {
    const t = timestamp(row.time);
    if (!Number.isFinite(t) || !finite(row.priceEurMWh)) continue;
    if (priceMap.has(t))
      throw new Error(`Duplicate market price interval ${utc(t)}.`);
    priceMap.set(t, row.priceEurMWh);
  }
  const weatherMap = new Map();
  for (const row of weatherRows) {
    let t = timestamp(row.time);
    if (!Number.isFinite(t))
      throw new Error("Weather contains an invalid timestamp.");
    if (weatherTimeBasis === "end") t -= durationHours * HOUR;
    if (weatherMap.has(t))
      throw new Error(`Duplicate weather interval ${utc(t)}.`);
    weatherMap.set(t, row);
  }
  const years =
    year != null
      ? [Number(year)]
      : [
          ...new Set(
            [...weatherMap.keys()].map((t) => new Date(t).getUTCFullYear()),
          ),
        ].sort();
  if (years.some((v) => !Number.isInteger(v) || v < 1901 || v > 2099))
    throw new Error("Analysis year must be between 1901 and 2099.");
  if (!years.length)
    throw new Error("Supply weather intervals or select an analysis year.");
  const profiles = normalizeProfiles(horizon)?.map((profile) => ({
    ...profile,
  }));
  if (profiles)
    for (const p of profiles) {
      if (
        !Array.isArray(p.profile) ||
        p.profile.some(
          (point, i) =>
            !finite(point.azimuthDeg) ||
            point.azimuthDeg < 0 ||
            point.azimuthDeg >= 360 ||
            !finite(point.elevationDeg) ||
            point.elevationDeg < 0 ||
            point.elevationDeg > 90 ||
            (i > 0 && point.azimuthDeg <= p.profile[i - 1].azimuthDeg),
        )
      )
        throw new Error(
          "Horizon profiles must have sorted unique azimuths in [0,360) and elevations in [0,90].",
        );
      p._diffuseVisibility = diffuseSkyVisibility(p.profile, system);
      if (!finite(p.weight ?? 1) || (p.weight ?? 1) <= 0)
        throw new Error("Horizon sample weights must be positive numbers.");
    }
  const weightSum = profiles?.reduce((sum, p) => sum + (p.weight ?? 1), 0) ?? 0;
  const hourly = [];
  for (const selectedYear of years) {
    for (
      let time = Date.UTC(selectedYear, 0, 1);
      time < Date.UTC(selectedYear + 1, 0, 1);
      time += durationHours * HOUR
    ) {
      const row = weatherMap.get(time);
      const hasWeather =
        row &&
        ["ghi", "dni", "dhi", "temperatureC"].every((key) =>
          finite(row[key]),
        ) &&
        row.ghi >= 0 &&
        row.dni >= 0 &&
        row.dhi >= 0;
      let clearKwh = 0;
      let weatherKwh = hasWeather ? 0 : null;
      let shadedKwh = hasWeather && profiles ? 0 : null;
      let sunVisibleFraction = profiles ? 0 : null;
      // No hidden air-temperature default: clear sky uses 20°C when weather is missing, flagged below.
      const airTemperature = finite(row?.temperatureC) ? row.temperatureC : 20;
      for (let i = 0; i < substeps; i += 1) {
        const t = time + ((i + 0.5) / substeps) * durationHours * HOUR;
        const position = solarPosition(t, system.latitude, system.longitude);
        const clear = clearSkyIrradiance(t, position);
        clearKwh += energyFromPoa(
          planeOfArray(clear, position, system).total,
          airTemperature,
          system,
          durationHours / substeps,
        );
        const visibility = profiles?.map((p) =>
          position.elevationDeg > 0 &&
          position.elevationDeg >
            horizonElevation(p.profile, position.azimuthDeg)
            ? 1
            : 0,
        );
        if (profiles)
          sunVisibleFraction +=
            profiles.reduce(
              (sum, p, index) => sum + visibility[index] * (p.weight ?? 1),
              0,
            ) /
            weightSum /
            substeps;
        if (hasWeather) {
          const unshadedPoa = planeOfArray(row, position, system).total;
          weatherKwh += energyFromPoa(
            unshadedPoa,
            airTemperature,
            system,
            durationHours / substeps,
          );
          if (profiles) {
            // Apply the nonlinear thermal response per footprint sample before averaging.
            shadedKwh +=
              profiles.reduce(
                (sum, p, index) =>
                  sum +
                  energyFromPoa(
                    planeOfArray(
                      row,
                      position,
                      system,
                      visibility[index],
                      p._diffuseVisibility,
                    ).total,
                    airTemperature,
                    system,
                    durationHours / substeps,
                  ) *
                    (p.weight ?? 1),
                0,
              ) / weightSum;
          }
        }
      }
      const priceEurMWh = priceMap.get(time) ?? null;
      const netPriceEurKwh =
        priceEurMWh != null
          ? (priceEurMWh - system.salesMarginEurMWh) / 1000
          : null;
      const record = {
        time: utc(time),
        durationHours,
        clearKwh,
        weatherKwh,
        shadedKwh,
        shadingLossKwh:
          shadedKwh != null ? Math.max(0, weatherKwh - shadedKwh) : null,
        sunVisibleFraction,
        priceEurMWh,
        netPriceEurKwh,
        temperatureC: row?.temperatureC ?? null,
        ghi: row?.ghi ?? null,
        clearRevenueEur:
          netPriceEurKwh != null ? clearKwh * netPriceEurKwh : null,
        weatherRevenueEur:
          netPriceEurKwh != null && weatherKwh != null
            ? weatherKwh * netPriceEurKwh
            : null,
        shadedRevenueEur:
          netPriceEurKwh != null && shadedKwh != null
            ? shadedKwh * netPriceEurKwh
            : null,
      };
      record.shadowRevenueLossEur =
        record.weatherRevenueEur != null && record.shadedRevenueEur != null
          ? record.weatherRevenueEur - record.shadedRevenueEur
          : null;
      hourly.push(record);
    }
  }
  const byMonth = new Map();
  const byYear = new Map();
  for (const row of hourly) {
    const month = row.time.slice(0, 7);
    const y = row.time.slice(0, 4);
    if (!byMonth.has(month)) byMonth.set(month, []);
    if (!byYear.has(y)) byYear.set(y, []);
    byMonth.get(month).push(row);
    byYear.get(y).push(row);
  }
  const monthly = [...byMonth].map(([month, rows]) => ({
    month,
    ...aggregate(rows, system),
  }));
  const annual = [...byYear].map(([y, rows]) => ({
    year: Number(y),
    ...aggregate(rows, system),
  }));
  const summary = aggregate(hourly, system);
  const warnings = [...(horizon?.warnings ?? [])];
  if (summary.weatherHours < summary.expectedHours)
    warnings.push(
      "Weather is incomplete. Annual weather-adjusted energy is unknown; covered sums are not extrapolated.",
    );
  if (summary.pricedHours < summary.expectedHours)
    warnings.push(
      "Market prices are incomplete. Annual revenue is unknown; priced sums cover matching intervals only.",
    );
  if (!profiles)
    warnings.push(
      "Local shading is unavailable without a measured source horizon.",
    );
  return {
    system,
    hourly,
    monthly,
    annual,
    summary,
    quality: {
      status: warnings.length ? "warning" : "pass",
      warnings,
      expectedHours: summary.expectedHours,
      weatherHours: summary.weatherHours,
      pricedHours: summary.pricedHours,
      horizonCoveragePct: horizon?.coveragePct ?? (profiles ? 100 : 0),
      temperatureFallbackHours:
        hourly.filter((row) => !finite(row.temperatureC)).length *
        durationHours,
    },
    assumptions: [
      "Weather and market rows are UTC interval starts.",
      `${substeps} midpoint samples per weather interval; irradiance is constant within each interval.`,
      "Haurwitz clear sky with Erbs decomposition; isotropic diffuse sky and albedo ground reflection.",
      "Linear nameplate power, NOCT cell temperature, temperature coefficient and aggregate electrical loss; no inverter clipping, snow, curtailment, storage or self-consumption.",
      "DSM horizon is opaque in every season; no tree leaf transmission or electrical string mismatch model. Ground-reflected light is not locally obstructed.",
      "All energy is exported at spot price less sales margin, including negative prices.",
    ],
  };
}

function parseDelimitedLine(line, delimiter) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (line[i] === delimiter && !quoted) {
      fields.push(field.trim());
      field = "";
    } else field += line[i];
  }
  if (quoted) throw new Error("CSV contains an unclosed quote.");
  fields.push(field.trim());
  return fields;
}

/** Explicit interval-energy CSV: time/energy_kwh; timestamps require Z or numeric UTC offset. */
export function parseOwnerCsv(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2)
    throw new Error("CSV needs a header and at least one production interval.");
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseDelimitedLine(lines[0], delimiter).map((value) =>
    value.toLowerCase().replace(/[\s-]+/g, "_"),
  );
  const timeIndex = header.findIndex((value) =>
    ["time", "timestamp", "interval_start"].includes(value),
  );
  const energyIndex = header.findIndex((value) =>
    ["energy_kwh", "production_kwh", "kwh"].includes(value),
  );
  if (timeIndex < 0 || energyIndex < 0)
    throw new Error(
      "Use CSV headers time,energy_kwh. Values must be interval energy in kWh.",
    );
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    let fields;
    try {
      fields = parseDelimitedLine(lines[i], delimiter);
    } catch (error) {
      errors.push(`Line ${i + 1}: ${error.message}`);
      continue;
    }
    const rawTime = fields[timeIndex] ?? "";
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawTime)) {
      errors.push(
        `Line ${i + 1}: timestamp needs Z or a UTC offset to resolve daylight saving time.`,
      );
      continue;
    }
    const iso = rawTime.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i,
    );
    if (
      !iso ||
      +iso[2] < 1 ||
      +iso[2] > 12 ||
      +iso[3] < 1 ||
      +iso[3] > new Date(Date.UTC(+iso[1], +iso[2], 0)).getUTCDate() ||
      +iso[4] > 23 ||
      +iso[5] > 59 ||
      +(iso[6] ?? 0) > 59
    ) {
      errors.push(
        `Line ${i + 1}: timestamp must be a valid ISO calendar date and time.`,
      );
      continue;
    }
    const t = timestamp(rawTime);
    const rawEnergy = fields[energyIndex] ?? "";
    const energyKwh = Number(
      delimiter === ";" ? rawEnergy.replace(",", ".") : rawEnergy,
    );
    if (!Number.isFinite(t) || t % 900000 !== 0) {
      errors.push(
        `Line ${i + 1}: time must start on a UTC 15-minute boundary.`,
      );
      continue;
    }
    if (!rawEnergy || !finite(energyKwh) || energyKwh < 0) {
      errors.push(`Line ${i + 1}: energy_kwh must be a nonnegative number.`);
      continue;
    }
    if (seen.has(t)) {
      errors.push(`Line ${i + 1}: duplicate interval ${utc(t)}.`);
      continue;
    }
    seen.add(t);
    rows.push({ time: utc(t), energyKwh, durationMinutes: 15 });
  }
  rows.sort((a, b) => timestamp(a.time) - timestamp(b.time));
  const missingIntervals = rows.length
    ? (timestamp(rows.at(-1).time) - timestamp(rows[0].time)) / 900000 +
      1 -
      rows.length
    : 0;
  return {
    rows,
    errors,
    warnings:
      missingIntervals > 0
        ? [
            `${missingIntervals} quarter-hour intervals are missing between the first and last records; they will not be filled.`,
          ]
        : [],
    missingIntervals,
    valid: errors.length === 0 && rows.length > 0,
    intervalMinutes: 15,
  };
}

/** Aggregate measured interval energy into complete model hours; never upsample the prediction. */
export function compareOwnerData(input, analysis) {
  const rows = Array.isArray(input) ? input : (input?.rows ?? []);
  const toleranceMs = 0.001;
  const model = new Map();
  for (const row of analysis?.hourly ?? []) {
    const time = timestamp(row.time);
    if (!Number.isFinite(time) || time % HOUR !== 0 || (row.durationHours != null && row.durationHours !== 1)) {
      throw new Error("Owner comparison requires model hours starting on UTC hour boundaries.");
    }
    if (model.has(time)) throw new Error("Owner comparison contains duplicate model hours.");
    model.set(time, row);
  }
  const modelTimes = [...model.keys()].sort((a, b) => a - b);
  const modelMin = modelTimes[0] ?? Infinity;
  const modelEnd = modelTimes.length ? modelTimes.at(-1) + HOUR : -Infinity;
  const groups = new Map();
  const group = (hour) => {
    if (!groups.has(hour)) groups.set(hour, { segments: [], sourceIds: new Set(), invalid: false, overlap: false });
    return groups.get(hour);
  };
  // Iterate only inside the bounded modeled period, including holes in model coverage.
  const visitHours = (start, end, callback) => {
    const finish = Math.min(end, modelEnd);
    for (let hour = Math.max(Math.floor(start / HOUR) * HOUR, modelMin); hour < finish - toleranceMs; hour += HOUR) {
      if (!model.has(hour)) continue;
      const a = Math.max(start, hour), b = Math.min(end, hour + HOUR);
      if (b > a + toleranceMs) callback(hour, a, b);
    }
  };
  const intervals = [];
  let invalidIntervals = 0, outsideModelIntervals = 0, outsideModelHours = 0, splitIntervals = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? {};
    const start = timestamp(row.time);
    const minutes = row.durationMinutes ?? input?.intervalMinutes ?? 15;
    const duration = finite(minutes) ? minutes * 60000 : NaN;
    const end = start + duration;
    const validExtent = Number.isFinite(start) && Number.isFinite(end) && duration > toleranceMs;
    if (!validExtent || !finite(row.energyKwh) || row.energyKwh < 0) {
      invalidIntervals += 1;
      if (validExtent) visitHours(start, end, (hour) => { group(hour).invalid = true; });
      continue;
    }
    const item = { index, start, end, energyKwh: row.energyKwh };
    intervals.push(item);
    if (Math.floor(start / HOUR) !== Math.floor((end - toleranceMs) / HOUR)) splitIntervals += 1;
    let modeledMs = 0;
    visitHours(start, end, (hour, a, b) => {
      modeledMs += b - a;
      const g = group(hour);
      g.segments.push({
        start: a, end: b, energyKwh: row.energyKwh * (b - a) / duration,
        sampleGapMinutes: finite(row.sampleGapMinutes) && row.sampleGapMinutes > 0 ? row.sampleGapMinutes : null,
        extendedSpan: row.extendedSpan === true,
      });
      g.sourceIds.add(index);
    });
    const outsideMs = Math.max(0, duration - modeledMs);
    if (outsideMs > toleranceMs) outsideModelIntervals += 1;
    outsideModelHours += outsideMs / HOUR;
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  // Sweep all source boundaries so even nested/duplicate intervals taint every overlapping hour.
  const events = intervals.flatMap((row) => [[row.start, 1], [row.end, -1]]).sort((a, b) => a[0] - b[0]);
  const overlapSpans = [];
  let active = 0, previous = null;
  for (let i = 0; i < events.length;) {
    const time = events[i][0];
    if (previous != null && active > 1 && time > previous + toleranceMs) {
      const last = overlapSpans.at(-1);
      if (last && Math.abs(last[1] - previous) <= toleranceMs) last[1] = time;
      else overlapSpans.push([previous, time]);
    }
    while (i < events.length && events[i][0] === time) { active += events[i][1]; i += 1; }
    previous = time;
  }
  for (const [start, end] of overlapSpans) visitHours(start, end, (hour) => { group(hour).overlap = true; });
  let overlapIntervals = 0;
  for (const row of intervals) {
    let low = 0, high = overlapSpans.length;
    while (low < high) { const middle = (low + high) >> 1; if (overlapSpans[middle][1] <= row.start + toleranceMs) low = middle + 1; else high = middle; }
    if (overlapSpans[low]?.[0] < row.end - toleranceMs) overlapIntervals += 1;
  }
  // This is unique observed duration, not the sum of potentially duplicated input durations.
  let inputCoverageMs = 0, unionStart = null, unionEnd = null;
  for (const row of intervals) {
    if (unionEnd == null || row.start > unionEnd + toleranceMs) {
      if (unionEnd != null) inputCoverageMs += unionEnd - unionStart;
      unionStart = row.start; unionEnd = row.end;
    } else unionEnd = Math.max(unionEnd, row.end);
  }
  if (unionEnd != null) inputCoverageMs += unionEnd - unionStart;
  const matched = [], matchedIds = new Set(), unavailableIds = new Set();
  let partialHours = 0, partialCoveredHours = 0, overlapHours = 0, invalidHours = 0;
  let unavailableModelHours = 0, excludedHours = 0, excludedCoveredHours = 0, modeledCoverageMs = 0;
  for (const [hour, g] of [...groups].sort((a, b) => a[0] - b[0])) {
    g.segments.sort((a, b) => a.start - b.start || a.end - b.end);
    let coveredMs = 0, end = hour, actualKwh = 0;
    for (const segment of g.segments) {
      coveredMs += Math.max(0, segment.end - Math.max(end, segment.start));
      end = Math.max(end, segment.end);
      actualKwh += segment.energyKwh;
    }
    modeledCoverageMs += coveredMs;
    const complete = Math.abs(coveredMs - HOUR) <= toleranceMs;
    const estimate = model.get(hour);
    const available = finite(estimate.shadedKwh) && estimate.shadedKwh >= 0;
    if (!complete) { partialHours += 1; partialCoveredHours += coveredMs / HOUR; }
    if (g.overlap) overlapHours += 1;
    if (g.invalid) invalidHours += 1;
    if (!available) { unavailableModelHours += 1; for (const index of g.sourceIds) unavailableIds.add(index); }
    if (!complete || g.overlap || g.invalid || !available) {
      excludedHours += 1; excludedCoveredHours += coveredMs / HOUR; continue;
    }
    for (const index of g.sourceIds) matchedIds.add(index);
    const maxSampleGapMinutes = g.segments.reduce((maximum, segment) => segment.sampleGapMinutes == null ? maximum : Math.max(maximum ?? 0, segment.sampleGapMinutes), null);
    matched.push({
      time: utc(hour), durationMinutes: 60, coverageMinutes: coveredMs / 60000,
      sourceIntervals: g.sourceIds.size,
      maxSampleGapMinutes,
      longerSpanMinutes: g.segments.reduce((sum, segment) => sum + (segment.extendedSpan ? (segment.end - segment.start) / 60000 : 0), 0),
      actualKwh, modelKwh: estimate.shadedKwh, errorKwh: estimate.shadedKwh - actualKwh,
    });
  }
  const n = matched.length;
  outsideModelHours = Math.max(0, (inputCoverageMs - modeledCoverageMs) / HOUR);
  const actualKwh = n ? sumKnown(matched, "actualKwh") : null;
  const modelKwh = n ? sumKnown(matched, "modelKwh") : null;
  const maeKwh = n ? matched.reduce((sum, row) => sum + Math.abs(row.errorKwh), 0) / n : null;
  const rmseKwh = n ? Math.sqrt(matched.reduce((sum, row) => sum + row.errorKwh ** 2, 0) / n) : null;
  const biasKwh = n ? (modelKwh - actualKwh) / n : null;
  const warnings = [];
  if (invalidIntervals) warnings.push(`${invalidIntervals} invalid source intervals were excluded; touched model hours are not compared.`);
  if (overlapIntervals) warnings.push(`${overlapIntervals} overlapping source intervals affect ${overlapHours} model hours, which were excluded.`);
  if (partialHours) warnings.push(`${partialHours} model hours have incomplete measured coverage and were excluded.`);
  if (outsideModelIntervals) warnings.push(`${outsideModelIntervals} source intervals extend outside available model timestamps; those portions are not compared.`);
  if (unavailableModelHours) warnings.push(`${unavailableModelHours} touched model hours have unknown predicted energy and were excluded.`);
  if (splitIntervals) warnings.push(`${splitIntervals} source intervals cross an hour boundary. Their interval energy is allocated by duration, assuming uniform energy rate within each split source interval.`);
  if (!n) warnings.push("No complete, nonoverlapping measured hours match available model energy. No accuracy metrics can be calculated.");
  return {
    matched, matchedIntervals: n, matchedHours: n, matchedSourceIntervals: matchedIds.size,
    inputIntervals: rows.length, invalidIntervals, invalidHours, outsideModelIntervals, outsideModelHours,
    unavailableModelIntervals: unavailableIds.size, unavailableModelHours,
    partialHours, partialCoveredHours, overlapIntervals, overlapHours, excludedHours, excludedCoveredHours,
    candidateHours: groups.size, inputCoverageHours: inputCoverageMs / HOUR, splitIntervals,
    actualKwh, modelKwh, biasKwh, biasPct: actualKwh > 0 ? (modelKwh / actualKwh - 1) * 100 : null,
    maeKwh, rmseKwh, hourlyMaeKwh: maeKwh, hourlyRmseKwh: rmseKwh, hourlyBiasKwh: biasKwh,
    nmaePct: actualKwh > 0 ? maeKwh * n / actualKwh * 100 : null,
    periodStart: matched[0]?.time ?? null, periodEnd: n ? utc(timestamp(matched.at(-1).time) + HOUR) : null,
    status: n ? "compared" : "not_testable", warnings,
    assumption: "Measured interval energy is aggregated into complete UTC model hours. Partial hours, overlapping or invalid source coverage, outside periods and unknown model energy are excluded. Predictions retain their hourly resolution; no five-minute or quarter-hour prediction accuracy is claimed. Source intervals crossing an hour boundary use an explicit uniform-rate duration allocation. Metrics and totals describe matched hours only; no annual extrapolation.",
  };
}

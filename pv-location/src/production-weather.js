const HOUR = 3600000;
const DAY = 24 * HOUR;
const MAX_DAYS = 366;
const ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";
const FIELDS = [
  "temperature_2m",
  "shortwave_radiation",
  "direct_normal_irradiance",
  "diffuse_radiation",
];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const iso = (time) => new Date(time).toISOString();

function instant(value, label, allowDate = false) {
  if (typeof value === "string") {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if ((!allowDate || !dateOnly) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
      throw new Error(`${label} must have an explicit UTC or timezone offset.`);
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (
      !parts ||
      new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]))
        .toISOString()
        .slice(0, 10) !== parts[0]
    )
      throw new Error(`${label} has an invalid calendar date.`);
  }
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(time))
    throw new Error(`${label} is not a valid timestamp.`);
  return time;
}

/** End is exclusive. Imported values and metadata are deliberately never read. */
export function productionWeatherPeriod(input = {}) {
  let start,
    end,
    inputRows = null;
  if (input.start != null || input.end != null) {
    start = instant(input.start, "Period start", true);
    end = instant(input.end, "Period end", true);
  } else if (Array.isArray(input.rows) && input.rows.length) {
    inputRows = input.rows.length;
    start = Infinity;
    end = -Infinity;
    for (const row of input.rows) {
      const time = instant(row.time, "Production interval");
      const minutes =
        row.durationMinutes ??
        (row.durationHours != null ? row.durationHours * 60 : 15);
      if (!finite(minutes) || minutes <= 0 || minutes > 24 * 60)
        throw new Error(
          "Production interval duration must be positive and at most one day.",
        );
      start = Math.min(start, time);
      end = Math.max(end, time + minutes * 60000);
    }
  } else
    throw new Error("Supply production rows or an explicit start/end period.");
  if (end <= start)
    throw new Error(
      "Production weather period must have an exclusive end after its start.",
    );
  if (end - start > MAX_DAYS * DAY)
    throw new Error(
      `Production weather requests are limited to ${MAX_DAYS} days.`,
    );
  if (start < Date.UTC(1901, 0, 1) || end > Date.UTC(2100, 0, 1))
    throw new Error(
      "Production weather periods must fall within model years 1901–2099.",
    );
  const modelStart = Math.floor(start / HOUR) * HOUR;
  const modelEnd = Math.ceil(end / HOUR) * HOUR;
  return {
    start: iso(start),
    end: iso(end),
    modelStart: iso(modelStart),
    modelEnd: iso(modelEnd),
    expectedHours: (modelEnd - modelStart) / HOUR,
    inputRows,
  };
}

function site(point = {}) {
  const latitude = point.latitude ?? point.lat;
  const longitude = point.longitude ?? point.lon ?? point.lng;
  if (
    !finite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !finite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    throw new Error(
      "Production weather needs valid site latitude and longitude.",
    );
  return { latitude, longitude };
}

function abort(signal) {
  if (signal?.aborted)
    throw (
      signal.reason ??
      new DOMException("Weather request cancelled.", "AbortError")
    );
}

function normalize(raw, period, point) {
  const hourly = raw?.hourly;
  if (raw?.utc_offset_seconds !== 0 || !Array.isArray(hourly?.time))
    throw new Error(
      "Historical weather response must contain a UTC hourly series with zero offset.",
    );
  const gridLocation = site(raw);
  if (
    FIELDS.some(
      (field) =>
        !Array.isArray(hourly[field]) ||
        hourly[field].length !== hourly.time.length,
    )
  )
    throw new Error(
      "Historical weather columns have missing or mismatched values; no fallback was substituted.",
    );
  if (
    raw.hourly_units &&
    FIELDS.some(
      (field) =>
        raw.hourly_units[field] != null &&
        raw.hourly_units[field] !==
          (field === "temperature_2m" ? "°C" : "W/m²"),
    )
  )
    throw new Error(
      "Historical weather returned unexpected temperature or radiation units.",
    );
  const start = Date.parse(period.modelStart),
    end = Date.parse(period.modelEnd);
  const selected = new Map(),
    seen = new Set();
  for (let index = 0; index < hourly.time.length; index++) {
    const value = hourly.time[index];
    if (typeof value !== "string")
      throw new Error("Historical weather has an invalid hourly timestamp.");
    // timezone=UTC makes unqualified provider timestamps UTC. Radiation is a preceding-hour mean.
    const timestamp = instant(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`,
      "Weather hour",
    );
    if (timestamp % HOUR !== 0)
      throw new Error(
        "Historical weather timestamps must be aligned to UTC hours.",
      );
    if (seen.has(timestamp))
      throw new Error("Historical weather contains duplicate UTC hours.");
    seen.add(timestamp);
    const time = timestamp - HOUR;
    if (time < start || time >= end) continue;
    const values = FIELDS.map((field) => hourly[field][index]);
    if (!values.every(finite) || values.slice(1).some((value) => value < 0))
      throw new Error(
        "Historical weather has missing or invalid irradiance/temperature in the production period; no fallback was substituted.",
      );
    selected.set(time, {
      time: iso(time),
      ghi: values[1],
      dni: values[2],
      dhi: values[3],
      temperatureC: values[0],
    });
  }
  const rows = [];
  for (let time = start; time < end; time += HOUR) {
    if (!selected.has(time))
      throw new Error(
        "Historical weather coverage is incomplete for the production period; no baseline weather or gap filling was substituted.",
      );
    rows.push(selected.get(time));
  }
  return {
    provider: "Open-Meteo / Copernicus ERA5",
    model: "era5",
    requestedLocation: point,
    gridLocation: {
      ...gridLocation,
      elevationM: finite(raw.elevation) ? raw.elevation : null,
    },
    intervalHours: 1,
    timeBasis: "interval_start_utc",
    radiationBasis: "preceding-hour mean shifted to interval start",
    temperatureBasis: "instantaneous provider value at interval end",
    period,
    rows,
    coverage: {
      expectedHours: period.expectedHours,
      receivedHours: rows.length,
      coveragePct: 100,
      inputRows: period.inputRows,
    },
  };
}

/** Only the site and dates are transmitted: no production values, names, IDs or filenames. */
export async function loadProductionWeather(
  input,
  point,
  { signal, fetchImpl = globalThis.fetch } = {},
) {
  abort(signal);
  const period = productionWeatherPeriod(input),
    requestedLocation = site(point);
  const url = new URL(ENDPOINT);
  const params = {
    ...requestedLocation,
    start_date: period.modelStart.slice(0, 10),
    // Include the next midnight endpoint when required by preceding-hour radiation.
    end_date: period.modelEnd.slice(0, 10),
    hourly: FIELDS.join(","),
    timezone: "UTC",
    models: "era5",
    temperature_unit: "celsius",
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  if (typeof fetchImpl !== "function")
    throw new Error(
      "Historical weather requests are unavailable in this environment.",
    );
  const response = await fetchImpl(url.href, {
    signal,
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  abort(signal);
  if (!response.ok)
    throw new Error(
      `Historical ERA5 weather request failed (HTTP ${response.status}); no baseline weather was substituted.`,
    );
  const bytes = await response.arrayBuffer();
  abort(signal);
  if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024)
    throw new Error(
      "Historical weather response is empty or exceeds the bounded request size.",
    );
  let raw;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Historical weather service returned invalid JSON.");
  }
  const weather = normalize(raw, period, requestedLocation);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  abort(signal);
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    ...weather,
    provenance: {
      source_url: url.href,
      retrieved_at: new Date().toISOString(),
      sha256,
      bytes: bytes.byteLength,
      requestedLocation,
      gridLocation: weather.gridLocation,
      model: "era5",
      timeBasis: weather.timeBasis,
      radiationBasis: weather.radiationBasis,
      temperatureBasis: weather.temperatureBasis,
      period,
      note: "Exploratory location-specific historical weather request; not the pinned canonical baseline or a site irradiance observation.",
    },
  };
}

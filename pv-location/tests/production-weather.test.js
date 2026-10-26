import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  loadProductionWeather,
  productionWeatherPeriod,
} from "../src/production-weather.js";
import { analyzeProductionPeriod } from "../src/production.worker.js";

const HOUR = 3600000;
const point = { latitude: 58.37, longitude: 26.72 };
const fields = [
  "temperature_2m",
  "shortwave_radiation",
  "direct_normal_irradiance",
  "diffuse_radiation",
];
const period = { start: "2026-06-01T00:00:00Z", end: "2026-06-02T00:00:00Z" };
function rawFor(url) {
  const u = new URL(url),
    start = Date.parse(u.searchParams.get("start_date")),
    end = Date.parse(u.searchParams.get("end_date")) + 24 * HOUR;
  const time = Array.from({ length: (end - start) / HOUR }, (_, i) =>
    new Date(start + i * HOUR).toISOString().slice(0, 16),
  );
  return {
    latitude: 58.25,
    longitude: 26.75,
    elevation: 57,
    utc_offset_seconds: 0,
    hourly_units: {
      temperature_2m: "°C",
      shortwave_radiation: "W/m²",
      direct_normal_irradiance: "W/m²",
      diffuse_radiation: "W/m²",
    },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 10 + i / 10),
      shortwave_radiation: time.map((_, i) => 100 + i),
      direct_normal_irradiance: time.map((_, i) => 200 + i),
      diffuse_radiation: time.map((_, i) => 300 + i),
    },
  };
}
const mocked = (mutate) => async (url) => {
  const raw = rawFor(url);
  mutate?.(raw);
  return Response.json(raw);
};

test("production period respects uploaded offsets and sub-hour durations, with an exclusive end", () => {
  const p = productionWeatherPeriod({
    rows: [{ time: "2026-06-01T00:03:00+02:00", durationMinutes: 5 }],
  });
  assert.equal(p.start, "2026-05-31T22:03:00.000Z");
  assert.equal(p.end, "2026-05-31T22:08:00.000Z");
  assert.equal(p.modelStart, "2026-05-31T22:00:00.000Z");
  assert.equal(p.modelEnd, "2026-05-31T23:00:00.000Z");
  assert.equal(
    productionWeatherPeriod({ rows: [{ time: "2026-06-01T00:00Z" }] }).end,
    "2026-06-01T00:15:00.000Z",
  );
  assert.equal(
    productionWeatherPeriod({
      rows: [{ time: "2026-06-01T00:00Z", durationHours: 0.5 }],
    }).end,
    "2026-06-01T00:30:00.000Z",
  );
  assert.equal(
    productionWeatherPeriod({ start: "2024-01-01", end: "2025-01-01" })
      .expectedHours,
    8784,
  );
  assert.throws(
    () => productionWeatherPeriod({ start: "2024-01-01", end: "2025-01-02" }),
    /366 days/,
  );
  assert.throws(
    () => productionWeatherPeriod({ rows: [{ time: "2026-06-01T00:00" }] }),
    /explicit UTC or timezone/,
  );
  assert.throws(
    () => productionWeatherPeriod({ start: "2026-02-31", end: "2026-03-04" }),
    /invalid calendar/,
  );
  assert.throws(
    () => productionWeatherPeriod({ start: "2026-06-02", end: "2026-06-01" }),
    /exclusive end/,
  );
  assert.throws(
    () =>
      productionWeatherPeriod({
        rows: [{ time: "2026-06-01T00:00Z", durationMinutes: 0 }],
      }),
    /duration/,
  );
});

test("ERA5 preceding-hour radiation includes the final midnight boundary and retains exact response provenance", async () => {
  let requested, body;
  const result = await loadProductionWeather(period, point, {
    fetchImpl: async (url) => {
      requested = new URL(url);
      body = JSON.stringify(rawFor(url));
      return new Response(body);
    },
  });
  assert.equal(requested.hostname, "archive-api.open-meteo.com");
  assert.equal(requested.searchParams.get("models"), "era5");
  assert.equal(requested.searchParams.get("timezone"), "UTC");
  assert.equal(requested.searchParams.get("end_date"), "2026-06-02");
  assert.equal(result.rows.length, 24);
  assert.deepEqual(result.rows[0], {
    time: "2026-06-01T00:00:00.000Z",
    ghi: 101,
    dni: 201,
    dhi: 301,
    temperatureC: 10.1,
  });
  assert.equal(result.rows.at(-1).ghi, 124);
  assert.equal(result.rows.at(-1).time, "2026-06-01T23:00:00.000Z");
  assert.equal(result.gridLocation.latitude, 58.25);
  assert.deepEqual(result.requestedLocation, point);
  assert.equal(result.coverage.coveragePct, 100);
  assert.equal(
    result.provenance.sha256,
    createHash("sha256").update(body).digest("hex"),
  );
  assert.ok(Number.isFinite(Date.parse(result.provenance.retrieved_at)));
  assert.match(result.provenance.radiationBasis, /preceding-hour/);
});

test("weather requests transmit only dates and coordinates, never private production fields", async () => {
  let requestUrl, options;
  const row = {
    time: "2026-06-01T12:03:00Z",
    durationMinutes: 5,
    filename: "PRIVATE_FILE.xlsx",
    siteId: "PRIVATE_SITE",
  };
  Object.defineProperty(row, "energyKwh", {
    get: () => {
      throw new Error("Must not read uploaded energy");
    },
  });
  const result = await loadProductionWeather(
    { rows: [row], filename: "PRIVATE_FILE.xlsx", account: "PRIVATE_ACCOUNT" },
    { ...point, name: "PRIVATE_SITE" },
    {
      fetchImpl: async (url, opts) => {
        requestUrl = url;
        options = opts;
        return Response.json(rawFor(url));
      },
    },
  );
  assert.ok(!requestUrl.includes("PRIVATE"));
  assert.deepEqual(
    [...new URL(requestUrl).searchParams.keys()].sort(),
    [
      "latitude",
      "longitude",
      "start_date",
      "end_date",
      "hourly",
      "timezone",
      "models",
      "temperature_unit",
    ].sort(),
  );
  assert.equal(options.method, "GET");
  assert.equal(options.body, undefined);
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(result.coverage.inputRows, 1);
  assert.equal(result.rows.length, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("missing values, duplicate hours, gaps, wrong offsets and mismatched units fail without a baseline fallback", async () => {
  const cases = [
    [
      (raw) => {
        raw.utc_offset_seconds = 7200;
      },
      /zero offset/,
    ],
    [
      (raw) => {
        raw.hourly.time[2] = raw.hourly.time[1];
      },
      /duplicate UTC/,
    ],
    [
      (raw) => {
        raw.hourly.shortwave_radiation[3] = null;
      },
      /missing or invalid/,
    ],
    [
      (raw) => {
        raw.hourly.direct_normal_irradiance[3] = -1;
      },
      /missing or invalid/,
    ],
    [
      (raw) => {
        for (const key of ["time", ...fields]) raw.hourly[key].splice(3, 1);
      },
      /coverage is incomplete/,
    ],
    [
      (raw) => {
        raw.hourly.temperature_2m.pop();
      },
      /mismatched values/,
    ],
    [
      (raw) => {
        raw.hourly_units.temperature_2m = "°F";
      },
      /unexpected.*units/,
    ],
  ];
  for (const [mutate, pattern] of cases)
    await assert.rejects(
      loadProductionWeather(period, point, { fetchImpl: mocked(mutate) }),
      pattern,
    );
  await assert.rejects(
    loadProductionWeather(period, point, {
      fetchImpl: async () => new Response("Unavailable", { status: 503 }),
    }),
    /HTTP 503.*no baseline/,
  );
  await assert.rejects(
    loadProductionWeather(
      period,
      { latitude: NaN, longitude: 26 },
      { fetchImpl: mocked() },
    ),
    /valid site/,
  );
});

test("cancellation is honored before the request and before processing returned data", async () => {
  const first = new AbortController();
  first.abort();
  await assert.rejects(
    loadProductionWeather(period, point, {
      signal: first.signal,
      fetchImpl: () => {
        throw new Error("Must not fetch");
      },
    }),
    { name: "AbortError" },
  );
  const second = new AbortController();
  await assert.rejects(
    loadProductionWeather(period, point, {
      signal: second.signal,
      fetchImpl: async (url, options) => {
        assert.equal(options.signal, second.signal);
        second.abort();
        return Response.json(rawFor(url));
      },
    }),
    { name: "AbortError" },
  );
});

test("sub-hour requests across New Year retain only overlapping UTC model hours", async () => {
  const result = await loadProductionWeather(
    { start: "2025-12-31T23:45:00Z", end: "2026-01-01T00:15:00Z" },
    point,
    { fetchImpl: mocked() },
  );
  assert.deepEqual(
    result.rows.map((row) => row.time),
    ["2025-12-31T23:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
  assert.equal(result.coverage.expectedHours, 2);
});

const workerInput = () => ({
  system: {
    latitude: 58.37,
    longitude: 26.72,
    kwp: 20,
    tiltDeg: 35,
    azimuthDeg: 180,
    mountingHeightM: 2,
    systemLossPct: 14,
    salesMarginEurMWh: 5,
  },
  horizon: [0, 90, 180, 270].map((azimuthDeg) => ({
    azimuthDeg,
    elevationDeg: 0,
  })),
  weather: {
    period: { start: "2026-06-15T10:00:00Z", end: "2026-06-15T12:00:00Z" },
    rows: [10, 11].map((hour) => ({
      time: `2026-06-15T${hour}:00:00Z`,
      ghi: 500,
      dni: 700,
      dhi: 100,
      temperatureC: 20,
    })),
  },
});

test("production worker infers 2026 and publishes only the requested period, not annual baseline aggregates", () => {
  const result = analyzeProductionPeriod(workerInput());
  assert.equal(result.hourly.length, 2);
  assert.ok(
    result.hourly.every(
      (row) => row.time.startsWith("2026-06-15") && row.shadedKwh > 0,
    ),
  );
  assert.equal(result.quality.expectedHours, 2);
  assert.equal(result.quality.weatherHours, 2);
  assert.equal(result.quality.valuation, "not_requested");
  assert.equal(result.quality.status, "pass");
  assert.equal(result.annual, undefined);
  assert.equal(result.summary, undefined);
  assert.equal(result.monthly, undefined);
  assert.ok(
    !result.quality.warnings.some((warning) => /annual|market/i.test(warning)),
  );
  const crossing = workerInput();
  crossing.weather.period = {
    start: "2025-12-31T23:00:00Z",
    end: "2026-01-01T01:00:00Z",
  };
  crossing.weather.rows[0].time = crossing.weather.period.start;
  crossing.weather.rows[1].time = "2026-01-01T00:00:00Z";
  assert.deepEqual(
    analyzeProductionPeriod(crossing).hourly.map((row) => row.time),
    ["2025-12-31T23:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
  const bad = workerInput();
  bad.weather.rows[1].time = bad.weather.rows[0].time;
  assert.throws(() => analyzeProductionPeriod(bad), /unique UTC hours/);
});

test("worker message replies retain request IDs and return explicit errors", async () => {
  const previous = globalThis.self,
    replies = [];
  try {
    globalThis.self = { postMessage: (message) => replies.push(message) };
    await import("../src/production.worker.js?message-protocol-test");
    self.onmessage({ data: { id: 17, ...workerInput() } });
    assert.equal(replies[0].id, 17);
    assert.equal(replies[0].analysis.hourly.length, 2);
    self.onmessage({ data: { id: 18, weather: [] } });
    assert.equal(replies[1].id, 18);
    assert.match(replies[1].error, /Load historical weather/);
  } finally {
    if (previous === undefined) delete globalThis.self;
    else globalThis.self = previous;
  }
});

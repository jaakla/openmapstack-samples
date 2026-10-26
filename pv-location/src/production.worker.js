import { analyzePV } from "./analysis.js";
import { applyConsumption } from "./consumption.js";

/** Model the supplied weather dates, including years outside the published baseline. */
export function analyzeProductionPeriod({
  system,
  horizon,
  weather,
  consumption,
} = {}) {
  const rows = Array.isArray(weather) ? weather : weather?.rows;
  if (!Array.isArray(rows) || !rows.length)
    throw new Error(
      "Load historical weather for the imported production period first.",
    );
  const orderedTimes = rows
    .map((row) =>
      typeof row.time === "number" ? row.time : Date.parse(row.time),
    )
    .sort((a, b) => a - b);
  if (
    rows.length > 366 * 24 + 1 ||
    orderedTimes.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time % 3600000 !== 0 ||
        (index > 0 && time !== orderedTimes[index - 1] + 3600000),
    )
  )
    throw new Error(
      "Production weather must be a bounded, complete series of unique UTC hours.",
    );
  const times = new Set(orderedTimes);
  // No selected baseline year or market data: infer years from this weather alone.
  const modeled = analyzePV({ system, horizon, weather: rows, prices: [] });
  const hourly = modeled.hourly.filter((row) =>
    times.has(Date.parse(row.time)),
  );
  if (hourly.length !== rows.length)
    throw new Error(
      "Production weather must contain unique intervals aligned to UTC hours.",
    );
  const weatherHours = hourly.filter((row) =>
    Number.isFinite(row.weatherKwh),
  ).length;
  const warnings = [...(horizon?.warnings || [])];
  if (weatherHours !== hourly.length)
    warnings.push(
      "Weather is incomplete within the imported production period; unavailable values remain unknown.",
    );
  if (!modeled.quality.horizonCoveragePct)
    warnings.push(
      "Local shading is unavailable without a measured source horizon.",
    );
  else if (modeled.quality.horizonCoveragePct < 100 && !warnings.length)
    warnings.push(
      "Local horizon source coverage is partial; unobserved obstacles may add losses.",
    );
  const quality = {
    status: warnings.length ? "warning" : "pass",
    warnings,
    expectedHours: hourly.length,
    weatherHours,
    pricedHours: 0,
    horizonCoveragePct: modeled.quality.horizonCoveragePct,
    temperatureFallbackHours: hourly.filter(
      (row) => !Number.isFinite(row.temperatureC),
    ).length,
    scope: "imported_production_period",
    valuation: "not_requested",
  };
  const result = {
    system: modeled.system,
    hourly,
    quality,
    period: weather?.period || {
      start: hourly[0].time,
      end: new Date(Date.parse(hourly.at(-1).time) + 3600000).toISOString(),
    },
    assumptions: modeled.assumptions.filter(
      (value) => !value.startsWith("All energy is exported"),
    ),
  };
  if (modeled.system.gridExportLimitKw != null) {
    // Physical curtailment depends on demand but does not require market prices.
    // Keep this on the requested dates; a fetched period has no battery dispatch.
    const demand = applyConsumption(result, consumption);
    result.hourly = demand.hourly;
    result.consumption = demand.consumption;
  }
  return result;
}

if (typeof self !== "undefined")
  self.onmessage = ({ data }) => {
    const { id } = data;
    try {
      self.postMessage({ id, analysis: analyzeProductionPeriod(data) });
    } catch (error) {
      self.postMessage({ id, error: error.message });
    }
  };

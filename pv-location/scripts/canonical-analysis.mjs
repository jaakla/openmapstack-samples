/** Thin batch adapter. Browser previews and canonical runs share this engine. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePV, buildHorizon, polygonMetrics } from "../src/analysis.js";
import {
  applyConsumption,
  normalizeConsumptionConfig,
} from "../src/consumption.js";
import { applyStorage, normalizeStorageConfig } from "../src/storage.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const scenario = read("data/overrides/planning-scenario.geojson");
const feature = scenario.features[0];
const system = { ...feature.properties.system, polygon: feature.geometry };
const rawConsumption = feature.properties.consumption;
if (!rawConsumption || rawConsumption.mode !== "estimate") {
  throw new Error(
    "The published baseline requires an explicit estimate consumption config.",
  );
}
const consumption = normalizeConsumptionConfig(rawConsumption);
if (
  Object.keys(rawConsumption).some((key) => !Object.hasOwn(consumption, key))
) {
  throw new Error(
    "The published baseline must not contain private profile metadata or interval rows.",
  );
}
const rawStorage = feature.properties.storage;
if (!rawStorage || typeof rawStorage.enabled !== "boolean") {
  throw new Error(
    "The published baseline requires an explicit storage config.",
  );
}
const storage = normalizeStorageConfig(rawStorage, system);
const storageKeys = [
  "enabled",
  "capacityMode",
  "capacityKwh",
  "powerMode",
  "chargePowerKw",
  "dischargePowerKw",
  "chargeCurrentA",
  "dischargeCurrentA",
  "phases",
  "voltageV",
  "roundTripEfficiencyPct",
  "reserveSocPct",
  "allowGridCharging",
  "allowBatteryExport",
  "cyclingCostEurKwh",
  "socSteps",
];
if (Object.keys(rawStorage).some((key) => !storageKeys.includes(key))) {
  throw new Error("The published storage config contains undeclared metadata.");
}
const grid = read("data/source/context-grid.json");
if (
  polygonMetrics(feature.geometry).projectedRing.some(
    ([x, y]) =>
      x < grid.bounds[0] ||
      x > grid.bounds[2] ||
      y < grid.bounds[1] ||
      y > grid.bounds[3],
  )
) {
  throw new Error(
    "The canonical footprint is outside its retained terrain context.",
  );
}
const horizon = buildHorizon({
  grid,
  polygon: feature.geometry,
  site: system,
  mountingHeightM: system.mountingHeightM,
  maxDistanceM: 500,
  azimuthStepDeg: 2,
  maxSamples: 9,
});
const years = {};
for (const year of [2024, 2025]) {
  years[year] = applyStorage(
    applyConsumption(
      analyzePV({
        system,
        year,
        weather: read(`data/source/weather-${year}.json`).rows,
        prices: read(`data/source/prices-${year}.json`).rows,
        horizon,
      }),
      consumption,
    ),
    storage,
    consumption,
  );
}
fs.mkdirSync(path.join(root, "data/derived"), { recursive: true });
fs.writeFileSync(
  path.join(root, "data/derived/analysis.json"),
  JSON.stringify({ system, horizon, consumption, storage, years }) + "\n",
);

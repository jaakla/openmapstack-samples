/** Thin batch adapter. Browser previews and canonical runs share this engine. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePV, buildHorizon } from "../src/analysis.js";
import {
  applyConsumption,
  normalizeConsumptionConfig,
} from "../src/consumption.js";

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
const grid = read("data/source/context-grid.json");
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
  years[year] = applyConsumption(
    analyzePV({
      system,
      year,
      weather: read(`data/source/weather-${year}.json`).rows,
      prices: read(`data/source/prices-${year}.json`).rows,
      horizon,
    }),
    consumption,
  );
}
fs.mkdirSync(path.join(root, "data/derived"), { recursive: true });
fs.writeFileSync(
  path.join(root, "data/derived/analysis.json"),
  JSON.stringify({ system, horizon, consumption, years }) + "\n",
);

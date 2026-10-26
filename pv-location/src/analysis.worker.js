import { analyzePV, buildHorizon, validateSystem } from "./analysis.js";
import { applyConsumption } from "./consumption.js";
let inputs, horizonCache;
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    inputs = data.inputs;
    return;
  }
  const { id, system, polygon, year, consumption } = data;
  try {
    if (!inputs) throw new Error("Analysis inputs have not loaded.");
    const normalized = validateSystem({ ...system, polygon });
    const key = JSON.stringify([polygon, normalized.mountingHeightM]);
    if (horizonCache?.key !== key)
      horizonCache = {
        key,
        value: buildHorizon({
          grid: inputs.terrain,
          polygon,
          mountingHeightM: normalized.mountingHeightM,
        }),
      };
    const pvAnalysis = analyzePV({
      system: normalized,
      year,
      weather: inputs.weather[year],
      prices: inputs.prices[year],
      horizon: horizonCache.value,
    });
    const analysis = applyConsumption(pvAnalysis, consumption);
    self.postMessage({ id, analysis, horizon: horizonCache.value });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

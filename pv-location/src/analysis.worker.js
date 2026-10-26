import { analyzePV, buildHorizon, validateSystem } from "./analysis.js";
import { applyStorage } from "./storage.js";
import { applyConsumption } from "./consumption.js";
let inputs, horizonCache, pvCache, demandCache;
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    inputs = data.inputs;
    horizonCache = pvCache = demandCache = null;
    return;
  }
  const { id, system, polygon, year, consumption, storage } = data;
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
    const pvKey = JSON.stringify([normalized, year, key]);
    if (pvCache?.key !== pvKey)
      pvCache = {
        key: pvKey,
        value: analyzePV({
          system: normalized,
          year,
          weather: inputs.weather[year],
          prices: inputs.prices[year],
          horizon: horizonCache.value,
        }),
      };
    const demandKey = JSON.stringify([pvKey, consumption]);
    if (demandCache?.key !== demandKey)
      demandCache = {
        key: demandKey,
        value: applyConsumption(pvCache.value, consumption),
      };
    const analysis = applyStorage(demandCache.value, storage, consumption);
    // Idle storage needs no second full-year interval table in the renderer.
    // The canonical engine keeps that table; active browser scenarios retain it for export.
    if (!analysis.storage.config.enabled) delete analysis.storage.hourly;
    self.postMessage({ id, analysis, horizon: horizonCache.value });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

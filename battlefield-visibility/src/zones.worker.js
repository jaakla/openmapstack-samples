import { calculateZones } from "./calculate.js";
let grid, scenario;
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    grid = data.grid;
    scenario = data.scenario;
    return;
  }
  const { settings, time, target, generation } = data;
  try {
    const started = performance.now(),
      result = calculateZones(grid, scenario, settings, time, target);
    self.postMessage(
      {
        generation,
        ...result,
        durationMs: Math.round(performance.now() - started),
      },
      [result.zones.buffer],
    );
  } catch (error) {
    self.postMessage({ generation, error: String(error) });
  }
};

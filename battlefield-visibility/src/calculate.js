import { height, classifyTarget } from "./visibility.js";
import { activeVectors, sensorAt, predict, pastTraces } from "./simulation.js";

export function calculateZones(grid, scenario, settings, time, target) {
  const vectors = activeVectors(scenario, settings);
  const sensors = vectors.map((v) =>
    sensorAt(grid, scenario, v, time, settings),
  );
  const futures = predict(grid, scenario, vectors, time, settings);
  const spacing = scenario.zoneSpacingM,
    cols = Math.floor((grid.width * grid.resolution) / spacing);
  const rows = Math.floor((grid.height * grid.resolution) / spacing),
    zones = new Uint8Array(cols * rows);
  const statusAt = ([x, y], current = sensors, forecast = futures) => {
    const z = height(grid, grid.dtm, x, y),
      obstruction = height(grid, grid.dsm, x, y);
    return !Number.isFinite(z) ||
      !Number.isFinite(obstruction) ||
      obstruction >= z + 2
      ? { zone: 0, visibleTo: [], probability: 0 }
      : classifyTarget(
          grid,
          [x, y, z + 2],
          current,
          forecast,
          scenario.probabilityThreshold,
        );
  };
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      zones[row * cols + col] = statusAt([
        (col + 0.5) * spacing,
        (row + 0.5) * spacing,
      ]).zone;
    }
  return {
    time,
    sensors,
    futures,
    traces: pastTraces(grid, scenario, vectors, time, settings),
    sightlines: sensors.map((sensor) => ({
      id: sensor.id,
      ...statusAt(
        target,
        [sensor],
        futures.filter((f) => f.id === sensor.id),
      ),
    })),
    zones,
    cols,
    rows,
    spacing,
    target,
    status: statusAt(target),
  };
}

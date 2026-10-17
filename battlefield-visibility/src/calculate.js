import { height, classifyTarget } from "./visibility.js";
import { activeVectors, sensorAt, predict, pastTraces } from "./simulation.js";
import { formatMGRS, gridConvergenceDegrees } from "./coordinates.js";
import { relativeContact, formatContactLine } from "./contact.js";

export function calculateZones(grid, scenario, settings, time, target, origin) {
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
  const sightlines = sensors.map((sensor) => ({
    id: sensor.id,
    ...statusAt(target, [sensor], futures.filter((f) => f.id === sensor.id)),
  }));
  const convergenceDegrees = origin ? gridConvergenceDegrees([
    origin[0] + target[0], origin[1] + target[1],
  ]) : null;
  const ownPosition = [...target, height(grid, grid.dtm, ...target) + 2];
  const contacts = sensors.map((sensor) => {
    const contact = {
      id: sensor.id, timeSeconds: time,
      mgrs: origin ? formatMGRS(origin, sensor.position) : null,
      zone: sightlines.find((s) => s.id === sensor.id).zone,
      ...relativeContact({ ownPosition, position: sensor.position,
        groundVelocity: sensor.groundVelocity, agl: sensor.agl, convergenceDegrees }),
    };
    return { ...contact, line: formatContactLine(contact) };
  });
  return {
    time,
    sensors,
    futures,
    traces: pastTraces(grid, scenario, vectors, time, settings),
    sightlines,
    contacts,
    zones,
    cols,
    rows,
    spacing,
    target,
    status: statusAt(target),
  };
}

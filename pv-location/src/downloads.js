import { normalizeStorageConfig } from "./storage.js";
import { normalizeConsumptionConfig } from "./consumption.js";
export function downloadFile(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportScenario(system, polygon, project, consumption, storage) {
  downloadFile(
    "solar-atlas-scenario.geojson",
    JSON.stringify(
      {
        type: "FeatureCollection",
        name: "Hypothetical PV planning scenario",
        metadata: {
          schema: "solar-atlas-scenario/v1",
          sourceProject: project.project.id,
          sourceRun: project.run.id,
          createdAt: new Date().toISOString(),
          classification: "hypothetical",
          area: project.liveContext
            ? {
                id: project.liveContext.id,
                name: project.liveContext.name,
                center: project.liveContext.center,
                bounds: project.liveContext.bounds,
                capturedAt: project.liveContext.provenance?.capturedAt,
                sourceHashes: project.sources.map((source) => ({
                  id: source.id,
                  sha256: source.pin?.sha256,
                })),
                replay:
                  "Import the matching saved area bundle before this scenario to reuse the captured data.",
              }
            : undefined,
          note: "User scenario. Not an existing installation, permitted design, or capacity survey.",
        },
        features: [
          {
            type: "Feature",
            geometry: polygon,
            properties: {
              ...system,
              consumption: consumption
                ? normalizeConsumptionConfig(consumption)
                : undefined,
              storage: storage
                ? normalizeStorageConfig(storage, system)
                : undefined,
              scenarioType: "hypothetical",
            },
          },
        ],
      },
      null,
      2,
    ),
    "application/geo+json",
  );
}
export function exportHourly(analysis) {
  if (!analysis?.hourly?.length) return;
  const rows = analysis.hourly.map((row, index) => ({
    ...row,
    ...Object.fromEntries(
      Object.entries(analysis.storage?.hourly?.[index] || {})
        .filter(
          ([key, value]) =>
            key !== "time" && (value == null || typeof value !== "object"),
        )
        .map(([key, value]) => [`battery_${key}`, value]),
    ),
  }));
  const cols = Object.keys(rows[0]).filter(
    (k) => rows[0][k] == null || typeof rows[0][k] !== "object",
  );
  const esc = (v) => (v == null ? "" : JSON.stringify(v));
  downloadFile(
    "solar-atlas-hourly.csv",
    [
      cols.join(","),
      ...rows.map((r) => cols.map((k) => esc(r[k])).join(",")),
    ].join("\n"),
    "text/csv",
  );
}

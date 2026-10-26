import { normalizeConsumptionConfig } from "./consumption.js";
export function downloadFile(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportScenario(system, polygon, project, consumption) {
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
  const cols = Object.keys(analysis.hourly[0]).filter(
    (k) =>
      analysis.hourly[0][k] == null ||
      typeof analysis.hourly[0][k] !== "object",
  );
  const esc = (v) => (v == null ? "" : JSON.stringify(v));
  downloadFile(
    "solar-atlas-hourly.csv",
    [
      cols.join(","),
      ...analysis.hourly.map((r) => cols.map((k) => esc(r[k])).join(",")),
    ].join("\n"),
    "text/csv",
  );
}

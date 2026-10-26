/** The published report uses the same report builder as the scenario PDF button. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScenarioReport } from "../src/report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const project = read("public/data/project.json");
const result = read("data/derived/analysis.json");
const report = await createScenarioReport({
  project,
  system: project.canonical.system,
  polygon: project.canonical.polygon,
  analysis: result.years[String(project.canonical.year)],
  horizon: result.horizon,
  consumption: project.canonical.consumption,
  mapImage: {
    dataUrl:
      "data:image/jpeg;base64," +
      fs
        .readFileSync(path.join(root, "data/source/aerial.jpg"))
        .toString("base64"),
    caption: `${project.aerial.attribution}. Source-context crop around the hypothetical footprint; this is not a site recommendation.`,
    coordinates: project.aerial.coordinates,
    zoom: 3,
  },
  scenarioState: "canonical",
  createdAt: project.run.completed_at,
});
if (report.getNumberOfPages() < 3) {
  throw new Error(
    "Canonical report is missing scenario, consumption or evidence pages.",
  );
}
fs.writeFileSync(
  path.join(root, "public/data/canonical-report.pdf"),
  Buffer.from(report.output("arraybuffer")),
);

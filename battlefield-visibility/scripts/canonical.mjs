import fs from "node:fs";
import { formatMGRS } from "../src/coordinates.js";
import { calculateZones } from "../src/calculate.js";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const config = read("public/data/scene.json"),
  scenario = read("public/data/scenario.json");
const array = (p) => {
  const b = fs.readFileSync(p);
  return new Uint16Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
};
const grid = {
  ...config.grid,
  dtm: array("public/data/dtm.bin"),
  dsm: array("public/data/dsm.bin"),
};
const r = calculateZones(grid, scenario, config.defaults, 0, scenario.target, config.origin),
  counts = [0, 0, 0, 0];
for (const z of r.zones) counts[z]++;
fs.writeFileSync("data/derived/default-zones.bin", r.zones);
fs.writeFileSync(
  "public/data/default-snapshot.json",
  JSON.stringify({
    time: 0,
    counts,
    status: r.status,
    targetMGRS: formatMGRS(config.origin, scenario.target),
    sensors: r.sensors.map((s) => ({
      ...s,
      mgrs: formatMGRS(config.origin, s.position),
    })),
    sightlines: r.sightlines,
    contacts: r.contacts,
    cols: r.cols,
    rows: r.rows,
    spacing: r.spacing,
  }) + "\n",
);
console.log(JSON.stringify({ counts, status: r.status }));

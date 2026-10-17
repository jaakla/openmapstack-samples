// Read-only CI audit; no raw survey downloads or GIS runtime required.
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const scene = read("public/data/scene.json"),
  run = read(`runs/${scene.runId}.json`),
  report = read("validation/latest-report.json");
assert.equal(run.id, report.run_id);
assert.equal(run.status, "passed");
assert.equal(report.status, "passed");
const hash = crypto.createHash("sha256");
for (const item of [...run.outputs].sort((a, b) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
)) {
  const bytes = fs.readFileSync(item.path),
    name = Buffer.from(item.path),
    length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(name.length));
  assert.equal(
    "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex"),
    item.sha256,
    item.path,
  );
  hash.update(length).update(name).update(bytes);
}
assert.equal("sha256:" + hash.digest("hex"), run.outputs_hash);
assert.equal(report.outputs_hash, run.outputs_hash);
console.log(
  `Verified ${run.outputs.length} declared output hashes for ${run.id}`,
);

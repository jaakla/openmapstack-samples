import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";

test("committed API archives strictly match both compressed and original response locks", () => {
  const lock = JSON.parse(fs.readFileSync("sources.lock.json", "utf8"));
  const entries = lock.files.filter((e) => e.archive);
  assert.deepEqual(entries.map((e) => e.id).sort(), [
    "lod2_tileset",
    "osm",
    "tile_index",
  ]);
  const hash = (b) =>
    "sha256:" + crypto.createHash("sha256").update(b).digest("hex");
  for (const entry of entries) {
    const compressed = fs.readFileSync(entry.archive.path);
    assert.equal(hash(compressed), entry.archive.sha256);
    assert.equal(compressed.length, entry.archive.size_bytes);
    const original = gunzipSync(compressed);
    assert.equal(hash(original), entry.sha256);
    assert.equal(original.length, entry.size_bytes);
    const json = JSON.parse(original);
    if (entry.id === "tile_index") {
      assert.equal(json.numberMatched, 9);
      assert.equal(json.numberReturned, 9);
      assert.equal(json.features.length, 9);
    } else if (entry.id === "osm") {
      assert.ok(!json.remark);
      assert.ok(json.elements.length > 0);
      assert.ok(lock.osm_query.includes('[date:"2026-10-16T00:00:00Z"]'));
    } else {
      assert.equal(json.asset.tilesetVersion, "291269823412");
      assert.ok(json.root.children.length > 0);
    }
  }
});

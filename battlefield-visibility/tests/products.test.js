import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import validator from "gltf-validator";
import { calculateZones } from "../src/calculate.js";
import { height, lineOfSight } from "../src/visibility.js";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = fs.existsSync("public/data/scene.json");
test(
  "published grids, simulation routes, defaults and canonical zones agree",
  { skip: !exists },
  () => {
    const config = read("public/data/scene.json"),
      scenario = read("public/data/scenario.json");
    const values = (p) => {
      const b = fs.readFileSync(p);
      return new Uint16Array(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      );
    };
    const grid = {
      ...config.grid,
      dtm: values("public/data/dtm.bin"),
      dsm: values("public/data/dsm.bin"),
    };
    assert.equal(grid.dtm.length, grid.width * grid.height);
    assert.equal(grid.dsm.length, grid.dtm.length);
    for (let i = 0; i < grid.dtm.length; i++)
      if (grid.dtm[i] !== 65535)
        assert.ok(grid.dsm[i] >= grid.dtm[i] || grid.dsm[i] === 65535);
    assert.deepEqual(config.defaults, {
      uavHeight: 50,
      uavs: 1,
    });
    for (const r of Object.values(scenario.routes)) {
      assert.equal(r.coordinates.length, r.sourceNodeIds.length);
      assert.equal(r.sourceEdges.length, r.coordinates.length - 1);
      assert.ok(
        r.sourceEdges.every(
          (e) => Number.isInteger(e.way_id) && Number.isInteger(e.version),
        ),
      );
    }
    const baseline = read("public/data/default-snapshot.json"),
      result = calculateZones(
        grid,
        scenario,
        config.defaults,
        0,
        scenario.target,
        config.origin,
      ),
      counts = [0, 0, 0, 0];
    assert.ok(scenario.vectors.every((v) => v.type === "uav"));
    assert.equal(scenario.vectors.length, 3);
    assert.equal(fs.existsSync("public/models/tank.glb"), false);
    for (const z of result.zones) counts[z]++;
    assert.deepEqual(counts, baseline.counts);
    assert.deepEqual(result.status, baseline.status);
    assert.deepEqual(result.contacts, baseline.contacts);
    assert.deepEqual(
      Buffer.from(result.zones),
      fs.readFileSync("data/derived/default-zones.bin"),
    );
  },
);
test(
  "official LoD2 GLB validates without issues and preserves source/analysis separation",
  { skip: !exists },
  async () => {
    const bytes = fs.readFileSync("public/data/buildings.glb");
    const result = await validator.validateBytes(new Uint8Array(bytes));
    assert.equal(result.issues.numErrors, 0, JSON.stringify(result.issues));
    assert.equal(result.issues.numWarnings, 0, JSON.stringify(result.issues));
    assert.equal(result.issues.numInfos, 0, JSON.stringify(result.issues));
    assert.equal(result.issues.numHints, 0, JSON.stringify(result.issues));
    const metadata = read("public/data/building-mesh.json"),
      config = read("public/data/scene.json");
    assert.equal(metadata.tilesMatched, 15);
    assert.equal(metadata.tilesReturned, 15);
    assert.equal(
      metadata.buildingCount,
      new Set(metadata.cityBuildingIds).size,
    );
    assert.ok(metadata.publishedTriangles > 100000);
    assert.equal(metadata.glbBytes, bytes.length);
    assert.ok(metadata.alignment.medianAbsoluteDifference < 2);
    assert.equal(config.buildingMesh.analysis, false);
    assert.deepEqual(
      metadata.boundsEPSG3067N2000.map((b) => b.slice(0, 2)),
      [
        [385200, 6671300],
        [386500, 6672500],
      ],
    );
  },
);
test(
  "models are self-contained glTF 2 with no external dependencies",
  { skip: !exists },
  () => {
    for (const file of ["public/models/uav.glb"]) {
      const b = fs.readFileSync(file);
      assert.equal(b.toString("ascii", 0, 4), "glTF");
      assert.equal(b.readUInt32LE(4), 2);
      assert.equal(b.readUInt32LE(8), b.length);
      const j = JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)));
      assert.ok(j.buffers.every((v) => !v.uri));
      assert.ok((j.images ?? []).every((v) => v.bufferView !== undefined));
      assert.ok(
        !(j.extensionsRequired ?? []).some((v) =>
          /draco|meshopt|basisu/i.test(v),
        ),
      );
    }
  },
);

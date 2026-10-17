import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { fitCamera, OWN_PADDING, UAV_PADDING } from "../src/camera.js";

const target = new Vector3(650, 12, -600);
const offset = new Vector3(-650, 1038, 1000);
const own = new Vector3(953.2369, 12.4, -323.5336);
const uav = new Vector3(285.284389, 70.1, -470.151345);
// Actual canvas sizes within the requested desktop/phone page viewports.
const viewports = [[1210, 770], [376, 463], [306, 448]];

function assertPadded(camera, subjects, width, height) {
  for (const { point, padding } of subjects) {
    const ndc = point.clone().project(camera);
    const x = (ndc.x + 1) * width / 2, y = (1 - ndc.y) * height / 2;
    assert.ok(ndc.z > -1 && ndc.z < 1, `depth ${ndc.z}`);
    assert.ok(x >= padding.left - 1e-7 && x <= width - padding.right + 1e-7,
      `horizontal ${x} on ${width}px canvas`);
    assert.ok(y >= padding.top - 1e-7 && y <= height - padding.bottom + 1e-7,
      `vertical ${y} on ${height}px canvas`);
  }
}

test("QA initial/reset OWN and UAV fit with pixel padding at all three viewport sizes", () => {
  const subjects = [{ point: own, padding: OWN_PADDING },
    { point: uav, padding: UAV_PADDING }];
  for (const [width, height] of viewports) {
    const camera = new PerspectiveCamera(42, width / height, 1, 12000);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    if (width === 306) {
      assert.ok(own.clone().project(camera).x > 1, "reproduces QA's off-canvas marker");
    }
    const distance = fitCamera(camera, target, offset, subjects, width, height);
    assertPadded(camera, subjects, width, height);
    if (width === 1210) assert.equal(distance, offset.length(), "preserves desktop distance");
  }
});

test("reset fits zero through three active UAVs, AOI corners and maximum configured altitude", () => {
  const positions = [
    new Vector3(1, 3, -1), new Vector3(1299, 33, -1),
    new Vector3(1, 10, -1199), new Vector3(1299, 20, -1199),
  ];
  for (const [width, height] of viewports)
    for (const own of positions)
      for (let count = 0; count <= 3; count++) {
        const camera = new PerspectiveCamera(42, width / height, 1, 12000);
        const subjects = [{ point: own, padding: OWN_PADDING },
          ...positions.slice(0, count).map((p) => ({
            point: p.clone().add(new Vector3(0, 150, 0)), padding: UAV_PADDING,
          }))];
        fitCamera(camera, target, offset, subjects, width, height);
        assertPadded(camera, subjects, width, height);
      }
});

test("fitting includes perspective depth for subjects nearer the camera", () => {
  const camera = new PerspectiveCamera(42, 306 / 448, 1, 12000);
  const subjects = [{ point: target.clone().add(new Vector3(-700, 350, 700)),
    padding: UAV_PADDING }];
  fitCamera(camera, target, offset, subjects, 306, 448);
  assertPadded(camera, subjects, 306, 448);
  assert.ok(camera.position.clone().sub(target).normalize()
    .distanceTo(offset.clone().normalize()) < 1e-12, "retains published viewing direction");
});

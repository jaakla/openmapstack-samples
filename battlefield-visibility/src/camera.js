import { Vector3, MathUtils } from "three";

// Pixel budgets include the 80×27 OWN sprite, UAV display magnification and
// clearance below the map overlays. UAV label rectangles are arranged separately.
export const OWN_PADDING = { left: 56, right: 56, top: 150, bottom: 50 };
export const UAV_PADDING = { left: 36, right: 36, top: 170, bottom: 65 };

export function fitCamera(camera, target, offset, subjects, width, height) {
  const back = offset.clone().normalize();
  const right = new Vector3().crossVectors(camera.up, back).normalize();
  const up = new Vector3().crossVectors(back, right);
  const tanY = Math.tan(MathUtils.degToRad(camera.fov / 2));
  const tanX = tanY * width / height;
  let distance = offset.length();
  for (const { point, padding } of subjects) {
    const relative = point.clone().sub(target);
    const x = relative.dot(right), y = relative.dot(up), z = relative.dot(back);
    // For very small embedded canvases, retain a nonempty centre rectangle.
    const extent = (pixels, size) => 1 - 2 * Math.min(pixels / size, 0.45);
    const horizontal = extent(x < 0 ? padding.left : padding.right, width);
    const vertical = extent(y < 0 ? padding.bottom : padding.top, height);
    // Perspective depth is distance-z, so fitting XY alone underestimates the
    // required distance for subjects nearer the camera or at high UAV altitudes.
    distance = Math.max(distance, z + Math.abs(x) / (tanX * horizontal),
      z + Math.abs(y) / (tanY * vertical), z + camera.near + 1);
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.position.copy(target).addScaledVector(back, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return distance;
}

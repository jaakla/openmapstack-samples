import proj4 from "proj4";
import { trueToGridBearing } from "./analysis.js";
proj4.defs(
  "EPSG:3301",
  "+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +units=m +no_defs",
);
export const toMetric = (coordinate) =>
  proj4("EPSG:4326", "EPSG:3301", coordinate);
export const toWgs = (coordinate) =>
  proj4("EPSG:3301", "EPSG:4326", coordinate);
export function gridCorners(grid) {
  const [w, s, e, n] = grid.bounds;
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ].map(toWgs);
}
export function withinCoverage(ring, grid, margin = 25) {
  if (!ring?.length || !grid) return false;
  const [w, s, e, n] = grid.bounds;
  return ring.every((p) => {
    const [x, y] = toMetric(p);
    return (
      x >= w + margin && x <= e - margin && y >= s + margin && y <= n - margin
    );
  });
}
export function surfaceImage(grid, sun, mode = "surface", heightM = 2) {
  const step = 2,
    width = Math.ceil(grid.width / step),
    height = Math.ceil(grid.height / step);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(width, height);
  const center = toWgs([
    (grid.bounds[0] + grid.bounds[2]) / 2,
    (grid.bounds[1] + grid.bounds[3]) / 2,
  ]);
  const az =
      (trueToGridBearing(sun.azimuthDeg, center[1], center[0]) * Math.PI) / 180,
    tanElevation = Math.tan((sun.elevationDeg * Math.PI) / 180);
  const rayX = Math.sin(az),
    rayY = -Math.cos(az);
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const row = r * step,
        col = c * step,
        idx = row * grid.width + col,
        p = (r * width + c) * 4;
      const dsm = grid.dsm[idx],
        dtm = grid.dtm[idx];
      if (dsm == null || dtm == null) continue;
      if (mode === "surface") {
        const fraction = Math.min(1, Math.max(0, (dsm - dtm) / 20));
        pixels.data.set(
          [
            Math.round(215 - 170 * fraction),
            Math.round(232 - 110 * fraction),
            Math.round(180 - 122 * fraction),
            Math.round(25 + 150 * fraction),
          ],
          p,
        );
      } else {
        let blocked = sun.elevationDeg <= 0;
        const receiver = dtm + heightM;
        // Short-range snapshot illustration; annual model uses the full measured horizon.
        for (let d = 1; !blocked && d <= 60; d++) {
          const rr = Math.round(row + rayY * d),
            cc = Math.round(col + rayX * d);
          if (rr < 0 || cc < 0 || rr >= grid.height || cc >= grid.width) break;
          const z = grid.dsm[rr * grid.width + cc];
          if (z != null && z > receiver + d * grid.resolutionM * tanElevation)
            blocked = true;
        }
        if (blocked) pixels.data.set([33, 54, 69, 125], p);
      }
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

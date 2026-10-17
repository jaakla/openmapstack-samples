// Metric 2.5D raster LOS. Rows increase northward; cells are closed solids below DSM.
// null means unknown (outside measured coverage or NoData), never safe/green.
export function cell(grid, x, y) {
  const col = Math.floor(x / grid.resolution),
    row = Math.floor(y / grid.resolution);
  return col < 0 || row < 0 || col >= grid.width || row >= grid.height
    ? -1
    : row * grid.width + col;
}

export function height(grid, values, x, y) {
  const i = cell(grid, x, y);
  return i < 0 || values[i] === 65535
    ? NaN
    : grid.zOrigin + values[i] * grid.zScale;
}

export function lineOfSight(grid, observer, target) {
  if (![...observer, ...target].every(Number.isFinite)) return null;
  const [ox, oy, oz] = observer,
    [tx, ty, tz] = target;
  const start = cell(grid, ox, oy),
    end = cell(grid, tx, ty);
  if (start < 0 || end < 0) return null;
  const dx = tx - ox,
    dy = ty - oy,
    dz = tz - oz,
    r = grid.resolution;
  let col = Math.floor(ox / r),
    row = Math.floor(oy / r),
    t = 0;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const dtx = sx ? r / Math.abs(dx) : Infinity,
    dty = sy ? r / Math.abs(dy) : Infinity;
  let nx = sx ? ((col + (sx > 0 ? 1 : 0)) * r - ox) / dx : Infinity;
  let ny = sy ? ((row + (sy > 0 ? 1 : 0)) * r - oy) / dy : Infinity;
  let unknown = false;
  // Closed cells include their edges/corners, even when the ray touches them
  // only at t=0 or t=1. Inspect the full Cartesian set at BOTH endpoints before
  // the traversal's early exit; direction must not change which solids count.
  for (const [x, y, z] of [observer, target]) {
    const cx = Math.floor(x / r), cy = Math.floor(y / r);
    const firstX = Number.isInteger(x / r) ? cx - 1 : cx;
    const firstY = Number.isInteger(y / r) ? cy - 1 : cy;
    for (let yy = firstY; yy <= cy; yy++) for (let xx = firstX; xx <= cx; xx++) {
      if (xx < 0 || yy < 0 || xx >= grid.width || yy >= grid.height) {
        unknown = true;
        continue;
      }
      const raw = grid.dsm[yy * grid.width + xx];
      if (raw === 65535) unknown = true;
      else if (grid.zOrigin + raw * grid.zScale >= z - 1e-7) return false;
    }
  }
  const alignedX = dx === 0 && Number.isInteger(ox / r);
  const alignedY = dy === 0 && Number.isInteger(oy / r);
  // Grid traversal checks every crossed cell at the lowest ray altitude within it.
  for (let n = 0; n <= grid.width + grid.height; n++) {
    const i = row * grid.width + col,
      exit = Math.min(nx, ny, 1);
    const raw = grid.dsm[i];
    if (raw === 65535) unknown = true;
    else if (
      grid.zOrigin + raw * grid.zScale >=
      Math.min(oz + dz * t, oz + dz * exit) - 1e-7
    )
      return false;
    // A ray lying along a cell boundary touches cells on both sides.
    if (alignedX || alignedY) {
      const neighbours = [];
      if (alignedX) neighbours.push([col - 1, row]);
      if (alignedY) neighbours.push([col, row - 1]);
      if (alignedX && alignedY) neighbours.push([col - 1, row - 1]);
      for (const [cx, cy] of neighbours) {
        if (cx < 0 || cy < 0) {
          unknown = true;
          continue;
        }
        const value = grid.dsm[cy * grid.width + cx];
        if (value === 65535) unknown = true;
        else if (
          grid.zOrigin + value * grid.zScale >=
          Math.min(oz + dz * t, oz + dz * exit) - 1e-7
        )
          return false;
      }
    }
    if (exit >= 1) return unknown ? null : true;
    const crossX = nx <= ny,
      crossY = ny <= nx;
    // At exact corners also test the two edge-touching cells (supercover).
    if (crossX && crossY) {
      for (const j of [
        row * grid.width + col + sx,
        (row + sy) * grid.width + col,
      ]) {
        if (grid.dsm[j] === 65535) unknown = true;
        else if (
          grid.zOrigin + grid.dsm[j] * grid.zScale >=
          oz + dz * exit - 1e-7
        )
          return false;
      }
    }
    if (crossX) {
      col += sx;
      nx += dtx;
    }
    if (crossY) {
      row += sy;
      ny += dty;
    }
    t = exit;
  }
  return null;
}

export const ZONE = Object.freeze({ UNKNOWN: 0, GREEN: 1, YELLOW: 2, RED: 3 });

export function classifyTarget(
  grid,
  target,
  current,
  futures,
  threshold = 0.25,
) {
  const visibleTo = [];
  let unknown = false;
  for (const sensor of current) {
    const los = lineOfSight(grid, sensor.position, target);
    if (los === true) visibleTo.push(sensor.id);
    if (los === null) unknown = true;
  }
  if (visibleTo.length) return { zone: ZONE.RED, visibleTo, probability: 1 };
  // Each future is a whole equally weighted speed hypothesis, NOT a time frequency.
  let maximumProbability = 0;
  for (const vector of futures) {
    let visible = 0,
      uncertain = 0;
    for (const hypothesis of vector.hypotheses) {
      let seen = false,
        missing = false;
      for (const position of hypothesis) {
        const los = lineOfSight(grid, position, target);
        seen ||= los === true;
        missing ||= los === null;
        if (seen) break;
      }
      if (seen) visible++;
      else if (missing) uncertain++;
    }
    const p = visible / vector.hypotheses.length;
    maximumProbability = Math.max(maximumProbability, p);
    if (p >= threshold)
      return { zone: ZONE.YELLOW, visibleTo: [], probability: p };
    unknown ||= (visible + uncertain) / vector.hypotheses.length >= threshold;
  }
  return {
    zone: unknown ? ZONE.UNKNOWN : ZONE.GREEN,
    visibleTo: [],
    probability: maximumProbability,
  };
}

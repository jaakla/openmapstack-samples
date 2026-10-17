// Local EPSG:3067 East/North metres and N2000 heights. Own position is fixed.
// Range rate is d(horizontal range)/dt; vertical velocity is not modelled.
const DEG = 180 / Math.PI;
export const CONTACT_LOS = [
  "UNKNOWN", "MASKED", "LIKELY VISIBLE ≤5 MIN", "VISIBLE NOW",
];
export const wrapDegrees = (degrees) => ((degrees % 360) + 360) % 360;
export const degreesToMils = (degrees) => degrees * 6400 / 360;
const finite = (value) => Number.isFinite(value) ? value : null;

export function relativeContact({ ownPosition, position, groundVelocity,
  agl, convergenceDegrees = null }) {
  const dx = position[0] - ownPosition[0], dy = position[1] - ownPosition[1];
  const horizontalRangeM = finite(Math.hypot(dx, dy));
  const relativeHeightM = finite(position[2] - ownPosition[2]);
  const slantRangeM = horizontalRangeM !== null && relativeHeightM !== null
    ? Math.hypot(horizontalRangeM, relativeHeightM) : null;
  const bearingGridDeg = horizontalRangeM > 0
    ? wrapDegrees(Math.atan2(dx, dy) * DEG) : null;
  const bearingTrueDeg = bearingGridDeg !== null && Number.isFinite(convergenceDegrees)
    ? wrapDegrees(bearingGridDeg + convergenceDegrees) : null;
  const elevationDeg = slantRangeM > 0
    ? Math.atan2(relativeHeightM, horizontalRangeM) * DEG : null;
  const velocityKnown = groundVelocity?.length === 2 && groundVelocity.every(Number.isFinite);
  const groundSpeedMps = velocityKnown ? Math.hypot(...groundVelocity) : null;
  const courseGridDeg = groundSpeedMps > 0
    ? wrapDegrees(Math.atan2(groundVelocity[0], groundVelocity[1]) * DEG) : null;
  const horizontalRangeRateMps = velocityKnown && horizontalRangeM > 0
    ? (dx * groundVelocity[0] + dy * groundVelocity[1]) / horizontalRangeM : null;
  return {
    bearingGridDeg, bearingGridMils: bearingGridDeg === null ? null : degreesToMils(bearingGridDeg),
    bearingTrueDeg, convergenceDeg: finite(convergenceDegrees),
    horizontalRangeM, slantRangeM, relativeHeightM, aglM: finite(agl),
    elevationDeg, elevationMils: elevationDeg === null ? null : degreesToMils(elevationDeg),
    groundSpeedMps, courseGridDeg,
    courseGridMils: courseGridDeg === null ? null : degreesToMils(courseGridDeg),
    horizontalRangeRateMps,
  };
}

export function formatRange(metres) {
  if (!Number.isFinite(metres)) return "UNKNOWN";
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(0)} m`;
}
export function formatAzimuth(degrees) {
  if (!Number.isFinite(degrees)) return "UNDEFINED";
  const mils = Math.round(degreesToMils(wrapDegrees(degrees))) % 6400;
  const deg = (Math.round(wrapDegrees(degrees) * 10) / 10) % 360;
  return `${String(mils).padStart(4, "0")} mil / ${deg.toFixed(1)}°`;
}
export function formatSigned(value, digits = 1) {
  if (!Number.isFinite(value)) return "UNKNOWN";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}
export function formatElevation(degrees) {
  return Number.isFinite(degrees)
    ? `${formatSigned(degreesToMils(degrees), 0)} mil / ${formatSigned(degrees)}°`
    : "UNDEFINED";
}
export function formatRangeRate(rate) {
  if (!Number.isFinite(rate)) return "UNKNOWN";
  // Match the sign label to the displayed precision, avoiding '-0.0 CLOSING'.
  const rounded = Number(rate.toFixed(1));
  const sense = rounded < 0 ? "CLOSING" : rounded > 0 ? "OPENING" : "STEADY";
  return `${formatSigned(rounded)} m/s · ${sense}`;
}
export function formatContactLine(contact) {
  const c = contact;
  return [
    "CONTACT — SIMULATED", `t=${c.timeSeconds.toFixed(1)} S`, `HOSTILE ${c.id}`,
    `GRID ${c.mgrs ?? "UNKNOWN"}`, `BRG ${formatAzimuth(c.bearingGridDeg)} GRID`,
    `SLANT RNG ${formatRange(c.slantRangeM)}`, `GROUND RNG ${formatRange(c.horizontalRangeM)}`,
    `ΔH ${formatSigned(c.relativeHeightM)} m`, `AGL ${formatRange(c.aglM)}`,
    `ELEV ${formatElevation(c.elevationDeg)}`, `SPEED ${c.groundSpeedMps === null ? "UNKNOWN" : c.groundSpeedMps.toFixed(1) + " m/s"}`,
    `COURSE ${formatAzimuth(c.courseGridDeg)} GRID`,
    `GROUND RNG RATE ${formatRangeRate(c.horizontalRangeRateMps)}`,
    CONTACT_LOS[c.zone] ?? CONTACT_LOS[0],
  ].join(" — ");
}

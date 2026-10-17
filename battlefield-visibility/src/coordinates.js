import proj4 from "proj4";
import mgrs from "geographiclib-mgrs";

// ETRS89 / TM35FIN, GRS80. Presentation conversion only; LOS stays in EPSG:3067.
const TM35 = "+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs";
const GRS80 = "+proj=longlat +ellps=GRS80 +units=degrees +no_defs";

// Signed clockwise bearing of grid north from true north. Differentiate the
// projected meridian symmetrically (~2.2m span), avoiding a spherical TM shortcut.
// Therefore local true azimuth = grid azimuth + convergence.
export function gridConvergenceDegrees(eastingNorthing) {
  if (eastingNorthing?.length !== 2 || !eastingNorthing.every(Number.isFinite)) return null;
  const [lon, lat] = proj4(TM35, GRS80, eastingNorthing);
  const south = proj4(GRS80, TM35, [lon, lat - 0.00001]);
  const north = proj4(GRS80, TM35, [lon, lat + 0.00001]);
  return -Math.atan2(north[0] - south[0], north[1] - south[1]) * 180 / Math.PI;
}
export function formatMGRS(origin, position) {
  if (!position?.slice(0, 2).every(Number.isFinite)) return "MGRS unavailable";
  const xy = [origin[0] + position[0], origin[1] + position[1]];
  const value = mgrs.forward(proj4(TM35, "WGS84", xy), 5);
  return value.replace(
    /^(\d{1,2}[C-X])([A-Z]{2})(\d{5})(\d{5})$/,
    "$1 $2 $3 $4",
  );
}

export function parseMGRS(origin, text, grid) {
  const value = text.toUpperCase().replace(/\s/g, "");
  // A one-metre MGRS square is unambiguous; select its centre deliberately.
  if (!/^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}\d{10}$/.test(value))
    throw new Error(
      "Enter a full MGRS grid reference with two five-digit groups.",
    );
  const xy = proj4("WGS84", TM35, mgrs.toPoint(value, true));
  const p = [xy[0] - origin[0], xy[1] - origin[1]];
  if (
    !p.every(Number.isFinite) ||
    p[0] < 0 ||
    p[1] < 0 ||
    p[0] >= grid.width * grid.resolution ||
    p[1] >= grid.height * grid.resolution
  )
    throw new Error("That grid reference is outside the published area.");
  return p;
}

export function exportSnapshot(config, snapshot) {
  return {
    schema: "helsinki-uav-snapshot/v2",
    status: "SIMULATED",
    runId: config.runId,
    timeSeconds: snapshot.time,
    coordinateSystem: "MGRS / WGS84, 1 m squares",
    ownPosition: {
      mgrs: formatMGRS(config.origin, snapshot.target),
      ...snapshot.status,
    },
    drones: snapshot.sensors.map((sensor) => ({
      id: sensor.id,
      mgrs: formatMGRS(config.origin, sensor.position),
      altitudeN2000M: sensor.position[2],
      sighting: snapshot.sightlines.find((s) => s.id === sensor.id),
    })),
    warning: "Geometric simulation only. GREEN does not establish safety.",
  };
}

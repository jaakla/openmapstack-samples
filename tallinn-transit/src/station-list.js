import { searchStations } from './transit.js';

// Test actual screen coordinates, including rotated maps and individual
// platforms at close zooms. Layer visibility and label collisions do not matter.
export function visibleStationIds(data, project, width, height) {
  return data.stations.flatMap(station => {
    let distance = Infinity;
    for (const point of [station, ...station.members.map(i => data.stops[i])]) {
      const { x, y } = project(point);
      if (x >= 0 && x <= width && y >= 0 && y <= height) {
        distance = Math.min(distance, (x - width / 2) ** 2 + (y - height / 2) ** 2);
      }
    }
    return Number.isFinite(distance) ? [{ id: station.id, distance, name: station.name }] : [];
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'et')).map(station => station.id);
}

export function stationGroups(data, query, visibleIds) {
  const matches = query.trim() ? searchStations(data, query, Infinity)
    : data.stations.map(station => ({ ...station, kind: 'station' })).sort((a, b) => a.name.localeCompare(b.name, 'et'));
  const visibleOrder = new Map(visibleIds.map((id, i) => [id, i]));
  return {
    visible: matches.filter(station => visibleOrder.has(station.id)).sort((a, b) => visibleOrder.get(a.id) - visibleOrder.get(b.id)),
    other: matches.filter(station => !visibleOrder.has(station.id)),
  };
}

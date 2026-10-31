import test from 'node:test';
import assert from 'node:assert/strict';
import { stationGroups, visibleStationIds } from '../src/station-list.js';

const data = {
  stops: [{ lon: 100, lat: 100, code: '1' }, { lon: 0, lat: 150, code: '2' }, { lon: 500, lat: 500, code: '3' }],
  stations: [
    { id: 'edge', name: 'Ääre', lon: -20, lat: 150, members: [1], routes: [] },
    { id: 'center', name: 'Kesklinn', lon: 100, lat: 100, members: [0], routes: [] },
    { id: 'outside', name: 'Kauge', lon: 500, lat: 500, members: [2], routes: [] },
  ],
};
const project = ({ lon, lat }) => ({ x: lon, y: lat });

test('viewport includes visible platforms even when the group center is outside, nearest first', () => {
  assert.deepEqual(visibleStationIds(data, project, 200, 200), ['center', 'edge']);
  assert.deepEqual(visibleStationIds(data, project, 600, 600).sort(), ['center', 'edge', 'outside']);
});

test('zooming, rotating and moving use screen coordinates rather than rendered stop layers', () => {
  const moved = point => ({ x: point.lon - 450, y: point.lat - 450 });
  assert.deepEqual(visibleStationIds(data, moved, 100, 100), ['outside']);
  const rotated = point => ({ x: point.lon - point.lat + 100, y: point.lon + point.lat });
  assert.deepEqual(visibleStationIds(data, rotated, 200, 200), ['center']);
  assert.deepEqual(visibleStationIds(data, point => ({ x: point.lon + 1000, y: point.lat }), 100, 100), []);
});

test('visible stops precede others and text/code search still finds stops outside the map', () => {
  const groups = stationGroups(data, '', ['center', 'edge']);
  assert.deepEqual(groups.visible.map(s => s.id), ['center', 'edge']);
  assert.deepEqual(groups.other.map(s => s.id), ['outside']);
  assert.equal(stationGroups(data, 'Kauge', ['center']).other[0].id, 'outside');
  assert.equal(stationGroups(data, '2', ['edge']).visible[0].id, 'edge');
  assert.deepEqual(stationGroups(data, 'ei ole', ['center']), { visible: [], other: [] });
});

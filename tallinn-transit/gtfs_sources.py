"""Combine pinned feeds, keeping rail journeys inside the pedestrian/map coverage.

Identifiers are namespaced. Outside stops split a trip, rather than creating a
shortcut across an area for which the offline application has no coverage.
"""
import csv
import io
import zipfile
from collections import defaultdict

TABLES = ['stops', 'routes', 'trips', 'stop_times', 'calendar', 'calendar_dates', 'shapes']


def read_feed(path):
    with zipfile.ZipFile(path) as archive:
        return {name: list(csv.DictReader(io.StringIO(archive.read(name + '.txt').decode('utf-8-sig'))))
                if name + '.txt' in archive.namelist() else [] for name in TABLES}


def local_rail(feed, bounds):
    west, south, east, north = bounds
    stops = {s['stop_id']: s for s in feed['stops']}
    local = {key for key, s in stops.items() if west <= float(s['stop_lon']) <= east and south <= float(s['stop_lat']) <= north}
    routes = {r['route_id'] for r in feed['routes'] if r['route_type'] == '2'}
    by_trip, shapes = defaultdict(list), defaultdict(list)
    for row in feed['stop_times']:
        by_trip[row['trip_id']].append(row)
    for row in feed['shapes']:
        shapes[row['shape_id']].append(row)
    for points in shapes.values():
        points.sort(key=lambda p: int(p['shape_pt_sequence']))
    result = {name: [] for name in TABLES}
    used_stops, used_routes, used_services, emitted_shapes = set(), set(), set(), set()
    prefix = lambda value: 'elron:' + value
    for trip in feed['trips']:
        if trip['route_id'] not in routes:
            continue
        seq = sorted(by_trip[trip['trip_id']], key=lambda row: int(row['stop_sequence']))
        spans, span = [], []
        for row in seq + [None]:
            if row is not None and row['stop_id'] in local:
                span.append(row)
            else:
                if len(span) >= 2:
                    spans.append(span)
                span = []
        for part, span in enumerate(spans):
            points = shapes[trip['shape_id']]
            if len(points) < 2:
                raise ValueError(f"Elron trip has no rail shape: {trip['trip_id']}")
            def nearest(stop_id):
                s = stops[stop_id]
                return min(range(len(points)), key=lambda i: ((float(points[i]['shape_pt_lon'])-float(s['stop_lon']))*.51)**2 + (float(points[i]['shape_pt_lat'])-float(s['stop_lat']))**2)
            first, last = nearest(span[0]['stop_id']), nearest(span[-1]['stop_id'])
            if last <= first:
                raise ValueError(f"Elron shape direction does not match stop order: {trip['trip_id']}")
            shape_id = prefix(f"{trip['shape_id']}:{first}:{last}")
            if shape_id not in emitted_shapes:
                emitted_shapes.add(shape_id)
                result['shapes'].extend({**p, 'shape_id': shape_id} for p in points[first:last+1])
            trip_id = prefix(trip['trip_id']) + (f':part{part}' if len(spans) > 1 else '')
            result['trips'].append({**trip, 'trip_id': trip_id, 'route_id': prefix(trip['route_id']), 'service_id': prefix(trip['service_id']), 'shape_id': shape_id})
            result['stop_times'].extend({**row, 'trip_id': trip_id, 'stop_id': prefix(row['stop_id'])} for row in span)
            used_stops.update(row['stop_id'] for row in span)
            used_routes.add(trip['route_id'])
            used_services.add(trip['service_id'])
    result['stops'] = [{**s, 'stop_id': prefix(s['stop_id']), 'source_name': s['stop_name'],
                        'stop_name': 'Balti jaam' if s['stop_name'] == 'Tallinn' else s['stop_name'], 'source': 'Elron / RPM GTFS', 'mode': 'train'}
                       for s in feed['stops'] if s['stop_id'] in used_stops]
    result['routes'] = [{**r, 'route_id': prefix(r['route_id']), 'source': 'Elron / RPM GTFS'} for r in feed['routes'] if r['route_id'] in used_routes]
    for name in ['calendar', 'calendar_dates']:
        result[name] = [{**row, 'service_id': prefix(row['service_id'])} for row in feed[name] if row['service_id'] in used_services]
    return result


def combined_feeds(city_path, rail_path, bounds):
    city = read_feed(city_path)
    rail = local_rail(read_feed(rail_path), bounds)
    return {name: city[name] + rail[name] for name in TABLES}

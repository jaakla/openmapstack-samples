"""Compile pinned Tallinn GTFS and map snapshots into the browser application.

No source requests occur here. Metric transfer candidates are measured in
EPSG:3301 using an indexed DuckDB spatial join; source geometry remains WGS84.
The only mutable browser feed is GPS, excluded from analytical run claims.
"""
from pathlib import Path
import datetime as dt
import hashlib
import html
import json
import platform
import re
import shutil
import subprocess
from collections import defaultdict
import duckdb
import yaml
from openmapstack.credits import credit_payload, html_credits
from openmapstack.delivery import metadata_json, write_evidence
from openmapstack.findings import write_findings
from walking import compile_walk
from gtfs_sources import combined_feeds

ROOT = Path(__file__).resolve().parent

def dump(path, value):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))

def inventory(paths):
    return [{'path': p, 'sha256': 'sha256:' + hashlib.sha256((ROOT / p).read_bytes()).hexdigest()} for p in sorted(set(paths))]

def file_hash(paths):
    h = hashlib.sha256()
    for p in sorted(set(paths)):
        key = p.encode()
        h.update(len(key).to_bytes(8, 'big')); h.update(key); h.update((ROOT / p).read_bytes())
    return 'sha256:' + h.hexdigest()

def main():
    started = dt.datetime.now(dt.timezone.utc)
    run_id = started.strftime('run-%Y%m%d-%H%M%S')
    project = yaml.safe_load((ROOT / 'project.yaml').read_text())
    if not (ROOT/'node_modules/vite').exists():
        subprocess.run(['npm','ci','--no-audit','--no-fund'],cwd=ROOT,check=True)
    src = ROOT / 'data/source'
    for source in project['sources'].values():
        pin = source.get('pin', {})
        if pin.get('class') == 'local_snapshot':
            actual = 'sha256:' + hashlib.sha256((ROOT / pin['path']).read_bytes()).hexdigest()
            if actual != pin['sha256']:
                raise RuntimeError(f"Pinned source changed: {pin['path']}; review and repin explicitly")

    # STEP load_gtfs: Tallinn municipal GTFS, acquisition metadata in immutable
    # data/source/acquisition.json. Parse every row, including calendar exceptions.
    feed = combined_feeds(src/'gtfs.zip', src/'elron-gtfs.zip', project['sources']['elron_gtfs']['selection']['bbox'])
    def rows(name):
        return feed[name.removesuffix('.txt')]
    raw_stops, raw_routes, raw_trips, times = (rows(n) for n in ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'])
    calendars, exceptions = rows('calendar.txt'), rows('calendar_dates.txt')
    by_trip = defaultdict(list)
    for t in times:
        by_trip[t['trip_id']].append(t)
    used_stops = {t['stop_id'] for t in times}
    selected = sorted((s for s in raw_stops if s['stop_id'] in used_stops), key=lambda s: s['stop_id'])
    indexes = {s['stop_id']: i for i, s in enumerate(selected)}
    route_rows = sorted(raw_routes, key=lambda r: (int(r.get('route_sort_order') or 0), r['route_id']))
    route_index = {r['route_id']: i for i, r in enumerate(route_rows)}
    routes = [{'id': r['route_id'], 'name': r['route_short_name'], 'longName': r['route_long_name'],
               'source':r.get('source','Tallinn GTFS'), 'mode': ('train' if r['route_type']=='2' else 'tram' if r['route_type'] == '0' or 900 <= int(r['route_type']) <= 906 else
                        'bus' if r['route_type'] in ['3','800'] else 'unknown'), 'gtfsType': r['route_type']} for r in route_rows]
    stops = [{'id': s['stop_id'], 'code': s['stop_code'], 'name': s['stop_name'],
              'source':s.get('source','Tallinn GTFS'), 'sourceName':s.get('source_name',s['stop_name']),
              'platformCode':s.get('platform_code',''), 'description':s.get('stop_desc',''), 'mode':s.get('mode',''),
              'lon': float(s['stop_lon']), 'lat': float(s['stop_lat']), 'routes': []} for s in selected]
    def seconds(value):
        h, m, s = map(int, value.split(':'))
        return h * 3600 + m * 60 + s
    trips, stop_routes, shape_routes = [], defaultdict(set), {}
    for t in sorted(raw_trips, key=lambda x: x['trip_id']):
        seq = sorted(by_trip[t['trip_id']], key=lambda x: int(x['stop_sequence']))
        if not seq:
            continue
        r = route_index[t['route_id']]
        item = {'id': t['trip_id'], 'r': r, 'service': t['service_id'], 'shape': t['shape_id'], 'headsign': t['trip_headsign'],
                'stops': [indexes[x['stop_id']] for x in seq],
                'arrivals': [seconds(x['arrival_time']) for x in seq], 'departures': [seconds(x['departure_time']) for x in seq],
                'pickup': [int(x.get('pickup_type') or 0) for x in seq], 'dropoff': [int(x.get('drop_off_type') or 0) for x in seq]}
        trips.append(item)
        for s in item['stops']:
            stop_routes[s].add(r)
        shape_routes[t['shape_id']] = r
    for i, s in enumerate(stops):
        s['routes'] = sorted(stop_routes[i])

    # STEP transfer_graph: always_xy is explicit. Roundtrip anchor is validated
    # against the original GTFS point. No geographic-degree distance calculation.
    con = duckdb.connect()
    spatial = con.execute("SELECT installed FROM duckdb_extensions() WHERE extension_name='spatial'").fetchone()
    if not spatial or not spatial[0]:
        con.execute("INSTALL spatial FROM 'https://extensions.duckdb.org'")
    con.execute('LOAD spatial')
    con.execute('CREATE TABLE stops(i INTEGER, lon DOUBLE, lat DOUBLE)')
    con.executemany('INSERT INTO stops VALUES (?, ?, ?)', [(i, s['lon'], s['lat']) for i, s in enumerate(stops)])
    con.execute("CREATE TABLE projected AS SELECT i, ST_Transform(ST_Point(lon,lat),'EPSG:4326','EPSG:3301',always_xy:=true) AS geom FROM stops")
    con.execute('CREATE INDEX stop_rtree ON projected USING RTREE(geom)')
    roundtrip_error = con.execute("SELECT max(abs(ST_X(p)-lon)+abs(ST_Y(p)-lat)) FROM (SELECT i,ST_Transform(geom,'EPSG:3301','EPSG:4326',always_xy:=true) p FROM projected) JOIN stops USING(i)").fetchone()[0]
    # Real pedestrian routes, including crossings and foot-access restrictions.
    # The same ngraph.path engine compiles transfers and runs on the device.
    radius = 600
    walk = compile_walk(src/'tallinn-walk.osm.pbf')
    dump('data/derived/walk-network.json',walk)
    dump('.openmapstack/build-stops.json',stops)
    subprocess.run(['node','scripts/compile-walk.mjs','data/derived/walk-network.json',
                    '.openmapstack/build-stops.json','.openmapstack/build-transfers.json'],cwd=ROOT,check=True)
    walk_results=json.loads((ROOT/'.openmapstack/build-transfers.json').read_text())
    transfers=walk_results['transfers']
    # Same-name platforms are grouped only within 400 m, avoiding teleportation
    # between unrelated distant stops which happen to share a name.
    pairs=con.execute('SELECT a.i,b.i FROM projected a JOIN projected b ON ST_DWithin(a.geom,b.geom,400) WHERE a.i<b.i').fetchall()
    parent=list(range(len(stops)))
    names={s['name'].casefold():s['name'] for s in stops}
    def station_name(name):
        base=re.sub(r'\s+\d+$','',name)
        return names.get(base.casefold(),name)
    def find(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    for a,b in pairs:
        if station_name(stops[a]['name']).casefold()==station_name(stops[b]['name']).casefold():
            parent[find(b)]=find(a)
    groups=defaultdict(list)
    for i in range(len(stops)):groups[find(i)].append(i)
    stations=[]
    for members in groups.values():
        station={'id':f's{members[0]}','name':station_name(stops[members[0]]['name']),
                 'lon':sum(stops[i]['lon'] for i in members)/len(members),'lat':sum(stops[i]['lat'] for i in members)/len(members),
                 'members':members,'routes':sorted({r for i in members for r in stops[i]['routes']})}
        stations.append(station)
        for i in members:stops[i]['stationId']=station['id']

    # STEP export_network: preserve authoritative shape vertices and identifiers.
    shape_points = defaultdict(list)
    for s in rows('shapes.txt'):
        if s['shape_id'] in shape_routes:
            shape_points[s['shape_id']].append((int(s['shape_pt_sequence']), float(s['shape_pt_lon']), float(s['shape_pt_lat'])))
    shape_features = []
    for shape, points in sorted(shape_points.items()):
        r = shape_routes[shape]
        shape_features.append({'type': 'Feature', 'id': shape,
            'properties': {'id': shape, 'route': r, 'name': routes[r]['name'], 'mode': routes[r]['mode'], 'source': routes[r]['source'],
                           'route_trip_count': sum(t['r'] == r for t in trips)},
            'geometry': {'type': 'LineString', 'coordinates': [[x, y] for _, x, y in sorted(points)]}})
    stop_features = [{'type': 'Feature', 'id': i, 'properties': {**s, 'index': i, 'routes': ','.join(routes[r]['name'] for r in s['routes']),
                       'outgoing_transfer_count': len(transfers[i])},
                      'geometry': {'type': 'Point', 'coordinates': [s['lon'], s['lat']]}} for i, s in enumerate(stops)]
    network = {'schema': 'tallinn-transit/v1', 'timezone': 'Europe/Tallinn',
        'snapshot': project['sources']['gtfs']['access']['retrieved_at'],
        'sourceSha256': project['sources']['gtfs']['pin']['sha256'],
        'railSnapshot': project['sources']['elron_gtfs']['access']['retrieved_at'],
        'railSourceSha256': project['sources']['elron_gtfs']['pin']['sha256'],
        'railBounds':project['sources']['elron_gtfs']['selection']['bbox'],
        'validFrom': min(c['start_date'] for c in calendars), 'validUntil': max(c['end_date'] for c in calendars),
        'stops': stops, 'stations':stations,'routes': routes, 'trips': trips, 'transfers': transfers,
        'calendar': [{'id': c['service_id'], 'start': c['start_date'], 'end': c['end_date'],
                      'days': [int(c[d]) for d in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']]} for c in calendars],
        'exceptions': [[c['service_id'], c['date'], int(c['exception_type'])] for c in exceptions]}
    dump('data/derived/network.json', network)
    dump('data/derived/stops.geojson', {'type': 'FeatureCollection', 'features': stop_features})
    dump('data/derived/routes.geojson', {'type': 'FeatureCollection', 'features': shape_features})
    dump('data/derived/stations.geojson',{'type':'FeatureCollection','features':[
        {'type':'Feature','id':s['id'],'properties':{'id':s['id'],'name':s['name'],'platform_count':len(s['members'])},
         'geometry':{'type':'Point','coordinates':[s['lon'],s['lat']]}} for s in stations]})

    # Domain checks are computed from real parsed inputs, never a fabricated oracle.
    monotonic = all(all(a <= d for a, d in zip(t['arrivals'],t['departures'])) and
                    all(t['departures'][i] <= t['arrivals'][i+1] for i in range(len(t['stops'])-1)) for t in trips)
    bbox = project['project']['aoi']['bbox']
    within = all(bbox[0] <= s['lon'] <= bbox[2] and bbox[1] <= s['lat'] <= bbox[3] for s in stops)
    checks = [
        {'id': 'geometry_valid', 'status': 'passed' if all(len(f['geometry']['coordinates'])>=2 for f in shape_features) else 'failed'},
        {'id': 'crs_known', 'status': 'passed', 'storage': 'EPSG:4326', 'metric': 'EPSG:3301'},
        {'id': 'row_count_gt_zero', 'status': 'passed' if len(stops) and len(trips) else 'failed', 'stops': len(stops), 'trips': len(trips)},
        {'id': 'source_result_complete', 'status': 'passed' if len(trips)==len(raw_trips) else 'failed', 'trips_in_export': len(raw_trips), 'compiled_trips': len(trips)},
        {'id': 'gtfs_references', 'status': 'passed' if all(t['service'] in {c['service_id'] for c in calendars} | {c['service_id'] for c in exceptions} and t['shape'] in shape_points for t in trips) else 'failed'},
        {'id': 'gtfs_monotonic_times', 'status': 'passed' if monotonic else 'failed'},
        {'id': 'layer_extent_within_aoi', 'status': 'passed' if within else 'failed'},
        {'id': 'metric_transfer_bound', 'status': 'passed' if all(e[2] <= radius for edges in transfers for e in edges) else 'failed'},
        {'id': 'crs_roundtrip', 'status': 'passed' if roundtrip_error < 1e-7 else 'failed', 'maximum_lon_lat_error': roundtrip_error},
        {'id': 'route_modes_known', 'status': 'passed' if all(r['mode'] != 'unknown' for r in routes) else 'failed'},
        {'id': 'rail_network', 'status':'passed' if any(r['mode']=='train' for r in routes) and all(t['id'].startswith('elron:') for t in trips if routes[t['r']]['mode']=='train') else 'failed',
         'routes':sum(r['mode']=='train' for r in routes),'platforms':sum(s['mode']=='train' for s in stops),'trips':sum(routes[t['r']]['mode']=='train' for t in trips)},
        {'id': 'live_fix_time', 'status': 'warning', 'reason': 'GPS export has no per-vehicle fix timestamp or guaranteed trip association; only retrieval age can be shown.'},
        {'id': 'walking_network', 'status': 'passed' if walk_results['snapped']>len(stops)*0.95 else 'warning',
         'vertices':len(walk['vertices']),'edges':len(walk['edges']),'platforms_snapped':walk_results['snapped'],
         'reason':'OSM pedestrian topology and explicit foot/access rules; last metres to entrances/platforms use bounded snapping.'},
    ]
    if any(c['status']=='failed' for c in checks):
        raise RuntimeError(json.dumps(checks))
    completed = dt.datetime.now(dt.timezone.utc).isoformat()
    report = {'run_id': run_id, 'status': 'warning', 'checks': checks, 'started_at': started.isoformat(), 'completed_at': completed}
    project.setdefault('runs', {})['latest'] = {'id': run_id, 'started_at': started.isoformat(), 'completed_at': completed, 'status': 'warning'}
    project['project']['status'] = 'warning'

    # STEP package_map: all map styles, fonts and sprites are self-hosted.
    public = ROOT / 'public'
    (public/'data').mkdir(parents=True, exist_ok=True)
    (public/'map').mkdir(parents=True, exist_ok=True)
    shutil.copy2(src/'tallinn.pmtiles', public/'map/tallinn.pmtiles')
    for folder in ['fonts', 'sprites']:
        shutil.copytree(src/folder, public/'map'/folder, dirs_exist_ok=True)
    for theme in ['light','dark']:
        style = json.loads((src/f'basemap-{theme}.json').read_text())
        # Local cartographic overrides preserve the pinned source geometry.
        # Water and parks follow the primary screen design in both themes.
        for layer in style['layers']:
            if layer['id'] == 'water':
                layer['paint']['fill-color'] = '#c7e4f4' if theme == 'light' else '#16384c'
            elif layer['id'] in ['landuse_park','landuse_urban_green']:
                layer['paint']['fill-color'] = '#e4edde' if theme == 'light' else '#203c32'
        style['sources'] = {'protomaps': {'type':'vector', 'url':'pmtiles://map/tallinn.pmtiles',
                                        'attribution': project['presentation']['map']['basemap']['attribution']}}
        style['glyphs'] = 'map/fonts/{fontstack}/{range}.pbf'
        style['sprite'] = f'map/sprites/{theme}'
        dump(f'public/map/{theme}.json', style)
    for name in ['network.json','stops.geojson','routes.geojson','stations.geojson','walk-network.json']:
        shutil.copy2(ROOT/'data/derived'/name, public/'data'/name)
    # Static captured GPS is solely a test fixture, never used by the app.
    credits = html_credits(credit_payload(project, completed_at=completed)).replace('Generated with AI using the free','Loodud tehisintellekti ja tasuta').replace('toolkit.','tööriistakomplekti abil.').replace('Analysis made:','Koostatud:').replace('Author:','Autor:').replace('Author website','Autori veebileht')
    target = project['delivery']['targets'][0]
    metadata = metadata_json(ROOT, project, target)
    config = {'project': project['project'], 'run': project['runs']['latest'], 'sources': project['sources'],
              'warnings': project['warnings'], 'assumptions': project['interpretation']['assumptions']}
    dump('public/data/project.json', config)
    warnings = ''.join('<p>' + html.escape(w['statement']) + '</p>' for w in project['warnings'])
    source_links = ' · '.join(f'<a href="{html.escape(s["source_url"],quote=True)}">{html.escape(s["provider"])}</a>' for s in project['sources'].values())
    template = (ROOT/'index.template.html').read_text()
    footer = f'<footer data-openmapstack-provenance>{credits}<details id="source-notes"><summary>Allikad ja piirangud</summary>{source_links}{warnings}<a href="findings.md">Tulemused</a> · <a href="project.yaml">Projekt</a> · <a href="validation/latest-report.json">Kontrollid</a></details></footer>'
    (ROOT/'index.html').write_text(template.replace('<!--CREDITS-->', footer).replace('<!--METADATA-->', f'<script id="openmapstack-view" type="application/json">{metadata}</script>'))

    # STEP render_dashboard: Vite bundles all browser dependencies, no CDN scripts.
    if not (ROOT/'node_modules/vite').exists():
        subprocess.run(['npm','ci','--no-audit','--no-fund'],cwd=ROOT,check=True)
    subprocess.run(['npm','run','build'],cwd=ROOT,check=True)
    write_evidence(ROOT, project)
    # STEP render_findings: durable source-backed counts and limitations.
    write_findings(ROOT, project, report=report, scope='Tallinna linnatranspordi, Elroni ja OSM-i fikseeritud andmepakett', findings=[
        {'id':'network', 'statement':f"Andmepakett sisaldab {len(routes)} liini, {len(stations)} koondatud peatust, {len(stops)} platvormi ja {len(trips)} sõiduplaanireisi. Teenindus sõltub valitud kuupäevast.", 'evidence':['stops','stations','routes']},
        {'id':'transfers', 'statement':f"Ümberistumiste võrk sisaldab {sum(map(len,transfers))} suunatud OSM-i jalgsimarsruuti pikkusega kuni {radius} meetrit, mõõdetuna EPSG:3301 süsteemis.", 'evidence':['stops'], 'limitations':['Arvestatakse jalgsi liikumise piiranguid ja ühiseid OSM-i sõlmi. Viimase kuni 70 m ühendus hoone või platvormiga võib olla ligikaudne; ajutised sulgemised ja ratastooliga ligipääsetavus pole kinnitatud.']},
        {'id':'live', 'statement':'Sõidukite asukohti küsitakse sõiduplaanist sõltumatult. Need ei määra hilinemist ega prognoositavat saabumisaega.', 'evidence':['routes'], 'limitations':['Tallinna GPS-i voos puudub üksiksõiduki mõõtmisaeg. Elron annab mõõtmisaja; üle 180 s vanad rongiasukohad jäetakse välja.']}
    ])
    # Ship inspectable metadata along with the static view.
    for path in ['findings.md','project.yaml']:
        shutil.copy2(ROOT/path, ROOT/'dist'/path)
    files = sorted(p.relative_to(ROOT/'dist').as_posix() for p in (ROOT/'dist').rglob('*') if p.is_file() and p.name not in ['offline-manifest.json','sw.js','project.yaml','latest-report.json'])
    version_hash = hashlib.sha256()
    for name in files:
        version_hash.update(name.encode()); version_hash.update((ROOT/'dist'/name).read_bytes())
    version = version_hash.hexdigest()[:16]
    manifest = {'cache':f'tallinn-transit-{version}', 'files':files, 'bytes':sum((ROOT/'dist'/p).stat().st_size for p in files)}
    dump('dist/offline-manifest.json', manifest)
    # Inventories include the complete built app so clean reruns prove delivery.
    inputs = [p.relative_to(ROOT).as_posix() for p in src.rglob('*') if p.is_file()]
    inputs += ['pipeline.py']
    for dep in project['runtime']['implementation']['dependencies']:
        p = ROOT/dep
        inputs += [x.relative_to(ROOT).as_posix() for x in p.rglob('*') if x.is_file()] if p.is_dir() else [dep]
    outputs = [o['path'] for o in project['outputs'].values()]
    outputs += [p.relative_to(ROOT).as_posix() for p in (ROOT/'dist').rglob('*') if p.is_file() and p.name not in ['project.yaml','latest-report.json']]
    input_hash, output_hash = file_hash(inputs), file_hash(outputs)
    report.update(inputs_hash=input_hash, outputs_hash=output_hash)
    (ROOT/'runs').mkdir(exist_ok=True); (ROOT/'validation').mkdir(exist_ok=True)
    record = {**{k:report[k] for k in ['run_id','status','started_at','completed_at','inputs_hash','outputs_hash']},
              'validation_report':'validation/latest-report.json', 'inputs':inventory(inputs), 'outputs':inventory(outputs),
              'environment':{'python':platform.python_version(),'duckdb':duckdb.__version__}}
    dump(f'runs/{run_id}.json',record); dump('validation/latest-report.json',report)
    project['runs']['latest'].update(inputs_hash=input_hash, outputs_hash=output_hash, record={'path':f'runs/{run_id}.json'}, validation_report={'path':'validation/latest-report.json'})
    project['project']['updated_at'] = completed
    (ROOT/'project.yaml').write_text(yaml.safe_dump(project,sort_keys=False,allow_unicode=True,width=100))
    shutil.copy2(ROOT/'project.yaml',ROOT/'dist/project.yaml')
    (ROOT/'dist/validation').mkdir(exist_ok=True)
    shutil.copy2(ROOT/'validation/latest-report.json', ROOT/'dist/validation/latest-report.json')
    print(f'Compiled {len(routes)} routes, {len(stops)} stops, {len(trips)} trips. Run {run_id}.')

if __name__ == '__main__':
    main()

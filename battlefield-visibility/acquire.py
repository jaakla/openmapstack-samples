"""Fetch fixed source selections; create sources.lock.json once, verify thereafter.

The initial acquisition is explicit; this never silently refreshes a locked source.
Raw downloads stay outside git. All locks carry exact byte hashes and timestamps.
"""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'data/source'
LOCK = ROOT / 'sources.lock.json'
TILES = ['672496a','672496b','672496c','672496d','672497a','672497b','673496a','673496c','673497a']
MODEL_BASE = 'https://raw.githubusercontent.com/DhruvBhargava007/Morv_AI/b51a51a5b58962f4d07931e1871cbc6effd27c3e/frontend/public/models/abrams_m1a2_sepv3/'
QUERY = '[out:json][timeout:60][date:"2026-10-16T00:00:00Z"];way["highway"](60.161,24.928,60.175,24.957)->.w;(.w;>;);out meta;'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024), b''): h.update(b)
    return 'sha256:' + h.hexdigest()

def fetch(entry):
    path = ROOT / entry['path']
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and entry.get('sha256'):
        if digest(path) != entry['sha256']: raise ValueError(f'Changed source: {path}')
        return entry
    partial = path.with_suffix(path.suffix+'.partial')
    request = urllib.request.Request(entry['url'], headers={'User-Agent':'OpenMapStack-Helsinki-demo/1.0'})
    print('Fetching',entry['path'],flush=True)
    with urllib.request.urlopen(request, timeout=180) as r, partial.open('wb') as f:
        while b := r.read(1024*1024): f.write(b)
    if entry.get('sha256') and digest(partial) != entry['sha256']:
        raise ValueError(f'Checksum mismatch: {path}')
    partial.replace(path)
    if path.suffix == '.laz' and path.open('rb').read(4) != b'LASF': raise ValueError(f'Not LAS: {path}')
    return {**entry,'sha256':digest(path),'size_bytes':path.stat().st_size,
            'retrieved_at':entry.get('retrieved_at',datetime.now(timezone.utc).isoformat())}

def main():
    if LOCK.exists():
        lock = json.loads(LOCK.read_text())
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(fetch,lock['files']))
        return
    entries = [{'id':'lidar_'+t,'path':f'data/source/{t}_2021.laz',
        'url':f'https://ptp.hel.fi/DataHandlers/Lidar_kaikki/Default.ashx?q={t}&y=2021',
        'provider':'City of Helsinki','version':'2021 flights 11–15 June',
        'license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/'} for t in TILES]
    entries += [{'id':'osm','path':'data/source/osm-20261016.json',
        'url':'https://overpass-api.de/api/interpreter?data='+urllib.parse.quote(QUERY),
        'provider':'OpenStreetMap contributors','version':'2026-10-16T00:00:00Z',
        'license':'ODbL 1.0','license_url':'https://www.openstreetmap.org/copyright'},
        {'id':'tile_index','path':'data/source/tile-index.geojson','url':'https://kartta.hel.fi/ws/geoserver/avoindata/wfs?'+urllib.parse.urlencode({'service':'WFS','version':'2.0.0','request':'GetFeature','typeNames':'avoindata:Karttalehtijako_05x05_km','srsName':'EPSG:3067','bbox':'385200,6671300,386500,6672500,EPSG:3067','outputFormat':'application/json'}),
         'provider':'City of Helsinki','version':'2026-10-17 snapshot','license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/'},
        {'id':'lidar_spec','path':'data/source/2021_Laserpisteet_kuvaus.pdf','url':'https://kartta.hel.fi/avoindata/dokumentit/2021_Laserpisteet_kuvaus.pdf','provider':'City of Helsinki','version':'2022-11-11 specification for 2021 data','license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/'},
        {'id':'uav','path':'data/source/quadcopter.glb','url':'https://www.innerscene.com/api/library/quadcopter-with-flight-electronics-a25968c1/download',
         'provider':'Innerscene','version':'quadcopter-with-flight-electronics-a25968c1','license':'CC0 1.0','license_url':'https://creativecommons.org/publicdomain/zero/1.0/',
         'sha256':'sha256:0d38b6f44eef969fe17f0c8a54d6747b7a0efb8a3b2e9ab875221d182a6dfb12'},
        {'id':'tank','path':'data/source/tank/scene.gltf','url':MODEL_BASE+'scene.gltf','provider':'dannzjs / licensed mirror','version':'b51a51a5b58962f4d07931e1871cbc6effd27c3e','license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/'},
        {'id':'tank_license','path':'data/source/tank/license.txt','url':MODEL_BASE+'license.txt','provider':'dannzjs','version':'b51a51a5b58962f4d07931e1871cbc6effd27c3e','license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/'}]
    # Discover companion URIs from the pinned glTF, never guess texture names.
    tank = fetch(next(e for e in entries if e['id']=='tank'))
    entries = [tank if e['id']=='tank' else e for e in entries]
    model = json.loads((ROOT/tank['path']).read_text())
    for item in model.get('buffers',[])+model.get('images',[]):
        uri = item['uri']
        if '..' in uri or uri.startswith('/'): raise ValueError('Unsafe glTF URI')
        entries.append({**tank,'id':'tank_'+uri,'path':'data/source/tank/'+uri,'url':MODEL_BASE+uri})
        for key in ['sha256','size_bytes','retrieved_at']:entries[-1].pop(key,None)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:files=list(pool.map(fetch,entries))
    index = json.loads((RAW/'tile-index.geojson').read_text())
    assert index['numberMatched'] == index['numberReturned'] == len(index['features']) == 9
    osm=json.loads((RAW/'osm-20261016.json').read_text());assert 'remark' not in osm
    LOCK.write_text(json.dumps({'schema':'helsinki-sources/v1','files':files,'osm_query':QUERY,
        'research':'https://github.com/jaakla/openmapstack-samples/issues/1#issuecomment-6233311665'},indent=2)+'\n')
    print('Locked',len(files),'immutable source files',flush=True)

if __name__ == '__main__':main()

"""Explicit source acquisition; canonical pipeline never silently refreshes inputs.

GTFS/GPS are Tallinn's own exports. Map tiles are a bounded extract of the
OpenMapStack configured Protomaps 2026-10-06 snapshot, not OSM's public tile service.
Run with the pinned Python requirements. Review updated hashes in project.yaml.
"""
from pathlib import Path
import concurrent.futures as cf
import datetime as dt
import gzip
import hashlib
import json
import math
import time
import urllib.request
from pmtiles.writer import write
from pmtiles.tile import zxy_to_tileid, Compression, TileType

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data/source'
BOUNDS = [24.45, 59.28, 25.04, 59.57]
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://transport.tallinn.ee/'}

def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=45) as r:
                return r.read(), dict(r.headers)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    receipts = []
    for name, url in [('gtfs.zip', 'https://transport.tallinn.ee/data/gtfs.zip?download=1'),
                      ('gps-snapshot.txt', 'https://transport.tallinn.ee/gps.txt?x=1'),
                      ('gps-client.js', 'https://transport.tallinn.ee/JS/map-leaflet.js')]:
        data, headers = get(url)
        (DEST / name).write_bytes(data)
        receipts.append({'path': name, 'url': url, 'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                         'sha256': hashlib.sha256(data).hexdigest(), 'headers': headers})
    styles = []
    for theme, name in [('light', 'white'), ('dark', 'dark')]:
        url = f'https://tiles.goplex.ee/styles/5.7.2/{name}.json'
        data, _ = get(url)
        (DEST / f'basemap-{theme}.json').write_bytes(data)
        styles.append(json.loads(data))
    fonts = set()
    for style in styles:
        for layer in style['layers']:
            stack = layer.get('layout', {}).get('text-font')
            if stack:
                if all(isinstance(x, str) for x in stack):
                    fonts.add(','.join(stack))
                else:
                    def literals(value):
                        if isinstance(value, list):
                            if value and value[0] == 'literal':
                                fonts.add(','.join(value[1]))
                            else:
                                for child in value:
                                    literals(child)
                    literals(stack)
    tasks = []
    for stack in sorted(fonts):
        for span in ['0-255', '256-511', '1024-1279', '8192-8447']:
            tasks.append((f'fonts/{stack}/{span}.pbf', 'https://tiles.goplex.ee/assets/fonts/' + urllib.parse.quote(stack) + f'/{span}.pbf'))
    for theme, name in [('light', 'white'), ('dark', 'dark')]:
        for suffix in ['.json', '.png', '@2x.json', '@2x.png']:
            tasks.append((f'sprites/{theme}{suffix}', f'https://tiles.goplex.ee/assets/sprites/v4/{name}{suffix}'))
    def resource(task):
        path, url = task
        data, _ = get(url)
        p = DEST / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(resource, tasks))
    def xy(lon, lat, z):
        return int((lon + 180) / 360 * 2 ** z), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** z)
    tiles = []
    for z in range(15):
        x0, y0 = xy(BOUNDS[0], BOUNDS[3], z)
        x1, y1 = xy(BOUNDS[2], BOUNDS[1], z)
        tiles += [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    def tile(t):
        z, x, y = t
        b, _ = get(f'https://tiles.goplex.ee/planet-20261006/{z}/{x}/{y}.mvt')
        if b[:2] == b'\x1f\x8b':
            b = gzip.decompress(b)
        return zxy_to_tileid(z, x, y), gzip.compress(b, mtime=0)
    print(f'Acquiring {len(tiles)} bounded vector tiles', flush=True)
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        acquired = list(ex.map(tile, tiles))
    with write(str(DEST / 'tallinn.pmtiles')) as w:
        for tile_id, data in sorted(acquired):
            w.write_tile(tile_id, data)
        w.finalize({'tile_compression': Compression.GZIP, 'tile_type': TileType.MVT,
                    'min_lon_e7': int(BOUNDS[0]*1e7), 'min_lat_e7': int(BOUNDS[1]*1e7),
                    'max_lon_e7': int(BOUNDS[2]*1e7), 'max_lat_e7': int(BOUNDS[3]*1e7),
                    'center_zoom': 12, 'center_lon_e7': 247450000, 'center_lat_e7': 594350000},
                   {'name': 'Tallinn offline map', 'attribution': '© OpenStreetMap contributors, Protomaps tiles by goplex.ee',
                    'bounds': ','.join(map(str, BOUNDS)), 'snapshot': 'planet-20261006', 'tile_count': len(tiles)})
    receipts.append({'path': 'tallinn.pmtiles', 'url': 'https://tiles.goplex.ee/planet-20261006/{z}/{x}/{y}.mvt',
                     'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'bounds': BOUNDS,
                     'zooms': [0,14], 'tile_count': len(tiles), 'sha256': hashlib.sha256((DEST/'tallinn.pmtiles').read_bytes()).hexdigest()})
    (DEST / 'acquisition.json').write_text(json.dumps(receipts, indent=2))
    print('Saved pinned source snapshots', flush=True)

if __name__ == '__main__':
    main()

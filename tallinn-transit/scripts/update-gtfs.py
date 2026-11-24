"""Acquire both GTFS archives and repin their provenance; pipeline.py builds them.

Both downloads must validate before any project file is changed. Unchanged feeds
are also acquired and recorded, with their real retrieval time and content hash.
GPS fixtures, maps and the pedestrian network are outside this update.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

import yaml

ROOT = Path(__file__).resolve().parents[1]
FEEDS = {
    'gtfs': ('gtfs.zip', 'https://transport.tallinn.ee/data/gtfs.zip?download=1'),
    'elron_gtfs': ('elron-gtfs.zip', 'https://eu-gtfs.remix.com/elron.zip'),
}
MAX_DOWNLOAD = 64 * 1024 * 1024


def fetch(url):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Tallinn-liigub GTFS updater)',
        'Referer': 'https://transport.tallinn.ee/', 'Accept-Encoding': 'identity',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise ValueError(f'GTFS download returned HTTP {response.status}')
        body = response.read(MAX_DOWNLOAD + 1)
        if len(body) > MAX_DOWNLOAD:
            raise ValueError('GTFS download exceeds size limit')
        return body, {key.lower(): value for key, value in response.headers.items()}


def validate_archive(body):
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        members = [m for m in archive.infolist() if m.filename.endswith('.txt')]
        names = {m.filename for m in members}
        required = {'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt'}
        if not required <= names or not {'calendar.txt', 'calendar_dates.txt'} & names:
            raise ValueError('GTFS is missing required timetable tables')
        if len(names) != len(members) or sum(m.file_size for m in members) > 256 * 1024 * 1024:
            raise ValueError('Duplicate GTFS tables or excessive uncompressed size')
        for member in members:
            text = archive.read(member).decode('utf-8-sig')  # Verifies CRC and encoding.
            if member.filename in required and len(text.strip().splitlines()) < 2:
                raise ValueError(f'Empty GTFS table: {member.filename}')


def update(root=ROOT, fetcher=fetch, now=lambda: dt.datetime.now(dt.timezone.utc)):
    project_path = root / 'project.yaml'
    receipt_path = root / 'data/source/acquisition.json'
    project = yaml.safe_load(project_path.read_text())
    receipts = json.loads(receipt_path.read_text())
    downloads = []
    for key, (filename, url) in FEEDS.items():
        source = project['sources'][key]
        if source['pin']['path'] != f'data/source/{filename}':
            raise ValueError(f'{key}: unexpected source path')
        body, headers = fetcher(url)
        validate_archive(body)
        retrieved = now().astimezone(dt.timezone.utc).isoformat()
        sha = hashlib.sha256(body).hexdigest()
        source['access'].update(method='https', retrieved_at=retrieved, request_spec=url)
        source['access']['file'].update(name=filename, format='zip', size_bytes=len(body))
        source['pin'].update(sha256='sha256:' + sha, captured_at=retrieved)
        source['version'] = {'identifier': sha}
        receipt = next((r for r in receipts if r['path'] == filename), None)
        if receipt is None:
            receipt = {'path': filename}
            receipts.append(receipt)
        receipt.pop('version', None)  # Old provider labels do not describe the new download.
        receipt.update(url=url, retrieved_at=retrieved, sha256=sha,
                       headers={k: headers[k] for k in ['etag', 'last-modified', 'content-type'] if k in headers})
        downloads.append((root / source['pin']['path'], body))
    # A failed second download cannot leave the first feed or its pin updated.
    for path, body in downloads:
        path.write_bytes(body)
    receipt_path.write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
    project_path.write_text(yaml.safe_dump(project, sort_keys=False, allow_unicode=True, width=100))
    print('Acquired and repinned Tallinn and Elron GTFS. Run pipeline.py and checks before publishing.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='Project directory (also useful for isolated validation)')
    update(parser.parse_args().root)

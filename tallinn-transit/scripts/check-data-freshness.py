"""Read-only data audit. Standard library only; never rebuilds or republishes data."""
import calendar
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results/data-freshness/output'
PRIOR = ROOT / 'test-results/data-freshness/prior/state.json'
BASE = 'https://jaakla.github.io/openmapstack-samples/tallinn-transit/'
SCHEMA = 'openmapstack-data-freshness/v1'
ARTIFACT = 'tallinn-transit-data-state'
SOURCES = {
    'gtfs': ('https://transport.tallinn.ee/data/gtfs.zip?download=1', 'data/source/gtfs.zip', 7, 8),
    'elron_gtfs': ('https://eu-gtfs.remix.com/elron.zip', 'data/source/elron-gtfs.zip', 7, 8),
    'walk_osm': ('https://download.bbbike.org/osm/bbbike/Tallinn/Tallinn.osm.pbf', 'data/source/tallinn-walk.osm.pbf', None, 40),
}


def stamp(value):
    return value.astimezone(dt.timezone.utc).isoformat()


def display_time(value):
    return instant(value).astimezone(ZoneInfo('Europe/Tallinn')).strftime('%d.%m.%Y %H:%M %Z') if value else '—'


def instant(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timestamp has no timezone')
    return result


def next_month(value):
    year, month = value.year + (value.month == 12), value.month % 12 + 1
    return value.replace(year=year, month=month, day=min(value.day, calendar.monthrange(year, month)[1]))


def fetch(url, headers=None, limit=64 * 1024 * 1024):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Tallinn-liigub data freshness audit',
        'Accept-Encoding': 'identity', **(headers or {}),
    })
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            error.close()
            return 304, {}, b''
        raise
    with response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError('Source exceeds bounded download size')
        return response.status, {k.lower(): v for k, v in response.headers.items()}, body


def digest(body):
    return hashlib.sha256(body).hexdigest()


def gtfs_content_digest(body):
    """Ignore ZIP timestamps/compression; compare actual GTFS text-file contents."""
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        members = [m for m in archive.infolist() if m.filename.endswith('.txt')]
        if not {'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'} <= {m.filename for m in members}:
            raise ValueError('GTFS archive is missing required tables')
        if len({m.filename for m in members}) != len(members):
            raise ValueError('GTFS archive contains duplicate tables')
        if sum(m.file_size for m in members) > 256 * 1024 * 1024:
            raise ValueError('GTFS uncompressed size exceeds audit limit')
        result = hashlib.sha256()
        for member in sorted(members, key=lambda m: m.filename):
            content = archive.read(member).decode('utf-8-sig').replace('\r\n', '\n').encode()
            result.update(member.filename.encode() + b'\0')
            result.update(len(content).to_bytes(8, 'big'))
            result.update(content)
        return result.hexdigest()


def validate_state(state, now):
    if state.get('schema') != SCHEMA or not isinstance(state.get('sources'), dict):
        raise ValueError('Invalid prior audit state')
    if instant(state['checkedAt']) > now + dt.timedelta(minutes=5):
        raise ValueError('Prior audit state is dated in the future')
    for source in state['sources'].values():
        for key in ['lastCheckedAt', 'lastMatchedAt']:
            if source.get(key) and instant(source[key]) > now + dt.timedelta(minutes=5):
                raise ValueError(f'Prior {key} is dated in the future')
    return state


def gh_json(path):
    result = subprocess.run(['gh', 'api', path], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def restore_state():
    """Restore evidence from this workflow's main-branch runs, including failed audits."""
    repo = os.environ['GH_REPO']
    if repo != 'jaakla/openmapstack-samples':
        raise ValueError('Unexpected repository')
    if PRIOR.exists():
        PRIOR.unlink()
    listing = gh_json(f'repos/{repo}/actions/artifacts?name={ARTIFACT}&per_page=100')
    for artifact in sorted(listing['artifacts'], key=lambda a: a['created_at'], reverse=True):
        if artifact['expired'] or artifact.get('workflow_run', {}).get('head_branch') != 'main':
            continue
        run_id = artifact['workflow_run']['id']
        run = gh_json(f'repos/{repo}/actions/runs/{run_id}')
        if (run['status'] != 'completed' or run['head_branch'] != 'main'
                or run['event'] not in ['schedule', 'workflow_dispatch']
                or run['path'] != '.github/workflows/maintenance-data.yml'):
            continue
        with tempfile.TemporaryDirectory(prefix='transit-data-history-') as directory:
            subprocess.run(['gh', 'run', 'download', str(run_id), '--repo', repo,
                            '--name', ARTIFACT, '--dir', directory], check=True, capture_output=True)
            candidate = Path(directory) / 'state.json'
            # A setup failure may have no source observations. Keep looking back.
            if not candidate.exists():
                continue
            if candidate.stat().st_size > 1024 * 1024:
                raise ValueError('Prior audit state is too large')
            validate_state(json.loads(candidate.read_text()), dt.datetime.now(dt.timezone.utc))
            PRIOR.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(candidate, PRIOR)
            print(f'Restored source-check history from Actions run {run_id}')
            return
    print('No previous source-check artifact; bootstrap by checking all sources now.')


def coverage(network, today):
    if network.get('timezone') != 'Europe/Tallinn':
        raise ValueError('Unexpected timetable timezone')
    service_modes = {}
    for trip in network['trips']:
        service_modes.setdefault(trip['service'], set()).add(network['routes'][trip['r']]['mode'])
    checked = []
    for offset in range(15):
        date = today + dt.timedelta(days=offset)
        key = date.strftime('%Y%m%d')
        active = {c['id'] for c in network['calendar'] if c['start'] <= key <= c['end'] and c['days'][date.weekday()]}
        for service, day, change in network['exceptions']:
            if day == key:
                if change == 1:
                    active.add(service)
                elif change == 2:
                    active.discard(service)
        modes = set().union(*(service_modes.get(s, set()) for s in active))
        missing = {'bus', 'tram', 'train'} - modes
        if missing:
            raise ValueError(f'{date}: no published trips for {", ".join(sorted(missing))}')
        checked.append(str(date))
    return {'status': 'passed', 'from': checked[0], 'through': checked[-1]}


def check_source(key, deployed, previous, now, fetcher=fetch):
    url, local_path, days, grace_days = SOURCES[key]
    deployed_hash = deployed['pin']['sha256'].removeprefix('sha256:')
    if len(deployed_hash) != 64 or any(c not in '0123456789abcdef' for c in deployed_hash):
        raise ValueError('Missing or malformed published source hash')
    retrieved = instant(deployed['access']['retrieved_at'])
    if retrieved > now + dt.timedelta(minutes=5):
        raise ValueError('Published acquisition timestamp is in the future')
    same_deployment = previous.get('deployedSha256') == deployed_hash
    result = dict(previous) if same_deployment else {}
    result.update(sourceUrl=url, deployedSha256=deployed_hash, retrievedAt=stamp(retrieved),
                  deployedBytes=deployed['access']['file']['size_bytes'])
    last_check = instant(result['lastCheckedAt']) if result.get('lastCheckedAt') else None
    next_check = (last_check + dt.timedelta(days=days) if days else next_month(last_check)) if last_check else now
    due = not last_check or now >= next_check or result.get('status') == 'error'
    if due:
        headers = {}
        if result.get('latestSha256'):
            if result.get('etag'):
                headers['If-None-Match'] = result['etag']
            elif result.get('lastModified'):
                headers['If-Modified-Since'] = result['lastModified']
        status, response_headers, body = fetcher(url, headers)
        if status == 304:
            if not result.get('latestSha256'):
                raise ValueError('304 without a previously verified source version')
        elif status == 200:
            content_hash = gtfs_content_digest(body) if key != 'walk_osm' else None
            if key == 'walk_osm' and (len(body) < 100 or body.lstrip().startswith((b'<', b'{'))):
                raise ValueError('OSM source returned a page instead of a PBF archive')
            result.update(latestSha256=digest(body), latestContentSha256=content_hash, latestBytes=len(body),
                          etag=response_headers.get('etag'), lastModified=response_headers.get('last-modified'))
        else:
            raise ValueError(f'Unexpected source HTTP status {status}')
        result['lastCheckedAt'] = stamp(now)
        next_check = now + dt.timedelta(days=days) if days else next_month(now)
    matches = result.get('latestSha256') == deployed_hash
    # A repacked GTFS ZIP is not a timetable update. Only trust our local copy
    # when its hash agrees with the actual publicly deployed source pin.
    local = ROOT / local_path
    if not matches and key != 'walk_osm' and local.exists():
        body = local.read_bytes()
        if digest(body) == deployed_hash:
            matches = result.get('latestContentSha256') == gtfs_content_digest(body)
    if matches:
        result['lastMatchedAt'] = result['lastCheckedAt']
    anchor = instant(result.get('lastMatchedAt') or stamp(retrieved))
    deadline = anchor + dt.timedelta(days=grace_days)
    result.update(status='current' if matches else 'overdue' if now > deadline else 'update_available',
                  lastMatchedAt=result.get('lastMatchedAt'), nextCheckAt=stamp(next_check),
                  updateDeadlineAt=None if matches else stamp(deadline), needsUpdate=not matches,
                  checkPerformed=due)
    result.pop('error', None)
    return result


def audit(now=None, fetcher=fetch, prior_path=PRIOR, output=OUTPUT):
    now = now or dt.datetime.now(dt.timezone.utc)
    output.mkdir(parents=True, exist_ok=True)
    report = {'schema': SCHEMA, 'service': 'tallinn-transit', 'checkedAt': stamp(now),
              'timezone': 'Europe/Tallinn', 'sources': {}, 'status': 'unknown', 'errors': []}
    try:
        previous = validate_state(json.loads(prior_path.read_text()), now) if prior_path.exists() else {'sources': {}}
        _, _, body = fetcher(BASE + 'data/project.json')
        project = json.loads(body)
        _, _, body = fetcher(BASE + 'data/network.json')
        network = json.loads(body)
        report['coverage'] = coverage(network, now.astimezone(ZoneInfo('Europe/Tallinn')).date())
        for key, field in [('gtfs', 'sourceSha256'), ('elron_gtfs', 'railSourceSha256')]:
            if network[field] != project['sources'][key]['pin']['sha256']:
                raise ValueError(f'{key}: published timetable and provenance hashes disagree')
        for key in SOURCES:
            try:
                report['sources'][key] = check_source(key, project['sources'][key], previous['sources'].get(key, {}), now, fetcher)
            except Exception as error:
                report['sources'][key] = {**previous['sources'].get(key, {}), 'status': 'error', 'error': str(error)}
        report['status'] = 'failed' if any(s['status'] in ['error', 'overdue'] for s in report['sources'].values()) else 'passed'
    except Exception as error:
        report['errors'].append(str(error))
        # Preserve existing observations through a coverage/network error.
        report['sources'] = previous['sources'] if 'previous' in locals() else {}
        report['status'] = 'failed'
    state = {k: report[k] for k in ['schema', 'checkedAt', 'sources']}
    (output / 'state.json').write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    labels = {'passed': 'Läbis', 'failed': 'Viga', 'current': 'Ajakohane',
              'update_available': 'Uuendus saadaval', 'overdue': 'Uuendus hilinenud', 'error': 'Kontrolli viga'}
    lines = ['## Tallinn liigub – andmete värskus', '', f'Tulemus: **{labels[report["status"]]}**', '',
             '| Allikas | Seis | Viimati kontrollitud | Järgmine kontroll | Uuendamise tähtaeg |', '|---|---|---|---|---|']
    for key, source in report['sources'].items():
        lines.append(f'| {key} | {labels[source["status"]]} | {display_time(source.get("lastCheckedAt"))} | {display_time(source.get("nextCheckAt"))} | {display_time(source.get("updateDeadlineAt"))} |')
        if source.get('error'):
            lines.append(f'\n{key}: {source["error"]}\n')
    if report.get('coverage'):
        lines.append(f'\nSõiduplaani katvus: {report["coverage"]["from"]} kuni {report["coverage"]["through"]}.')
    lines.extend(['', '| Allikas | Avaldatud räsi | Lähteallika räsi | Avaldatud suurus | Lähteallika suurus |', '|---|---|---|---|---|'])
    for key, source in report['sources'].items():
        lines.append(f'| {key} | {source.get("deployedSha256", "Teadmata")[:12]} | {source.get("latestSha256", "Teadmata")[:12]} | {source.get("deployedBytes", "Teadmata")} B | {source.get("latestBytes", "Teadmata")} B |')
    lines.extend(['', *report['errors'], '', 'Uuenduse olemasolu enne tähtaega on märkus; hilinenud uuendus või ebaõnnestunud kontroll on viga.',
                  'See kontroll ei muuda lähteandmeid ega avalda rakendust. Täielikud räsid ja suurused: report.json.', ''])
    summary = '\n'.join(lines)
    (output / 'summary.md').write_text(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(summary)
    print(summary)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    if sys.argv[1:] == ['--restore-state']:
        restore_state()
    elif sys.argv[1:]:
        raise SystemExit('Usage: check-data-freshness.py [--restore-state]')
    else:
        raise SystemExit(audit())

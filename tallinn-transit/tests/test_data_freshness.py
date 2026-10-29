"""Deadline, caching and failure regressions; no external services are contacted."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('freshness', Path(__file__).resolve().parents[1] / 'scripts/check-data-freshness.py')
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
NOW = dt.datetime(2026, 10, 29, 8, 0, tzinfo=dt.timezone.utc)


def gtfs(text='a,b\n1,2\n', compression=zipfile.ZIP_STORED):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=compression) as archive:
        for name in ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']:
            archive.writestr(name, text)
    return stream.getvalue()


def source(body, age=1):
    return {'pin': {'sha256': 'sha256:' + audit.digest(body)},
            'access': {'retrieved_at': audit.stamp(NOW - dt.timedelta(days=age)), 'file': {'size_bytes': len(body)}}}


def response(body):
    return lambda *_: (200, {'etag': '"version"'}, body)


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='data-audit-test-')
        self.addCleanup(directory.cleanup)
        environment = patch.dict(audit.os.environ, {'GITHUB_STEP_SUMMARY': str(Path(directory.name) / 'summary.md')})
        environment.start()
        self.addCleanup(environment.stop)

    def test_unchanged_old_archive_is_current_and_verified_again(self):
        body = gtfs()
        result = audit.check_source('gtfs', source(body, 100), {}, NOW, response(body))
        self.assertEqual(result['status'], 'current')
        self.assertEqual(result['lastMatchedAt'], audit.stamp(NOW))

    def test_changed_recent_data_has_a_deadline_not_an_immediate_alarm(self):
        result = audit.check_source('gtfs', source(gtfs(), 1), {}, NOW, response(gtfs('changed')))
        self.assertEqual(result['status'], 'update_available')
        self.assertEqual(result['updateDeadlineAt'], audit.stamp(NOW + dt.timedelta(days=7)))

    def test_changed_old_data_is_overdue(self):
        result = audit.check_source('gtfs', source(gtfs(), 10), {}, NOW, response(gtfs('changed')))
        self.assertEqual(result['status'], 'overdue')

    def test_304_updates_check_time_without_moving_update_deadline(self):
        deployed = source(gtfs(), 7)
        prior = audit.check_source('gtfs', deployed, {}, NOW, response(gtfs('changed')))
        later = NOW + dt.timedelta(days=2)
        prior['status'] = 'error'  # A failed probe is retried regardless of cadence.
        seen = []
        def not_modified(url, headers):
            seen.append(headers)
            return 304, {}, b''
        result = audit.check_source('gtfs', deployed, prior, later, not_modified)
        self.assertEqual(seen, [{'If-None-Match': '"version"'}])
        self.assertEqual(result['lastCheckedAt'], audit.stamp(later))
        self.assertEqual(result['updateDeadlineAt'], prior['updateDeadlineAt'])
        self.assertEqual(result['status'], 'overdue')

    def test_daily_deadline_check_does_not_redownload_weekly_source(self):
        body = gtfs()
        prior = audit.check_source('gtfs', source(body), {}, NOW, response(body))
        def unexpected(*_):
            self.fail('Source was requested before weekly deadline')
        result = audit.check_source('gtfs', source(body), prior, NOW + dt.timedelta(days=1), unexpected)
        self.assertFalse(result['checkPerformed'])
        self.assertEqual(result['lastCheckedAt'], prior['lastCheckedAt'])

    def test_monthly_osm_check_handles_short_month(self):
        self.assertEqual(audit.next_month(NOW.replace(month=1, day=31)), NOW.replace(month=2, day=28))
        body = b'\0' * 200
        prior = audit.check_source('walk_osm', source(body), {}, NOW, response(body))
        self.assertEqual(prior['nextCheckAt'], audit.stamp(NOW.replace(month=11)))
        result = audit.check_source('walk_osm', source(body), prior, NOW + dt.timedelta(days=1),
                                    lambda *_: self.fail('Monthly source was fetched daily'))
        self.assertEqual(result['status'], 'current')

    def test_zip_repacking_does_not_claim_a_timetable_change(self):
        original, repacked = gtfs(), gtfs(compression=zipfile.ZIP_DEFLATED)
        self.assertNotEqual(audit.digest(original), audit.digest(repacked))
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, 'ROOT', Path(directory)):
            local = Path(directory) / 'data/source/gtfs.zip'
            local.parent.mkdir(parents=True)
            local.write_bytes(original)
            result = audit.check_source('gtfs', source(original, 100), {}, NOW, response(repacked))
            self.assertEqual(result['status'], 'current')

    def test_304_without_known_version_and_html_zip_are_rejected(self):
        for fetcher in [lambda *_: (304, {}, b''), response(b'<html>Error</html>')]:
            with self.assertRaises((ValueError, zipfile.BadZipFile)):
                audit.check_source('gtfs', source(gtfs()), {}, NOW, fetcher)

    def test_future_observation_is_rejected(self):
        with self.assertRaises(ValueError):
            audit.validate_state({'schema': audit.SCHEMA, 'checkedAt': audit.stamp(NOW), 'sources': {
                'gtfs': {'lastCheckedAt': audit.stamp(NOW + dt.timedelta(days=1))}}}, NOW)

    def test_calendar_exceptions_are_applied_and_all_modes_required(self):
        network = timetable()
        self.assertEqual(audit.coverage(network, NOW.date())['through'], '2026-11-12')
        network['exceptions'] = [['daily', '20261030', 2]]
        with self.assertRaisesRegex(ValueError, '2026-10-30'):
            audit.coverage(network, NOW.date())

    def test_success_report_and_source_failure_preserve_observation_time(self):
        original = gtfs()
        project = {'sources': {key: source(original if key != 'walk_osm' else b'\0' * 200) for key in audit.SOURCES}}
        network = timetable()
        network.update(sourceSha256=project['sources']['gtfs']['pin']['sha256'],
                       railSourceSha256=project['sources']['elron_gtfs']['pin']['sha256'])
        def fetcher(url, *_):
            if url.endswith('project.json'):
                return 200, {}, json.dumps(project).encode()
            if url.endswith('network.json'):
                return 200, {}, json.dumps(network).encode()
            return response(b'\0' * 200 if url.endswith('.pbf') else original)()
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            output = Path(directory) / 'output'
            self.assertEqual(audit.audit(NOW, fetcher, Path(directory) / 'missing', output), 0)
            state = json.loads((output / 'state.json').read_text())
            state['sources']['gtfs']['status'] = 'error'
            prior = Path(directory) / 'prior.json'
            prior.write_text(json.dumps(state))
            def failing(url, *_):
                if url == audit.SOURCES['gtfs'][0]:
                    raise OSError('upstream unavailable')
                return fetcher(url)
            self.assertEqual(audit.audit(NOW + dt.timedelta(days=1), failing, prior, output), 1)
            result = json.loads((output / 'state.json').read_text())
            self.assertEqual(result['sources']['gtfs']['lastCheckedAt'], audit.stamp(NOW))
            self.assertEqual(result['sources']['gtfs']['status'], 'error')

    def test_restore_only_accepts_own_completed_main_workflow_artifact(self):
        state = {'schema': audit.SCHEMA, 'checkedAt': audit.stamp(NOW), 'sources': {}}
        artifacts = [{'created_at': '2026-10-29', 'expired': False, 'workflow_run': {'id': n, 'head_branch': 'main'}} for n in [1, 2]]
        def api(path):
            if '/artifacts?' in path:
                return {'artifacts': artifacts}
            return {'status': 'completed', 'head_branch': 'main', 'event': 'workflow_dispatch',
                    'path': '.github/workflows/other.yml' if path.endswith('/1') else '.github/workflows/maintenance-data.yml'}
        def download(command, **_):
            self.assertEqual(command[3], '2')
            (Path(command[-1]) / 'state.json').write_text(json.dumps(state))
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, 'PRIOR', Path(directory) / 'prior.json'), \
                patch.dict(audit.os.environ, {'GH_REPO': 'jaakla/openmapstack-samples'}), \
                patch.object(audit, 'gh_json', side_effect=api), patch.object(audit.subprocess, 'run', side_effect=download), \
                contextlib.redirect_stdout(io.StringIO()):
            audit.restore_state()
            self.assertEqual(json.loads(audit.PRIOR.read_text()), state)

    def test_history_api_failure_is_not_mistaken_for_first_run(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, 'PRIOR', Path(directory) / 'prior.json'), \
                patch.dict(audit.os.environ, {'GH_REPO': 'jaakla/openmapstack-samples'}), \
                patch.object(audit, 'gh_json', side_effect=OSError('GitHub unavailable')):
            with self.assertRaisesRegex(OSError, 'GitHub unavailable'):
                audit.restore_state()


def timetable():
    return {'timezone': 'Europe/Tallinn', 'routes': [{'mode': m} for m in ['bus', 'tram', 'train']],
            'trips': [{'service': 'daily', 'r': r} for r in range(3)],
            'calendar': [{'id': 'daily', 'start': '20200101', 'end': '20300101', 'days': [1] * 7}], 'exceptions': []}


if __name__ == '__main__':
    unittest.main()

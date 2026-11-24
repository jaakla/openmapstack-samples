"""Feed acquisition must keep archives and provenance consistent on failures."""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import yaml

SPEC = importlib.util.spec_from_file_location('update_gtfs', Path(__file__).resolve().parents[1] / 'scripts/update-gtfs.py')
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)
NOW = dt.datetime(2026, 11, 16, 12, tzinfo=dt.timezone.utc)


def archive(text='id\n1\n', omit=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        for name in ['stops', 'routes', 'trips', 'stop_times', 'shapes', 'calendar']:
            if name != omit:
                z.writestr(name + '.txt', text)
    return output.getvalue()


class GtfsUpdateTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / 'data/source'
        self.source.mkdir(parents=True)
        sources, receipts = {}, []
        for key, (name, url) in updater.FEEDS.items():
            (self.source / name).write_bytes(archive())
            sources[key] = {'access': {'file': {}}, 'pin': {'class': 'local_snapshot', 'path': f'data/source/{name}'},
                            'version': {'identifier': 'old'}, 'license': {'name': 'retained'}}
            receipts.append({'path': name, 'version': 'old provider label', 'identification': 'retained'})
        (self.source / 'gps-snapshot.txt').write_text('unchanged GPS fixture')
        receipts.append({'path': 'gps-snapshot.txt', 'sha256': 'unchanged'})
        (self.root / 'project.yaml').write_text(yaml.safe_dump({'sources': sources, 'other': 'retained'}))
        (self.source / 'acquisition.json').write_text(json.dumps(receipts))

    def files(self):
        return {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_both_feeds_and_receipts_use_actual_download_hash_size_and_time(self):
        calls = []
        body = archive('id\nnew\n')
        def fetch(url):
            calls.append(url)
            return body, {'etag': '"new"', 'set-cookie': 'must not be stored'}
        with contextlib.redirect_stdout(io.StringIO()):
            updater.update(self.root, fetch, lambda: NOW)
        self.assertEqual(calls, [url for _, url in updater.FEEDS.values()])
        project = yaml.safe_load((self.root / 'project.yaml').read_text())
        receipts = json.loads((self.source / 'acquisition.json').read_text())
        self.assertEqual(project['other'], 'retained')
        for key, (name, url) in updater.FEEDS.items():
            source = project['sources'][key]
            sha = hashlib.sha256(body).hexdigest()
            self.assertEqual((self.source / name).read_bytes(), body)
            self.assertEqual(source['pin']['sha256'], 'sha256:' + sha)
            self.assertEqual(source['pin']['captured_at'], NOW.isoformat())
            self.assertEqual(source['access']['retrieved_at'], NOW.isoformat())
            self.assertEqual(source['access']['file']['size_bytes'], len(body))
            self.assertEqual(source['version']['identifier'], sha)
            self.assertEqual(source['license']['name'], 'retained')
            receipt = next(r for r in receipts if r['path'] == name)
            self.assertEqual(receipt['sha256'], sha)
            self.assertEqual(receipt['headers'], {'etag': '"new"'})
            self.assertNotIn('version', receipt)
            self.assertEqual(receipt['identification'], 'retained')
        self.assertEqual(receipts[-1], {'path': 'gps-snapshot.txt', 'sha256': 'unchanged'})
        self.assertEqual((self.source / 'gps-snapshot.txt').read_text(), 'unchanged GPS fixture')

    def test_bad_second_download_leaves_all_project_files_untouched(self):
        for error in [b'<html>Not a feed</html>', archive(omit='shapes'), archive('id\n')]:
            before = self.files()
            def fetch(url):
                return (archive('id\nchanged\n') if url == updater.FEEDS['gtfs'][1] else error), {}
            with self.assertRaises((ValueError, zipfile.BadZipFile)):
                updater.update(self.root, fetch, lambda: NOW)
            self.assertEqual(self.files(), before)

    def test_network_failure_does_not_partially_update(self):
        before = self.files()
        def fetch(url):
            if url == updater.FEEDS['elron_gtfs'][1]:
                raise OSError('Unavailable')
            return archive('id\nchanged\n'), {}
        with self.assertRaises(OSError):
            updater.update(self.root, fetch, lambda: NOW)
        self.assertEqual(self.files(), before)

    def test_unchanged_archive_records_a_real_new_acquisition(self):
        original = (self.source / 'gtfs.zip').read_bytes()
        with contextlib.redirect_stdout(io.StringIO()):
            updater.update(self.root, lambda url: (original, {}), lambda: NOW)
        project = yaml.safe_load((self.root / 'project.yaml').read_text())
        self.assertEqual(project['sources']['gtfs']['access']['retrieved_at'], NOW.isoformat())
        self.assertEqual((self.source / 'gtfs.zip').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()

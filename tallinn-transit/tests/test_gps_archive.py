import importlib.util
from pathlib import Path
import tempfile
import unittest

import duckdb

spec = importlib.util.spec_from_file_location('compact_gps_archive', Path(__file__).parents[1] / 'scripts/compact-gps-archive.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveCompactionTest(unittest.TestCase):
    def test_compaction_removes_replayed_events_and_preserves_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with duckdb.connect() as conn:
                conn.execute('CREATE TABLE records (event_id VARCHAR, collected_at_ms BIGINT, capture_reason VARCHAR, longitude DOUBLE)')
                conn.execute("INSERT INTO records VALUES ('a', 1000, 'user', 24.7), ('b', 2000, 'background', 24.8)")
                conn.execute('COPY records TO ? (FORMAT PARQUET)', [str(path / 'part-1.parquet')])
                conn.execute("DELETE FROM records WHERE event_id = 'b'")
                conn.execute('COPY records TO ? (FORMAT PARQUET)', [str(path / 'part-2.parquet')])
            originals = {p: p.read_bytes() for p in path.glob('*.parquet')}
            output = path / 'merged.parquet'
            result = module.compact(str(path / 'part-*.parquet'), output)
            self.assertEqual(result['inputRows'], 3)
            self.assertEqual(result['uniqueRows'], 2)
            self.assertEqual(result['replayedRows'], 1)
            self.assertEqual(result['byReason'], {'user': 1, 'background': 1})
            self.assertEqual(output.read_bytes()[:4], b'PAR1')
            self.assertTrue(all(p.read_bytes() == content for p, content in originals.items()))
            with self.assertRaisesRegex(ValueError, 'already exists'):
                module.compact(str(path / 'part-*.parquet'), output)


if __name__ == '__main__':
    unittest.main()

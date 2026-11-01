#!/usr/bin/env python3
"""Merge downloaded GPS Parquet files locally, deduplicating delivery replays."""
import argparse
import json
from pathlib import Path

import duckdb


def compact(input_glob, output):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError(f'Output already exists: {output}')
    with duckdb.connect() as conn:
        conn.read_parquet(input_glob, hive_partitioning=False).create_view('raw')
        conn.execute('''CREATE VIEW unique_rows AS SELECT * EXCLUDE (_archive_row) FROM (
            SELECT *, row_number() OVER (PARTITION BY event_id ORDER BY collected_at_ms) AS _archive_row
            FROM raw) WHERE _archive_row = 1''')
        raw = conn.execute('SELECT count(*) FROM raw').fetchone()[0]
        counts = dict(conn.execute('SELECT capture_reason, count(*) FROM unique_rows GROUP BY capture_reason').fetchall())
        conn.execute('COPY unique_rows TO ? (FORMAT PARQUET, COMPRESSION ZSTD)', [str(output)])
        actual = conn.execute('SELECT count(*) FROM read_parquet(?)', [str(output)]).fetchone()[0]
        if actual != sum(counts.values()):
            raise RuntimeError('Compacted row count does not match input')
    return {'output': str(output), 'inputRows': raw, 'uniqueRows': actual,
            'replayedRows': raw - actual, 'byReason': counts, 'bytes': output.stat().st_size}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='Quoted glob of downloaded Parquet files')
    parser.add_argument('--output', required=True, help='New local Parquet file (never overwritten)')
    args = parser.parse_args()
    print(json.dumps(compact(args.input, args.output), indent=2))

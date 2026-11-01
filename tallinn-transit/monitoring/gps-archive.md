# GPS history

Fresh public vehicle locations are archived at the shared upstream refresh, not
at every browser request. The existing SQLite Durable Objects hold deduplication
state and a durable outbox. Cloudflare Pipelines delivers typed rows as Zstandard
Parquet to the **private** R2 bucket `project-archives`, under:

```
tallinn-transit/gps/positions/year=YYYY/month=MM/day=DD/*.parquet
```

Partitions use UTC ingestion dates. Files roll hourly or at 64 MiB, so the current
hour may not be visible in R2 yet. Daily folders already contain analytical
Parquet: a second daily conversion job/database is unnecessary. Optionally merge
a completed day's files with the compaction command below.

## Collection and two-week trial

- User demand retains the existing shared **10-second upstream cap**. Only new
  successful HTTP 200 source versions reach the archive hook. Cache hits, HTTP
  304, failed refreshes and stale fallbacks never become new observations.
- The extra collector runs **every five minutes**, using the same Durable Objects
  and cooldown. A recent user refresh satisfies that sample without an extra
  upstream request. Each five-minute slot is reserved durably before I/O, so
  duplicate cron delivery cannot create extra requests in that slot. There are
  no catch-up requests: delayed events from older slots are discarded.
  There are
  at most 576 extra source requests/day across Tallinn and Elron combined.
- The background trial runs from **2026-11-01 07:21:59 UTC** until
  **2026-11-15 07:21:59 UTC** (09:21:59 Europe/Tallinn). Absolute dates are in
  `wrangler.jsonc`; redeployment never resets them. Both the scheduled handler and
  the Durable Object reject background collection outside the window. Invalid
  or longer-than-14-day windows fail closed. Cron propagation can take 15 minutes.
- At the deadline, cron becomes a cheap no-op without Durable Object/upstream
  calls. User-triggered collection and delivery retries continue. **History is
  retained** for investigation; the two-week limit is not a deletion policy.
  Remove `triggers.crons` and redeploy after evaluating the trial, or deliberately
  configure another bounded window if continued background sampling is wanted.

## Meaning of a row

`monitoring/gps-archive-schema.json` is the ingestion schema. All `*_at_ms` fields
are Unix milliseconds. `collected_at_ms` is when we queued the record;
`observed_at_ms` is the source observation/fix time. A row must be at most 60 s
old, with at most 30 s source-clock tolerance. Elron freshness is checked for
**each train**, not just the newest train in a response.

- **Tallinn:** `source_fix_at_ms` is null: this feed has no individual vehicle
  measurement timestamps. The feed's Last-Modified (or first observation of a
  changed body) supplies `observed_at_ms`. Repeated coordinates and route for the
  same mode/ID are skipped even if other vehicles update. Returning to a previous
  location after moving creates a new event. Consequently this is a history of
  changed observed positions, not regular stationary measurements; do not infer
  dwell time just by counting rows. Deduplication state expires after seven days
  without a fresh observation of that entity.
- **Elron:** `source_fix_at_ms` is the actual feed timestamp, resolved in
  Europe/Tallinn. Duplicate trip/fix/coordinates are skipped; a new timestamp at
  the same location remains a genuine new measurement. `entity_id = elron:<reis>`
  identifies a **trip number**, not a physical train. Only the application's
  existing Tallinn-area bounds are collected.
- `speed_source` / `bearing_source` distinguish `feed`, `estimated`, and missing
  values. Speeds use km/h, bearings degrees. These are vehicle positions, not
  users' locations. No visitor identifiers or IP addresses enter this schema.
- `capture_reason` is `user` or `background`: the first request that caused the
  shared refresh wins. A later user may benefit from a background-acquired cache
  entry, so this is acquisition origin, not proof of exclusive background value.

The outbox is transactionally updated with dedup state, then delivered in batches
of 500. An alarm retries failures after 60 s. It survives object eviction and is
bounded to 100,000 queued rows/object; reaching capacity logs/reports an archive
error instead of disrupting live GPS. Collection is best effort during local
storage failure/capacity exhaustion; the public upstream has no replay API.
Delivery is **at least once**: a crash after send acknowledgement but before
outbox deletion can replay rows. `event_id` is deterministic; analytical queries
must deduplicate it. Stream acceptance is not proof that a Parquet file is
already flushed. Do not delete source files until exports have been checked.

## Health and trial review

`GET /health/archive` is read-only and `Cache-Control: no-store`. It reports both
objects' queue sizes, oldest pending timestamp, queued/delivered counts, counts
by acquisition origin, suppressed duplicates, rejected rows and last error.
`backgroundSamples` and `lastBackgroundSampleAt` count reserved five-minute
sampling attempts even when a recent user refresh already satisfies the sample.
It returns 503 for archive errors, unavailable state, or a queue older than five
minutes. `/health/live` and `/health/data` retain their independent meanings.
Collection endpoints are internal Durable Object routes and return 404 publicly.

After two weeks compare daily background/user row counts, distinct entities,
coverage in quiet hours, additional time coverage, and compressed object bytes.
Use `event_id` deduplication before comparing totals. Counterfactual user-only
coverage cannot be inferred exactly from acquisition origin alone.

Download a completed UTC day using the existing local AWS profile (no keys in
this repository), then inspect or compact locally:

```sh
aws --profile r2-archive-write \
  --endpoint-url https://1770d998d043a2778e06edafa880a877.r2.cloudflarestorage.com \
  s3 cp s3://project-archives/tallinn-transit/gps/positions/year=2026/month=11/day=01/ \
  /tmp/tallinn-gps-2026-11-01/ --recursive

.venv/bin/python scripts/compact-gps-archive.py \
  --input '/tmp/tallinn-gps-2026-11-01/*.parquet' \
  --output /tmp/tallinn-gps-2026-11-01.parquet
```

The compactor writes a new local file, preserves source files, removes replayed
`event_id`s, and reports raw/unique/background/user rows. DuckDB is already pinned
in `requirements.lock`. For analysis:

```sql
SELECT source, capture_reason, count(*) AS observations,
       count(DISTINCT entity_id) AS entities
FROM read_parquet('/tmp/tallinn-gps-2026-11-01.parquet')
GROUP BY ALL ORDER BY ALL;
```

## Recreate the infrastructure

Current resource IDs and deployment evidence are in `deployment/gps-archive.json`.
Schema and sink changes require a new versioned stream/sink/pipeline; do not
delete an active stream with undelivered data. These commands create resources
in the configured account; use unused names when migrating:

```sh
npx wrangler pipelines streams create tallinn_gps_locations \
  --schema-file monitoring/gps-archive-schema.json --http-enabled=false
npx wrangler pipelines sinks create tallinn_gps_parquet --type r2 \
  --bucket project-archives --format parquet --compression zstd \
  --path tallinn-transit/gps/positions --partitioning 'year=%Y/month=%m/day=%d' \
  --roll-interval 3600 --roll-size 64
npx wrangler pipelines create tallinn_gps_archive \
  --sql 'INSERT INTO tallinn_gps_parquet SELECT * FROM tallinn_gps_locations'
```

Sink creation normally opens Cloudflare's browser authorization. This deployment
reuses the already-authorized local `r2-archive-write` profile, scoped to the
existing private archive bucket; credentials were passed directly to the API
and are not committed. Public r2.dev access is disabled and there are no custom
domains on the bucket. HTTP ingestion is disabled on the stream; only the Worker
binding can send. Add the returned stream ID as `GPS_ARCHIVE` in `wrangler.jsonc`
and deploy with `npm run worker:deploy`.

References: [Worker ingestion](https://developers.cloudflare.com/basin-pipelines/streams/writing-to-streams/),
[Parquet R2 sinks](https://developers.cloudflare.com/basin-pipelines/sinks/available-sinks/r2/),
[Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

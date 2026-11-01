// History shares the existing SQLite Durable Object; no separate database.
export const SAMPLE_INTERVAL_MS = 300_000;
const FRESH_MS = 60_000, MAX_PENDING = 100_000, BATCH_SIZE = 500;
const iso = value => value == null ? null : new Date(value).toISOString();

export function backgroundWindow(env, now = Date.now()) {
  const start = Date.parse(env.GPS_ARCHIVE_BACKGROUND_START);
  const until = Date.parse(env.GPS_ARCHIVE_BACKGROUND_UNTIL);
  // A redeploy never extends the trial. Invalid/unbounded settings fail closed.
  const configured = Number.isFinite(start) && Number.isFinite(until) && until > start && until - start <= 14 * 86400_000;
  return { active: configured && now >= start && now < until, start: configured ? iso(start) : null,
    until: configured ? iso(until) : null, intervalSeconds: SAMPLE_INTERVAL_MS / 1000 };
}

export class LocationArchive {
  constructor(storage, stream, { now = Date.now, log = entry => console.error(JSON.stringify(entry)) } = {}) {
    this.storage = storage; this.sql = storage.sql; this.stream = stream; this.now = now; this.log = log;
    this.sql.exec('CREATE TABLE IF NOT EXISTS location_outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS location_entities (entity TEXT PRIMARY KEY, signature TEXT NOT NULL, observed_ms INTEGER NOT NULL, seen_ms INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS location_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sending = null;
  }
  meta(key, fallback = null) { const row = [...this.sql.exec('SELECT value FROM location_meta WHERE key = ?', key)][0]; return row ? JSON.parse(row.value) : fallback; }
  setMeta(key, value) { this.sql.exec('INSERT OR REPLACE INTO location_meta VALUES (?, ?)', key, JSON.stringify(value)); }
  count() { return [...this.sql.exec('SELECT COUNT(*) AS n FROM location_outbox')][0].n; }
  async wake(delay = 1000) {
    const alarm = await this.storage.getAlarm();
    // New user traffic must not shorten a delivery-failure retry backoff.
    if (alarm == null) await this.storage.setAlarm(this.now() + delay);
  }
  async resume() { if (this.count()) await this.wake(); }
  reserveSample(source, scheduledTime) {
    const slot = Math.floor(scheduledTime / SAMPLE_INTERVAL_MS);
    const key = `sample:${source}`;
    if (!Number.isFinite(scheduledTime) || slot !== Math.floor(this.now() / SAMPLE_INTERVAL_MS) || slot <= this.meta(key, -1)) return false;
    this.storage.transactionSync(() => {
      this.setMeta(key, slot); // Reserve before upstream I/O, including cron retries.
      this.setMeta('lastBackgroundSampleAt', scheduledTime);
      this.setMeta('backgroundSamples', this.meta('backgroundSamples', 0) + 1);
    });
    return true;
  }
  async capture(snapshot, { source, reason = 'user' }) {
    const now = this.now(), rows = JSON.parse(snapshot.vehiclesBody).vehicles;
    const stats = this.meta('stats', { queued: 0, delivered: 0, user: 0, background: 0, duplicates: 0, rejected: 0 });
    const pending = this.count();
    if (pending + rows.length > MAX_PENDING) throw new Error('archive_outbox_capacity');
    this.storage.transactionSync(() => {
      for (const vehicle of rows) {
        const sourceFix = vehicle.fixAt ? Date.parse(vehicle.fixAt) : null;
        const observed = sourceFix ?? snapshot.observedAt;
        if (!Number.isFinite(observed) || now - observed > FRESH_MS || observed > now + 30_000 ||
          !Number.isFinite(vehicle.lon) || !Number.isFinite(vehicle.lat)) { stats.rejected++; continue; }
        const entity = `${source}:${vehicle.mode}:${vehicle.id}`;
        // Tallinn has no per-vehicle clock: suppress unchanged positions even
        // when other vehicles change the feed. Elron has genuine fix times.
        const signature = JSON.stringify([vehicle.lon, vehicle.lat, vehicle.route, sourceFix]);
        const previous = [...this.sql.exec('SELECT signature, observed_ms FROM location_entities WHERE entity = ?', entity)][0];
        if (previous && (previous.signature === signature || previous.observed_ms >= observed)) {
          this.sql.exec('UPDATE location_entities SET seen_ms = ? WHERE entity = ?', now, entity);
          stats.duplicates++; continue;
        }
        const eventId = JSON.stringify([1, entity, observed, vehicle.lon, vehicle.lat]);
        const record = { schema_version: 1, event_id: eventId, source, entity_id: String(vehicle.id), mode: vehicle.mode,
          route: String(vehicle.route ?? ''), headsign: vehicle.headsign || '', capture_reason: reason,
          collected_at_ms: now, observed_at_ms: observed, source_fix_at_ms: sourceFix,
          longitude: vehicle.lon, latitude: vehicle.lat, speed_kmh: vehicle.speed ?? null,
          speed_source: vehicle.speedSource ?? null, bearing_degrees: vehicle.bearing ?? null,
          bearing_source: vehicle.bearingSource ?? null };
        this.sql.exec('INSERT OR IGNORE INTO location_outbox VALUES (?, ?)', eventId, JSON.stringify(record));
        this.sql.exec('INSERT OR REPLACE INTO location_entities VALUES (?, ?, ?, ?)', entity, signature, observed, now);
        stats.queued++; stats[reason]++;
      }
      this.sql.exec('DELETE FROM location_entities WHERE seen_ms < ?', now - 7 * 86400_000);
      this.setMeta('stats', stats);
      this.setMeta('lastCaptureAt', now);
    });
    if (this.count()) await this.wake();
  }
  failure(error) {
    this.setMeta('lastError', { at: iso(this.now()), reason: String(error.message || error).slice(0, 160) });
    this.log({ event: 'gps_archive_error', ...this.meta('lastError'), pending: this.count() });
  }
  async flush() {
    if (this.sending) return this.sending;
    this.sending = this.deliver();
    try { await this.sending; } finally { this.sending = null; }
  }
  async deliver() {
    try {
      // Bound each alarm's work. The durable outbox survives eviction/failures.
      for (let batch = 0; batch < 8; batch++) {
        const rows = [...this.sql.exec('SELECT event_id, payload FROM location_outbox ORDER BY rowid LIMIT ?', BATCH_SIZE)];
        if (!rows.length) break;
        await this.stream.send(rows.map(row => JSON.parse(row.payload)));
        this.storage.transactionSync(() => {
          for (const row of rows) this.sql.exec('DELETE FROM location_outbox WHERE event_id = ?', row.event_id);
          const stats = this.meta('stats'); stats.delivered += rows.length; this.setMeta('stats', stats);
          this.setMeta('lastDeliveryAt', this.now()); this.setMeta('lastError', null);
        });
      }
    } catch (error) { this.failure(error); }
    // Explicit retry also after the platform's built-in alarm retries end.
    if (this.count()) await this.storage.setAlarm(this.now() + 60_000);
  }
  health() {
    const pending = this.count(), error = this.meta('lastError');
    const lastDelivery = this.meta('lastDeliveryAt');
    const lastCapture = this.meta('lastCaptureAt');
    const oldest = [...this.sql.exec('SELECT payload FROM location_outbox ORDER BY rowid LIMIT 1')][0];
    const oldestAt = oldest ? JSON.parse(oldest.payload).collected_at_ms : null;
    const overdue = oldestAt !== null && this.now() - oldestAt > 300_000;
    return { status: error || overdue ? 'degraded' : 'ok', pending, stats: this.meta('stats', {}),
      backgroundSamples: this.meta('backgroundSamples', 0), lastBackgroundSampleAt: iso(this.meta('lastBackgroundSampleAt')),
      oldestPendingAt: iso(oldestAt), lastCaptureAt: iso(lastCapture), lastDeliveryAt: iso(lastDelivery), lastError: error };
  }
}

export async function collectBackground(event, env, now = Date.now()) {
  if (!env.GPS_ARCHIVE || !backgroundWindow(env, now).active || !backgroundWindow(env, event.scheduledTime).active ||
    Math.floor(event.scheduledTime / SAMPLE_INTERVAL_MS) !== Math.floor(now / SAMPLE_INTERVAL_MS)) return;
  const results = await Promise.allSettled([
    ['tallinn-public-gps-v1', 'vehicles'], ['elron-public-gps-v1', 'trains'],
  ].map(async ([name, feed]) => {
    const stub = env.GPS_FEED.get(env.GPS_FEED.idFromName(name), { locationHint: 'eeur' });
    const response = await stub.fetch(`https://gps.internal/archive/background/${feed}`, {
      method: 'POST', headers: { 'X-Scheduled-Time': String(event.scheduledTime) },
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`background_${feed}_${response.status}`);
  }));
  for (const result of results) if (result.status === 'rejected') console.error(JSON.stringify({ event: 'gps_archive_sample_error', reason: result.reason.message }));
}

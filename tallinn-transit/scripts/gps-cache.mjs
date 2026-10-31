import { observeVehicles } from './vehicle-motion.mjs';
import { parseGPS } from '../src/transit.js';
import { dataStatus, dataHeaders, DATA_FRESH_SECONDS } from '../src/data-status.js';
// Shared, demand-driven feed: concurrent requests and failures obey the same cap.
export const GPS_TTL = 10;
export const GPS_UPSTREAM = 'https://transport.tallinn.ee/gps.txt?x=1';
export class FeedUnavailable extends Error {
  constructor(retryAfter = GPS_TTL, upstreamStatus, errorClass = 'invalid_response', reason = errorClass) {
    super('Sõidukite asukohad pole praegu kättesaadavad.');
    this.retryAfter = Math.max(1, retryAfter);
    this.upstreamStatus = upstreamStatus;
    this.errorClass = errorClass;
    this.reason = reason;
  }
}
export class GpsFeedCache {
  constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, storage, state,
    upstream = GPS_UPSTREAM, referer = 'https://transport.tallinn.ee/', parseVehicles, sourceObservation, storageKey = 'feed',
    log = entry => console[entry.outcome === 'error' ? 'error' : 'info'](JSON.stringify(entry)) } = {}) {
    this.fetcher = fetcher;
    this.now = now;
    this.storage = storage;
    this.upstream = upstream; this.referer = referer; this.parseVehicles = parseVehicles; this.storageKey = storageKey;
    this.sourceObservation = sourceObservation;
    this.log = log;
    this.state = state || { snapshot: null, nextAttemptAt: 0, upstreamRequests: 0 };
    this.pending = null;
  }
  async persist() { await this.storage?.put(this.storageKey, this.state); }
  latest() {
    if (!this.state.lastError) return this.state.snapshot;
    return this.state.snapshot ? { ...this.state.snapshot, upstreamError: this.state.lastError.errorClass,
      upstreamStatus: this.state.lastUpstreamStatus, upstreamRequests: this.state.upstreamRequests } : null;
  }
  health() {
    const snapshot = this.latest();
    return { ...dataStatus(snapshotTimestamp(snapshot), this.now(), this.state.lastError?.errorClass || null),
      validatedAt: snapshot ? new Date(snapshot.validatedAt).toISOString() : null,
      vehicleCount: snapshot?.vehicleCount ?? null,
      lastAttempt: this.state.lastAttempt || null };
  }
  fallback() {
    const snapshot = this.latest();
    if (snapshotStatus(snapshot, this.now()).status !== 'unavailable') return snapshot;
    const error = new FeedUnavailable(Math.ceil((this.state.nextAttemptAt - this.now()) / 1000),
      this.state.lastUpstreamStatus, this.state.lastError?.errorClass || null);
    error.snapshot = snapshot;
    throw error;
  }
  async get() {
    if (this.state.snapshot && this.now() < this.state.snapshot.validatedAt + GPS_TTL * 1000) return this.latest();
    if (this.pending) return this.pending;
    if (this.now() < this.state.nextAttemptAt) return this.fallback();
    this.pending = this.refresh();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async refresh() {
    const started = this.now(), previous = this.state.snapshot;
    this.state.nextAttemptAt = started + GPS_TTL * 1000;
    this.state.upstreamRequests++;
    // Persist before I/O: eviction or failure cannot bypass the global cap.
    this.state.lastUpstreamStatus = null;
    let phase = 'internal';
    try {
      await this.persist();
      const headers = { 'User-Agent': 'Mozilla/5.0', Referer: this.referer };
      if (previous?.upstreamEtag) headers['If-None-Match'] = previous.upstreamEtag;
      if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
      // Elron's live JSON currently advertises a two-week HTTP lifetime. Bypass
      // the fetch subrequest cache, while retaining validators and our 10 s cap.
      phase = 'fetch';
      const upstream = await this.fetcher(this.upstream, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      this.state.lastUpstreamStatus = upstream.status;
      let snapshot;
      if (upstream.status === 304 && previous) {
        snapshot = { ...previous, modified: upstream.headers.get('last-modified') || previous.modified,
          upstreamEtag: upstream.headers.get('etag') || previous.upstreamEtag };
      } else {
        if (!upstream.ok || upstream.status === 204) {
          await upstream.body?.cancel();
          throw new FeedUnavailable(GPS_TTL, upstream.status, upstream.status >= 500 ? 'upstream_5xx' : upstream.status >= 400 ? 'upstream_4xx' : 'invalid_response', `http_${upstream.status}`);
        }
        const body = await upstream.text();
        phase = 'parse';
        // An empty CSV is a valid empty observation; HTML/broken rows aren't.
        if (this.parseVehicles) this.parseVehicles(body, started);
        else if (body.trim()) parseGPS(body);
        phase = 'internal';
        const hash = await contentHash(body);
        snapshot = { body, etag: `W/"${hash}"`, upstreamEtag: upstream.headers.get('etag'), modified: upstream.headers.get('last-modified') };
      }
      phase = 'parse';
      const observation = this.sourceObservation?.(snapshot.body, started);
      phase = 'internal';
      // Append only genuine new source versions, never cache hits or HTTP 304.
      const sourceTime = observation?.timestamp ?? Date.parse(snapshot.modified);
      if (Number.isFinite(sourceTime) && sourceTime > started + 30000) throw new FeedUnavailable(GPS_TTL, upstream.status, 'invalid_response', 'future_source_timestamp');
      const changed = !previous || snapshot.etag !== previous.etag || snapshot.modified !== previous.modified;
      const observedAt = Number.isFinite(sourceTime) ? sourceTime : changed ? started : previous.observedAt ?? previous.validatedAt;
      snapshot.observedAt = observedAt;
      snapshot.emptyObservation = observation?.empty ?? !snapshot.body.trim();
      if (changed || !snapshot.vehiclesBody) {
        const motion = this.parseVehicles ? {vehicles:this.parseVehicles(snapshot.body,started)}
          : snapshot.body.trim() ? observeVehicles(snapshot.body, observedAt, this.state.motionHistory) : { vehicles: [], history: {} };
        if(motion.history)this.state.motionHistory = motion.history;
        snapshot.vehiclesBody = JSON.stringify({ version: 1, observedAt: new Date(observedAt).toISOString(), vehicles: motion.vehicles });
        snapshot.vehicleCount = motion.vehicles.length;
        snapshot.vehiclesEtag = `W/"${await contentHash(snapshot.vehiclesBody)}"`;
      }
      // A confirmed empty result has no locations to freeze. It remains an
      // available empty observation, including at night and on HTTP 304.
      if (snapshot.vehicleCount === 0 && snapshot.emptyObservation) snapshot.observedAt = started;
      // Freshness starts at the request, never when a downstream cache serves it.
      this.state.snapshot = { ...snapshot, validatedAt: started, upstreamRequests: this.state.upstreamRequests, upstreamStatus: upstream.status };
      delete this.state.snapshot.upstreamError;
      this.state.lastError = null;
      const empty = snapshot.vehicleCount === 0 && snapshot.emptyObservation;
      const expiredFixes = snapshot.vehicleCount === 0 && !snapshot.emptyObservation;
      this.state.lastAttempt = { at: new Date(started).toISOString(), outcome: empty ? 'empty' : expiredFixes ? 'stale' : 'success',
        errorClass: null, reason: empty ? 'empty_response' : expiredFixes ? 'expired_fixes' : null,
        upstreamStatus: upstream.status, durationMs: Math.max(0, this.now() - started) };
      await this.persist();
      if (snapshot.vehicleCount === 0) this.log({ event: 'gps_upstream', feed: this.storageKey, ...this.state.lastAttempt });
      return this.state.snapshot;
    } catch (error) {
      const errorClass = error instanceof FeedUnavailable ? error.errorClass
        : ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout'
        : phase === 'parse' ? 'invalid_response' : phase === 'fetch' ? 'network_error' : 'internal_error';
      const reason = error instanceof FeedUnavailable ? error.reason : errorClass === 'timeout' ? 'upstream_timeout'
        : phase === 'parse' ? error instanceof SyntaxError ? 'invalid_json' : 'invalid_vehicle_rows'
        : phase === 'fetch' ? 'fetch_failed' : 'storage_or_processing_failed';
      this.state.lastError = this.state.lastAttempt = { at: new Date(started).toISOString(), outcome: 'error', errorClass,
        reason, upstreamStatus: this.state.lastUpstreamStatus, durationMs: Math.max(0, this.now() - started) };
      this.log({ event: 'gps_upstream', feed: this.storageKey, ...this.state.lastAttempt });
      // A failed local persistence/processing step must not publish a new fix.
      this.state.snapshot = previous;
      try { await this.persist(); } catch { /* The original internal error is already logged. */ }
      // Never re-date old fixes on failure. The UI keeps its original fix age.
      return this.fallback();
    }
  }
}
function snapshotTimestamp(snapshot) {
  const modified = Date.parse(snapshot?.modified);
  return snapshot?.observedAt ?? (Number.isFinite(modified) ? modified : snapshot?.validatedAt);
}
export function snapshotStatus(snapshot, now = Date.now()) {
  return dataStatus(snapshotTimestamp(snapshot), now, snapshot?.upstreamError || null);
}
export async function contentHash(body) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function gpsResponse(snapshot, request, { now = Date.now(), cache = 'GLOBAL' } = {}) {
  const data = snapshotStatus(snapshot, now);
  if (data.status === 'unavailable') return gpsError({ snapshot }, request, { now });
  const enriched = /\/(vehicles|trains)$/.test(new URL(request.url).pathname);
  // An existing Durable Object may still hold a fresh pre-upgrade CSV snapshot.
  // Serve native fields immediately without bypassing its upstream rate limit.
  const initial = enriched && !snapshot.vehiclesBody && request.method !== 'HEAD' ? observeVehicles(snapshot.body, Date.parse(snapshot.modified) || snapshot.validatedAt).vehicles : null;
  const etag = enriched ? snapshot.vehiclesEtag || `W/"vehicles-${snapshot.etag.replace(/[^a-zA-Z0-9]/g,'')}"` : snapshot.etag;
  const body = enriched ? snapshot.vehiclesBody || JSON.stringify({version:1,vehicles:initial}) : snapshot.body;
  const headers = new Headers({
    'Content-Type': enriched ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': data.status === 'fresh' ? `public, max-age=${Math.min(GPS_TTL, DATA_FRESH_SECONDS + 1 - data.ageSeconds)}, s-maxage=${Math.min(GPS_TTL, DATA_FRESH_SECONDS + 1 - data.ageSeconds)}, must-revalidate` : 'no-store',
    ...dataHeaders(data),
    Date: new Date(snapshot.validatedAt).toUTCString(),
    Age: String(Math.max(0, Math.ceil((now - snapshot.validatedAt) / 1000))),
    ETag: etag,
    'X-GPS-Validated-At': new Date(snapshot.validatedAt).toISOString(),
    'X-GPS-Upstream-Requests': String(snapshot.upstreamRequests),
    ...(snapshot.upstreamStatus == null ? {} : { 'X-GPS-Upstream-Status': String(snapshot.upstreamStatus) }),
    'X-GPS-Cache': cache,
  });
  if (snapshot.modified) headers.set('Last-Modified', snapshot.modified);
  const noneMatch = request.headers.get('if-none-match');
  const since = Date.parse(request.headers.get('if-modified-since'));
  const modified = Date.parse(snapshot.modified);
  const unchanged = noneMatch ? noneMatch.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
    : !enriched && Number.isFinite(since) && Number.isFinite(modified) && modified <= since;
  return new Response(unchanged || request.method === 'HEAD' ? null : body, { status: unchanged ? 304 : 200, headers });
}
export function gpsError(error, request, { now = Date.now() } = {}) {
  const data = { ...snapshotStatus(error.snapshot, now), status: 'unavailable', upstreamError: error.errorClass || error.snapshot?.upstreamError || null };
  return new Response(request?.method === 'HEAD' ? null : 'Sõidukite asukohad pole praegu kättesaadavad.', { status: 503, headers: {
    ...dataHeaders(data),
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfter || GPS_TTL),
    ...(error.upstreamStatus ? { 'X-GPS-Upstream-Status': String(error.upstreamStatus) } : {}),
  } });
}

import { observeVehicles } from './vehicle-motion.mjs';
// Shared, demand-driven feed: concurrent requests and failures obey the same cap.
export const GPS_TTL = 10;
export const GPS_UPSTREAM = 'https://transport.tallinn.ee/gps.txt?x=1';
export class FeedUnavailable extends Error {
  constructor(retryAfter = GPS_TTL, upstreamStatus) {
    super('Sõidukite asukohad pole praegu kättesaadavad.');
    this.retryAfter = Math.max(1, retryAfter);
    this.upstreamStatus = upstreamStatus;
  }
}
export class GpsFeedCache {
  constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, storage, state } = {}) {
    this.fetcher = fetcher;
    this.now = now;
    this.storage = storage;
    this.state = state || { snapshot: null, nextAttemptAt: 0, upstreamRequests: 0 };
    this.pending = null;
  }
  async persist() { await this.storage?.put('feed', this.state); }
  async get() {
    if (this.state.snapshot && this.now() < this.state.snapshot.validatedAt + GPS_TTL * 1000) return this.state.snapshot;
    if (this.pending) return this.pending;
    if (this.now() < this.state.nextAttemptAt) throw new FeedUnavailable(Math.ceil((this.state.nextAttemptAt - this.now()) / 1000), this.state.lastUpstreamStatus);
    this.pending = this.refresh();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async refresh() {
    const started = this.now(), previous = this.state.snapshot;
    this.state.nextAttemptAt = started + GPS_TTL * 1000;
    this.state.upstreamRequests++;
    // Persist before I/O: eviction or failure cannot bypass the global cap.
    await this.persist();
    try {
      const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://transport.tallinn.ee/' };
      if (previous?.upstreamEtag) headers['If-None-Match'] = previous.upstreamEtag;
      if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
      const upstream = await this.fetcher(GPS_UPSTREAM, { headers, signal: AbortSignal.timeout(8000) });
      this.state.lastUpstreamStatus = upstream.status;
      let snapshot;
      if (upstream.status === 304 && previous) {
        snapshot = { ...previous, modified: upstream.headers.get('last-modified') || previous.modified,
          upstreamEtag: upstream.headers.get('etag') || previous.upstreamEtag };
      } else {
        if (!upstream.ok) { await upstream.body?.cancel(); throw new FeedUnavailable(); }
        const body = await upstream.text();
        if (!/^\d+,/.test(body.trim())) throw new FeedUnavailable();
        const hash = await contentHash(body);
        snapshot = { body, etag: `W/"${hash}"`, upstreamEtag: upstream.headers.get('etag'), modified: upstream.headers.get('last-modified') };
      }
      // Append only genuine new source versions, never cache hits or HTTP 304.
      const sourceTime = Date.parse(snapshot.modified);
      const observedAt = Number.isFinite(sourceTime) ? sourceTime : started;
      const changed = !previous || snapshot.etag !== previous.etag || snapshot.modified !== previous.modified;
      if (changed || !snapshot.vehiclesBody) {
        const motion = observeVehicles(snapshot.body, observedAt, this.state.motionHistory);
        this.state.motionHistory = motion.history;
        snapshot.vehiclesBody = JSON.stringify({ version: 1, observedAt: new Date(observedAt).toISOString(), vehicles: motion.vehicles });
        snapshot.vehiclesEtag = `W/"${await contentHash(snapshot.vehiclesBody)}"`;
      }
      // Freshness starts at the request, never when a downstream cache serves it.
      this.state.snapshot = { ...snapshot, validatedAt: started, upstreamRequests: this.state.upstreamRequests, upstreamStatus: upstream.status };
      await this.persist();
      return this.state.snapshot;
    } catch (error) {
      if (!(error instanceof FeedUnavailable)) console.error('GPS relay error:', error.name, error.message);
      await this.persist();
      // Never re-date old fixes on failure. The UI keeps its original fix age.
      throw new FeedUnavailable(Math.ceil((this.state.nextAttemptAt - this.now()) / 1000), this.state.lastUpstreamStatus || error.name);
    }
  }
}
export async function contentHash(body) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function gpsResponse(snapshot, request, { now = Date.now(), cache = 'GLOBAL' } = {}) {
  const enriched = new URL(request.url).pathname.endsWith('/vehicles');
  // An existing Durable Object may still hold a fresh pre-upgrade CSV snapshot.
  // Serve native fields immediately without bypassing its upstream rate limit.
  const initial = enriched && !snapshot.vehiclesBody ? observeVehicles(snapshot.body, Date.parse(snapshot.modified) || snapshot.validatedAt).vehicles : null;
  const etag = enriched ? snapshot.vehiclesEtag || `W/"vehicles-${snapshot.etag.replace(/[^a-zA-Z0-9]/g,'')}"` : snapshot.etag;
  const body = enriched ? snapshot.vehiclesBody || JSON.stringify({version:1,vehicles:initial}) : snapshot.body;
  const headers = new Headers({
    'Content-Type': enriched ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': `public, max-age=${GPS_TTL}, s-maxage=${GPS_TTL}, must-revalidate`,
    Date: new Date(snapshot.validatedAt).toUTCString(),
    Age: String(Math.max(0, Math.ceil((now - snapshot.validatedAt) / 1000))),
    ETag: etag,
    'X-GPS-Validated-At': new Date(snapshot.validatedAt).toISOString(),
    'X-GPS-Upstream-Requests': String(snapshot.upstreamRequests),
    'X-GPS-Upstream-Status': String(snapshot.upstreamStatus),
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
export function gpsError(error) {
  return new Response('Sõidukite asukohad pole praegu kättesaadavad.', { status: 503, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfter || GPS_TTL),
    ...(error.upstreamStatus ? { 'X-GPS-Upstream-Status': String(error.upstreamStatus) } : {}),
  } });
}

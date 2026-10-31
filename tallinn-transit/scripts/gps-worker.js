import { geocode } from './services.mjs';
import { GpsFeedCache, GPS_TTL, gpsResponse, gpsError } from './gps-cache.mjs';
import { ElronFeedCache } from './elron-feed.mjs';
import { healthResponse, jsonHealth, internalError } from './data-health.mjs';

// Cache API is POP-local. One named Durable Object caps upstream traffic globally.
export class GpsFeed {
  constructor(ctx) {
    ctx.blockConcurrencyWhile(async () => {
      this.feed = new GpsFeedCache({ storage: ctx.storage, state: await ctx.storage.get('feed') });
      this.trains = new ElronFeedCache({ storage: ctx.storage, state: await ctx.storage.get('elron') });
    });
  }
  async fetch(request) {
    const started = Date.now();
    const path = new URL(request.url).pathname;
    const feed = path.endsWith('/trains') ? this.trains : this.feed;
    try {
      if (path.startsWith('/health/data')) return jsonHealth(feed.health(), request);
      return gpsResponse(await feed.get(), request);
    } catch (error) {
      if (!error.retryAfter) { internalError('worker', started); error.errorClass = 'internal_error'; }
      return gpsError(error, request);
    }
  }
}

export async function handleRequest(request, env, ctx, edgeCache = globalThis.caches?.default) {
  const started = Date.now();
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return new Response('Origin not allowed', { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin' } });
  const cors = { Vary: 'Origin',
    'Access-Control-Expose-Headers': 'CF-Cache-Status, Last-Modified, ETag, Age, Date, Retry-After, X-GPS-Validated-At, X-GPS-Upstream-Requests, X-GPS-Upstream-Status, X-GPS-Cache, X-Data-Status, X-Data-Timestamp, X-Data-Age, X-Upstream-Error',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
  const reply = response => {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  };
  const url = new URL(request.url);
  if (!['/gps', '/api/gps', '/geocode', '/api/geocode', '/vehicles', '/api/vehicles', '/trains', '/api/trains', '/health/live', '/health/data', '/api/health/live', '/api/health/data'].includes(url.pathname)) return reply(new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }));
  if (request.method === 'OPTIONS') return reply(new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'If-None-Match, If-Modified-Since', 'Access-Control-Max-Age': '86400',
  } }));
  if (!['GET', 'HEAD'].includes(request.method)) return reply(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' } }));
  if (url.pathname.endsWith('/health/live')) return reply(jsonHealth({ status: 'ok' }, request));
  if (url.pathname.endsWith('/health/data')) {
    const sources = Object.fromEntries(await Promise.all([
      ['tallinn', 'tallinn-public-gps-v1', '/health/data'],
      ['elron', 'elron-public-gps-v1', '/health/data/trains'],
    ].map(async ([name, object, path]) => {
      try {
        const response = await env.GPS_FEED.get(env.GPS_FEED.idFromName(object), { locationHint: 'eeur' }).fetch(`https://gps.internal${path}`);
        if (!response.ok) throw new Error('Health state unavailable');
        const state = await response.json();
        if (!['fresh', 'stale', 'unavailable'].includes(state.status)) throw new Error('Invalid health state');
        return [name, state];
      } catch { return [name, internalError(name, started)]; }
    })));
    return reply(healthResponse(sources, request));
  }
  if (url.pathname.endsWith('/geocode')) {
    try {
      const body = JSON.stringify(await geocode(url.searchParams.get('q')));
      return reply(new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }));
    } catch { return reply(Response.json({ error: 'Aadressiotsing pole saadaval.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })); }
  }
  // No query strings, conditionals or Origin in this key. CORS follows lookup.
  const trains = url.pathname.endsWith('/trains');
  const enriched = trains || url.pathname.endsWith('/vehicles');
  const key = new Request(`${url.origin}/__gps_feed_v4${trains?'-trains':enriched?'-vehicles':''}`);
  try {
    let raw = await edgeCache?.match(key);
    let cached = false;
    if (raw) {
      const at = Date.parse(raw.headers.get('X-GPS-Validated-At'));
      if (Number.isFinite(at) && Date.now() < at + GPS_TTL * 1000) cached = true;
      else raw = null;
    }
    if (!raw) {
      const id = env.GPS_FEED.idFromName(trains?'elron-public-gps-v1':'tallinn-public-gps-v1');
      raw = await env.GPS_FEED.get(id, { locationHint: 'eeur' }).fetch(`https://gps.internal/${trains?'trains':enriched?'vehicles':'gps'}`);
      if (raw.ok && raw.headers.get('X-Data-Status') === 'fresh' && edgeCache) {
        const remaining = Math.floor((Date.parse(raw.headers.get('X-GPS-Validated-At')) + GPS_TTL * 1000 - Date.now()) / 1000);
        if (remaining > 0) {
          const headers = new Headers(raw.headers);
          headers.set('Cache-Control', `public, max-age=${Math.min(remaining, Number(/max-age=(\d+)/.exec(headers.get('Cache-Control'))?.[1]) || remaining)}, must-revalidate`);
          headers.set('Date', new Date().toUTCString());
          headers.delete('Age');
          ctx.waitUntil(edgeCache.put(key, new Response(raw.clone().body, { headers })));
        }
      }
    }
    if (!raw.ok) return reply(new Response(request.method === 'HEAD' ? null : raw.body, { status: raw.status, headers: raw.headers }));
    const snapshot = { body: request.method === 'HEAD' ? '' : await raw.text(), etag: raw.headers.get('ETag'), modified: raw.headers.get('Last-Modified'),
      validatedAt: Date.parse(raw.headers.get('X-GPS-Validated-At')), observedAt: Date.parse(raw.headers.get('X-Data-Timestamp')),
      upstreamError: raw.headers.get('X-Upstream-Error') === 'none' ? null : raw.headers.get('X-Upstream-Error'),
      upstreamRequests: Number(raw.headers.get('X-GPS-Upstream-Requests')), upstreamStatus: raw.headers.has('X-GPS-Upstream-Status') ? Number(raw.headers.get('X-GPS-Upstream-Status')) : null };
    if(enriched){snapshot.vehiclesBody=snapshot.body;snapshot.vehiclesEtag=snapshot.etag;}
    return reply(gpsResponse(snapshot, request, { cache: cached ? 'EDGE' : 'GLOBAL' }));
  } catch {
    internalError('worker', started);
    return reply(gpsError({ errorClass: 'internal_error' }, request));
  }
}
export default { fetch: handleRequest };

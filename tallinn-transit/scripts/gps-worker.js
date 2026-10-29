import { geocode } from './services.mjs';
import { GpsFeedCache, GPS_TTL, gpsResponse, gpsError } from './gps-cache.mjs';
import { ElronFeedCache } from './elron-feed.mjs';

// Cache API is POP-local. One named Durable Object caps upstream traffic globally.
export class GpsFeed {
  constructor(ctx) {
    ctx.blockConcurrencyWhile(async () => {
      this.feed = new GpsFeedCache({ storage: ctx.storage, state: await ctx.storage.get('feed') });
      this.trains = new ElronFeedCache({ storage: ctx.storage, state: await ctx.storage.get('elron') });
    });
  }
  async fetch(request) {
    try { return gpsResponse(await (new URL(request.url).pathname.endsWith('/trains')?this.trains:this.feed).get(), request); }
    catch (error) { return gpsError(error); }
  }
}

export async function handleRequest(request, env, ctx, edgeCache = globalThis.caches?.default) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return new Response('Origin not allowed', { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin' } });
  const cors = { Vary: 'Origin',
    'Access-Control-Expose-Headers': 'CF-Cache-Status, Last-Modified, ETag, Age, Date, Retry-After, X-GPS-Validated-At, X-GPS-Upstream-Requests, X-GPS-Upstream-Status, X-GPS-Cache',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
  const reply = response => {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  };
  const url = new URL(request.url);
  if (!['/gps', '/api/gps', '/geocode', '/api/geocode', '/vehicles', '/api/vehicles', '/trains', '/api/trains'].includes(url.pathname)) return reply(new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }));
  if (request.method === 'OPTIONS') return reply(new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'If-None-Match, If-Modified-Since', 'Access-Control-Max-Age': '86400',
  } }));
  if (!['GET', 'HEAD'].includes(request.method)) return reply(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' } }));
  if (url.pathname.endsWith('/geocode')) {
    try {
      const body = JSON.stringify(await geocode(url.searchParams.get('q')));
      return reply(new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }));
    } catch { return reply(Response.json({ error: 'Aadressiotsing pole saadaval.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })); }
  }
  // No query strings, conditionals or Origin in this key. CORS follows lookup.
  const trains = url.pathname.endsWith('/trains');
  const enriched = trains || url.pathname.endsWith('/vehicles');
  const key = new Request(`${url.origin}/__gps_feed_v3${trains?'-trains':enriched?'-vehicles':''}`);
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
    if (raw.ok && edgeCache) {
      const remaining = Math.floor((Date.parse(raw.headers.get('X-GPS-Validated-At')) + GPS_TTL * 1000 - Date.now()) / 1000);
      if (remaining > 0) {
        const headers = new Headers(raw.headers);
        headers.set('Cache-Control', `public, max-age=${remaining}, must-revalidate`);
        headers.set('Date', new Date().toUTCString());
        headers.delete('Age');
        ctx.waitUntil(edgeCache.put(key, new Response(raw.clone().body, { headers })));
      }
    }
  }
  if (!raw.ok) return reply(raw);
  const snapshot = { body: request.method === 'HEAD' ? '' : await raw.text(), etag: raw.headers.get('ETag'), modified: raw.headers.get('Last-Modified'),
    validatedAt: Date.parse(raw.headers.get('X-GPS-Validated-At')), upstreamRequests: Number(raw.headers.get('X-GPS-Upstream-Requests')), upstreamStatus: Number(raw.headers.get('X-GPS-Upstream-Status')) };
  if(enriched){snapshot.vehiclesBody=snapshot.body;snapshot.vehiclesEtag=snapshot.etag;}
  return reply(gpsResponse(snapshot, request, { cache: cached ? 'EDGE' : 'GLOBAL' }));
}
export default { fetch: handleRequest };

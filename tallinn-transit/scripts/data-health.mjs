import { dataStatus } from '../src/data-status.js';

export const HEALTH_HEADERS = { 'Cache-Control': 'no-store' };
export function healthResponse(sources, request) {
  const statuses = Object.values(sources).map(source => source.status);
  const status = statuses.includes('unavailable') ? 'unavailable' : statuses.includes('stale') ? 'stale' : 'fresh';
  return jsonHealth({ status, sources }, request, status === 'fresh' ? 200 : 503);
}
export function jsonHealth(body, request, status = 200) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    status, headers: { ...HEALTH_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
export function internalError(feed = 'worker', started = Date.now()) {
  console.error(JSON.stringify({ event: 'worker_internal_error', feed, errorClass: 'internal_error', reason: 'internal_error', durationMs: Math.max(0, Date.now() - started) }));
  return dataStatus(undefined, Date.now(), 'internal_error');
}

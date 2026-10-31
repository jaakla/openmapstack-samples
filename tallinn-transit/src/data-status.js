export const DATA_FRESH_SECONDS = 60;
export const DATA_MAX_SECONDS = 180;

// The source/observation timestamp survives cache hits, 304s and failures.
export function dataStatus(timestamp, now = Date.now(), upstreamError = null) {
  const at = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  const ageSeconds = Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : null;
  return {
    status: ageSeconds === null || ageSeconds > DATA_MAX_SECONDS ? 'unavailable'
      : upstreamError || ageSeconds > DATA_FRESH_SECONDS ? 'stale' : 'fresh',
    timestamp: Number.isFinite(at) ? new Date(at).toISOString() : null,
    ageSeconds,
    upstreamError,
  };
}

export function dataHeaders(data) {
  return {
    'X-Data-Status': data.status,
    'X-Data-Timestamp': data.timestamp || '',
    'X-Data-Age': data.ageSeconds === null ? '' : String(data.ageSeconds),
    'X-Upstream-Error': data.upstreamError || 'none',
  };
}

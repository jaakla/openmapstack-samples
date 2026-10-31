import { dataStatus, DATA_MAX_SECONDS } from './data-status.js';
import { gpsValidatedAt } from './transit.js';

export function liveMetadata(headers, now = Date.now()) {
  const fetchedAt = gpsValidatedAt(headers, now);
  const stamp = Date.parse(headers.get('X-Data-Timestamp'));
  const modified = Date.parse(headers.get('Last-Modified'));
  const reportedAge = Number(headers.get('X-Data-Age'));
  const dataAt = Number.isFinite(stamp) ? stamp : Number.isFinite(modified) ? modified
    : headers.get('X-Data-Age') && Number.isFinite(reportedAge) ? now - Math.max(0, reportedAge) * 1000 : fetchedAt;
  const upstream = headers.get('X-Upstream-Error');
  return { fetchedAt, dataAt, modifiedAt: Number.isFinite(modified) ? modified : null,
    serverStatus: headers.get('X-Data-Status'), upstreamError: upstream && upstream !== 'none' ? upstream : null };
}

export function liveDataState(state, now = Date.now()) {
  const age = state.fetchedAt === null ? null : Math.max(0, Math.floor((now - state.fetchedAt) / 1000));
  const data = dataStatus(state.dataAt, now, state.upstreamError || (state.error ? 'network_error' : null));
  const status = state.serverStatus === 'unavailable' || age === null || age > DATA_MAX_SECONDS ? 'unavailable'
    : state.serverStatus === 'stale' && data.status === 'fresh' ? 'stale' : data.status;
  return { ...state, status, age, sourceAge: data.ageSeconds, dataAge: data.ageSeconds,
    stale: status !== 'fresh', expired: status === 'unavailable',
    vehicles: status === 'unavailable' ? [] : state.vehicles.filter(v => !v.fixAt ||
      (Number.isFinite(Date.parse(v.fixAt)) && now - Date.parse(v.fixAt) <= DATA_MAX_SECONDS * 1000)) };
}

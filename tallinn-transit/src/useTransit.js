import { useEffect, useRef, useState, useCallback } from 'react';
import { asset, registerOffline } from './offline.js';
import { parseGPS, gpsValidatedAt, cleanVehicle } from './transit.js';

export function useNetwork() {
  const [state, setState] = useState({ data: null, shapes: null, project: null, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    async function get(path) {
      const response = await fetch(asset(path), { signal: controller.signal });
      if (!response.ok) throw new Error('Andmepaketti ei õnnestunud laadida. Ühenda seade korraks internetti.');
      return response.json();
    }
    Promise.all([get('data/network.json'), get('data/routes.geojson'), get('data/project.json'),get('data/walk-network.json')])
      .then(([data, shapes, project,walking]) => setState({ data, shapes, project,walking, error: '' }))
      .catch(error => { if (!controller.signal.aborted) setState(s => ({ ...s, error: error.message })); });
    registerOffline().catch(() => {});
    return () => controller.abort();
  }, []);
  return state;
}

export function useRouter(data,walking) {
  const worker = useRef(null), pending = useRef(new Map()), sequence = useRef(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!data || !walking) return;
    const w = new Worker(new URL('./router.worker.js', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data: message }) => {
      const job = pending.current.get(message.id);
      if (job) { pending.current.delete(message.id); message.error ? job.reject(new Error(message.error)) : job.resolve(message.result); }
    };
    w.onerror = () => {
      for (const job of pending.current.values()) job.reject(new Error('Teekonna arvutamine peatus. Laadi leht uuesti.'));
      pending.current.clear(); setReady(false);
    };
    const id = ++sequence.current;
    pending.current.set(id, { resolve: () => setReady(true), reject: () => {} });
    w.postMessage({ id, type: 'init', data,walking });
    return () => { w.terminate(); worker.current = null; setReady(false); pending.current.clear(); };
  }, [data,walking]);
  const request = useCallback(message => new Promise((resolve, reject) => {
    if (!worker.current) { reject(new Error('Sõiduplaani laadimine on veel pooleli.')); return; }
    const id = ++sequence.current;
    pending.current.set(id, { resolve, reject });
    worker.current.postMessage({ ...message, id });
  }), []);
  return { ready, request };
}

export function useLive(paused, endpoint,enabled=true) {
  const [state, setState] = useState({ vehicles: [], fetchedAt: null, modifiedAt: null, error: '', loading: true });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if(!enabled)return;const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [enabled]);
  useEffect(() => {
    if(!enabled){setState({vehicles:[],fetchedAt:null,modifiedAt:null,error:'',loading:false});return;}
    if (paused) return;
    let cancelled = false, timer;
    const controller = new AbortController();
    async function poll() {
      if (document.visibilityState === 'hidden' || !navigator.onLine) { timer = setTimeout(poll, 10000); return; }
      try {
        const response = await fetch(endpoint, { cache: 'default', credentials: 'omit', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (!response.ok) throw new Error('Sõidukite asukohti ei õnnestunud uuendada.');
        const json=response.headers.get('content-type')?.includes('application/json');
        const vehicles=json?(await response.json()).vehicles.map(v=>cleanVehicle(v)):parseGPS(await response.text());
        const modifiedAt = Date.parse(response.headers.get('last-modified'));
        if (!cancelled) {setNow(Date.now());setState({ vehicles, fetchedAt: gpsValidatedAt(response.headers), modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null, error: '', loading: false });}
      } catch (error) {
        if (!cancelled) setState(s => ({ ...s, error:'Sõidukite asukohad pole praegu kättesaadavad. Sõiduplaan töötab edasi.', loading: false }));
      }
      if (!cancelled) timer = setTimeout(poll, 10000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [paused, endpoint,enabled]);
  const age = state.fetchedAt ? Math.max(0, Math.floor((now - state.fetchedAt) / 1000)) : null;
  const sourceAge = state.modifiedAt ? Math.max(0, Math.floor((now - state.modifiedAt) / 1000)) : null;
  return { ...state, age, sourceAge, stale: age === null || age > 45 || (sourceAge !== null && sourceAge > 60), expired: age === null || age > 180 || (sourceAge !== null && sourceAge > 180) };
}

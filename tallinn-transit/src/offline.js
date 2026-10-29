const BASE = import.meta.env.BASE_URL;
export const asset = path => `${BASE}${path}`;
// Production (including GitHub Pages) uses the deployed relay. Development
// keeps Vite's local proxy; VITE_API_BASE_URL can override either deployment.
const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD
  ? 'https://tallinn-transit-api.jaak-laineste.workers.dev/' : `${BASE}api/`);
export const api = path => `${API_BASE}${path}`;
export async function registerOffline() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    await navigator.serviceWorker.register(asset('sw.js'), { scope: BASE });
    await navigator.serviceWorker.ready;
  }
}
export async function downloadOffline(onProgress) {
  if (!('caches' in window)) throw new Error('Võrguühenduseta režiim vajab HTTPS-i või localhosti.');
  await registerOffline();
  if (!navigator.serviceWorker?.controller) await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Võrguühenduseta režiimi seadistamine on pooleli. Proovi hetk hiljem uuesti.')),5000);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
  });
  const manifest = await fetch(asset('offline-manifest.json')).then(r => {
    if (!r.ok) throw new Error('Allalaaditava andmepaketi kirjeldus pole saadaval.');
    return r.json();
  });
  const cache = await caches.open(manifest.cache);
  const entries = manifest.files;
  for (let i = 0; i < entries.length; i++) {
    const url = asset(entries[i]);
    // Full PMTiles response is retained; the service worker serves byte ranges.
    if (!(await cache.match(url))) {
      const response = await fetch(url, { cache: 'reload', headers: { 'X-Tallinn-Offline-Download': '1' } });
      if (!response.ok) throw new Error('Andmepaketi salvestamine katkes. Proovi internetiühendusega uuesti.');
      await cache.put(url, response);
    }
    onProgress(Math.round((i + 1) / entries.length * 100));
  }
  await cache.put(asset('__offline_complete__'), new Response(new Date().toISOString()));
  for (const name of await caches.keys()) {
    if (name.startsWith('tallinn-transit-') && name !== manifest.cache) await caches.delete(name);
  }
  localStorage.setItem('tallinn-offline', JSON.stringify({ cache: manifest.cache, at: new Date().toISOString() }));
  return manifest;
}
export async function setOfflineMode(offline) {
  localStorage.setItem('tallinn-mode',offline?'offline':'online');
  if(!navigator.serviceWorker?.controller)return;
  await new Promise(resolve=>{
    const channel=new MessageChannel(),timer=setTimeout(resolve,3000);
    channel.port1.onmessage=()=>{clearTimeout(timer);resolve();};
    navigator.serviceWorker.controller.postMessage({type:'SET_MODE',mode:offline?'offline':'online'},[channel.port2]);
  });
}

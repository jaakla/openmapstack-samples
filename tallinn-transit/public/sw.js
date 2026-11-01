const modeURL=new URL('__mode__',self.registration.scope).href;
const scopeURL=new URL(self.registration.scope);
async function saveMode(mode, recovered=false){
  const cache=await caches.open('tallinn-mode-state');await cache.put(modeURL,new Response(mode));
  if(recovered)for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'MODE_RECOVERED',mode});
}
async function readMode(){
  const saved=await (await caches.open('tallinn-mode-state')).match(modeURL);
  if(!saved||await saved.text()!=='offline')return 'online';
  // Browser eviction can remove a pack while leaving its separate mode cache.
  const index=new URL('index.html',self.registration.scope).href;
  if(await cachedResponse(new Request(index)))return 'offline';
  await saveMode('online',true);return 'online';
}
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{await readMode();await self.clients.claim();})()));
self.addEventListener('message',event=>{
  if(event.data?.type==='SET_MODE')event.waitUntil((async()=>{
    await saveMode(event.data.mode==='offline'?'offline':'online');
    event.ports[0]?.postMessage({ok:true});
  })());
  if(event.data?.type==='GET_MODE')event.waitUntil((async()=>{event.ports[0]?.postMessage({mode:await readMode()});})());
});
async function cachedResponse(req) {
  const names=(await caches.keys()).filter(n=>n.startsWith('tallinn-transit-'));
  for(const name of names.reverse()){
    const cache=await caches.open(name);
    if(!(await cache.match(new URL('__offline_complete__',self.registration.scope).href)))continue;
    const hit=await cache.match(req.url)||(req.mode==='navigate'?await cache.match(new URL('index.html',self.registration.scope).href):null);
    if(!hit)continue;
    const range=req.headers.get('range');if(!range)return hit;
    const bytes=await hit.arrayBuffer(),match=/^bytes=(\d+)-(\d*)$/.exec(range);
    if(!match)return new Response(null,{status:416});
    const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):bytes.byteLength-1,bytes.byteLength-1);
    if(start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.byteLength}`}});
    return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':hit.headers.get('Content-Type')||'application/octet-stream','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.byteLength}`}});
  }
  return null;
}
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||req.headers.has('X-Tallinn-Offline-Download')||url.origin!==scopeURL.origin||!url.pathname.startsWith(scopeURL.pathname))return;
  event.respondWith((async()=>{
    if(req.mode==='navigate'&&url.searchParams.get('online')==='1')await saveMode('online',true);
    const offline=await readMode()==='offline';
    if(url.pathname.includes('/api/'))return offline?new Response('Võrguühenduseta režiim',{status:503}):fetch(req);
    if(offline){
      const hit=await cachedResponse(req);if(hit)return hit;
      // A partially evicted pack must not block its worker scripts or tiles
      // when the network can supply the missing file.
      try{const response=await fetch(req);if(response.ok)await saveMode('online',true);return response;}catch{ /* show recovery below */ }
    }else{
      try{const response=await fetch(req);if(response.ok)return response;return await cachedResponse(req)||response;}catch{ /* fall back to complete saved pack */ }
      const hit=await cachedResponse(req);if(hit)return hit;
    }
    if(req.mode==='navigate')return new Response(`<!doctype html><html lang="et"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tallinn liigub · taasta ühendus</title><body><h1>Võrguta andmepakett puudub.</h1><p>Ühenda seade internetti ja ava rakendus uuesti veebirežiimis.</p><a href="${scopeURL.pathname}?online=1">Ava veebirežiimis</a></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    return new Response('Andmefail pole võrguta saadaval. Taasta internetiühendus.',{status:503,headers:{'Cache-Control':'no-store'}});
  })());
});

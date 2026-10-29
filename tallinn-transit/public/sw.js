const modeURL=new URL('__mode__',self.registration.scope).href;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type==='SET_MODE')event.waitUntil((async()=>{
    const cache=await caches.open('tallinn-mode-state');await cache.put(modeURL,new Response(event.data.mode));
    event.ports[0]?.postMessage({ok:true});
  })());
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
  if(req.method!=='GET'||req.headers.has('X-Tallinn-Offline-Download')||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const mode=await (await caches.open('tallinn-mode-state')).match(modeURL);
    const offline=mode&&await mode.text()==='offline';
    if(url.pathname.includes('/api/'))return offline?new Response('Võrguühenduseta režiim',{status:503}):fetch(req);
    if(!offline){try{const r=await fetch(req);if(r.ok)return r;}catch{ /* fall back to complete saved pack */ }}
    return await cachedResponse(req)||new Response('Võrguühenduseta andmepakett puudub.',{status:503});
  })());
});

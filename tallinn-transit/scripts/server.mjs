import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geocode } from './services.mjs';
import { GpsFeedCache, gpsResponse, gpsError } from './gps-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 5177);
const gps = new GpsFeedCache();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.css':'text/css','.svg':'image/svg+xml','.pbf':'application/x-protobuf','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.md':'text/markdown; charset=utf-8','.yaml':'text/yaml; charset=utf-8','.pmtiles':'application/octet-stream'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/geocode'){
    try{const items=await geocode(url.searchParams.get('q'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(items));}
    catch(e){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message}));}return;
  }
  if(url.pathname==='/api/gps'||url.pathname==='/api/vehicles'){
    let response;
    try { response = gpsResponse(await gps.get(), new Request(url, { method: req.method, headers: req.headers })); }
    catch (error) { response = gpsError(error); }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === 'HEAD' ? undefined : await response.text()); return;
  }
  let decoded;
  try{decoded=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  let stat;try{stat=fs.statSync(file);}catch{res.writeHead(404);res.end('Not found');return;}
  if(!stat.isFile()){res.writeHead(404);res.end();return;}
  const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
  const range=req.headers.range;
  if(range){
    const match=/^bytes=(\d+)-(\d*)$/.exec(range);
    const start=match?Number(match[1]):-1,end=match?Math.min(match[2]?Number(match[2]):stat.size-1,stat.size-1):-1;
    if(start<0||start>end){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
    res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`});
    if(req.method==='HEAD')res.end();else fs.createReadStream(file,{start,end}).pipe(res);
  }else{
    res.writeHead(200,{...headers,'Content-Length':stat.size});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`Tallinn liigub: http://127.0.0.1:${port}`));

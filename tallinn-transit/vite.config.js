import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { geocode } from './scripts/services.mjs';
import { GpsFeedCache, gpsResponse, gpsError } from './scripts/gps-cache.mjs';
const feed=new GpsFeedCache();

// Fixed public GPS and In-ADS endpoints; journey calculations stay in the browser.
export default defineConfig({
  base: './',
  plugins: [react(),{name:'tallinn-address-search',configureServer(server){
    for(const endpoint of ['/api/gps','/api/vehicles'])server.middlewares.use(endpoint,async(req,res)=>{
      let response;try{response=gpsResponse(await feed.get(),new Request(`http://localhost${endpoint}`,{method:req.method,headers:req.headers}));}catch(error){response=gpsError(error);}
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?undefined:await response.text());
    });
    server.middlewares.use('/api/geocode',async(req,res)=>{
    try{const q=new URL(req.url,'http://localhost').searchParams.get('q');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(await geocode(q)));}
    catch(e){res.statusCode=502;res.end(JSON.stringify({error:e.message}));}
  });}}],
});

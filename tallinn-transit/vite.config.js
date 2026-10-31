import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
import { geocode } from './scripts/services.mjs';
import { GpsFeedCache, gpsResponse, gpsError } from './scripts/gps-cache.mjs';
import { ElronFeedCache } from './scripts/elron-feed.mjs';
import { healthResponse, jsonHealth } from './scripts/data-health.mjs';
const feed=new GpsFeedCache(),trains=new ElronFeedCache();

// Fixed public GPS and In-ADS endpoints; journey calculations stay in the browser.
export default defineConfig({
  base: './',
  plugins: [react(),analyticsPlugin('tallinn-transit', 'cdd722ab5ded9b55fa614e9969cf46922da66db1e52aeee949e8930ca9db5b07'),{name:'tallinn-address-search',configureServer(server){
    for(const endpoint of ['/health/live','/health/data','/api/health/live','/api/health/data'])server.middlewares.use(endpoint,async(req,res)=>{
      const request=new Request(`http://localhost${endpoint}`,{method:req.method});
      const response=endpoint.endsWith('/live')?jsonHealth({status:'ok'},request):healthResponse({tallinn:feed.health(),elron:trains.health()},request);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    });
    for(const endpoint of ['/api/gps','/api/vehicles','/api/trains'])server.middlewares.use(endpoint,async(req,res)=>{
      let response;try{response=gpsResponse(await (endpoint.endsWith('/trains')?trains:feed).get(),new Request(`http://localhost${endpoint}`,{method:req.method,headers:req.headers}));}catch(error){response=gpsError(error,new Request(`http://localhost${endpoint}`,{method:req.method}));}
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?undefined:await response.text());
    });
    server.middlewares.use('/api/geocode',async(req,res)=>{
    try{const q=new URL(req.url,'http://localhost').searchParams.get('q');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(await geocode(q)));}
    catch(e){res.statusCode=502;res.end(JSON.stringify({error:e.message}));}
  });}}],
});

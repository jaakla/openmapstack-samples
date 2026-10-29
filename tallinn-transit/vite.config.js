import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { geocode } from './scripts/services.mjs';

// Fixed public GPS and In-ADS endpoints; journey calculations stay in the browser.
export default defineConfig({
  base: './',
  plugins: [react(),{name:'tallinn-address-search',configureServer(server){server.middlewares.use('/api/geocode',async(req,res)=>{
    try{const q=new URL(req.url,'http://localhost').searchParams.get('q');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(await geocode(q)));}
    catch(e){res.statusCode=502;res.end(JSON.stringify({error:e.message}));}
  });}}],
  server: {
    proxy: {
      '/api/gps': {
        target: 'https://transport.tallinn.ee',
        changeOrigin: true,
        rewrite: () => '/gps.txt?x=1',
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://transport.tallinn.ee/' },
      },
    },
  },
});

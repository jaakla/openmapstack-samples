import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function publicationAttribution(){
  return {name:'publication-attribution',transformIndexHtml(html){
    const atlas=JSON.parse(readFileSync(new URL('./public/data/atlas.json',import.meta.url),'utf8'));
    const project=atlas.project;
    if(!project)throw new Error('Publication metadata is missing. Run npm run data before building.');
    const p=Object.fromEntries(Object.entries(project).map(([key,value])=>[key,typeof value==='string'?escapeHTML(value):value]));
    const city=atlas.sources.city_model,maa=atlas.sources.lidar_588541,photo=atlas.sources.orthophoto,osm=atlas.sources.place_labels;
    const footer=`<footer id="project-attribution" class="publication-credit" aria-label="Project and data attribution">
      <div class="publication-line"><span><a href="mailto:${escapeHTML(project.author.email)}">${escapeHTML(project.author.name)}</a> · ${escapeHTML(project.author.email)}</span><span class="publication-status">${p.status} · Updated <time datetime="${p.updated_at}">${p.updated_at.slice(0,10)}</time></span><span>Generated with <a href="${escapeHTML(project.generated_with.url)}" target="_blank" rel="noreferrer">${escapeHTML(project.generated_with.tool)}</a></span></div>
      <div class="publication-sources"><span>City of Tallinn · Tallinn_vanalinn_2020 · 2020 survey · extracted ${escapeHTML(city.access.retrieved_at.slice(0,10))} · <a href="${escapeHTML(city.license.url)}" target="_blank" rel="noreferrer">Tallinn spatial-data license</a></span><span>Maa- ja Ruumiamet · 2023 airborne LiDAR · EESTIFOTO extracted ${escapeHTML(photo.access.retrieved_at.slice(0,10))} · <a href="${escapeHTML(maa.license.url)}" target="_blank" rel="noreferrer">Source terms</a> · © <a href="${escapeHTML(osm.license.url)}" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a></span></div>
    </footer>`;
    return {html:html.replace('</body>',footer+'</body>'),tags:[
      {tag:'meta',attrs:{name:'author',content:project.author.name}},
      {tag:'meta',attrs:{name:'generator',content:project.generated_with.tool}},
      {tag:'meta',attrs:{name:'dcterms.modified',content:project.updated_at}},
      {tag:'meta',attrs:{name:'publication-status',content:project.status}},
      {tag:'script',attrs:{id:'project-metadata',type:'application/json'},children:JSON.stringify(project).replace(/</g,'\\u003c')}
    ]};
  }};
}
export default defineConfig({
  base:'./',
  plugins:[react(),publicationAttribution()],
  server:{host:'0.0.0.0'},
  build:{
    chunkSizeWarningLimit:900,
    rollupOptions:{output:{manualChunks:{three:['three','three/addons/controls/OrbitControls.js']}}}
  }
});

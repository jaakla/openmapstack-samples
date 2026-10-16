import {intersectSection,sectionFrame} from './survey-tools.js';
let buildings,terrain,terrainIndices;
self.onmessage=({data})=>{
  if(data.type==='init'){buildings=new Float32Array(data.buildings);terrain=new Float32Array(data.terrain);terrainIndices=new Uint32Array(data.terrainIndices);return;}
  if(data.type!=='section'||!buildings||!terrain)return;
  const frame=sectionFrame(data.bearing,data.offset),b=intersectSection(buildings,frame),t=intersectSection(terrain,frame,terrainIndices);
  self.postMessage({id:data.id,buildings:b,terrain:t},[b.coordinates.buffer,b.profile.buffer,t.coordinates.buffer,t.profile.buffer]);
};

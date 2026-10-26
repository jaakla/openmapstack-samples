import {useEffect,useRef} from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {vectorStyle,useColor} from './mapStyles';
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
const classicWorker = workerSource.replace(/export\{[^}]+\};\s*(?=\/\/# sourceMappingURL|$)/, '');
maplibregl.setWorkerUrl(location.protocol === 'file:'
 ? 'data:text/javascript;charset=utf-8,' + encodeURIComponent(classicWorker) + '#.cjs'
 : URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'})));

export const imageUrl = name => window.__DP_IMAGES__?.[name] || `${import.meta.env.BASE_URL}data/${name}`;
const localImages = new Map();
function localAluskaartUrl(name){
 const encoded=window.__DP_IMAGES__?.[name];
 if(!encoded)return imageUrl(name);
 if(!localImages.has(name)){const binary=atob(encoded.split(',')[1]);localImages.set(name,URL.createObjectURL(new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'image/png'})));}
 return localImages.get(name);
}
const groupLayers={proposal:['surfaces','planned-3d','boundary'],existing:['existing-footprints','existing-3d'],plots:['plots','plot-lines','pos-labels'],drawing:['drawing'],context:['context-fill','context-line'],utilities:['utility-lines'],relations:['relation-lines','relation-points','relation-labels']};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const visible=(map,id,value)=>{if(map.getLayoutProperty(id,'visibility')!==value)map.setLayoutProperty(id,'visibility',value);};
const paint=(map,id,key,value)=>{if(!same(map.getPaintProperty(id,key),value))map.setPaintProperty(id,key,value);};
const filter=(map,id,value)=>{if(!same(map.getFilter(id),value))map.setFilter(id,value);};
function syncRelief(map,model,state){
 const b=map.getBounds(),[west,south,east,north]=model.terrain.bounds;
 const available=map.getZoom()>=model.terrain.zoom&&b.getWest()>=west&&b.getSouth()>=south&&b.getEast()<=east&&b.getNorth()<=north;
 const active=state.terrain&&available;
 if(Boolean(map.getTerrain())!==active)map.setTerrain(active?{source:'dem',exaggeration:1}:null);
 paint(map,'planned-3d','fill-extrusion-height',['get',active?'terrain_top_m':'height_m']);
 paint(map,'planned-3d','fill-extrusion-base',active?['get','terrain_base_m']:0);
 return available;
}
export default function MapView({model,state,onSelect,onReady,onError,onCamera,onBasemapError,onTerrainStatus}){
 const host=useRef(null),mapRef=useRef(null),current=useRef(state);current.current=state;
 useEffect(()=>{
  let disposed=false;
  maplibregl.addProtocol('localdem',async request=>{
   const key='terrain/'+request.url.replace('localdem://','');
   const response=await fetch(imageUrl(key));if(!response.ok)throw new Error('Reljeefiandmeid ei õnnestunud laadida');return {data:await response.arrayBuffer()};
  });
  let map;
  async function initialize(){
  const style=await vectorStyle(model,current.current.dark);if(disposed)return;
  map=new maplibregl.Map({container:host.current,locale:{'Map.Title':'Kaart','NavigationControl.ZoomIn':'Suurenda','NavigationControl.ZoomOut':'Vähenda','NavigationControl.ResetBearing':'Lohista kaardi pööramiseks; klõpsa põhjasuuna taastamiseks','AttributionControl.ToggleAttribution':'Näita või peida allikaviited','AttributionControl.MapFeedback':'Tagasiside kaardi kohta','Popup.Close':'Sulge hüpikaken','Marker.Title':'Kaardimarker','TerrainControl.Enable':'Näita reljeefi','TerrainControl.Disable':'Peida reljeef','CooperativeGesturesHandler.WindowsHelpText':'Kaardi suumimiseks hoia all Ctrl-klahvi ja keri','CooperativeGesturesHandler.MacHelpText':'Kaardi suumimiseks hoia all ⌘-klahvi ja keri','CooperativeGesturesHandler.MobileHelpText':'Kaardi liigutamiseks kasuta kahte sõrme'},style,center:model.center,zoom:16.5,pitch:56,bearing:-32,maxPitch:75,maxZoom:20,minZoom:13,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true},attributionControl:false});
  mapRef.current=map;window.__DP_MAP__=map;
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:120,unit:'metric'}),'bottom-left');
  map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'© OpenStreetMap contributors, Protomaps tiles by goplex.ee · Maa- ja Ruumiamet · Planeering: AB Artes Terrae OÜ / Tartu Linnavalitsus'}),'bottom-right');
  window.__DP_MAP_ERRORS__=[];
  map.on('error',event=>{if(disposed)return;window.__DP_MAP_ERRORS__.push({source:event.sourceId,message:event.error?.message});if(event.sourceId?.startsWith('base-'))onBasemapError();else onError('Kaardikihti ei õnnestunud laadida. Proovi leht uuesti avada.');});
  map.touchPitch.enable();
  let drag=null;
  const canvas=map.getCanvas();
  canvas.addEventListener('pointerdown',e=>{if(current.current.dragMode!=='rotate'||e.button!==0||e.pointerType==='touch')return;drag={x:e.clientX,y:e.clientY,bearing:map.getBearing(),pitch:map.getPitch()};canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();},true);
  canvas.addEventListener('pointermove',e=>{if(!drag)return;map.jumpTo({bearing:drag.bearing+(e.clientX-drag.x)*.4,pitch:Math.max(0,Math.min(70,drag.pitch-(e.clientY-drag.y)*.3))});e.preventDefault();e.stopImmediatePropagation();},true);
  const finishDrag=()=>{if(drag){drag=null;onCamera(map.getPitch(),map.getBearing());}};
  canvas.addEventListener('pointerup',finishDrag);canvas.addEventListener('pointercancel',finishDrag);
  map.on('moveend',event=>{if(map.getLayer('planned-3d'))onTerrainStatus(syncRelief(map,model,current.current));if(!drag&&event.originalEvent)onCamera(map.getPitch(),map.getBearing());});
  map.on('load',()=>{
   for(const [id,raster] of Object.entries(model.rasters))map.addSource(id,{type:'image',url:id==='basemap'?localAluskaartUrl(raster.url):imageUrl(raster.url),coordinates:raster.coordinates});
   map.addLayer({id:'basemap',type:'raster',source:'basemap',layout:{visibility:'none'},paint:{'raster-opacity':.46,'raster-fade-duration':0}});
   map.addLayer({id:'aerial',type:'raster',source:'aerial',layout:{visibility:'none'},paint:{'raster-fade-duration':0}});
   for(const [id,data] of Object.entries(model.datasets))map.addSource(id,{type:'geojson',data,promoteId:'id'});
   map.addSource('dem',{type:'raster-dem',tiles:['localdem://{z}/{x}/{y}.png'],tileSize:256,minzoom:14,maxzoom:14,bounds:model.terrain.bounds,encoding:'mapbox'});
   map.addLayer({id:'context-fill',type:'fill',source:'context',paint:{'fill-color':'#879679','fill-opacity':.055}});
   map.addLayer({id:'context-line',type:'line',source:'context',paint:{'line-color':'#767d72','line-width':1.5,'line-dasharray':[4,4]}});
   map.addLayer({id:'plots',type:'fill',source:'plots',paint:{'fill-color':useColor(3),'fill-opacity':.82}});
   map.addLayer({id:'plot-lines',type:'line',source:'plots',paint:{'line-color':useColor(2),'line-width':1.2}});
   map.addLayer({id:'surfaces',type:'fill',source:'surfaces',paint:{'fill-color':'#cbcac4','fill-opacity':.95}});
   map.addLayer({id:'drawing',type:'raster',source:'drawing',layout:{visibility:'none'},paint:{'raster-opacity':.7,'raster-fade-duration':0}});
   map.addLayer({id:'existing-footprints',type:'fill',source:'existing',paint:{'fill-color':'#a4aaa8','fill-opacity':.6}});
   map.addLayer({id:'existing-3d',type:'fill-extrusion',source:'existing',filter:['>', ['coalesce',['get','height_m'],0],0],paint:{'fill-extrusion-color':'#b1b6b3','fill-extrusion-height':['get','height_m'],'fill-extrusion-opacity':1}});
   map.addLayer({id:'planned-3d',type:'fill-extrusion',source:'planned',paint:{'fill-extrusion-color':useColor(2),'fill-extrusion-height':['get','terrain_top_m'],'fill-extrusion-base':['get','terrain_base_m'],'fill-extrusion-opacity':1}});
   map.addLayer({id:'boundary',type:'line',source:'boundary',paint:{'line-color':'#a4513c','line-width':2,'line-dasharray':[3,2]}});
   map.addLayer({id:'pos-labels',type:'symbol',source:'plots',minzoom:15.5,layout:{'text-field':['concat','POS ',['to-string',['get','pos']]],'text-font':['Noto Sans Regular'],'text-size':11,'text-allow-overlap':false},paint:{'text-color':'#38423c','text-halo-color':'#ffffff','text-halo-width':1.4}});
   map.addLayer({id:'utility-lines',type:'line',source:'utilities',layout:{visibility:'none','line-join':'round','line-cap':'round'},paint:{'line-color':['get','color'],'line-width':['case',['in',['get','category'],['literal',['servitude','protection']]],1,2.6],'line-opacity':.95}});
   map.addLayer({id:'relation-lines',type:'line',source:'relations',filter:['==',['geometry-type'],'LineString'],layout:{visibility:'none'},paint:{'line-color':['get','color'],'line-width':['case',['==',['get','category'],'parcel_context'],.8,2.5],'line-opacity':.85}});
   map.addLayer({id:'relation-points',type:'circle',source:'relations',filter:['==',['geometry-type'],'Point'],layout:{visibility:'none'},paint:{'circle-radius':['case',['==',['get','category'],'bus_stop'],9,3],'circle-color':'#466ba2','circle-stroke-color':'#fff','circle-stroke-width':1.5}});
   map.addLayer({id:'relation-labels',type:'symbol',source:'relations',filter:['==',['geometry-type'],'Point'],layout:{visibility:'none','text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':['case',['==',['get','category'],'bus_stop'],12,11],'text-max-width':17,'text-offset':['case',['==',['get','category'],'bus_stop'],['literal',[0,0]],['literal',[0,1.4]]]},paint:{'text-color':['case',['==',['get','category'],'bus_stop'],'#fff','#36547e'],'text-halo-color':'#fff','text-halo-width':['case',['==',['get','category'],'bus_stop'],0,1.8]}});
   map.addSource('selection',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
   map.addLayer({id:'selected-outline',type:'line',source:'selection',paint:{'line-color':'#a13f25','line-width':3}});
   map.setTerrain({source:'dem',exaggeration:1});
   map.fitBounds(model.plan_bounds,{padding:70,bearing:-32,pitch:56,duration:0,maxZoom:17.2});
   map.setZoom(map.getZoom()+.25);
   map.on('click',e=>{
    if(current.current.dragMode==='rotate')return;
    const features=map.queryRenderedFeatures(e.point,{layers:['utility-lines','relation-points','relation-labels','relation-lines','planned-3d','existing-3d','plots','existing-footprints']});
    const f=features[0];if(f){const source=f.source;const original=model.datasets[source]?.features.find(x=>x.properties.id===f.properties.id);if(original){map.getSource('selection').setData({type:'FeatureCollection',features:[original]});onSelect({...original.properties,sourceLayer:source});}}
    else {map.getSource('selection').setData({type:'FeatureCollection',features:[]});onSelect(null);}
   });
   map.on('mousemove',e=>{map.getCanvas().style.cursor=map.queryRenderedFeatures(e.point,{layers:['planned-3d','existing-3d','plots']}).length?'pointer':'';});
   onReady(map);
  });
  const resize=new ResizeObserver(()=>map.resize());resize.observe(host.current);map.on('remove',()=>resize.disconnect());
  }
  initialize().catch(()=>onError('Kaardi käivitamine ebaõnnestus. Laadi leht uuesti.'));
  return ()=>{disposed=true;map?.remove();maplibregl.removeProtocol('localdem');delete window.__DP_MAP__;};
 },[model]);
 useEffect(()=>{
  const map=mapRef.current;if(!map?.getLayer('planned-3d'))return;
  for(const [group,layers] of Object.entries(groupLayers))for(const id of layers){
   const proposed=['proposal','plots','drawing','utilities'].includes(group);
   visible(map,id,state.layers[group]&&(!proposed||state.mode==='proposal')?'visible':'none');
  }
  paint(map,'drawing','raster-opacity',state.opacity/100);
  for(const layer of map.getStyle().layers.filter(l=>l.id.startsWith('base-'))){const tone=state.dark?'base-dark-':'base-light-';visible(map,layer.id,state.basemap==='osm'&&layer.id.startsWith(tone)?'visible':'none');}
  visible(map,'basemap',state.basemap==='map'?'visible':'none');
  filter(map,'utility-lines',['in',['get','category'],['literal',state.utilityTypes]]);
  filter(map,'relation-lines',['all',['==',['geometry-type'],'LineString'],['in',['get','category'],['literal',state.relationTypes]]]);
  for(const id of ['relation-points','relation-labels'])filter(map,id,['all',['==',['geometry-type'],'Point'],['in',['get','category'],['literal',state.relationTypes]]]);
  state.dragMode==='rotate'?map.dragPan.disable():map.dragPan.enable();
  visible(map,'aerial',state.basemap==='aerial'?'visible':'none');
  paint(map,'basemap','raster-opacity',state.dark?.28:.46);

  onTerrainStatus(syncRelief(map,model,state));
  if(Math.abs(map.getPitch()-state.pitch)>.1||Math.abs(((map.getBearing()-state.bearing+540)%360)-180)>.1)map.easeTo({pitch:state.pitch,bearing:state.bearing,duration:180});
 },[state,model]);
 return <div ref={host} id="map" data-testid="map" aria-label="Idaringtee 21 ja ümbruskonna interaktiivne 3D-kaart"/>;
}

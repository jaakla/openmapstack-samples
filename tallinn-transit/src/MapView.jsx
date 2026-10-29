import { memo, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { LocateFixed, RotateCcw } from 'lucide-react';
import { asset } from './offline.js';
import { cleanVehicle } from './transit.js';
import 'maplibre-gl/dist/maplibre-gl.css';

const protocol = new Protocol();
maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.addProtocol('pmtiles', protocol.tile);
const empty = () => ({ type: 'FeatureCollection', features: [] });
const feature = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
function markerImage(color) {
  const c = document.createElement('canvas'); c.width = 80; c.height = 54;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.strokeStyle = 'white'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(3, 3, 74, 44, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(33, 47); ctx.lineTo(40, 54); ctx.lineTo(47, 47); ctx.fill();
  return ctx.getImageData(0, 0, 80, 54);
}
function nearestIndex(points, stop, min = 0) {
  let best = Infinity, index = min;
  for (let i = min; i < points.length; i++) {
    const d = (points[i][0] - stop.lon) ** 2 * 0.26 + (points[i][1] - stop.lat) ** 2;
    if (d < best) { best = d; index = i; }
  }
  return index;
}
export default memo(function MapView({ data, shapes, theme, layers, route, journey, inspection, nearbyPaths, vehicles, stale, onInspect, onUsePoint,onCloseInspect, onMapReady }) {
  const host = useRef(null), instance = useRef(null), popup=useRef(null),generation=useRef(0),fitted=useRef(null),callbacks = useRef({});
  callbacks.current = {onInspect,onUsePoint,onCloseInspect,onMapReady};
  const [loaded, setLoaded] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const map = new maplibregl.Map({ container: host.current, style: { version:8,sources:{},layers:[] },locale:{'NavigationControl.ZoomIn':'Suurenda','NavigationControl.ZoomOut':'Vähenda','AttributionControl.ToggleAttribution':'Kaardi allikad'},
      center:[24.745,59.435], zoom:12, minZoom:9, maxZoom:18,
      maxBounds:[[24.43,59.26],[25.06,59.59]], attributionControl:false });
    map.addControl(new maplibregl.AttributionControl({ compact:true }));
    map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth:110 }), 'bottom-left');
    map.on('click', e => {
      const ids=['vehicles','vehicle-points','stops','stations'].filter(id=>map.getLayer(id));
      const hit=map.queryRenderedFeatures(e.point,{layers:ids})[0];
      if(hit?.layer.id==='vehicles'||hit?.layer.id==='vehicle-points')callbacks.current.onInspect({...cleanVehicle(hit.properties),kind:'vehicle',lon:hit.geometry.coordinates[0],lat:hit.geometry.coordinates[1]});
      else if(hit?.layer.id==='stops'){
        const stop=data.stops[Number(hit.properties.index)];callbacks.current.onInspect({...data.stations.find(s=>s.id===stop.stationId),kind:'station'});
      }else if(hit?.layer.id==='stations')callbacks.current.onInspect({...data.stations.find(s=>s.id===hit.properties.id),kind:'station'});
      else {
        const label=map.queryRenderedFeatures(e.point).find(f=>f.properties?.name)?.properties.name;
        callbacks.current.onInspect({kind:'point',lon:e.lngLat.lng,lat:e.lngLat.lat,name:typeof label==='string'?label:'Valitud asukoht'});
      }
    });
    for (const id of ['stops','stations','vehicles','vehicle-points']) {
      map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
    }
    map.on('error', event => {
      if (!event.error?.message?.includes('abort')) setError('Osa kaardiandmeid jäi laadimata. Sõiduplaan töötab edasi.');
    });
    instance.current = map;
    host.current.__tallinnMap=map;
    return () => { instance.current = null; map.remove(); };
  }, []);
  useEffect(() => {
    const map = instance.current;
    if (!map) return;
    let alive = true;
    const current=++generation.current;setError('');
    fetch(asset(`map/${theme}.json`)).then(r => { if (!r.ok) throw new Error('Kaardi stiil ei ole saadaval.'); return r.json(); }).then(style => {
      if (!alive) return;
      style.sources.protomaps.url = `pmtiles://${new URL(asset('map/tallinn.pmtiles'), location.href).href}`;
      style.glyphs = `${new URL(asset('map/fonts/'), location.href).href}{fontstack}/{range}.pbf`;
      style.sprite = new URL(asset(`map/sprites/${theme}`), location.href).href;
      map.once('style.load', () => {
        if (!alive||current!==generation.current) return;
        // MapLibre can retain custom images while diffing styles. Reuse them;
        // adding the same image again emits an error during each theme change.
        if(!map.hasImage('bus-marker'))map.addImage('bus-marker', markerImage('#0866ed'), {pixelRatio:2});
        if(!map.hasImage('tram-marker'))map.addImage('tram-marker', markerImage('#e45d46'), {pixelRatio:2});
        for (const name of ['routes','stops','stations','vehicles','journey','selection','endpoints','nearby']) map.addSource(name,{type:'geojson',data:empty()});
        map.addLayer({id:'nearby-walks',type:'line',source:'nearby',paint:{'line-color':theme==='dark'?'#bac9d8':'#596f85','line-width':3,'line-opacity':0.5,'line-dasharray':[1,1]}});
        map.addLayer({id:'network',type:'line',source:'routes',paint:{'line-color':['match',['get','mode'],'tram','#e45d46','#0866ed'],'line-width':2,'line-opacity':0.3}});
        map.addLayer({id:'route-highlight',type:'line',source:'routes',filter:['==',['get','route'],-1],paint:{'line-color':['match',['get','mode'],'tram','#e45d46','#0866ed'],'line-width':5,'line-opacity':0.85}});
        map.addLayer({id:'journey-halo',type:'line',source:'journey',paint:{'line-color':'white','line-width':10},layout:{'line-cap':'round','line-join':'round'}});
        map.addLayer({id:'journey-line',type:'line',source:'journey',filter:['==',['get','type'],'ride'],paint:{'line-color':['match',['get','mode'],'tram','#e45d46','#0866ed'],'line-width':6},layout:{'line-cap':'round','line-join':'round'}});
        map.addLayer({id:'walk-line',type:'line',source:'journey',filter:['==',['get','type'],'walk'],paint:{'line-color':'#707a89','line-width':4,'line-dasharray':[1,1]}});
        map.addLayer({id:'stations',type:'circle',source:'stations',maxzoom:15,paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,2,14,5],'circle-color':theme==='dark'?'#192635':'#fff','circle-stroke-color':theme==='dark'?'#adc2d8':'#6b8199','circle-stroke-width':1.5}});
        map.addLayer({id:'stops',type:'circle',source:'stops',minzoom:15,paint:{'circle-radius':5,'circle-color':theme==='dark'?'#192635':'#fff','circle-stroke-color':theme==='dark'?'#adc2d8':'#6b8199','circle-stroke-width':1.5}});
        map.addLayer({id:'stop-labels',type:'symbol',source:'stops',minzoom:15,layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':11,'text-anchor':'top','text-offset':[0,0.65]},paint:{'text-color':theme==='dark'?'#e4edf5':'#435366','text-halo-color':theme==='dark'?'#192635':'#fff','text-halo-width':1.5}});
        map.addLayer({id:'vehicle-points',type:'circle',source:'vehicles',paint:{'circle-radius':3,'circle-color':['match',['get','mode'],'tram','#e45d46','#0866ed'],'circle-stroke-color':'white','circle-stroke-width':1}});
        map.addLayer({id:'vehicles',type:'symbol',source:'vehicles',layout:{'icon-image':['match',['get','mode'],'tram','tram-marker','bus-marker'],'icon-allow-overlap':false,'text-field':['get','route'],'text-font':['Noto Sans Medium'],'text-size':12,'text-allow-overlap':false,'text-offset':[0,-0.17]},paint:{'text-color':'#fff'}});
        map.addLayer({id:'journey-labels',type:'symbol',source:'journey',filter:['==',['get','type'],'ride'],layout:{'symbol-placement':'line','symbol-spacing':180,'text-field':['get','lineLabel'],'text-font':['Noto Sans Medium'],'text-size':14,'text-padding':6,'text-keep-upright':true},paint:{'text-color':['match',['get','mode'],'tram','#c7422c','#0057ce'],'text-halo-color':theme==='dark'?'#182432':'#fff','text-halo-width':4}});
        map.addLayer({id:'endpoint-points',type:'circle',source:'endpoints',paint:{'circle-radius':8,'circle-color':'#fff','circle-stroke-color':'#0866ed','circle-stroke-width':4}});
        map.addLayer({id:'endpoint-labels',type:'symbol',source:'endpoints',layout:{'text-field':['get','name'],'text-font':['Noto Sans Medium'],'text-size':14,'text-anchor':'bottom-left','text-offset':[0.7,-0.7],'text-allow-overlap':true},paint:{'text-color':theme==='dark'?'#fff':'#162639','text-halo-color':theme==='dark'?'#15202c':'#fff','text-halo-width':3}});
        map.addLayer({id:'selected-stop',type:'circle',source:'selection',paint:{'circle-radius':9,'circle-color':'#fff','circle-stroke-color':'#0866ed','circle-stroke-width':4}});
        map.addLayer({id:'selected-label',type:'symbol',source:'selection',layout:{'text-field':['get','name'],'text-font':['Noto Sans Medium'],'text-size':13,'text-offset':[0,1.4],'text-allow-overlap':true},paint:{'text-color':theme==='dark'?'#fff':'#162639','text-halo-color':theme==='dark'?'#15202c':'#fff','text-halo-width':2}});
        setLoaded(x => x + 1); callbacks.current.onMapReady?.();
      });
      map.setStyle(style);
    }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [theme]);
  useEffect(() => {
    const map = instance.current;
    if (!loaded || !map?.getSource('routes')) return;
    map.getSource('routes').setData(shapes);
    map.getSource('stops').setData({ type:'FeatureCollection',features:data.stops.map((s,i) => feature([s.lon,s.lat],{index:i,name:s.name})) });
    map.getSource('stations').setData({type:'FeatureCollection',features:data.stations.map(s=>feature([s.lon,s.lat],{id:s.id,name:s.name}))});
  }, [loaded,data,shapes]);
  useEffect(() => {
    const map = instance.current;
    if (!loaded || !map?.getLayer('network')) return;
    map.setLayoutProperty('network','visibility',layers.routes?'visible':'none');
    map.setFilter('network',['in',['get','mode'],['literal',['bus','tram'].filter(m=>layers[m])]]);
    map.setLayoutProperty('stops','visibility',layers.stops?'visible':'none');
    map.setLayoutProperty('stations','visibility',layers.stops?'visible':'none');
    map.setLayoutProperty('stop-labels','visibility',layers.stops?'visible':'none');
    map.setFilter('route-highlight', ['==',['get','route'],route ?? -1]);
    const visible = vehicles.filter(v => layers[v.mode] && (route === null || v.route === data.routes[route]?.name));
    map.getSource('vehicles').setData({type:'FeatureCollection',features:visible.map(v => feature([v.lon,v.lat],v))});
    map.setPaintProperty('vehicles','icon-opacity',stale?0.42:1);
    map.setPaintProperty('vehicles','text-opacity',stale?0.65:1);
    map.setPaintProperty('vehicle-points','circle-opacity',stale?0.42:1);
  }, [loaded,layers,route,vehicles,stale,data]);
  useEffect(() => {
    const map = instance.current;
    if (!loaded || !map?.getSource('selection')) return;
    const s = inspection?.kind==='station'?inspection:null;
    map.getSource('selection').setData({type:'FeatureCollection',features:s?[feature([s.lon,s.lat],{name:s.name})]:[]});
    if (inspection?.focus) map.easeTo({center:[inspection.lon,inspection.lat],zoom:Math.max(14,map.getZoom()),duration:500});
  },[loaded,inspection,data]);
  useEffect(() => {
    const map = instance.current;
    if (!loaded || !map?.getSource('journey')) return;
    const features = [];
    for (const leg of journey?.legs || []) {
      const from = data.stops[leg.from], to = data.stops[leg.to];
      let coordinates = leg.coordinates || (from&&to?[[from.lon,from.lat],[to.lon,to.lat]]:[]);
      if (leg.type==='ride') {
        const shape = shapes.features.find(s => s.id === leg.shape)?.geometry.coordinates;
        if (shape) {
          const a = nearestIndex(shape,from), b = nearestIndex(shape,to,a);
          coordinates = [[from.lon,from.lat],...shape.slice(a,b+1),[to.lon,to.lat]];
        }
      }
      if(coordinates.length>1)features.push({type:'Feature',properties:{type:leg.type,mode:leg.type==='ride'?data.routes[leg.route].mode:'walk',lineLabel:leg.type==='ride'?`Liin ${data.routes[leg.route].name}`:''},geometry:{type:'LineString',coordinates}});
    }
    map.getSource('journey').setData({type:'FeatureCollection',features});
    const endpoints = journey?.legs.length ? [journey.fromPlace||data.stops[journey.legs[0].from],journey.toPlace||data.stops[journey.legs.at(-1).to]].filter(Boolean) : [];
    map.getSource('endpoints').setData({type:'FeatureCollection',features:endpoints.map(s=>feature([s.lon,s.lat],{name:s.name}))});
    const points = features.flatMap(f => f.geometry.coordinates);
    if (points.length&&fitted.current!==journey) {
      fitted.current=journey;
      const bounds = points.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(points[0],points[0]));
      map.fitBounds(bounds,{padding:{top:125,bottom:85,left:45,right:45},maxZoom:14,duration:700});
    }
  },[loaded,journey,shapes,data]);
  useEffect(()=>{
    const map=instance.current;if(!map?.getSource('nearby'))return;
    map.getSource('nearby').setData({type:'FeatureCollection',features:(nearbyPaths||[]).filter(p=>p.coordinates?.length>1).map(p=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:p.coordinates}}))});
  },[loaded,nearbyPaths]);
  useEffect(()=>{
    const map=instance.current;popup.current?.remove();popup.current=null;
    if(!inspection||!map)return;
    const box=document.createElement('div');box.className='map-inspection';
    box.addEventListener('click',e=>e.stopPropagation());
    const heading=document.createElement('h3');heading.textContent=inspection.kind==='vehicle'?`${inspection.mode==='tram'?'Tramm':'Buss'} ${inspection.route}`:inspection.name;box.append(heading);
    const text=value=>{if(!value)return;const p=document.createElement('p');p.textContent=value;box.append(p);};
    if(inspection.kind==='vehicle'){
      const v=cleanVehicle(inspection);if(v.headsign)text(`Suund: ${v.headsign}`);if(v.id)text(`Sõiduk ${v.id}`);if(v.speed!==null&&v.speed>=0)text(`${v.speed} km/h`);
    }else{
      if(inspection.kind==='station')text('Peatuse väljumised ja teekonna valikud');
      else text(`${inspection.lat.toFixed(5)}, ${inspection.lon.toFixed(5)}`);
      const row=document.createElement('div');row.className='popup-actions';
      for(const [label,end] of [['Teekond siit','from'],['Teekond siia','to']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.className=end==='to'?'primary':'secondary';button.onclick=()=>callbacks.current.onUsePoint(inspection,end);row.append(button);
      }box.append(row);
      if(nearbyPaths?.length){
        const title=document.createElement('h4');title.textContent='Jalgsi ligipääsetavad peatused';box.append(title);
        const list=document.createElement('ul');
        for(const p of nearbyPaths){const li=document.createElement('li');const station=data.stations.find(s=>s.id===data.stops[p.stop].stationId);li.textContent=`${station?.name||data.stops[p.stop].name} · ${p.metres} m · ${Math.ceil(p.seconds/60)} min`;list.append(li);}box.append(list);
      }
    }
    const pp=new maplibregl.Popup({closeButton:true,closeOnClick:false,maxWidth:'330px',offset:12}).setLngLat([inspection.lon,inspection.lat]).setDOMContent(box).addTo(map);
    pp.getElement().querySelector('.maplibregl-popup-close-button')?.setAttribute('aria-label','Sulge kaardiinfo');
    let removing=false;pp.on('close',()=>{if(!removing)callbacks.current.onCloseInspect?.();});
    popup.current=pp;
    return()=>{removing=true;pp.remove();};
  },[inspection,nearbyPaths,data]);
  useEffect(() => {
    const map = instance.current;
    if (!loaded || route === null || journey) return;
    const points = shapes.features.filter(f=>f.properties.route===route).flatMap(f=>f.geometry.coordinates);
    if (points.length) map.fitBounds(points.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(points[0],points[0])),{padding:70,maxZoom:14});
  },[loaded,route,shapes,journey]);
  return <div className="map-wrapper">
    <div ref={host} className="map-canvas" aria-label="Tallinna ühistranspordi kaart" role="region" />
    {error ? <div className="map-error" role="status">{error}</div> : null}
    <div className="map-extra-controls">
      <button title="Minu asukoht" aria-label="Minu asukoht" onClick={()=>{
        navigator.geolocation?.getCurrentPosition(p=>{
          const [lon,lat]=[p.coords.longitude,p.coords.latitude];
          if (lon<24.43||lon>25.06||lat<59.26||lat>59.59) {setError('Sinu asukoht jääb Tallinna kaardi ulatusest välja.');return;}
          instance.current?.flyTo({center:[lon,lat],zoom:15});
          callbacks.current.onInspect({kind:'point',lon,lat,name:'Minu asukoht'});
        },()=>setError('Asukohta ei õnnestunud määrata. Vali koht kaardilt või otsingust.'));
      }}><LocateFixed size={20}/></button>
      <button title="Kogu Tallinn" aria-label="Kogu Tallinn" onClick={()=>instance.current?.flyTo({center:[24.745,59.435],zoom:12})}><RotateCcw size={18}/></button>
    </div>
  </div>;
});

import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Controls} from './Controls.jsx';
import Provenance from './Provenance.jsx';
import './styles.css';

const INITIAL_LAYERS = {red:true,yellow:true,green:true,buildings:true,vegetation:true,roads:true,predictions:true};
const ZONES = ['UNKNOWN','GREEN','YELLOW','RED'];
async function load() {
  const base = import.meta.env.BASE_URL;
  const get = async path => { const response=await fetch(`${base}${path}`); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response; };
  const config = await (await get('data/scene.json')).json();
  const [dtm,dsm,scenario,provenance,{VisibilityScene}] = await Promise.all([
    get('data/dtm.bin').then(r=>r.arrayBuffer()), get('data/dsm.bin').then(r=>r.arrayBuffer()),
    get('data/scenario.json').then(r=>r.json()), get('data/provenance.json').then(r=>r.json()), import('./scene.js')]);
  return {config,grid:{...config.grid,dtm:new Uint16Array(dtm),dsm:new Uint16Array(dsm)},scenario,provenance,VisibilityScene};
}

function App() {
  const [data,setData]=useState(null),[error,setError]=useState(''),[tab,setTab]=useState('simulation');
  const [settings,setSettings]=useState(null),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [layers,setLayers]=useState(INITIAL_LAYERS),[snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(true);
  const [target,setTarget]=useState(null),[exploratory,setExploratory]=useState(false);
  const host=useRef(null),scene=useRef(null),worker=useRef(null),generation=useRef(0),time=useRef(0),state=useRef({});
  state.current={settings,playing,speed,target};
  useEffect(()=>{let live=true;load().then(d=>{if(live){setData(d);setSettings(d.config.defaults);setTarget(d.scenario.target);}}).catch(e=>setError(String(e)));return()=>{live=false;};},[]);
  useEffect(()=>{
    if(!data)return;
    let stopped=false,inFlight=false,lastWall=performance.now(),lastSent=-Infinity;
    const w=new Worker(new URL('./zones.worker.js',import.meta.url),{type:'module'});worker.current=w;
    w.postMessage({type:'init',grid:data.grid,scenario:data.scenario});
    const view=new data.VisibilityScene(host.current,data,position=>{setTarget(position);setExploratory(true);generation.current++;});scene.current=view;
    w.onmessage=({data:result})=>{inFlight=false;setBusy(false);if(result.error){setError(result.error);return;}if(result.generation!==generation.current)return;setSnapshot(result);view.updateSnapshot(result);};
    w.onerror=e=>setError(`Visibility worker: ${e.message}`);
    const tick=()=>{
      if(stopped)return;const now=performance.now(),dt=Math.min((now-lastWall)/1000,0.2);lastWall=now;
      const s=state.current;if(s.playing&&!document.hidden)time.current+=dt*s.speed;
      if(!inFlight&&s.settings&&s.target&&(generation.current!==lastSent||s.playing&&now-view.lastUpdate>1200)){
        inFlight=true;lastSent=generation.current;view.lastUpdate=now;setBusy(true);
        w.postMessage({settings:s.settings,target:s.target,time:time.current,generation:generation.current});
      }
      view.render();requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
    return()=>{stopped=true;w.terminate();view.dispose();scene.current=null;};
  },[data]);
  useEffect(()=>{scene.current?.setLayers(layers);},[layers,data]);
  function change(key,value){setSettings(s=>({...s,[key]:value}));setExploratory(true);generation.current++;}
  function reset(){time.current=0;setSettings({...data.config.defaults});setTarget([...data.scenario.target]);setSpeed(1);setPlaying(false);setLayers({...INITIAL_LAYERS});setExploratory(false);generation.current++;scene.current?.resetCamera();}
  const ready=data&&settings;
  return <><header><h1>Helsinki visibility</h1><span>SIMULATED · NOT OPERATIONAL</span></header><main><aside>
    <nav aria-label="Workspace"><button className={tab==='simulation'?'active':''} onClick={()=>setTab('simulation')}>Simulation</button><button className={tab==='sources'?'active':''} onClick={()=>setTab('sources')}>Sources</button></nav>
    {ready&&(tab==='simulation'?<Controls {...{settings,change,playing,setPlaying,speed,setSpeed,reset,layers,setLayers}}/>:<Provenance config={data.provenance}/>)}
    {!ready&&<p className="loading">Loading measured source products…</p>}
  </aside><section className="map" aria-label="Interactive 3D visibility scene"><div className="canvas" ref={host}/>
    <div className="map-title"><h2>Downtown Helsinki</h2><p>EPSG:3067 · 5 minute forecast</p><small>{exploratory?'Exploratory scenario':'Published defaults'} · {playing?'Playing':'Paused'}</small></div>
    <div className="map-tools"><button onClick={()=>scene.current?.resetCamera()}>Reset view</button><button aria-label="Zoom in" onClick={()=>scene.current?.zoom(0.8)}>+</button><button aria-label="Zoom out" onClick={()=>scene.current?.zoom(1.25)}>−</button></div>
    {error&&<div className="error" role="alert">Could not load the demo: {error}</div>}
    <div className="position" aria-live="polite"><strong>Your position · {snapshot?ZONES[snapshot.status.zone]:'Computing'}</strong><p>{snapshot?.status.visibleTo.length?`Visible to ${snapshot.status.visibleTo.join(', ')}`:snapshot?.status.zone===2?`Forecast visibility ≥25% in the sampled scenario`:snapshot?.status.zone===1?'No visibility found in the sampled scenario':'Unknown, obstructed or outside measured coverage'}</p><small>Tap ground to move · target 2 m AGL</small>{target&&<div className="coordinates"><label>E<input aria-label="Your easting" type="number" step="1" value={Math.round(data.config.origin[0]+target[0])} onChange={e=>{setTarget([Number(e.target.value)-data.config.origin[0],target[1]]);generation.current++;setExploratory(true);}}/></label><label>N<input aria-label="Your northing" type="number" step="1" value={Math.round(data.config.origin[1]+target[1])} onChange={e=>{setTarget([target[0],Number(e.target.value)-data.config.origin[1]]);generation.current++;setExploratory(true);}}/></label></div>}</div>
    <div className="snapshot"><strong>{busy?'Computing…':'Zone snapshot'}</strong><br/>{snapshot&&<>t = {snapshot.time.toFixed(1)} s · {snapshot.durationMs} ms<br/>20 m target grid · 1 m LOS surface</>}<p>Drag orbit · two fingers pan / pinch zoom</p></div>
    <footer>City of Helsinki, Urban Environment Division / City Survey Services · © OpenStreetMap contributors · <a href="https://github.com/jaakla/openmapstack-samples/issues/1">Method & source project</a></footer>
  </section></main></>;
}
createRoot(document.getElementById('root')).render(<App/>);

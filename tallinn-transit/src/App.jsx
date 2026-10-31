import { memo,useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { Activity,ArrowDownUp,ArrowRight,BusFront,ChevronDown,ChevronRight,Circle,Clock3,Download,MapPin,Moon,Pause,Play,Route,Search,Settings2,Sun,TrainFront,TramFront,Wifi,WifiOff,X } from 'lucide-react';
import MapView from './MapView.jsx';
import PlaceSearch from './PlaceSearch.jsx';
import { useLive,useNetwork,useRouter } from './useTransit.js';
import { activeServices,clock,normalize,tallinnNow } from './transit.js';
import { api,asset,downloadOffline,setOfflineMode } from './offline.js';
import { stationGroups } from './station-list.js';

const TRANSPORT_MODES=[['bus','Buss',BusFront],['tram','Tramm',TramFront],['train','Rong',TrainFront]];

export function RouteBadge({route}) {
  const Icon=route.mode==='train'?TrainFront:route.mode==='tram'?TramFront:BusFront;
  return <span className={`route-badge ${route.mode}`}><Icon size={15}/>{route.name}</span>;
}
const modeName=mode=>({train:'Rong',tram:'Tramm',bus:'Buss'}[mode]);
const platformDetail=stop=>stop.mode==='train'?(stop.platformCode?`platvorm ${stop.platformCode}`:stop.description||'rongipeatus'):`platvorm ${stop.code||stop.id}`;
const stopName=(data,leg,end)=>leg[end]===null?(leg[`${end}Label`]||'Valitud koht'):data.stops[leg[end]]?.name;
function JourneyResults({results,selected,onSelect,data,busy,searched}) {
  return <section className="journey-results" aria-live="polite" aria-busy={busy}>
    <div className="section-label"><Clock3 size={14}/><span>Sõiduplaani järgi · Tallinna aeg</span></div>
    {busy?<p className="muted">Võrdlen ühendusi ja jalgsikäike sinu seadmes…</p>:null}
    {!busy&&searched&&!results.length?<div className="empty-state"><Route size={30}/><strong>Sobivat teekonda ei leitud</strong><p>Proovi teist aega või suurenda jalgsikäigu ja ümberistumiste ulatust.</p></div>:null}
    {!searched?<div className="empty-state"><Route size={30}/><strong>Kuhu täna liigume?</strong><p>Vali lähte- ja sihtkoht otsingust või kaardilt.</p></div>:null}
    {results.map((j,i)=><div className={`journey-result ${selected===i?'selected':''}`} key={`${j.departure}-${i}`}>
      <button className="journey-select" aria-expanded={selected===i} onClick={()=>onSelect(i)}>
        <div className="journey-timing"><strong>{clock(j.departure)} <ArrowRight size={15}/> {clock(j.arrival)}</strong><span>{Math.ceil(j.duration/60)} min</span></div>
        <div className="journey-routes">{j.legs.filter(l=>l.type==='ride').map((l,n)=><span className="route-step" key={n}>{n?<ChevronRight size={14}/>:null}<RouteBadge route={data.routes[l.route]}/></span>)}<small>{j.legs.every(l=>l.type==='walk')?'Jalgsi':j.transfers?`${j.transfers} ümberistumist`:'Ümberistumiseta'}</small><ChevronDown size={15}/></div>
      </button>
      {selected===i?<ol className="itinerary">{j.legs.map((leg,n)=><li key={n} className={leg.type}>
        <span className={`leg-dot ${leg.type==='ride'?data.routes[leg.route].mode:''}`}/><div>
          {leg.type==='ride'?<><strong>{n+1}. {modeName(data.routes[leg.route].mode)} {data.routes[leg.route].name} · {clock(leg.departure)}</strong>
            <p>{data.stops[leg.from].name} → {data.stops[leg.to].name}</p>
            <small>Peale: {platformDetail(data.stops[leg.from])}{leg.headsign?` · suund ${leg.headsign}`:''}</small>
            <small>{leg.stops} peatust · välju {clock(leg.arrival)}{` · ${platformDetail(data.stops[leg.to])}`}</small></>:<>
              <strong>{n+1}. Jalgsi: {stopName(data,leg,'from')} → {stopName(data,leg,'to')}</strong>
              <small>{Math.ceil((leg.arrival-leg.departure)/60)} min · {leg.metres} m mööda tänavaid ja jalgteid</small>
            </>}
        </div>
      </li>)}</ol>:null}
    </div>)}
  </section>;
}
function StopDetail({station,data,router,date,time,onUsePoint,onClose}) {
  const [list,setList]=useState([]),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true;setList([]);setError('');
    if(router.ready)router.request({type:'departures',args:[station.members,date,time]}).then(items=>{if(alive)setList(items);}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[station.id,date,time,router.ready,router.request]);
  return <section className="stop-detail"><div className="panel-heading"><div><h2>{station.name}</h2><small>Peatuse kõik suunad</small></div><button className="icon-button" aria-label="Sulge peatuse info" onClick={onClose}><X size={18}/></button></div>
    <div className="button-pair"><button className="secondary" onClick={()=>onUsePoint(station,'from')}>Teekond siit</button><button className="primary" onClick={()=>onUsePoint(station,'to')}>Teekond siia <ArrowRight size={16}/></button></div>
    <h3>Järgmised väljumised</h3><p className="muted">{date} · alates {time} · sõiduplaani järgi</p>
    {error?<p role="alert">{error}</p>:null}
    <div className="departures">{list.map((d,i)=><div key={`${d.trip}-${i}`}><RouteBadge route={data.routes[d.route]}/><span>{d.headsign}</span><strong>{clock(d.time)}</strong></div>)}</div>
    {router.ready&&!list.length?<p className="muted">Järgmise nelja tunni jooksul väljumisi ei leitud.</p>:null}
  </section>;
}
function StopButtons({stops,data,onInspect}) {
  return <div className="stop-list">{stops.map(station=><button key={station.id} onClick={()=>onInspect({...station,kind:'station',focus:true})}><MapPin size={17}/><span><strong>{station.name}</strong><small>{station.routes.map(r=>data.routes[r].name).join(', ')}</small></span><ChevronRight size={15}/></button>)}</div>;
}
const StopList=memo(function StopList({data,visibleIds,onInspect}) {
  const [query,setQuery]=useState(''),[visibleLimit,setVisibleLimit]=useState(40),[otherLimit,setOtherLimit]=useState(40);
  const groups=useMemo(()=>stationGroups(data,query,visibleIds),[data,query,visibleIds]);
  useEffect(()=>{setVisibleLimit(40);setOtherLimit(40);},[query,visibleIds]);
  return <><h2>Leia oma peatus</h2><p className="muted">Esmalt peatused kaardialas. Loend muutub koos kaardiga.</p>
    <div className="input-with-icon"><Search size={18}/><input aria-label="Otsi peatust" value={query} placeholder="Peatuse nimi" onChange={e=>setQuery(e.target.value)}/></div>
    <section className="viewport-stops" aria-label="Peatused kaardialas"><h3 className="stop-group-title">Kaardialas <span>{groups.visible.length}</span></h3>
      {groups.visible.length?<StopButtons stops={groups.visible.slice(0,visibleLimit)} data={data} onInspect={onInspect}/>:<p className="stop-list-note">{query.trim()?'Selle nimega peatust kaardialas ei ole.':'Kaardialas peatusi ei ole. Liiguta kaarti või otsi nime järgi.'}</p>}
      {groups.visible.length>visibleLimit?<button className="text-button show-more-stops" onClick={()=>setVisibleLimit(n=>n+40)}>Näita veel kaardiala peatusi ({groups.visible.length-visibleLimit})</button>:null}
    </section>
    {groups.other.length?<details className="other-stops" open={Boolean(query.trim())}><summary>Teised peatused ({groups.other.length})</summary><StopButtons stops={groups.other.slice(0,otherLimit)} data={data} onInspect={onInspect}/>{groups.other.length>otherLimit?<button className="text-button show-more-stops" onClick={()=>setOtherLimit(n=>n+40)}>Näita veel peatusi ({groups.other.length-otherLimit})</button>:null}</details>:null}
    {!groups.visible.length&&!groups.other.length?<p className="stop-list-note">Ühtegi vastet ei leitud. Proovi teist nime.</p>:null}
  </>;
});
function Sources({data,project,offline,progress,notice,onSwitchMode}) {
  return <div className="sources-view"><h2>Tallinn sinu taskus.</h2><p className="muted">Teekonnad arvutatakse sinu seadmes. Aadressiotsing saadab ainult otsinguteksti In-ADS-i.</p>
    <details open><summary>Veebis või võrguta</summary><div className="detail-body"><p>Veebis on saadaval aadressiotsing ja sõidukite asukohad. Võrguta režiimi valimisel salvestatakse kaart, sõiduplaan ja jalakäijate teedevõrk automaatselt.</p><button className="primary" disabled={progress!==null} onClick={()=>onSwitchMode(offline?'online':'offline')}>{progress!==null?`Salvestan ${progress}%`:offline?'Lülitu veebirežiimi':'Lülitu võrguta režiimi'}</button>{notice?<p>{notice}</p>:null}</div></details>
    <details open><summary>Andmed ja allikad</summary><div className="detail-body"><p><a href="https://transport.tallinn.ee/">Tallinna ühistransport</a> · sõiduplaanid ja sõidukite GPS-asukohad.</p><p><a href="https://elron.ee/">Elron</a> · rongide asukohad. <a href="https://eu-gtfs.remix.com/elron.zip">Elroni / RPM-i GTFS</a> · sõiduplaanid Tallinna ja lähiümbruse kaardi piires, kuni Valingu, Saku ja Kullini. Rongipileti tingimused erinevad linnatranspordist; vaata <a href="https://elron.ee/piletiinfo/piletid">Elroni piletiinfot</a>.</p><p>Andmepakett {data.snapshot.slice(0,10)} · {data.routes.length} liini · {data.stations.length} peatust.</p><p>Jalakäijate teed: © OpenStreetMapi kaasautorid (ODbL). Aadressid: <a href="https://inaadress.maaamet.ee/">Maa- ja Ruumiamet · In-ADS</a>.</p><a href={asset('findings.md')}>Tulemused ja meetod</a> · <a href={asset('project.yaml')}>Korratav projekt</a> · <a href={asset('validation/latest-report.json')}>Kontrollid</a></div></details>
    <details><summary>Teekonna arvutamine</summary><div className="detail-body">{project.assumptions.map(a=><p key={a.id}>{a.statement}</p>)}</div></details>
    <details><summary>Andmete piirangud</summary><div className="detail-body">{project.warnings.map(w=><p key={w.id}>{w.statement}</p>)}</div></details>
    <p className="muted source-run">Koostatud {project.run.completed_at}</p>
  </div>;
}
function TransitApp({data,shapes,project,walking}) {
  const initialNow=useRef(tallinnNow()).current;
  const initialFrom=data.stations.find(s=>s.name==='Balti jaam'),initialTo=data.stations.find(s=>s.name==='Lennujaam');
  const [tab,setTab]=useState('journey'),[from,setFrom]=useState({...initialFrom,kind:'station'}),[to,setTo]=useState({...initialTo,kind:'station'});
  const [fromText,setFromText]=useState(initialFrom?.name||''),[toText,setToText]=useState(initialTo?.name||'');
  const [date,setDate]=useState(initialNow.date),[time,setTime]=useState(initialNow.time),[arriveBy,setArriveBy]=useState(false);
  const [maxTransfers,setMaxTransfers]=useState(2),[maxWalk,setMaxWalk]=useState(1000),[transport,setTransport]=useState(['bus','tram','train']);
  const [results,setResults]=useState([]),[selectedJourney,setSelectedJourney]=useState(null),[busy,setBusy]=useState(false),[searched,setSearched]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
  const [route,setRoute]=useState(null),[routeQuery,setRouteQuery]=useState(''),[globalQuery,setGlobalQuery]=useState('');
  const [mapStationIds,setMapStationIds]=useState([]);
  const [inspection,setInspection]=useState(null),[station,setStation]=useState(null),[nearbyPaths,setNearbyPaths]=useState([]);
  const [layers,setLayers]=useState({bus:true,tram:true,train:true,stops:true,routes:false});
  const [theme,setTheme]=useState(()=>localStorage.getItem('tallinn-theme')||'light');
  const [mode,setMode]=useState(()=>!navigator.onLine?'offline':localStorage.getItem('tallinn-mode')||'online'),[connected,setConnected]=useState(navigator.onLine);
  const [paused,setPaused]=useState(false),[progress,setProgress]=useState(null),[notice,setNotice]=useState(''),[mapReady,setMapReady]=useState(false);
  const online=mode==='online'&&connected;
  const router=useRouter(data,walking),live=useLive(paused,import.meta.env.VITE_GPS_URL||api('vehicles'),online&&progress===null);
  const railLive=useLive(paused,api('trains'),online&&progress===null);
  const latestSearch=useRef(0);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('tallinn-theme',theme);},[theme]);
  useEffect(()=>{
    const update=()=>{setConnected(navigator.onLine);if(!navigator.onLine){setMode('offline');setOfflineMode(true);setInspection(i=>i?.kind==='vehicle'?null:i);}};
    window.addEventListener('online',update);window.addEventListener('offline',update);
    const escape=e=>{if(e.key==='Escape'){setInspection(null);setNearbyPaths([]);}};window.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);window.removeEventListener('keydown',escape);};
  },[]);
  async function switchMode(next){
    if(next===mode||progress!==null)return;
    if(next==='online'){
      if(!navigator.onLine){setNotice('Internetiühendus puudub. Võrguta sõiduplaan ja kõnniteed töötavad edasi.');return;}
      await setOfflineMode(false);setMode('online');setPaused(false);setNotice('Veebirežiim on sisse lülitatud.');return;
    }
    setProgress(0);setInspection(i=>i?.kind==='vehicle'?null:i);
    try{
      const pack=await downloadOffline(setProgress);await setOfflineMode(true);setMode('offline');
      setNotice(`Salvestatud ${(pack.bytes/1e6).toFixed(1)} MB. Kaart, sõiduplaan ja jalgteed töötavad nüüd võrguta.`);navigator.storage?.persist?.();
    }catch(e){setNotice(e.message);}finally{setProgress(null);}
  }
  const doSearch=useCallback(async()=>{
    if(!from||!to){setError('Vali lähte- ja sihtkoht otsingutulemustest või kaardilt.');return;}
    if(!transport.length){setError('Vali vähemalt üks liikumisviis.');return;}
    const analyticsMode=transport.length===3?'all':transport.length===1?transport[0]:undefined;
    const initialSearch=!initialized.current,started=performance.now(),id=++latestSearch.current;setBusy(true);setError('');setSearched(true);setDirty(false);setTab('journey');setRoute(null);setInspection(null);setNearbyPaths([]);
    try{const items=await router.request({type:'plan',request:{from,to,date,time,arriveBy,maxTransfers,maxWalk,mode:transport}});if(id===latestSearch.current){setResults(items.map(j=>({...j,fromPlace:from,toPlace:to})));setSelectedJourney(items.length?0:null);window.omsAnalytics?.track('route_search_completed',{duration_ms:performance.now()-started,result_count:items.length,status:items.length?'success':'no_results',arrive_by:arriveBy,mode:analyticsMode,initial:initialSearch});}}
    catch(e){if(id===latestSearch.current){setError(e.message);setResults([]);setSelectedJourney(null);window.omsAnalytics?.track('route_search_completed',{duration_ms:performance.now()-started,status:'error'});}}finally{if(id===latestSearch.current)setBusy(false);}
  },[from,to,date,time,arriveBy,maxTransfers,maxWalk,transport,router.request]);
  const initialized=useRef(false);
  useEffect(()=>{if(router.ready&&!initialized.current){window.omsAnalytics?.once('planner_ready',{duration_ms:performance.now()});doSearch();initialized.current=true;}},[router.ready,doSearch]);
  useEffect(()=>{
    let alive=true;setNearbyPaths([]);
    if(!inspection||inspection.kind==='vehicle'||!router.ready)return;
    router.request({type:'nearby',point:inspection,limit:maxWalk}).then(paths=>{
      if(!alive)return;const grouped=new Map();for(const p of paths){const id=data.stops[p.stop].stationId;if(!grouped.has(id))grouped.set(id,p);}setNearbyPaths([...grouped.values()]);
    }).catch(()=>{});return()=>{alive=false;};
  },[inspection,router.ready,router.request,maxWalk,data]);
  const inspect=useCallback(point=>{setInspection(point);if(point?.kind==='station'){setStation(point);setTab('stops');}},[]);
  const usePoint=useCallback((point,end)=>{
    const place=point.kind==='station'?{...point,kind:'station'}:{kind:'point',lon:point.lon,lat:point.lat,name:point.name||'Valitud asukoht'};
    if(end==='from'){setFrom(place);setFromText(place.name);}else{setTo(place);setToText(place.name);}
    setDirty(true);setTab('journey');setInspection(null);setNearbyPaths([]);
  },[]);
  const closeInspect=useCallback(()=>{setInspection(null);setNearbyPaths([]);},[]);
  const onMapReady=useCallback(()=>{setMapReady(true);window.omsAnalytics?.once('map_ready',{duration_ms:performance.now()});},[]);
  const onViewportChange=useCallback(ids=>setMapStationIds(previous=>previous.length===ids.length&&previous.every((id,i)=>id===ids[i])?previous:ids),[]);
  const change=(fn,value)=>{fn(value);setDirty(true);};
  const filteredRoutes=useMemo(()=>data.routes.map((r,index)=>({...r,index})).filter(r=>normalize(`${r.name} ${r.longName}`).includes(normalize(routeQuery))),[data,routeQuery]);
  const services=useMemo(()=>activeServices(data,date),[data,date]);
  const routeTrip=route===null?null:data.trips.find(t=>t.r===route&&services.has(t.service))||data.trips.find(t=>t.r===route);
  const routeStations=routeTrip?[...new Set(routeTrip.stops.map(i=>data.stops[i].stationId))].map(id=>data.stations.find(s=>s.id===id)):[];
  const selectedItinerary=selectedJourney===null?null:results[selectedJourney];
  const vehicles=online?[...live.vehicles.map(v=>({...v,dataStale:live.stale})),...railLive.vehicles.map(v=>({...v,dataStale:railLive.stale}))]:[];
  const feeds=[['Tallinna',live],['Elroni',railLive]];
  const liveReady=feeds.every(([,feed])=>feed.status==='fresh');
  const liveAvailable=feeds.some(([,feed])=>!feed.expired);
  const liveAge=Math.max(...feeds.filter(([,feed])=>!feed.expired).map(([,feed])=>feed.dataAge??Infinity));
  const snapshotAge=(Date.now()-Date.parse(data.snapshot))/86400000;
  const tabs=[['journey','Teekond',Route],['routes','Liinid',BusFront],['stops','Peatused',MapPin],['sources','Info',Settings2]];
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="./"><img src={asset('icon.svg')} alt=""/><strong>Tallinn liigub</strong></a><span className="tagline">Vähem ootamist. Rohkem Tallinna.</span>
      <div className="header-actions"><div className="mode-switch segmented" role="group" aria-label="Töörežiim">{[['online','Veebis',Wifi],['offline','Võrguta',WifiOff]].map(([value,label,Icon])=><button key={value} aria-pressed={mode===value} disabled={progress!==null} onClick={()=>switchMode(value)}><Icon size={15}/>{label}</button>)}</div>{progress!==null?<span className="download-progress">Salvestan {progress}%</span>:null}<button className="icon-button theme-button" aria-label={theme==='light'?'Lülitu tumedale kaardile':'Lülitu heledale kaardile'} onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button></div>
    </header>
    <main className="workspace"><aside className="sidebar"><nav className="tabs" role="tablist" aria-label="Reisiplaneerija">{tabs.map(([id,label,Icon],i)=><button id={`tab-${id}`} key={id} role="tab" aria-selected={tab===id} aria-controls={`panel-${id}`} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){const next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length][0];setTab(next);document.getElementById(`tab-${next}`).focus();}}}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-scroll"><section id="panel-journey" role="tabpanel" aria-labelledby="tab-journey" hidden={tab!=='journey'}><div className="planner"><h1>Kuhu soovid minna?</h1><p className="subhead">Uksest ukseni. Bussid, trammid, rongid ja jalgsikäigud.</p>
        <form onSubmit={e=>{e.preventDefault();doSearch();}}><div className="journey-inputs"><PlaceSearch data={data} label="Lähtekoht" value={fromText} online={online} onChange={setFromText} onSelect={p=>change(setFrom,p)} icon="circle"/><PlaceSearch data={data} label="Sihtkoht" value={toText} online={online} onChange={setToText} onSelect={p=>change(setTo,p)} icon="pin"/>
          <button type="button" className="swap" aria-label="Vaheta lähte- ja sihtkoht" onClick={()=>{setFrom(to);setTo(from);setFromText(toText);setToText(fromText);setDirty(true);}}><ArrowDownUp size={18}/></button></div>
          <div className="date-time"><label>Kuupäev<input type="date" value={date} required onChange={e=>change(setDate,e.target.value)}/></label><label>{arriveBy?'Saabumine':'Väljumine'}<input type="time" value={time} required onChange={e=>change(setTime,e.target.value)}/></label></div>
          <div className="time-options"><div className="segmented" role="group" aria-label="Aja valik"><button type="button" aria-pressed={!arriveBy} onClick={()=>change(setArriveBy,false)}>Väljun kell</button><button type="button" aria-pressed={arriveBy} onClick={()=>change(setArriveBy,true)}>Saabun hiljemalt</button></div><button type="button" className="text-button" onClick={()=>{const n=tallinnNow();setDate(n.date);setTime(n.time);setArriveBy(false);setDirty(true);}}>Praegu</button></div>
          <fieldset className="transport-options"><legend>Liikumisviisid</legend><div className="transport-choices">{TRANSPORT_MODES.map(([id,label,Icon])=><label key={id} className={`transport-choice ${id}`}><input type="checkbox" checked={transport.includes(id)} onChange={e=>{setTransport(previous=>e.target.checked?[...previous,id]:previous.filter(mode=>mode!==id));setDirty(true);}}/><Icon size={16}/><span>{label}</span></label>)}</div>{!transport.length?<p className="mode-note" role="status">Vali vähemalt üks liikumisviis.</p>:null}</fieldset>
          <details className="journey-options"><summary>Teekonna valikud <Settings2 size={14}/></summary><div className="options-row"><label>Ümberistumisi<select value={maxTransfers} onChange={e=>change(setMaxTransfers,Number(e.target.value))}><option value={0}>Ainult otseliin</option><option value={1}>Kuni 1</option><option value={2}>Kuni 2</option><option value={3}>Kuni 3</option></select></label><label>Jalgsi peatuseni<select value={maxWalk} onChange={e=>change(setMaxWalk,Number(e.target.value))}>{[300,600,1000,1500].map(m=><option key={m} value={m}>Kuni {m} m</option>)}</select></label></div></details>
          <button className="primary find-button" type="submit" disabled={!router.ready||busy||!transport.length}><Search size={19}/>{busy?'Otsin teekonda…':!router.ready?'Laadin teedevõrku…':'Leia teekond'}</button>
        </form>{error?<p className="error-message" role="alert">{error}</p>:null}{dirty&&searched?<p className="dirty-note">Valikud muutusid. Tulemuste uuendamiseks otsi teekonda uuesti.</p>:null}</div>
        <JourneyResults results={results} selected={selectedJourney} onSelect={i=>{setSelectedJourney(i);setRoute(null);setInspection(null);}} data={data} busy={busy} searched={searched}/>
      </section>
      <section id="panel-routes" role="tabpanel" aria-labelledby="tab-routes" hidden={tab!=='routes'} className="list-panel"><h2>Leia oma liin</h2><p className="muted">Vali liin, et näha selle marsruuti ja sõidukeid.</p><div className="input-with-icon"><Search size={18}/><input aria-label="Otsi liini" placeholder="Liin või sihtkoht" value={routeQuery} onChange={e=>setRouteQuery(e.target.value)}/></div>
        {route!==null?<div className="route-detail"><div className="panel-heading"><RouteBadge route={data.routes[route]}/><button className="text-button" onClick={()=>setRoute(null)}>Kõik liinid</button></div><h3>{data.routes[route].longName}</h3>{data.routes[route].mode==='train'?<p className="muted">Oranžidel asukohamärgistel on rongi reisinumber.</p>:null}<details><summary>Peatused ühes suunas</summary><ol className="route-stops">{routeStations.map(s=><li key={s.id}><button onClick={()=>inspect({...s,kind:'station',focus:true})}>{s.name}<ChevronRight size={13}/></button></li>)}</ol></details></div>:null}
        <div className="route-list">{filteredRoutes.map(r=><button className={route===r.index?'active':''} key={r.id} onClick={()=>{setRoute(r.index);setSelectedJourney(null);setInspection(null);}}><RouteBadge route={r}/><span>{r.longName}</span><ChevronRight size={15}/></button>)}</div>
      </section>
      <section id="panel-stops" role="tabpanel" aria-labelledby="tab-stops" hidden={tab!=='stops'} className="list-panel">{station?<StopDetail station={station} data={data} router={router} date={date} time={time} onUsePoint={usePoint} onClose={()=>setStation(null)}/>:<StopList data={data} visibleIds={mapStationIds} onInspect={inspect}/>}</section>
      <section id="panel-sources" role="tabpanel" aria-labelledby="tab-sources" hidden={tab!=='sources'} className="list-panel"><Sources data={data} project={project} offline={mode==='offline'} progress={progress} notice={notice} onSwitchMode={switchMode}/></section>
      </div><button className="sidebar-bottom" onClick={()=>setTab('sources')}><Download size={16}/><span>Allikad ja võrguta kasutamine</span><ChevronRight size={15}/></button></aside>
      <section className="map-area" aria-label="Ühistranspordi kaart"><MapView data={data} shapes={shapes} theme={theme} layers={layers} route={route} journey={selectedItinerary} inspection={inspection} nearbyPaths={nearbyPaths} vehicles={vehicles} stale={paused} onInspect={inspect} onUsePoint={usePoint} onCloseInspect={closeInspect} onMapReady={onMapReady} onViewportChange={onViewportChange}/>
        <div className="map-search"><PlaceSearch data={data} value={globalQuery} onChange={setGlobalQuery} online={online} onSelect={p=>{if(p){inspect({...p,focus:true});setGlobalQuery('');}}} onRoute={i=>{setRoute(i);setSelectedJourney(null);setTab('routes');setGlobalQuery('');}}/></div>
        <div className={`live-card ${online&&!paused&&liveReady?'':'unavailable'}`}><div><strong><span className="live-dot"/>{progress!==null?'Salvestan võrguta andmeid…':!online?'Võrguühenduseta':paused?'Asukohtade uuendus pausil':live.loading&&railLive.loading?'Ühendan sõidukite vooga…':!liveAvailable?'Reaalajaandmed pole saadaval':!liveReady?'Reaalajaandmed osaliselt saadaval':'Sõidukid reaalajas'}</strong><small>{!online?'Kaart, sõiduplaan ja jalgteed sinu seadmes':Number.isFinite(liveAge)?`${vehicles.length} sõidukit · andmete vanus kuni ${liveAge} s`:'Sõiduplaani järgi saab teekondi otsida'}</small></div>{online?<button className="icon-button" aria-label={paused?'Jätka asukohtade uuendamist':'Peata asukohtade uuendamine'} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={17}/>:<Pause size={17}/>}</button>:null}</div>
        {online&&!paused?<div className="live-notices">{feeds.map(([name,feed],i)=>!feed.loading&&feed.status!=='fresh'?<div key={name} className={i?'rail-error':'live-error'} role="status" data-status={feed.status}>{name} {feed.status==='stale'?`asukohad on viimasest teadaolevast seisust (${feed.dataAge??feed.age} s vanad).`:'reaalajaandmed pole praegu saadaval.'} Sõiduplaan töötab edasi.</div>:null)}</div>:null}
        {!mapReady?<div className="map-loading"><Activity size={20}/> Laadin Tallinna kaarti…</div>:null}
        <div className="layer-bar" role="group" aria-label="Kaardikihid">{[['bus','Bussid',BusFront],['tram','Trammid',TramFront],['train','Rongid',TrainFront],['stops','Peatused',Circle],['routes','Liinid',Route]].map(([id,label,Icon])=><label key={id} className={id}><input type="checkbox" checked={layers[id]} onChange={e=>setLayers(s=>({...s,[id]:e.target.checked}))}/><Icon size={16}/><span>{label}</span></label>)}</div>
      </section>
    </main>{snapshotAge>7?<div className="stale-schedule" role="status">Sõiduplaani andmepakett on {Math.floor(snapshotAge)} päeva vana. Uuenda seda enne reisi.</div>:null}
    {notice?<div className="toast" role="status"><span>{notice}</span><button aria-label="Sulge teade" onClick={()=>setNotice('')}><X size={16}/></button></div>:null}
  </div>;
}
export default function App(){
  const {data,shapes,project,walking,error}=useNetwork();
  if(error)return <div className="boot"><h1>Andmepaketi laadimine ei õnnestunud.</h1><p>{error}</p><button className="primary" onClick={()=>location.reload()}>Proovi uuesti</button></div>;
  if(!data||!shapes||!project||!walking)return <div className="boot"><Activity size={28}/><h1>Laadin Tallinna liikumisvõrku…</h1><p>Sõiduplaanid, peatused ja jalgteed sinu seadmes.</p></div>;
  return <TransitApp data={data} shapes={shapes} project={project} walking={walking}/>;
}

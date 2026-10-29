import { useEffect,useId,useMemo,useState } from 'react';
import { Circle,MapPin,Search,X } from 'lucide-react';
import { searchStations } from './transit.js';
import { api } from './offline.js';

export default function PlaceSearch({data,label,value,onChange,onSelect,online,icon='search',onRoute}) {
  const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(0),[addresses,setAddresses]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const stations=useMemo(()=>searchStations(data,value,7),[data,value]);
  useEffect(()=>{
    setAddresses([]);setError('');setLoading(false);
    if(!online||!open||value.trim().length<3)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      setLoading(true);
      try{
        const response=await fetch(api(`geocode?q=${encodeURIComponent(value)}`),{signal:controller.signal});
        if(!response.ok)throw new Error();const items=await response.json();
        if(!controller.signal.aborted)setAddresses(Array.isArray(items)?items:[]);
      }catch{if(!controller.signal.aborted)setError('Aadressiotsing pole praegu saadaval. Peatuseid saab endiselt otsida.');}
      finally{if(!controller.signal.aborted)setLoading(false);}
    },450);
    return()=>{clearTimeout(timer);controller.abort();};
  },[online,open,value]);
  const routes=onRoute&&value.trim()?data.routes.map((r,index)=>({...r,index,kind:'route'})).filter(r=>r.name.toLocaleLowerCase('et')===value.trim().toLocaleLowerCase('et')).slice(0,3):[];
  const results=[...routes,...stations,...addresses];
  function choose(item){if(item.kind==='route')onRoute(item.index);else{onSelect(item);onChange(item.name);}setOpen(false);}
  return <div className="stop-search place-search">
    {label?<label htmlFor={id}>{label}</label>:null}
    <div className="input-with-icon">{icon==='circle'?<Circle size={15}/>:icon==='pin'?<MapPin size={19}/>:<Search size={19}/>}
      <input id={id} value={value} placeholder={online?'Peatus, aadress või koht kaardil':'Peatuse nimi'} aria-label={label||'Otsi kaardilt'} role="combobox" aria-expanded={open} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={open&&results[active]?`${id}-${active}`:undefined} autoComplete="off"
        onFocus={()=>{setOpen(true);setActive(0);}} onBlur={()=>setTimeout(()=>setOpen(false),120)} onChange={e=>{onChange(e.target.value);onSelect(null);setOpen(true);setActive(0);}}
        onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(i+1,results.length-1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}if(e.key==='Enter'&&open&&results[active]){e.preventDefault();choose(results[active]);}if(e.key==='Escape')setOpen(false);}}/>
      {value?<button type="button" className="clear" aria-label={`Tühjenda ${label||'otsing'}`} onClick={()=>{onChange('');onSelect(null);setOpen(true);}}><X size={16}/></button>:null}
    </div>
    {open&&(value.trim()||results.length)?<div className="suggestions" id={`${id}-results`} role="listbox" aria-label="Otsingutulemused">
      {results.map((item,i)=><button type="button" key={`${item.kind}:${item.id||item.index}`} id={`${id}-${i}`} role="option" aria-selected={active===i} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(item)}><MapPin size={15}/><span><strong>{item.kind==='route'?`Liin ${item.name}`:item.name}</strong><small>{item.kind==='station'?`Peatus · ${item.routes.map(r=>data.routes[r].name).join(', ')}`:item.kind==='route'?item.longName:`Aadress · ${item.detail}`}</small></span></button>)}
      {loading?<p className="search-note">Otsin aadresse…</p>:null}
      {error?<p className="search-note">{error}</p>:null}
      {!results.length&&!loading&&!error?<p className="search-note">Vasteid ei leitud.</p>:null}
      {!online?<p className="search-note">Aadressiotsing on saadaval veebirežiimis. Koha saab valida ka kaardilt.</p>:null}
    </div>:null}
  </div>;
}

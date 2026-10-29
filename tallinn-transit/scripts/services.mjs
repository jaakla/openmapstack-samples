// Fixed upstream geocoder. No journey plans, dates or GPS traces leave the device.
export async function geocode(query,signal) {
  const text=String(query||'').trim().slice(0,160);
  if(text.length<3)return [];
  const address=/tallinn|viimsi|maardu|peetri|laagri|harju/i.test(text)?text:`${text}, Tallinn`;
  const url=new URL('https://inaadress.maaamet.ee/inaadress/gazetteer');
  for(const [key,value] of Object.entries({address,results:12,features:'EHITISHOONE',latlon:1}))url.searchParams.set(key,value);
  const response=await fetch(url,{signal:signal||AbortSignal.timeout(12000),headers:{'User-Agent':'Tallinn-liigub address search'}});
  if(!response.ok)throw new Error('Aadressiotsing ei ole praegu kättesaadav.');
  const data=await response.json();
  return [...new Map((data.addresses||[]).filter(a=>a.tehniline!=='1').map(a=>({
    kind:'address',id:`ads:${a.ads_oid||a.adr_id}`,name:a.aadresstekst||a.ipikkaadress||a.pikkaadress,
    detail:a.pikkaadress,lon:Number(a.viitepunkt_l),lat:Number(a.viitepunkt_b),source:'Maa- ja Ruumiamet · In-ADS',
  })).filter(a=>Number.isFinite(a.lon)&&Number.isFinite(a.lat)&&a.lon>=24.44&&a.lon<=25.05&&a.lat>=59.27&&a.lat<=59.58)
    .map(a=>[a.id,a])).values()];
}

export const uses=[
 ['commercial','Ärihoone / ärimaa','#9054ba','#e6d6ef'],
 ['apartments','Korterelamud','#c65e47','#f1d7cf'],
 ['terraced','Ridaelamud','#bf922c','#f1e5bd'],
 ['duplex','Paariselamud','#378b99','#cde5e8'],
 ['green','Haljasala','#759d5e','#dbe8cd'],
 ['street','Tänavamaa','#7c8992','#e0e4e7'],
];
export const useColor=column=>['match',['get','use'],...uses.flatMap(row=>[row[0],row[column]]),'#a6aca6'];
function spriteExpression(value,prefix){
 if(typeof value==='string')return value?`${prefix}:${value}`:'';
 if(!Array.isArray(value))return value;
 const result=structuredClone(value),op=result[0];
 if(op==='step'){for(let i=2;i<result.length;i+=2)result[i]=spriteExpression(result[i],prefix);return result;}
 if(op==='match'){for(let i=3;i<result.length-1;i+=2)result[i]=spriteExpression(result[i],prefix);result[result.length-1]=spriteExpression(result.at(-1),prefix);return result;}
 if(op==='case'){for(let i=2;i<result.length-1;i+=2)result[i]=spriteExpression(result[i],prefix);result[result.length-1]=spriteExpression(result.at(-1),prefix);return result;}
 return ['concat',`${prefix}:`,value];
}
export async function vectorStyle(model,dark){
 const cfg=model.vector_basemap;
 const [light,night]=await Promise.all([[cfg.url,cfg.light],[cfg.dark_url,cfg.dark]].map(async([url,fallback])=>{
  try{const response=await fetch(url);if(!response.ok)throw new Error('style');return await response.json();}catch{return fallback;}
 }));
 const sources={},layers=[],sprite=[];
 for(const [tone,style] of [['light',light],['dark',night]]){
  for(const [id,source] of Object.entries(style.sources))sources[`base-${id}`]=source;
  sprite.push({id:tone,url:style.sprite});
  for(const original of style.layers){
   const layer=structuredClone(original);layer.id=`base-${tone}-${original.id}`;
   if(layer.source)layer.source=`base-${layer.source}`;
   layer.layout={...layer.layout,visibility:(tone==='dark')===dark?'visible':'none'};
   if(layer.layout['icon-image'])layer.layout['icon-image']=spriteExpression(layer.layout['icon-image'],tone);
   layers.push(layer);
  }
 }
 return {version:8,sources,layers,sprite,glyphs:light.glyphs,light:{anchor:'viewport',color:'#fff7eb',intensity:.38,position:[1.5,210,35]}};
}

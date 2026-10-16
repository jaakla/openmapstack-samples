// Exploratory instruments over the published EPSG:3301 metre frame.
// These never change the canonical geodata or invent unseen surfaces.
export function measureEndpoints(endpoints) {
  if (endpoints.length !== 2) return null;
  const [a,b]=endpoints, dx=b.position[0]-a.position[0], dy=b.position[1]-a.position[1], dz=b.position[2]-a.position[2];
  const aligned=Boolean(a.datum&&b.datum&&a.datum===b.datum);
  return {horizontal:Math.hypot(dx,dz),distance:aligned?Math.hypot(dx,dy,dz):null,vertical:aligned?dy:null,aligned,datum:aligned?a.datum:null};
}

export function sectionFrame(bearing,offset=0) {
  const angle=bearing*Math.PI/180;
  return {normal:[Math.cos(angle),0,Math.sin(angle)],tangent:[Math.sin(angle),0,-Math.cos(angle)],offset};
}

export function intersectSection(positions,{normal,offset,tangent},indices=null) {
  const segments=[],epsilon=1e-6;
  for(let i=0;i<(indices?indices.length:positions.length/3);i+=3){
    const offsets=[0,1,2].map(j=>indices?indices[i+j]*3:(i+j)*3);
    const ds=offsets.map(j=>positions[j]*normal[0]+positions[j+2]*normal[2]-offset);
    if(ds.every(d=>d>epsilon)||ds.every(d=>d<-epsilon)||ds.every(d=>Math.abs(d)<=epsilon))continue;
    const hits=[];
    const add=p=>{if(!hits.some(q=>Math.hypot(...p.map((v,k)=>v-q[k]))<epsilon))hits.push(p);};
    for(let e=0;e<3;e++){
      const n=(e+1)%3,a=offsets[e],b=offsets[n];
      if(Math.abs(ds[e])<=epsilon)add(Array.from(positions.subarray(a,a+3)));
      if(ds[e]*ds[n]<0){const f=ds[e]/(ds[e]-ds[n]);add([0,1,2].map(k=>positions[a+k]+f*(positions[b+k]-positions[a+k])));}
    }
    if(hits.length===2)segments.push(...hits[0],...hits[1]);
  }
  const coordinates=new Float32Array(segments),profile=new Float32Array(coordinates.length/3*2);
  for(let i=0,j=0;i<coordinates.length;i+=3,j+=2){profile[j]=coordinates[i]*tangent[0]+coordinates[i+2]*tangent[2];profile[j+1]=coordinates[i+1];}
  return {coordinates,profile};
}

export function observationExport(endpoints,config) {
  return {schema:'toompea-exploratory-measurement/v1',status:'exploratory_unvalidated',base_run:config.run_id,crs:'EPSG:3301',basis:'Straight chord between picked observed surfaces/returns; not a route or surface-following length',results:measureEndpoints(endpoints),endpoints:endpoints.map(p=>({...p,coordinates_3301:[config.origin_3301[0]+p.position[0],config.origin_3301[1]-p.position[2],p.position[1]]})),vertical_warning:'Mixed EGM96/EH2000 endpoint heights are not aligned; 3D distance and vertical difference are withheld for mixed datums.'};
}

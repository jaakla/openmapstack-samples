import createGraph from 'ngraph.graph';
import { aStar } from 'ngraph.path';
import KDBush from 'kdbush';
import proj4 from 'proj4';

proj4.defs('EPSG:3301','+proj=lcc +lat_1=59.3333333333333 +lat_2=58 +lat_0=57.5175539305556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +units=m +no_defs');
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const xy = p => proj4('EPSG:4326','EPSG:3301',[p.lon,p.lat]);
const lonlat = p => proj4('EPSG:3301','EPSG:4326',p);
export class WalkingRouter {
  constructor(data,stops=[]) {
    this.data=data; this.stops=stops; this.graph=createGraph({multigraph:false});
    this.edgeSnaps=new Map(); this.cache=new Map(); this.vertexEdges=Array.from({length:data.vertices.length},()=>[]);
    this.index=new KDBush(data.vertices.length,64,Float64Array);
    data.vertices.forEach(v=>this.index.add(v[2],v[3]));this.index.finish();
    this.graph.beginUpdate();
    data.edges.forEach((e,i)=>{
      const [a,b,m,vertices,name,kind,direction]=e;
      for(const id of vertices)this.vertexEdges[id].push(i);
      for(const id of [a,b])this.graph.addNode(id,{xy:data.vertices[id].slice(2),coordinate:data.vertices[id].slice(0,2)});
      const coordinates=vertices.map(id=>data.vertices[id].slice(0,2));
      if(direction!==-1)this.link(a,b,m,coordinates,name);
      if(direction!==1)this.link(b,a,m,coordinates.slice().reverse(),name);
    });
    this.stopIds=stops.map((s,i)=>this.addPoint(s,`stop:${i}`));
    this.stopXY=stops.map(xy);
    this.graph.endUpdate();
    this.finder=aStar(this.graph,{oriented:true,distance:(_a,_b,l)=>l.data.metres,
      heuristic:(a,b)=>distance(a.data.xy,b.data.xy)});
  }
  link(a,b,metres,coordinates,name='') {
    const existing=this.graph.getLink(a,b);
    if(existing&&existing.data.metres<=metres)return;
    if(existing)this.graph.removeLink(existing);
    this.graph.addLink(a,b,{metres,coordinates,name});
  }
  snap(point) {
    const p=xy(point), candidates=new Set();
    for(const v of this.index.range(p[0]-220,p[1]-220,p[0]+220,p[1]+220))for(const e of this.vertexEdges[v])candidates.add(e);
    let best=null;
    for(const i of candidates){
      const e=this.data.edges[i],indices=e[3];let along=0;
      for(let n=1;n<indices.length;n++){
        const a=this.data.vertices[indices[n-1]].slice(2),b=this.data.vertices[indices[n]].slice(2);
        const length=distance(a,b),vx=b[0]-a[0],vy=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(length*length||1)));
        const q=[a[0]+vx*t,a[1]+vy*t],gap=distance(p,q);
        if(gap<=this.data.policy.max_snap_m&&(!best||gap<best.gap))best={edge:i,at:along+length*t,gap,q,segment:n};
        along+=length;
      }
    }
    return best;
  }
  edgeSlice(edge,start,end) {
    const points=edge[3].map(i=>this.data.vertices[i]),result=[];let at=0;
    for(let n=1;n<points.length;n++){
      const a=points[n-1],b=points[n],length=distance(a.slice(2),b.slice(2));
      if(at+length>=start&&at<=end){
        const t0=Math.max(0,(start-at)/(length||1)),t1=Math.min(1,(end-at)/(length||1));
        if(t0<=t1){
          const project=t=>lonlat([a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t]);
          if(!result.length)result.push(project(t0));result.push(project(t1));
        }
      }
      at+=length;
    }
    return result;
  }
  addPoint(point,id=`point:${point.lon.toFixed(7)},${point.lat.toFixed(7)}`) {
    if(this.graph.getNode(id))return id;
    const snap=this.snap(point);if(!snap)return null;
    const e=this.data.edges[snap.edge],coordinate=[point.lon,point.lat];
    this.graph.addNode(id,{xy:xy(point),coordinate});
    const attachments=this.edgeSnaps.get(snap.edge)||[
      {id:e[0],at:0,gap:0,coordinate:this.data.vertices[e[0]].slice(0,2)},
      {id:e[1],at:e[2],gap:0,coordinate:this.data.vertices[e[1]].slice(0,2)},
    ];
    const self={id,at:snap.at,gap:snap.gap,coordinate};
    for(const other of attachments){
      const forward=self.at<=other.at;
      let line=this.edgeSlice(e,Math.min(self.at,other.at),Math.max(self.at,other.at));
      if(!forward)line.reverse();
      line=[coordinate,...line,other.coordinate];
      const metres=Math.abs(self.at-other.at)+self.gap+other.gap;
      if(e[6]===0||(forward?e[6]===1:e[6]===-1))this.link(id,other.id,metres,line,e[4]);
      if(e[6]===0||(forward?e[6]===-1:e[6]===1))this.link(other.id,id,metres,line.slice().reverse(),e[4]);
    }
    attachments.push(self);this.edgeSnaps.set(snap.edge,attachments);return id;
  }
  route(from,to,maxMetres=Infinity) {
    if(from===null||to===null)return null;
    if(from===to){const p=this.graph.getNode(from).data.coordinate;return {metres:0,seconds:0,coordinates:[p,p]};}
    const key=`${from}|${to}`;
    if(this.cache.has(key)){const p=this.cache.get(key);return p&&p.metres<=maxMetres?p:null;}
    const found=this.finder.find(from,to).reverse();
    if(!found.length){this.cache.set(key,null);return null;}
    let metres=0;const coordinates=[];
    for(let i=1;i<found.length;i++){
      const link=this.graph.getLink(found[i-1].id,found[i].id);
      if(!link)return null;
      metres+=link.data.metres;coordinates.push(...link.data.coordinates.slice(coordinates.length?1:0));
    }
    const route={metres:Math.round(metres),seconds:Math.ceil(metres/this.data.policy.speed_m_s),coordinates};
    if(this.cache.size>10000)this.cache.clear();this.cache.set(key,route);
    return route.metres<=maxMetres?route:null;
  }
  nearby(point,maxMetres=1000,reverse=false) {
    const id=this.addPoint(point);if(id===null)return [];
    const p=xy(point),result=[];
    this.stops.forEach((stop,i)=>{
      if(distance(p,this.stopXY[i])>maxMetres)return;
      const route=reverse?this.route(this.stopIds[i],id,maxMetres):this.route(id,this.stopIds[i],maxMetres);
      if(route)result.push({...route,stop:i});
    });
    return result.sort((a,b)=>a.metres-b.metres);
  }
}

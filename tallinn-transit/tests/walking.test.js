import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { WalkingRouter } from '../src/walking.js';
// Synthetic U-shaped test road: these coordinates never enter delivered data.
function graph(directed=0){
 const vertices=[[542000,6589000],[542100,6589000],[542100,6589100],[542000,6589100]].map(p=>[...proj4('EPSG:3301','EPSG:4326',p),...p]);
 return {vertices,edges:[[0,1,100,[0,1],'A','footway',directed],[1,2,100,[1,2],'B','footway',directed],[2,3,100,[2,3],'C','footway',directed]],policy:{max_snap_m:20,speed_m_s:1.25}};
}
const point=v=>({lon:v[0],lat:v[1]});
test('walking follows street topology around a barrier, not the 100 m straight line',()=>{
 const g=graph(),r=new WalkingRouter(g,[point(g.vertices[3])]);
 const a=r.addPoint(point(g.vertices[0])),b=r.stopIds[0],path=r.route(a,b);
 assert.equal(path.metres,300);assert(path.coordinates.length>=4);assert.equal(r.nearby(point(g.vertices[0]),200).length,0);
 assert.equal(r.nearby(point(g.vertices[0]),350)[0].metres,300);
});
test('pedestrian one-way rules apply in both directions',()=>{
 const g=graph(1),r=new WalkingRouter(g);const a=r.addPoint(point(g.vertices[0])),b=r.addPoint(point(g.vertices[3]));
 assert.equal(r.route(a,b).metres,300);assert.equal(r.route(b,a),null);
});
test('two locations on the same segment get the actual partial road route',()=>{
 const g=graph(),r=new WalkingRouter(g);
 const a=point([...proj4('EPSG:3301','EPSG:4326',[542020,6589000])]),b=point([...proj4('EPSG:3301','EPSG:4326',[542080,6589000])]);
 assert.equal(r.route(r.addPoint(a),r.addPoint(b)).metres,60);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoplayAllowed, advanceTime } from '../src/playback.js';
import { publicationMarkup } from '../publication.js';
import { Vector3, BufferGeometry, Mesh } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { updateLineGeometry, updateMeshGeometry } from '../src/scene-geometry.js';

test('autoplay respects reduced motion and hidden/pause clocks never advance',()=>{
 assert.equal(autoplayAllowed({playing:true},false),true);
 assert.equal(autoplayAllowed({playing:true},true),false);
 assert.equal(autoplayAllowed({playing:false},false),false);
 for(const state of [{playing:false,hidden:false},{playing:true,hidden:true}])
  assert.equal(advanceTime(42,300,{...state,speed:5}),42);
 assert.equal(advanceTime(0,.1,{playing:true,hidden:false,speed:5}),.5);
 assert.equal(advanceTime(0,300,{playing:true,hidden:false,speed:1}),.2);
});
const project={title:'UAV visibility',updated_at:'2026-10-17T00:00:00Z',status:'published',author:{name:'Jaak Laineste',email:'jaak@goplex.ee'},generated_with:{tool:'OpenMapStack',url:'https://github.com/jaakla/openmapstack-skills'}};
test('publication emits matching visible attribution, author/generator and JSON metadata at nested base',()=>{
 const {footer,tags}=publicationMarkup({project},'/samples/uav/');
 for(const text of ['Jaak Laineste','jaak@goplex.ee','OpenMapStack','published','2026-10-17','Helsinki','OpenStreetMap','Innerscene'])assert.ok(footer.includes(text));
 assert.ok(footer.includes('/samples/uav/models/ATTRIBUTION.txt'));
 assert.equal(tags.find(t=>t.attrs.name==='author').attrs.content,project.author.name);
 assert.equal(tags.find(t=>t.attrs.name==='generator').attrs.content,'OpenMapStack');
 assert.deepEqual(JSON.parse(tags.find(t=>t.attrs.id==='project-metadata').children),project);
 assert.throws(()=>publicationMarkup({}),/missing/);
});
test('publication escapes markup and script closing sequences without altering JSON values',()=>{
 const p={...project,title:'</script><b>bad</b>',author:{name:'A < B & C',email:project.author.email}};
 const {footer,tags}=publicationMarkup({project:p});
 assert.ok(footer.includes('A &lt; B &amp; C'));
 const json=tags.at(-1).children;
 assert.ok(!json.includes('</script>'));
 assert.equal(JSON.parse(json).title,p.title);
});
test('LOS/path updates retain object and same-size GPU buffers, update bounds/distances and dispose changed topology',()=>{
 const a=[new Vector3(0,0,0),new Vector3(3,4,0)];
 const line=new Line2(new LineGeometry().setPositions(a.flatMap(p=>p.toArray())),new LineMaterial());line.computeLineDistances();
 const geometry=line.geometry,positions=geometry.attributes.instanceStart.data,distances=geometry.attributes.instanceDistanceStart.data;
 updateLineGeometry(line,[a[0],new Vector3(0,0,10)]);
 assert.equal(line.geometry,geometry);assert.equal(line.geometry.attributes.instanceStart.data,positions);assert.equal(line.geometry.attributes.instanceDistanceStart.data,distances);
 assert.equal(distances.array[1],10);assert.equal(geometry.boundingBox.max.z,10);
 let disposed=false;geometry.addEventListener('dispose',()=>disposed=true);
 updateLineGeometry(line,[...a,new Vector3(3,4,12)]);
 assert.equal(disposed,true);assert.notEqual(line.geometry,geometry);assert.equal(line.geometry.attributes.instanceDistanceEnd.getX(1),17);
 line.geometry.dispose();line.material.dispose();
});
test('uncertainty updates preserve geometry for equal topology and replace only resized buffers',()=>{
 const mesh=new Mesh(new BufferGeometry());updateMeshGeometry(mesh,[0,0,0,1,0,0,0,1,0]);
 const geometry=mesh.geometry;updateMeshGeometry(mesh,[0,0,0,2,0,0,0,2,0]);assert.equal(mesh.geometry,geometry);
 updateMeshGeometry(mesh,[]);assert.notEqual(mesh.geometry,geometry);mesh.geometry.dispose();mesh.material.dispose();
});

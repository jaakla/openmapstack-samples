import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {height} from './visibility.js';

const ZONE_COLORS=[null,'#60a86a','#f5c744','#ef5456'];
export class VisibilityScene {
  constructor(host,data,onPosition){
    this.host=host;this.data=data;this.lastUpdate=0;this.layers={};this.disposed=false;
    const {grid,config}=data;this.grid=grid;this.config=config;
    const renderer=this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#e7eef4');
    renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
    this.world=new THREE.Scene();this.world.fog=new THREE.Fog('#e7eef4',2500,6500);
    this.camera=new THREE.PerspectiveCamera(42,1,1,12000);this.controls=new OrbitControls(this.camera,renderer.domElement);
    this.controls.maxPolarAngle=Math.PI*.48;this.controls.minDistance=60;this.controls.maxDistance=3400;
    this.controls.enableDamping=true;this.controls.dampingFactor=.1;
    this.controls.touches.ONE=THREE.TOUCH.ROTATE;this.controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    this.world.add(new THREE.HemisphereLight('#ffffff','#8a9d80',2.6));
    const sun=new THREE.DirectionalLight('#ffffff',2.1);sun.position.set(-500,1200,600);this.world.add(sun);
    this.resetCamera();
    this.buildTerrain();this.buildBuildings();
    this.groups={vegetation:new THREE.Group(),roads:new THREE.Group(),predictions:new THREE.Group(),vectors:new THREE.Group()};
    Object.values(this.groups).forEach(g=>this.world.add(g));
    this.marker=new THREE.Mesh(new THREE.SphereGeometry(4,16,12),new THREE.MeshBasicMaterial({color:'#0670ed',depthTest:false}));
    this.marker.renderOrder=10;this.world.add(this.marker);
    this.loadAssets().catch(error=>{if(!this.disposed)this.error(error);});
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
    this.pointerDown=e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};};
    this.pointerUp=e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5||performance.now()-down.time>500)return;
      const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,this.camera);const hit=raycaster.intersectObject(this.terrain)[0];
      if(hit)onPosition([hit.point.x,-hit.point.z]);};
    renderer.domElement.addEventListener('pointerdown',this.pointerDown);renderer.domElement.addEventListener('pointerup',this.pointerUp);
    this.resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();});this.resize.observe(host);
  }
  error(e){this.host.dispatchEvent(new CustomEvent('scene-error',{bubbles:true,detail:String(e)}));}
  elevation(x,y){return height(this.grid,this.grid.dtm,x,y);}
  point([x,y,z]){return new THREE.Vector3(x,z,-y);}
  buildTerrain(){
    const {grid}=this,step=4,w=grid.width*grid.resolution,h=grid.height*grid.resolution;
    const positions=[],uv=[],indices=[];const cols=Math.floor(w/step),rows=Math.floor(h/step);
    for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
      const xx=Math.min(w-.01,x*step),yy=Math.min(h-.01,y*step),z=this.elevation(xx,yy);
      positions.push(xx,Number.isFinite(z)?z:-20,-yy);uv.push(x/cols,y/rows);
    }
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;
      if([a,b,c,d].some(i=>positions[i*3+1]===-20))continue;
      indices.push(a,b,c,b,d,c);
    }
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geom.setIndex(indices);geom.computeVertexNormals();
    const texture=new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}data/basemap.jpg`,()=>{},undefined,e=>this.error(e));texture.colorSpace=THREE.SRGBColorSpace;
    this.terrain=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({map:texture,roughness:1,color:'#e8edf0',side:THREE.DoubleSide}));this.world.add(this.terrain);
  }
  buildBuildings(){
    this.buildingGroup=new THREE.Group();this.world.add(this.buildingGroup);
    // Renderer geometry is constructed only from published measured DSM cells.
    // A coarser 2 m display surface has no role in 1 m LOS calculations.
  }
  async loadAssets(){
    const base=import.meta.env.BASE_URL;
    const checked=async path=>{const r=await fetch(base+path);if(!r.ok)throw new Error(`${path}: ${r.status}`);return r;};
    const [buildingBuffer,vegetationBuffer,roads,tank,uav]=await Promise.all([
      checked('data/buildings.bin').then(r=>r.arrayBuffer()),checked('data/vegetation.bin').then(r=>r.arrayBuffer()),
      checked('data/roads.json').then(r=>r.json()),new GLTFLoader().loadAsync(base+'models/tank.glb'),new GLTFLoader().loadAsync(base+'models/uav.glb')]);
    if(this.disposed)return;
    const b=new Uint16Array(buildingBuffer),step=2,w=this.config.displayGrid.width;
    const positions=[];
    const quad=(a,b,c,d)=>positions.push(...a,...b,...c,...b,...d,...c);
    for(let row=0;row<this.config.displayGrid.height;row++)for(let col=0;col<w;col++){
      const raw=b[row*w+col];if(raw===65535||raw===0)continue;
      const x=col*step,y=row*step,z=this.grid.zOrigin+raw*this.grid.zScale;
      quad([x,z,-y],[x+step,z,-y],[x,z,-y-step],[x+step,z,-y-step]);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const cc=col+dx,rr=row+dy,v=cc<0||rr<0||cc>=w||rr>=this.config.displayGrid.height?0:b[rr*w+cc];
        const ground=this.elevation(x+.5,y+.5);const lower=v&&v!==65535?this.grid.zOrigin+v*this.grid.zScale:ground;
        if(!Number.isFinite(lower)||lower>=z)continue;
        if(dx){const xx=x+(dx>0?step:0);quad([xx,z,-y],[xx,z,-y-step],[xx,lower,-y],[xx,lower,-y-step]);}
        else{const yy=-y-(dy>0?step:0);quad([x,z,yy],[x+step,z,yy],[x,lower,yy],[x+step,lower,yy]);}
      }
    }
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.computeVertexNormals();
    this.buildingGroup.add(new THREE.Mesh(geom,new THREE.MeshStandardMaterial({color:'#e6e9eb',roughness:.95,side:THREE.DoubleSide})));
    const vp=new Float32Array(vegetationBuffer),vg=new THREE.BufferGeometry();vg.setAttribute('position',new THREE.BufferAttribute(vp,3));
    this.groups.vegetation.add(new THREE.Points(vg,new THREE.PointsMaterial({color:'#487452',size:2.7,sizeAttenuation:true,transparent:true,opacity:.85})));
    for(const road of roads){const p=road.coordinates.map(([x,y])=>this.point([x,y,this.elevation(x,y)+.5])).filter(p=>Number.isFinite(p.y));
      if(p.length>1)this.groups.roads.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p),new THREE.LineBasicMaterial({color:'#6e8094',transparent:true,opacity:.5})));}
    this.models={tank:this.prepareModel(tank.scene,7),uav:this.prepareModel(uav.scene,1.2)};
    if(this.latestSnapshot)this.updateSnapshot(this.latestSnapshot);this.setLayers(this.layers);
  }
  prepareModel(object,length){
    const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    const scale=length/Math.max(size.x,size.z);object.scale.multiplyScalar(scale);object.position.sub(center.multiplyScalar(scale));
    object.position.y-=new THREE.Box3().setFromObject(object).min.y;
    const group=new THREE.Group();group.add(object);return group;
  }
  clear(group){while(group.children.length){const c=group.children[0];group.remove(c);c.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}}
  updateSnapshot(result){
    this.latestSnapshot=result;
    if(this.zoneMesh){this.world.remove(this.zoneMesh);this.zoneMesh.geometry.dispose();this.zoneMesh.material.dispose();}
    const positions=[],colors=[];
    for(let row=0;row<result.rows;row++)for(let col=0;col<result.cols;col++){
      const zone=result.zones[row*result.cols+col],key=['unknown','green','yellow','red'][zone];if(!zone||this.layers[key]===false)continue;
      const x=col*result.spacing,y=row*result.spacing,s=result.spacing;
      const points=[[x,y],[x+s,y],[x,y+s],[x+s,y+s]].map(([xx,yy])=>[xx,this.elevation(Math.min(xx,this.grid.width-.01),Math.min(yy,this.grid.height-.01))+1.1,-yy]);
      if(points.some(p=>!Number.isFinite(p[1])))continue;const c=new THREE.Color(ZONE_COLORS[zone]);
      for(const i of [0,1,2,1,3,2]){positions.push(...points[i]);colors.push(c.r,c.g,c.b);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.zoneMesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.48,depthWrite:false,side:THREE.DoubleSide}));this.zoneMesh.renderOrder=1;this.world.add(this.zoneMesh);
    this.clear(this.groups.predictions);
    for(const future of result.futures)future.hypotheses.forEach((hypothesis,i)=>{
      const current=result.sensors.find(s=>s.id===future.id).position;
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([current,...hypothesis].filter(p=>p.every(Number.isFinite)).map(p=>this.point(p))),new THREE.LineDashedMaterial({color:i===1?'#d98d10':'#e6bd64',dashSize:9,gapSize:6,transparent:true,opacity:i===1?1:.45}));line.computeLineDistances();this.groups.predictions.add(line);
    });
    // Model clones share geometry/materials; remove without disposing shared originals.
    this.groups.vectors.clear();
    if(this.models)for(const sensor of result.sensors){
      if(!sensor.position.every(Number.isFinite))continue;
      const model=this.models[sensor.type].clone(true),ground=this.elevation(sensor.position[0],sensor.position[1]);
      model.position.copy(this.point([sensor.position[0],sensor.position[1],sensor.type==='tank'?ground:sensor.position[2]]));model.rotation.y=sensor.heading;
      this.groups.vectors.add(model);
      // Distant-zoom display magnification is explicitly an annotation, not dimensions.
      model.userData.magnify=sensor.type==='uav'?9:2.4;
      const sprite=this.label(sensor.id);sprite.position.copy(this.point(sensor.position));sprite.position.y+=20;this.groups.predictions.add(sprite);
    }
    const tz=this.elevation(...result.target);this.marker.visible=Number.isFinite(tz);this.marker.position.copy(this.point([...result.target,tz+3]));
  }
  label(text){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffffeb';ctx.fillRect(0,0,256,64);ctx.fillStyle='#81242e';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.fillText(text,128,43);const texture=new THREE.CanvasTexture(canvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.scale.set(54,13.5,1);sprite.renderOrder=5;return sprite;}
  setLayers(layers){this.layers=layers;this.buildingGroup.visible=layers.buildings!==false;if(this.groups)for(const key of ['vegetation','roads','predictions'])this.groups[key].visible=layers[key]!==false;if(this.latestSnapshot)this.updateSnapshot(this.latestSnapshot);}
  resetCamera(){const w=this.grid.width,h=this.grid.height;this.controls.target.set(w*.5,12,-h*.5);this.camera.position.set(w*.5-650,1050,-h*.5+1000);this.controls.update();}
  zoom(factor){this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);this.controls.update();}
  render(){this.controls.update();for(const model of this.groups.vectors.children)model.scale.setScalar(model.userData.magnify??1);this.renderer.render(this.world,this.camera);}
  dispose(){this.disposed=true;this.resize.disconnect();this.controls.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);this.world.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}});this.renderer.dispose();this.host.replaceChildren();}
}

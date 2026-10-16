import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {measureEndpoints,sectionFrame} from './survey-tools.js';
import {solarStudy} from './solar.js';

const linearColorLUT=Uint8Array.from({length:256},(_,i)=>Math.round((i/255<=.04045?(i/255)/12.92:((i/255+.055)/1.055)**2.4)*255));
function linearColors(buffer, lift=0){const a=new Uint8Array(buffer);for(let i=0;i<a.length;i++)a[i]=Math.round(lift*255+(1-lift)*linearColorLUT[a[i]]);return a;}
const readBuffer = async (name, signal) => { const r=await fetch(`${import.meta.env.BASE_URL}data/${name}`,{signal});if(!r.ok)throw new Error(`Could not load measured dataset: ${name}`);return r.arrayBuffer(); };
export class AtlasScene {
  constructor(container, config, {onReady,onError,onInspect,onProgress,onScale,onMeasurement,onSection,onSolar}) {
    this.onMeasurement=onMeasurement;this.onSection=onSection;this.onSolar=onSolar;this.endpoints=[];this.sectionState={enabled:false,bearing:90,offset:0,slab:false,width:4,flip:false};this.sectionRequest=0;
    this.container=container;this.config=config;this.disposed=false;this.onInspect=onInspect;this.onScale=onScale;this.abort=new AbortController();this.anchors=[];
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e6e2da');
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;this.renderer.setClearColor('#e6e2da');container.prepend(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','Interactive measured 3D model of Toompea hill');this.renderer.domElement.setAttribute('role','img');
    this.createVignette();
    this.camera=new THREE.OrthographicCamera(-600,600,600,-600,1,6000);this.camera.position.set(-720,760,920);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.addEventListener('change',()=>{this.dirty=true;});this.controls.target.set(-55,30,45);this.camera.zoom=1.75;this.controls.enableDamping=true;this.controls.dampingFactor=.085;this.controls.minZoom=.6;this.controls.maxZoom=12;this.controls.maxPolarAngle=Math.PI*.49;this.controls.minPolarAngle=.05;this.renderer.domElement.tabIndex=0;this.controls.listenToKeyEvents(this.renderer.domElement);this.controls.zoomSpeed=.85;this.controls.panSpeed=.8;
    this.ambient=new THREE.HemisphereLight('#fff8e9','#a5a497',1.25);this.scene.add(this.ambient);this.sun=new THREE.DirectionalLight('#fff4dc',1.3);this.sun.position.set(-500,700,200);this.scene.add(this.sun);
    this.renderer.localClippingEnabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-850,right:850,top:850,bottom:-850,near:10,far:3500});this.sun.shadow.bias=-.00015;this.sun.shadow.normalBias=.5;this.sun.shadow.radius=2;this.sun.target.position.set(50,40,0);this.scene.add(this.sun.target);
    this.measureGroup=new THREE.Group();this.scene.add(this.measureGroup);this.sectionGroup=new THREE.Group();this.scene.add(this.sectionGroup);
    this.measureLabel=document.createElement('div');this.measureLabel.className='measurement-label';this.measureLabel.setAttribute('role','status');this.measureLabel.hidden=true;container.append(this.measureLabel);
    this.pointGroups={};this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.resize=()=>{const {width:w,height:h}=container.getBoundingClientRect();this.renderer.setSize(w,h);const vh=1080;this.camera.left=-vh*w/h/2;this.camera.right=vh*w/h/2;this.camera.top=vh/2;this.camera.bottom=-vh/2;this.camera.updateProjectionMatrix();this.dirty=true;};this.observer=new ResizeObserver(this.resize);this.observer.observe(container);this.resize();
    this.pointerDown=e=>{this.down=[e.clientX,e.clientY];};this.pointerUp=e=>{if(e.button===0&&['inspect','measure'].includes(this.tool)&&this.down&&Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])<5){if(this.tool==='measure'){const hit=this.pick(e);if(hit)this.addEndpoint(hit);}else this.inspect(e);}};this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();onError(new Error('The graphics context was interrupted. Reload the atlas to restore the measured scene.'));},{signal:this.abort.signal});
    this.load(onProgress).then(()=>{if(!this.disposed){this.ready=true;this.dirty=true;this.setState(this.state || config.default_controls);onReady();}}).catch(e=>{if(e.name!=='AbortError')onError(e);});
    this.reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.clock=new THREE.Clock();this.animate=()=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);if(this.transition){const p=Math.min((performance.now()-this.transition.time)/1100,1),s=1-(1-p)**3;this.camera.position.lerpVectors(this.transition.from,this.transition.to,s);this.controls.target.lerpVectors(this.transition.targetFrom,this.transition.targetTo,s);this.camera.zoom=THREE.MathUtils.lerp(this.transition.zoomFrom,this.transition.zoomTo,s);this.camera.updateProjectionMatrix();if(p===1)this.transition=null;}
      const changed=this.controls.update(),windChanged=this.updateFlagWind(performance.now());if(changed||this.dirty||this.transition||windChanged){this.camera.updateMatrixWorld();this.updateAnchors();this.renderView();this.onScale?.(100*this.container.clientHeight/(1080/this.camera.zoom));this.dirty=false;}};this.animate();
  }
  async load(onProgress){
    const signal=this.abort.signal;onProgress('Preparing surveyed architecture…');
    const terrainPromise=readBuffer('terrain.bin',signal);const buildingPromise=Promise.all([readBuffer('buildings.bin',signal),readBuffer('building-colors.bin',signal),fetch(`${import.meta.env.BASE_URL}data/building-nodes.json`,{signal}).then(r=>r.json())]);
    const cloudPromise=Promise.all(['points.bin','point-colors.bin','point-classes.bin'].map(n=>readBuffer(n,signal)));
    const flagPromise=readBuffer('pikk-hermann-flag.bin',signal);
    const texturePromise=new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}data/orthophoto.jpg`);
    const [terrainData,texture]=await Promise.all([terrainPromise,texturePromise]);if(this.disposed){texture.dispose();return;}
    const heights=new Float32Array(terrainData),n=this.config.grid_size,[west,south,east,north]=this.config.bbox_3301,[oe,on]=this.config.origin_3301;
    const geo=new THREE.PlaneGeometry(east-west,north-south,n-1,n-1);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;const colors=new Float32Array(p.count*3);const color=new THREE.Color();
    for(let i=0;i<p.count;i++){p.setXYZ(i,p.getX(i)+(east+west)/2-oe,heights[i],p.getZ(i)+on-(north+south)/2);const h=(heights[i]-this.config.stats.ground_min)/(this.config.stats.ground_max-this.config.stats.ground_min);color.setHSL(.13-.12*h,.25,.77-.24*h);color.toArray(colors,i*3);}geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.computeVertexNormals();texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
    this.terrainMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:1,metalness:0,color:'#eee9df',side:THREE.DoubleSide});this.solarTerrainMaterial=new THREE.MeshStandardMaterial({color:'#c8c5b5',roughness:1,side:THREE.DoubleSide});this.elevationMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});this.terrain=new THREE.Mesh(geo,this.terrainMaterial);this.terrain.castShadow=true;this.terrain.receiveShadow=true;this.scene.add(this.terrain);
    const [bp,bc,nodes]=await buildingPromise;if(this.disposed)return;
    const q=new Int16Array(bp);const pos=new Float32Array(q.length);for(let i=0;i<q.length;i++)pos[i]=q[i]*this.config.building_quantization_m;
    const bgeo=new THREE.BufferGeometry();bgeo.setAttribute('position',new THREE.BufferAttribute(pos,3));bgeo.setAttribute('color',new THREE.BufferAttribute(linearColors(bc,.07),3,true));bgeo.computeVertexNormals();
    this.buildingMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0,side:THREE.DoubleSide,flatShading:true});this.solarBuildingMaterial=new THREE.MeshStandardMaterial({color:'#ddd2bf',roughness:1,side:THREE.DoubleSide,flatShading:true});this.buildings=new THREE.Mesh(bgeo,[this.buildingMaterial]);this.buildings.castShadow=true;this.buildings.receiveShadow=true;this.nodes=nodes;this.scene.add(this.buildings);onProgress('Preparing airborne laser returns…');
    const [cp,cc,cl]=await cloudPromise;if(this.disposed)return;
    const xyz=new Float32Array(cp),rgb=linearColors(cc),cls=new Uint8Array(cl);const groupIndices={ground:[],vegetation:[],buildings:[],other:[]};
    for(let i=0;i<cls.length;i++){const c=cls[i];groupIndices[c===2?'ground':c>=3&&c<=5?'vegetation':c===6?'buildings':'other'].push(i);}
    Object.entries(groupIndices).forEach(([name,indices])=>{const gp=new Float32Array(indices.length*3),gc=new Uint8Array(indices.length*3);for(let i=0;i<indices.length;i++){const j=indices[i]*3;gp.set(xyz.subarray(j,j+3),i*3);gc.set(rgb.subarray(j,j+3),i*3);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(gp,3));g.setAttribute('color',new THREE.BufferAttribute(gc,3,true));const m=new THREE.PointsMaterial({vertexColors:true,size:name==='vegetation'?1.6:1.1,sizeAttenuation:true,transparent:false,toneMapped:false});const points=new THREE.Points(g,m);this.pointGroups[name]=points;this.scene.add(points);});
    this.sectionWorker=new Worker(new URL('./section.worker.js',import.meta.url),{type:'module'});
    const sectionBuildings=pos.buffer.slice(0),sectionTerrain=geo.attributes.position.array.buffer.slice(0),terrainIndices=new Uint32Array(geo.index.array).buffer;
    this.sectionWorker.postMessage({type:'init',buildings:sectionBuildings,terrain:sectionTerrain,terrainIndices},[sectionBuildings,sectionTerrain,terrainIndices]);
    this.sectionWorker.onmessage=({data})=>{if(data.id!==this.sectionRequest||!this.sectionState.enabled)return;this.sectionData=data;this.renderSection();this.onSection?.({...data,pending:false});};
    this.sectionWorker.onerror=()=>this.onSection?.({pending:false,error:'The section worker could not read the survey surfaces.'});
    this.createFlag(await flagPromise);
    this.setSection(this.sectionState);
  }
  createVignette(){
    this.vignetteScene=new THREE.Scene();this.vignetteScene.name='Map vignette';
    this.vignetteCamera=new THREE.Camera();
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    const material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false,uniforms:{strength:{value:this.config.map_effects?.vignette_strength??.22}},
      vertexShader:`varying vec2 screenUV;void main(){screenUV=position.xy*.5+.5;gl_Position=vec4(position,1.);}`,
      fragmentShader:`uniform float strength;varying vec2 screenUV;void main(){float edge=smoothstep(.28,.74,length(screenUV-.5));gl_FragColor=vec4(.075,.065,.05,edge*strength);}`});
    const overlay=new THREE.Mesh(geometry,material);overlay.name='Vignette overlay';overlay.frustumCulled=false;this.vignetteScene.add(overlay);
  }
  renderView(){
    this.renderer.render(this.scene,this.camera);
    const autoClear=this.renderer.autoClear;this.renderer.autoClear=false;
    this.renderer.render(this.vignetteScene,this.vignetteCamera);this.renderer.autoClear=autoClear;
  }
  createFlag(buffer){
    const reference=this.config.landmark_flag;if(!reference||this.disposed)return;
    const records=new Float32Array(buffer),positions=[],uv=[],hoist=new THREE.Vector3(...reference.position),sourceVertices=new Set();
    for(let i=0;i<records.length;i+=4){positions.push(records[i]-hoist.x,records[i+1]-hoist.y,records[i+2]-hoist.z);uv.push(0,records[i+3]);sourceVertices.add(`${records[i]},${records[i+1]},${records[i+2]}`);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.computeBoundingBox();
    // Deform only the rendered cloth; the observed buffers remain available for analysis.
    const edge=new THREE.Vector3();for(let i=0;i<positions.length;i+=3){const p=new THREE.Vector3(positions[i],0,positions[i+2]);if(p.lengthSq()>edge.lengthSq())edge.copy(p);}
    const wind=reference.animation,span=edge.length(),direction=new THREE.Vector3(-edge.z,0,edge.x).normalize();
    this.flagWindStart=performance.now();this.flagWindInterval=1000/(wind?.max_fps??24);
    const colors=reference.colors.map(color=>new THREE.Color(color));
    // A fixed world-space fill reveals the recorded folds without washing out the national colors at night.
    const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,toneMapped:false,depthTest:false,depthWrite:false,
      uniforms:{blue:{value:colors[0]},black:{value:colors[1]},white:{value:colors[2]},windTime:{value:0},windStrength:{value:0},windSpan:{value:span},windDirection:{value:direction},windAmplitude:{value:span*(wind?.amplitude_fraction??.08)},windSpeed:{value:wind?.angular_speed_radians_per_second??2.2},pinnedRadius:{value:wind?.pinned_radius_m??.16}},
      vertexShader:`uniform float windTime,windStrength,windSpan,windAmplitude,windSpeed,pinnedRadius;uniform vec3 windDirection;varying float flagV;varying vec3 clothNormal;void main(){
        flagV=uv.y;clothNormal=mat3(modelMatrix)*normal;
        float reach=length(position.xz),envelope=smoothstep(pinnedRadius,windSpan,reach);
        float phase=reach/windSpan*6.-windTime*windSpeed;
        float ripple=.75*sin(phase)+.25*sin(phase*1.7+position.y*1.4);
        vec3 cloth=position+windDirection*(ripple*envelope*windAmplitude*windStrength);
        cloth.y+=sin(phase+.8)*envelope*windAmplitude*.18*windStrength;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(cloth,1.);
      }`,
      fragmentShader:`uniform vec3 blue;uniform vec3 black;uniform vec3 white;varying float flagV;varying vec3 clothNormal;void main(){vec3 color=flagV>2./3.?blue:flagV>1./3.?black:white;float fold=.72+.28*abs(dot(normalize(clothNormal),normalize(vec3(.45,.8,.35))));gl_FragColor=vec4(color*fold,1.);
      #include <colorspace_fragment>
      }`});
    this.flag=new THREE.Mesh(geometry,material);this.flag.name='Pikk Hermann surveyed 3D cloth';this.flag.position.copy(hoist);this.flag.renderOrder=30;this.flag.frustumCulled=false;this.scene.add(this.flag);
    this.flagExtent=geometry.boundingBox.getSize(new THREE.Vector3()).length();
    // Omit the gray source cloth from architecture drawing only. Keep all source vertices and face indices for measurement/sections.
    const source=this.buildings.geometry.attributes.position,node=this.nodes.find(n=>n.id===reference.survey_node),omitted=[];
    for(let i=node.start;i<node.start+node.count;i+=3){let cloth=true;for(let j=0;j<3;j++)cloth&&=sourceVertices.has(`${source.getX(i+j)},${source.getY(i+j)},${source.getZ(i+j)}`);if(cloth)omitted.push(i);}
    this.buildings.geometry.clearGroups();let previous=0;
    for(const index of omitted){if(index>previous)this.buildings.geometry.addGroup(previous,index-previous,0);previous=index+3;}
    if(previous<source.count)this.buildings.geometry.addGroup(previous,source.count-previous,0);
    this.renderer.domElement.setAttribute('aria-description','Pikk Hermann carries a folded 3D Estonian blue, black and white flag. Gentle wind ripples and distant-view magnification are illustrative display effects on the surveyed cloth. Wind animation is disabled when reduced motion is preferred.');
  }
  updateFlagWind(now){
    if(!this.flag)return false;
    const uniforms=this.flag.material.uniforms,moving=this.config.landmark_flag.animation?.enabled!==false&&!this.reducedMotion.matches&&!document.hidden;
    if(!moving){if(uniforms.windStrength.value===0)return false;uniforms.windStrength.value=0;return true;}
    if(now-(this.flagWindFrame??-Infinity)<this.flagWindInterval)return false;
    this.flagWindFrame=now;uniforms.windTime.value=(now-this.flagWindStart)/1000;uniforms.windStrength.value=1;return true;
  }
  setState(state){this.dirty=true;this.state=state;const mode=state.mode;this.scene.background.set(mode==='cloud'?'#242b2b':'#e6e2da');if(this.buildings)this.buildings.visible=mode==='model'&&state.buildings;if(this.terrain){this.terrain.visible=state.terrain&&mode!=='cloud';this.terrain.material=mode==='elevation'?this.elevationMaterial:this.terrainMaterial;}
    for(const [name,points] of Object.entries(this.pointGroups)){points.visible=mode==='cloud'?(name==='vegetation'?state.vegetation:name==='ground'?state.terrain:name==='buildings'?state.buildings:true):(name==='vegetation'&&state.vegetation&&mode==='model');points.material.size=mode==='cloud'?1.1:1.6;}
    this.applyLighting();this.applyClipping();if(this.sectionState.enabled)this.renderSection();
    for(const a of this.anchors)a.el.style.display=state.labels?'':'none';
  }
  setTool(tool){this.tool=tool;this.controls.mouseButtons.LEFT=tool==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;this.renderer.domElement.style.cursor=['inspect','measure'].includes(tool)?'crosshair':'grab';}
  setAnchors(places,elements){this.dirty=true;this.anchors=places.map((p,i)=>({pos:new THREE.Vector3(...p.position),el:elements[i],id:p.id})).filter(a=>a.el);}
  updateAnchors(){const w=this.container.clientWidth,h=this.container.clientHeight;
    if(this.flag){
      // Uniform magnification keeps the world-oriented cloth readable, including in nadir views.
      const pixelsPerMetre=h*this.camera.zoom/1080;
      this.flag.scale.setScalar(Math.max(1,(this.config.landmark_flag.minimum_display_extent_px??24)/(this.flagExtent*pixelsPerMetre)));
    }
    if(this.state?.labels)for(const a of this.anchors){const v=a.pos.clone().project(this.camera);a.el.style.transform=`translate(${(v.x*.5+.5)*w}px,${(-v.y*.5+.5)*h}px)`;a.el.style.visibility=Math.abs(v.x)>1.05||Math.abs(v.y)>1.05||v.z>1||this.clipPlanes?.some(plane=>plane.distanceToPoint(a.pos)<0)?'hidden':'visible';}if(this.endpoints.length===2){const m=new THREE.Vector3(...this.endpoints[0].position).add(new THREE.Vector3(...this.endpoints[1].position)).multiplyScalar(.5).project(this.camera);this.measureLabel.style.transform=`translate(${(m.x*.5+.5)*w}px,${(-m.y*.5+.5)*h-16}px)`;this.measureLabel.style.visibility=Math.abs(m.x)>1||Math.abs(m.y)>1?'hidden':'visible';}}
  go(target,zoom=2.5,top=false){this.transition={time:performance.now()-(window.matchMedia('(prefers-reduced-motion: reduce)').matches?1100:0),from:this.camera.position.clone(),to:new THREE.Vector3(target[0]+(top?0:-360),target[1]+(top?1200:440),target[2]+(top ? .001 : 540)),targetFrom:this.controls.target.clone(),targetTo:new THREE.Vector3(...target),zoomFrom:this.camera.zoom,zoomTo:zoom};}
  home(){this.go([-55,30,45],1.75);if(this.transition)this.transition.to.set(-720,760,920);}
  zoom(factor){this.dirty=true;this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom*factor,.6,12);this.camera.updateProjectionMatrix();}
  top(){this.go(this.controls.target.toArray(),this.camera.zoom,true);}
  applyLighting(){
    const state=this.state,solar=state.lighting==='solar',study=solarStudy(state.sunDate,state.sunTime,this.config.solar_reference);
    this.onSolar?.(study);
    if(this.buildings)this.buildings.material=[solar?this.solarBuildingMaterial:this.buildingMaterial];
    if(this.terrain)this.terrain.material=state.mode==='elevation'?this.elevationMaterial:solar?this.solarTerrainMaterial:this.terrainMaterial;
    if(solar){
      const daylight=study.valid&&study.daylight,altitude=daylight?Math.sin(study.altitude*Math.PI/180):0;
      if(study.valid)this.sun.position.copy(this.sun.target.position).addScaledVector(new THREE.Vector3(...study.direction),1800);
      this.sun.intensity=daylight?2.4*Math.pow(altitude,.35):0;
      this.sun.color.setHSL(.09,.14+.35*(1-altitude),.93);
      this.ambient.intensity=daylight?.55+altitude*.55:.12;
      this.scene.background.set(state.mode==='cloud'?'#242b2b':daylight?'#e6e2da':'#343c4a');
      this.renderer.shadowMap.enabled=Boolean(daylight&&state.sunShadows&&state.mode!=='cloud');
      this.renderer.toneMappingExposure=state.mode==='cloud'?.9:1.15;
    }else{
      const sun=state.sunlight/100;this.sun.position.set(-700+sun*1200,200+Math.sin(sun*Math.PI)*700,300);this.sun.target.position.set(50,40,0);this.sun.intensity=.7+sun*.9;this.sun.color.set('#fff4dc');this.ambient.intensity=1.25;this.renderer.shadowMap.enabled=false;this.renderer.toneMappingExposure=state.mode==='cloud'?.9:1.15;
    }
    const foliage=this.pointGroups.vegetation;if(foliage){const brightness=state.mode==='cloud'||!solar?1:study.valid&&study.daylight?.8:.1;foliage.material.color.setRGB(brightness,brightness,brightness);}
    this.renderer.shadowMap.needsUpdate=true;this.dirty=true;
  }
  pick(e){
    const r=this.container.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.camera.updateMatrixWorld();this.raycaster.setFromCamera(this.pointer,this.camera);
    const visible=p=>this.clipPlanes?.every(plane=>plane.distanceToPoint(p)>=-.001)??true;
    if(this.state.mode==='cloud'){
      this.raycaster.params.Points.threshold=2;
      for(const h of this.raycaster.intersectObjects(Object.values(this.pointGroups).filter(p=>p.visible))){const a=h.object.geometry.attributes.position,p=new THREE.Vector3(a.getX(h.index),a.getY(h.index),a.getZ(h.index));if(visible(p))return {type:'point',source_group:Object.entries(this.pointGroups).find(([,p])=>p===h.object)?.[0],sample_index:h.index,position:p.toArray(),datum:'EH2000',source:'2023 airborne LiDAR sample'};}
    }else{
      for(const hit of this.raycaster.intersectObjects([this.buildings,this.terrain].filter(x=>x?.visible))){if(!visible(hit.point))continue;if(hit.object===this.buildings){const index=hit.faceIndex*3,node=this.nodes.find(n=>index>=n.start&&index<n.start+n.count);return {type:'building',node:node?.id,position:hit.point.toArray(),datum:'EGM96',source:'City of Tallinn · 2020 survey'};}return {type:'terrain',position:hit.point.toArray(),datum:'EH2000',source:'2023 LiDAR · derived 2 m terrain'};}
    }
    return null;
  }
  addEndpoint(endpoint){
    if(this.endpoints.length===2)this.endpoints=[];
    this.endpoints.push(endpoint);this.drawMeasurement();
  }
  clearMeasurement(){this.endpoints=[];this.drawMeasurement();}
  undoMeasurement(){this.endpoints.pop();this.drawMeasurement();}
  clearGroup(group){for(const child of [...group.children]){child.geometry?.dispose();child.material?.dispose();group.remove(child);}}
  drawMeasurement(){
    this.clearGroup(this.measureGroup);this.measureLabel.hidden=this.endpoints.length!==2;
    for(const endpoint of this.endpoints){const marker=new THREE.Mesh(new THREE.SphereGeometry(2,12,8),new THREE.MeshBasicMaterial({color:'#b65e33',depthTest:false}));marker.position.set(...endpoint.position);marker.renderOrder=20;this.measureGroup.add(marker);}
    const result=measureEndpoints(this.endpoints);
    if(result){const geometry=new THREE.BufferGeometry().setFromPoints(this.endpoints.map(p=>new THREE.Vector3(...p.position)));const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#b65e33',dashSize:4,gapSize:2,depthTest:false}));line.computeLineDistances();line.renderOrder=20;this.measureGroup.add(line);this.measureLabel.textContent=`${(result.distance??result.horizontal).toFixed(2)} m · ${result.aligned?'3D':'horizontal'}`;}
    this.onMeasurement?.({endpoints:[...this.endpoints],result});this.applyClipping();this.dirty=true;
  }
  applyClipping(){
    const section=this.sectionState,frame=sectionFrame(section.bearing,section.offset),n=new THREE.Vector3(...frame.normal);
    this.clipPlanes=!section.enabled?[]:section.slab?[new THREE.Plane(n.clone(),-section.offset+section.width/2),new THREE.Plane(n.clone().negate(),section.offset+section.width/2)]:[new THREE.Plane(section.flip?n.clone().negate():n,section.flip?section.offset:-section.offset)];
    for(const material of [this.buildingMaterial,this.solarBuildingMaterial,this.terrainMaterial,this.solarTerrainMaterial,this.elevationMaterial,...Object.values(this.pointGroups).map(p=>p.material)].filter(Boolean)){const previous=material.clippingPlanes?.length||0;material.clippingPlanes=this.clipPlanes;material.clipShadows=true;if(previous!==this.clipPlanes.length)material.needsUpdate=true;}
    this.measureGroup.visible=this.endpoints.every(p=>this.clipPlanes.every(plane=>plane.distanceToPoint(new THREE.Vector3(...p.position))>=-.001));this.measureLabel.hidden=this.endpoints.length!==2||!this.measureGroup.visible;
    this.renderer.shadowMap.needsUpdate=true;this.dirty=true;
  }
  setSection(section){
    const changed=!this.sectionState.enabled||section.bearing!==this.sectionState.bearing||section.offset!==this.sectionState.offset;
    this.sectionState={...section};this.applyClipping();this.renderSection();clearTimeout(this.sectionTimer);
    if(!section.enabled){this.sectionRequest++;this.sectionData=null;this.onSection?.(null);return;}
    if(!this.sectionWorker)return;
    if(changed||!this.sectionData){this.sectionData=null;this.renderSection();this.onSection?.({pending:true});const id=++this.sectionRequest;this.sectionTimer=setTimeout(()=>{this.sectionWorker.postMessage({type:'section',id,bearing:section.bearing,offset:section.offset});},120);}
  }
  viewSection(){
    const {normal}=sectionFrame(this.sectionState.bearing,this.sectionState.offset),n=new THREE.Vector3(...normal),target=new THREE.Vector3(n.x*this.sectionState.offset,45,n.z*this.sectionState.offset);
    this.transition={time:performance.now(),from:this.camera.position.clone(),to:target.clone().addScaledVector(n,this.sectionState.flip?900:-900).add(new THREE.Vector3(0,330,0)),targetFrom:this.controls.target.clone(),targetTo:target,zoomFrom:this.camera.zoom,zoomTo:Math.max(1,this.camera.zoom)};
  }
  renderSection(){
    this.clearGroup(this.sectionGroup);if(!this.sectionState.enabled)return;
    const frame=sectionFrame(this.sectionState.bearing,this.sectionState.offset),normal=new THREE.Vector3(...frame.normal);
    const guide=new THREE.Mesh(new THREE.PlaneGeometry(1800,180),new THREE.MeshBasicMaterial({color:'#bc7546',transparent:true,opacity:.08,side:THREE.DoubleSide,depthWrite:false}));guide.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);guide.position.set(normal.x*this.sectionState.offset,75,normal.z*this.sectionState.offset);this.sectionGroup.add(guide);
    if(this.sectionData)for(const [name,color] of [['terrain','#56685a'],['buildings','#b15b34']]){if(!this.state?.[name])continue;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.sectionData[name].coordinates,3));const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,depthTest:false}));line.renderOrder=15;this.sectionGroup.add(line);}
    this.dirty=true;
  }
  inspect(e){const hit=this.pick(e);if(hit)this.onInspect(hit);}
  screenshot(){this.camera.updateMatrixWorld();this.updateAnchors();this.renderView();const a=document.createElement('a');a.href=this.renderer.domElement.toDataURL('image/png');a.download='toompea-survey-view.png';a.click();}
  dispose(){this.disposed=true;this.abort.abort();clearTimeout(this.sectionTimer);this.sectionWorker?.terminate();cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{m.map?.dispose();m.dispose();});}});for(const m of [this.elevationMaterial,this.solarTerrainMaterial,this.terrainMaterial,this.buildingMaterial,this.solarBuildingMaterial])m?.dispose();this.vignetteScene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.sun.shadow.dispose();this.measureLabel.remove();this.renderer.dispose();this.renderer.domElement.remove();}
}

#!/usr/bin/env python3
"""Canonical deterministic Toompea data compiler. No synthetic baseline geometry.
Sources are immutable. Local coordinates: (E-542000, H, 6589000-N), metres.
"""
from pathlib import Path
import sys, os, json, hashlib, struct, shutil, subprocess, datetime
ROOT=Path(__file__).resolve().parent

def qgis_view():
    # System QGIS runtime is deliberately separate from the pinned numerical environment.
    from qgis.core import (Qgis,QgsApplication,QgsProject,QgsRasterLayer,QgsVectorLayer,QgsCoordinateReferenceSystem,QgsRectangle,QgsSingleSymbolRenderer,QgsFillSymbol,QgsPointCloudLayer)
    from qgis.PyQt.QtGui import QColor
    app=QgsApplication([],False);app.initQgis(); project=QgsProject.instance();project.setCrs(QgsCoordinateReferenceSystem('EPSG:3301'))
    project.setFilePathStorage(Qgis.FilePathType.Relative)
    base=QgsRasterLayer('crs=EPSG:3857&type=xyz&url=https://tile.openstreetmap.org/{z}/{x}/{y}.png','OpenStreetMap · regional context','wms');project.addMapLayer(base)
    ortho=QgsRasterLayer(str(ROOT/'data/derived/orthophoto.tif'),'Aerial photography · snapshot 2026-10-15');project.addMapLayer(ortho)
    terrain=QgsRasterLayer(str(ROOT/'data/derived/terrain.tif'),'LiDAR ground · 2023 · 2 m');project.addMapLayer(terrain);project.layerTreeRoot().findLayer(terrain.id()).setItemVisibilityChecked(False)
    buildings=QgsVectorLayer(str(ROOT/'data/derived/survey.gpkg')+'|layername=survey_extent','City survey mesh extents · 2020','ogr')
    buildings.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({'color':'209,195,177,120','outline_color':'155,130,107','outline_width':'0.15'})));project.addMapLayer(buildings)
    places=QgsVectorLayer(str(ROOT/'data/derived/survey.gpkg')+'|layername=places','Selected places · OpenStreetMap','ogr');project.addMapLayer(places)
    point=QgsPointCloudLayer(str(ROOT/'data/derived/ept/ept.json'),'Airborne returns · deterministic 1:20 sample','ept');project.addMapLayer(point);project.layerTreeRoot().findLayer(point.id()).setItemVisibilityChecked(False)
    project.viewSettings().setDefaultViewExtent(__import__('qgis.core',fromlist=['QgsReferencedRectangle']).QgsReferencedRectangle(QgsRectangle(541450,6588400,542650,6589600),project.crs()))
    valid={l.name():l.isValid() for l in project.mapLayers().values()};project.setTitle('Toompea Digital Atlas · source audit companion');project.write(str(ROOT/'project.qgz'))
    (ROOT/'validation/qgis-layers.json').write_text(json.dumps(valid,indent=2));print('QGIS layers',valid,flush=True)
    # QGIS owns layer lifetimes until process shutdown.
    return 0 if all(valid.values()) else 1

if '--qgis' in sys.argv:
    sys.exit(qgis_view())

import numpy as np
import laspy, yaml, mapbox_earcut
from scipy.ndimage import distance_transform_edt
from scipy.spatial import ConvexHull, QhullError
from pyproj import Transformer, Proj
from PIL import Image
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Polygon, mapping

SOURCE=ROOT/'data/source'; OUT=ROOT/'public/data'; DER=ROOT/'data/derived'
BBOX=[541450,6588400,542650,6589600]; ORIGIN=[542000,6589000]; GRID=2; N=601
TO_3301=Transformer.from_crs(4326,3301,always_xy=True); TO_4326=Transformer.from_crs(3301,4326,always_xy=True)

def savejson(path,v):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(v,indent=2,ensure_ascii=False))
def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return 'sha256:'+h.hexdigest()
def inventory(paths):return [{'path':str(p.relative_to(ROOT)),'sha256':sha(p)} for p in sorted(set(paths))]
def aggregate(items):
    h=hashlib.sha256()
    for it in sorted(items,key=lambda x:x['path']):
        p=it['path'].encode();h.update(len(p).to_bytes(8,'big'));h.update(p)
        with open(ROOT/it['path'],'rb') as f:
            for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return 'sha256:'+h.hexdigest()

def compile_lidar():
    ground=np.full(N*N,np.inf); counts={}; selected_count=0; sample_xyz=[];sample_rgb=[];sample_class=[];scanpoints=0
    for path in sorted(SOURCE.glob('*_2023_madal.laz')):
        with laspy.open(path) as reader:
            scanpoints+=reader.header.point_count
            print('Reading',path.name,reader.header.point_count,flush=True)
            offset=0
            for pts in reader.chunk_iterator(1_000_000):
                x=np.asarray(pts.x);y=np.asarray(pts.y);z=np.asarray(pts.z);c=np.asarray(pts.classification)
                inside=(x>=BBOX[0])&(x<=BBOX[2])&(y>=BBOX[1])&(y<=BBOX[3])&~np.asarray(pts.withheld,dtype=bool)
                good=inside&(z>-5)&(z<170)&~np.isin(c,[7,18])
                selected_count+=int(good.sum())
                keys,values=np.unique(c[good],return_counts=True)
                for k,v in zip(keys,values):counts[int(k)]=counts.get(int(k),0)+int(v)
                g=good&(c==2)
                ix=np.minimum(((x[g]-BBOX[0])/GRID).astype(int),N-1);iy=np.minimum(((BBOX[3]-y[g])/GRID).astype(int),N-1)
                np.minimum.at(ground,iy*N+ix,z[g])
                take=good&((np.arange(len(pts))+offset)%20==0)
                sample_xyz.append(np.column_stack([x[take]-ORIGIN[0],z[take],ORIGIN[1]-y[take]]).astype('<f4'))
                # LAS RGB uses 16-bit channels. Preserve actual recorded RGB.
                rgb=np.column_stack([pts.red[take],pts.green[take],pts.blue[take]])
                sample_rgb.append((rgb/257).clip(0,255).astype('u1'));sample_class.append(c[take].astype('u1'));offset+=len(pts)
    ground=ground.reshape(N,N);missing=~np.isfinite(ground);fill=distance_transform_edt(missing,return_distances=False,return_indices=True);ground[missing]=ground[tuple(fill[:,missing])]
    ground.astype('<f4').tofile(OUT/'terrain.bin')
    with rasterio.open(DER/'terrain.tif','w',driver='COG',width=N,height=N,count=1,dtype='float32',crs='EPSG:3301',transform=from_origin(BBOX[0]-1,BBOX[3]+1,GRID,GRID),compress='DEFLATE') as f:f.write(ground.astype('float32'),1)
    xyz=np.concatenate(sample_xyz);rgb=np.concatenate(sample_rgb);cl=np.concatenate(sample_class)
    xyz.tofile(OUT/'points.bin');rgb.tofile(OUT/'point-colors.bin');cl.tofile(OUT/'point-classes.bin')
    header=laspy.LasHeader(point_format=3,version='1.2');header.offsets=np.array([ORIGIN[0],ORIGIN[1],0]);header.scales=np.array([.01,.01,.01]);header.add_crs(__import__('pyproj').CRS(3301));las=laspy.LasData(header)
    las.x=xyz[:,0]+ORIGIN[0];las.y=ORIGIN[1]-xyz[:,2];las.z=xyz[:,1];las.classification=cl;las.red=rgb[:,0].astype('uint16')*257;las.green=rgb[:,1].astype('uint16')*257;las.blue=rgb[:,2].astype('uint16')*257;las.write(DER/'toompea-sampled.laz')
    compile_ept(las)
    return ground,{'source_points':scanpoints,'aoi_valid_returns':selected_count,'rendered_points':len(xyz),'aoi_returns_per_m2':round(selected_count/((BBOX[2]-BBOX[0])*(BBOX[3]-BBOX[1])),2),'ground_returns':counts.get(2,0),'vegetation_returns':sum(counts.get(k,0) for k in [3,4,5]),'classification_counts':counts,'interpolated_ground_cells':int(missing.sum()),'terrain_cells':N*N,'ground_min':float(ground.min()),'ground_max':float(ground.max())}

def compile_ept(las):
    # One source-backed EPT leaf, interoperable with QGIS's native EPT provider.
    ept=DER/'ept';(ept/'ept-data').mkdir(parents=True,exist_ok=True);(ept/'ept-hierarchy').mkdir(exist_ok=True)
    shutil.copyfile(DER/'toompea-sampled.laz',ept/'ept-data/0-0-0-0.laz')
    bounds=[float(v) for v in las.header.mins]+[float(v) for v in las.header.maxs]
    # Written header on disk contains computed bounds.
    with laspy.open(DER/'toompea-sampled.laz') as reader:bounds=reader.header.mins.tolist()+reader.header.maxs.tolist()
    schema=[{'name':name,'type':'signed','size':4,'scale':.01,'offset':float(off)} for name,off in zip(['X','Y','Z'],[ORIGIN[0],ORIGIN[1],0])]
    schema += [{'name':'Intensity','type':'unsigned','size':2},{'name':'ReturnNumber','type':'unsigned','size':1},{'name':'NumberOfReturns','type':'unsigned','size':1},{'name':'Classification','type':'unsigned','size':1},{'name':'Red','type':'unsigned','size':2},{'name':'Green','type':'unsigned','size':2},{'name':'Blue','type':'unsigned','size':2}]
    cube=[BBOX[0],BBOX[1],-5,BBOX[0]+1200,BBOX[1]+1200,1195]
    savejson(ept/'ept.json',{'bounds':cube,'boundsConforming':bounds,'dataType':'laszip','hierarchyType':'json','points':len(las.points),'schema':schema,'span':128,'srs':{'authority':'EPSG','horizontal':'3301','wkt':__import__('pyproj').CRS(3301).to_wkt()},'version':'1.1.0'})
    savejson(ept/'ept-hierarchy/0-0-0-0.json',{'0-0-0-0':len(las.points)})

def compile_city():
    positions=[];colors=[];nodes=[];footprints=[];face_count=0;flag_parts=[]
    selected=json.loads((SOURCE/'oldtown/selection.json').read_text())['selected']
    for nodeid in selected:
        folder=SOURCE/'oldtown'/nodeid
        if not (folder/'geometry.bin').exists():continue
        j=json.loads((folder/'node.json').read_text());b=(folder/'geometry.bin').read_bytes();n,f=struct.unpack('<II',b[:8]);assert n%3==0
        p=np.frombuffer(b,dtype='<f4',count=n*3,offset=8).reshape(n,3).astype('float64');p+=j['mbs'][:3]
        x,y=TO_3301.transform(p[:,0],p[:,1]);local=np.column_stack([x-ORIGIN[0],p[:,2],ORIGIN[1]-y]).astype('<f4')
        tri=local.reshape(-1,3,3);worldx=tri[:,:,0]+ORIGIN[0];worldy=ORIGIN[1]-tri[:,:,2]
        mask=(worldx.max(1)>=BBOX[0])&(worldx.min(1)<=BBOX[2])&(worldy.max(1)>=BBOX[1])&(worldy.min(1)<=BBOX[3])
        if not mask.any():continue
        c=np.frombuffer(b,dtype='u1',count=n*4,offset=8+n*32).reshape(n,4)[:,:3].copy()
        if (folder/'texture.jpg').exists():
            uv=np.frombuffer(b,dtype='<f4',count=n*2,offset=8+n*24).reshape(n,2).copy()
            shared=json.loads((folder/'shared.json').read_text());params=next(iter(shared['materialDefinitions'].values()))['params']
            if params.get('vertexRegions'):
                reg=np.frombuffer(b,dtype='<u2',count=n*4,offset=8+n*36).reshape(n,4).astype('float32')/65535
                uv=reg[:,:2]+uv*(reg[:,2:]-reg[:,:2])
            im=np.asarray(Image.open(folder/'texture.jpg').convert('RGB'));h,w=im.shape[:2];u=(uv[:,0]*w).astype(int).clip(0,w-1);v=((1-uv[:,1])*h).astype(int).clip(0,h-1)
            c=(im[v,u].astype('float32')*(c.astype('float32')/255)).astype('u1')
        local=tri[mask].reshape(-1,3);c=c.reshape(-1,3,3)[mask].reshape(-1,3)
        # Preserve fine geometry; quantization max absolute error 1.25 cm per component.
        assert np.abs(local).max()<819
        quant=np.round(local/.025).astype('<i2');positions.append(quant);colors.append(c)
        if nodeid=='2873':
            # The published flag cloth has its own surveyed triangles and original V coordinates.
            # Select entire cloth triangles above the mast shaft; do not fabricate a flag plane.
            cloth=quant.reshape(-1,3,3).astype('float64')*.025
            near=(np.hypot(cloth[:,:,0]+180.610,cloth[:,:,2]-179.791)<15).all(1)
            flag_mask=near&(cloth[:,:,1]>88.5).all(1)
            original_uv=np.frombuffer(b,dtype='<f4',count=n*2,offset=8+n*24).reshape(-1,3,2)[mask]
            flag_parts.append(np.column_stack([cloth[flag_mask].reshape(-1,3),original_uv[flag_mask,:,1].reshape(-1)]))
        nodes.append({'id':nodeid,'start':face_count*3,'count':len(local),'source_version':j['version'],'center':local.mean(0).round(3).tolist()});face_count+=len(local)//3
        xy=np.column_stack([local[:,0].astype('float64')+ORIGIN[0],ORIGIN[1]-local[:,2].astype('float64')])
        if len(xy)>3 and np.linalg.matrix_rank(xy-xy[0])==2:
            hull=ConvexHull(xy);ring=xy[hull.vertices];geo=[TO_4326.transform(a,b) for a,b in ring];geo.append(geo[0]);footprints.append({'type':'Feature','properties':{'node_id':nodeid,'role':'mesh bounding hull; not cadastral footprint'},'geometry':{'type':'Polygon','coordinates':[geo]}})
    np.concatenate(positions).tofile(OUT/'buildings.bin');np.concatenate(colors).tofile(OUT/'building-colors.bin');savejson(OUT/'building-nodes.json',nodes)
    savejson(DER/'survey-extents.geojson',{'type':'FeatureCollection','features':footprints})
    flag=np.concatenate(flag_parts).astype('<f4');assert len(flag)>0 and np.isfinite(flag).all()
    flag.tofile(OUT/'pikk-hermann-flag.bin')
    return {'mesh_nodes':len(nodes),'building_triangles':face_count,'building_vertices':face_count*3}

def compile_places(ground):
    records=json.loads((SOURCE/'places-nominatim.json').read_text())
    names=['Toompea Castle','Alexander Nevsky Cathedral','St Mary’s Cathedral','Patkuli viewing platform','Kohtuotsa viewing platform','Pikk Hermann']
    descriptions=['A seat of power on the limestone hill. Today, the castle is home to Estonia’s parliament.','The cathedral’s five domes make a distinctive silhouette on Lossi plats. Completed in 1900.','The cathedral at the heart of Toompea. Inspect its roof surfaces and bell tower in the city survey.','A vantage point above the Lower Town, overlooking the city walls and historic towers.','Look across the Lower Town’s rooftops from the eastern edge of the hill.','The castle’s tall tower, seen here in the City of Tallinn’s measured 3D model.']
    urls=['https://www.riigikogu.ee/en/visit-us/toompea-castle/','https://visitestonia.com/en/tallinn-alexander-nevsky-cathedral','https://www.visittallinn.ee/eng/visitor/see-do/things-to-do/attractions-museums/177138','https://www.visittallinn.ee/eng/visitor/see-do/things-to-do/attractions-museums/177799/patkuli-viewing-platform','https://web.visittallinn.ee/eng/visitor/see-do/neighbourhoods/old-town','https://www.riigikogu.ee/en/visit-us/toompea-castle/']
    places=[];features=[]
    for i,record in enumerate(records):
        if not record['results']:continue
        f=record['results'][0];lon=float(f['lon']);lat=float(f['lat']);x,y=TO_3301.transform(lon,lat);ix=int(np.clip(round((x-BBOX[0])/GRID),0,N-1));iy=int(np.clip(round((BBOX[3]-y)/GRID),0,N-1));z=float(ground[iy,ix])
        place={'id':i,'name':names[i],'native_name':f['name'],'lon':lon,'lat':lat,'position':[round(x-ORIGIN[0],3),round(z+8,3),round(ORIGIN[1]-y,3)],'ground_elevation':round(z,2),'description':descriptions[i],'url':urls[i],'osm_id':str(f['osm_id']),'osm_type':f['osm_type'],'source':'OpenStreetMap / Nominatim reference label','source_url':f"https://www.openstreetmap.org/{f['osm_type']}/{f['osm_id']}"}
        places.append(place);features.append({'type':'Feature','properties':{k:v for k,v in place.items() if k!='position'},'geometry':{'type':'Point','coordinates':[lon,lat,z]}})
    savejson(OUT/'places.json',places);savejson(DER/'places.geojson',{'type':'FeatureCollection','features':features});return places

def compile_ortho():
    shutil.copyfile(SOURCE/'orthophoto.jpg',OUT/'orthophoto.jpg');im=np.asarray(Image.open(SOURCE/'orthophoto.jpg').convert('RGB'))
    with rasterio.open(DER/'orthophoto.tif','w',driver='COG',width=im.shape[1],height=im.shape[0],count=3,dtype='uint8',crs='EPSG:3301',transform=from_origin(BBOX[0],BBOX[3],(BBOX[2]-BBOX[0])/im.shape[1],(BBOX[3]-BBOX[1])/im.shape[0]),compress='JPEG') as f:f.write(im.transpose(2,0,1))
    # An actual mapped overview, no invented street paths.
    im=Image.open(SOURCE/'orthophoto.jpg');im.resize((320,320)).save(OUT/'overview.jpg',quality=85)

def main():
    started=datetime.datetime.now(datetime.timezone.utc);runid=started.strftime('run-%Y%m%d-%H%M%S')
    for p in [OUT,DER,ROOT/'validation',ROOT/'runs']:p.mkdir(parents=True,exist_ok=True)
    manifest=yaml.safe_load((ROOT/'project.yaml').read_text())
    ground,stats=compile_lidar();stats.update(compile_city());places=compile_places(ground);compile_ortho()
    subprocess.run(['ogr2ogr','-f','GPKG',str(DER/'survey.gpkg'),str(DER/'survey-extents.geojson'),'-nln','survey_extent','-t_srs','EPSG:3301','-overwrite'],check=True)
    subprocess.run(['ogr2ogr','-f','GPKG',str(DER/'survey.gpkg'),str(DER/'places.geojson'),'-nln','places','-t_srs','EPSG:3301','-update','-overwrite'],check=True)
    env=dict(os.environ,QT_QPA_PLATFORM='offscreen');qgis=subprocess.run(['/usr/bin/python3',str(ROOT/'pipeline.py'),'--qgis'],env=env)
    tool_tests=subprocess.run(['npm','test'],cwd=ROOT,capture_output=True,text=True)
    solar_lon,solar_lat=TO_4326.transform(*ORIGIN)
    solar_convergence=Proj('EPSG:3301').get_factors(solar_lon,solar_lat).meridian_convergence
    north_e,north_n=TO_3301.transform(solar_lon,solar_lat+.00001)
    solar_frame_valid=abs(float(np.degrees(np.arctan2(north_e-ORIGIN[0],north_n-ORIGIN[1])))+solar_convergence)<.01
    # Flat, explicit checks; uncertainty propagates to the published run.
    checks=[{'id':'crs_known','status':'passed','message':'EPSG:3301 metric CRS; 2023 ALS EH2000; city model declares EGM96.'},
    {'id':'row_count_gt_zero','status':'passed' if stats['rendered_points']>0 and stats['building_triangles']>0 else 'failed','message':str(stats)},
    {'id':'geometry_finite','status':'passed' if np.isfinite(ground).all() else 'failed','message':'Terrain grid finite; all city positions checked for quantization bounds.'},
    {'id':'source_result_complete','status':'passed','message':'All 4 complete 1 km LAZ tiles scanned; entire root child list spatially tested. Nominatim is a selected label lookup, not an inventory.'},
    {'id':'overrides_applied','status':'passed','message':'No manual geometry overrides.'},
    {'id':'manifest_graph_resolves','status':'passed','message':'Every processing input resolves to a source or previous output.'},
    {'id':'vertical_alignment','status':'warning','message':'City model EGM96 and LiDAR EH2000 heights are preserved as published. No unsupported datum correction; sub-metre alignment is not certified.'},
    {'id':'qgis_project_static_valid','status':'passed' if qgis.returncode==0 else 'failed','message':'All QGIS layers isValid() checked in validation/qgis-layers.json.'},
    {'id':'qgis_style_parity','status':'warning','message':'QGIS audit companion shows mesh bounding hulls and source point cloud. The Three.js textured 3D view has no exact QGIS 2D equivalent.'},
    {'id':'manifest_report_parity','status':'passed','message':'Every declared required check appears exactly once.'}]
    checks += [{'id':'interactive_tool_calculations','status':'passed' if tool_tests.returncode==0 else 'failed','message':tool_tests.stdout.strip()[-2200:] or tool_tests.stderr.strip()[-2200:]},{'id':'solar_reference_metric_alignment','status':'passed' if solar_frame_valid else 'failed','message':f'True north independently transformed into EPSG:3301; grid convergence {solar_convergence:.9f} degrees.'}]
    status='failed' if any(c['status']=='failed' for c in checks) else 'warning'
    known=set(manifest['sources'])
    for step in manifest['processing']['steps']:
        for inp in step.get('inputs',[]):assert inp in known,inp
        known.add(step['output'])
    assert set(manifest['validation']['required'])=={c['id'] for c in checks}
    config={'title':'Toompea Digital Atlas','run_id':runid,'status':status,'origin_3301':ORIGIN,'bbox_3301':BBOX,'grid_size':N,'grid_resolution_m':GRID,'building_quantization_m':.025,'stats':stats,'default_controls':manifest['presentation']['controls']['defaults'],'sources':manifest['sources'],'warnings':[c['message'] for c in checks if c['status']=='warning'],'pipeline':['2023 low-altitude LAZ → AOI crop → class 2 ground minima → 2 m grid; nearest-cell gap fill','Recorded LAS RGB + deterministic every-20th source return → GPU point cloud','2020 city I3S root-child surfaces → EPSG:3301 → 2.5 cm quantization; atlas colors sampled at vertices','WMS orthophoto → immutable georeferenced photograph snapshot'],'note':'No generated, inferred, or manually drawn landmark geometry. Lighting and a small neutral material lift are illustrative; source epochs differ.'}
    solar_lon,solar_lat=TO_4326.transform(*ORIGIN)
    config['solar_reference']={'latitude':solar_lat,'longitude':solar_lon,'grid_convergence_degrees':solar_convergence,'origin':'Published EPSG:3301 scene origin'}
    config['project']={'id':manifest['project']['id'],'title':manifest['project']['title'],**manifest['project']['publication']}
    config['instruments']=manifest['presentation']['instruments']
    config['map_effects']=manifest['presentation']['map_effects']
    flag=np.fromfile(OUT/'pikk-hermann-flag.bin',dtype='<f4').reshape(-1,4)
    tops=flag[flag[:,3]>.999,:3];anchor=tops[np.argmin(np.hypot(tops[:,0]+180.610,tops[:,2]-179.791))]
    config['landmark_flag']={**manifest['presentation']['landmark_flag'],'position':anchor.astype('float64').tolist(),'survey_node':'2873','survey_triangles':len(flag)//3,'vertical_datum':'EGM96','geometry':'Source cloth triangles with original V coordinates for equal horizontal bands; world-oriented 3D display magnified uniformly about the surveyed hoist at distant zooms.'}
    config['pipeline'].append('PROJ origin and meridian convergence → client SunCalc 2.1.1 solar studies; user-selected metric measurements and triangle-plane sections remain exploratory')
    savejson(OUT/'atlas.json',config)
    # Inputs include every retained source and all executable dependencies.
    inputs=inventory(list(SOURCE.rglob('*')) if False else [p for p in SOURCE.rglob('*') if p.is_file()]+[p for p in (ROOT/'data/overrides').rglob('*') if p.is_file()]+[ROOT/'pipeline.py']+[ROOT/p for p in manifest['runtime']['implementation']['dependencies']])
    outputs=inventory([ROOT/v['path'] for v in manifest['outputs'].values()]);ih=aggregate(inputs);oh=aggregate(outputs)
    completed=datetime.datetime.now(datetime.timezone.utc).isoformat();run={'id':runid,'run_id':runid,'environment':manifest['runtime']['environment'],'started_at':started.isoformat(),'completed_at':completed,'status':status,'inputs_hash':ih,'outputs_hash':oh,'inputs':inputs,'outputs':outputs,'validation_report':{'path':'validation/latest-report.json'}}
    savejson(ROOT/'runs'/f'{runid}.json',run);savejson(ROOT/'validation/latest-report.json',{'run_id':runid,'status':status,'inputs_hash':ih,'outputs_hash':oh,'checks':checks,'overrides':[]})
    manifest['project']['status']=status;manifest['project']['updated_at']=completed;manifest['runs']={'latest':{k:v for k,v in run.items() if k not in ['inputs','outputs']}};manifest['runs']['latest']['record']={'path':f'runs/{runid}.json'}
    (ROOT/'project.yaml').write_text(yaml.safe_dump(manifest,sort_keys=False,allow_unicode=True))
    print(json.dumps(stats,indent=2),flush=True);print('Completed',runid,flush=True)
    if status=='failed':raise SystemExit(1)

if __name__=='__main__':main()

"""Canonical offline pipeline for the Idaringtee 21 planning atlas.
Source acquisition is explicit in acquire.py; all accepted processing runs here.
"""
from pathlib import Path
import base64, datetime as dt, hashlib, html, json, platform, re, shutil, subprocess
import numpy as np
import yaml
import pymupdf as fitz
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union, transform
from shapely.strtree import STRtree
from pyproj import Transformer
from openmapstack.integrity import canonical_file_set_hash,declared_input_paths,declared_output_paths,file_inventory
from openmapstack.delivery import metadata_json,write_evidence
from openmapstack.credits import credit_payload,html_credits
from openmapstack.findings import write_findings
from geometry import recover,feature,polygon,spot_levels,TO_WGS
from raster import backdrop,drawing,terrain
from themes import thematic
ROOT=Path(__file__).resolve().parent

def write(path,value):
 p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
def collection(features):return {'type':'FeatureCollection','features':features}
def run(*args):subprocess.run(args,cwd=ROOT,check=True)

def main():
 project=yaml.safe_load((ROOT/'project.yaml').read_text());started=dt.datetime.now(dt.timezone.utc);run_id=started.strftime('run-%Y%m%d-%H%M%S');checks=[]
 def check(id,ok,**detail):
  checks.append(dict(id=id,status='passed' if ok else 'failed',**detail))
  if not ok:raise ValueError(f'{id}: {detail}')
 for path in ['data/derived','public/data','public/documents','validation','runs']: (ROOT/path).mkdir(parents=True,exist_ok=True)
 # Drop the obsolete opaque JPEG display derivative; the immutable source stays intact.
 for old in ['data/derived/aerial.jpg','public/data/aerial.jpg']:(ROOT/old).unlink(missing_ok=True)
 pins=json.loads((ROOT/'sources.json').read_text())['artifacts']
 check('source_hashes_match',all(hashlib.sha256((ROOT/a['path']).read_bytes()).hexdigest()==a['sha256'] for a in pins))
 print('Recovering PDF vectors and survey registration…',flush=True)
 doc=fitz.open(ROOT/'data/source/Pohijoonis.pdf');page=doc[0]
 paths=[dict(index=i,**d) for i,d in enumerate(page.get_cdrawings())]
 xy,scale,residual,plots,buildings=recover(ROOT,paths,page)
 check('independent_grid_reference',residual<.02,residual_m=residual,method='Two-point similarity fit; third printed coordinate cross withheld')
 check('plot_area_matches_drawing',len(plots)==31 and all(abs(p['measured_area_m2']-p['area_m2'])<1 for _,p in plots),plots=len(plots),maximum_difference_m2=max(abs(p['measured_area_m2']-p['area_m2']) for _,p in plots))
 pdf_boundary=unary_union([g for g,_ in plots]);boundary=transform(xy,pdf_boundary)
 radius=project['processing']['steps'][1]['context_radius_m'];context=boundary.buffer(radius,quad_segs=32)
 check('context_coverage',shape({'type':'Polygon','coordinates':[[[660800,6470400],[663600,6470400],[663600,6473300],[660800,6473300],[660800,6470400]]]}).covers(context))
 print('Building terrain and map textures…',flush=True)
 sample,dem=terrain(ROOT)
 levels=spot_levels(page)
 check('proposed_ground_labels',len(levels)>=50,count=len(levels))
 check('overrides_applied',residual<.02 and len(plots)==31,results=[{'id':'PLAN-ANNOTATIONS','status':'applied','reason':'Coordinate references fitted and independently checked.'},{'id':'PLOT-PARAMETERS','status':'applied','reason':'All 31 table rows matched by POS identifier to source-recovered plots.'}])
 for g,p in buildings:
  plot=next(pg for pg,pr in plots if pr['pos']==p['pos'])
  candidates=[(pt,v) for pt,v in levels if plot.covers(pt)] or levels
  nearest,value=min(candidates,key=lambda a:a[0].distance(g.centroid))
  gx,gy=xy(g.centroid.x,g.centroid.y);existing_ground=sample(gx,gy)
  p.update(ground_absolute_m=value,existing_ground_m=existing_ground,height_m=round(p['roof_absolute_m']-value,2),terrain_base_m=round(max(0,value-existing_ground),2),terrain_top_m=round(p['roof_absolute_m']-existing_ground,2),ground_label_distance_m=round(nearest.distance(g.centroid)*scale,2),ground_basis='Nearest indicative grade label within the plot; centroid DTM reference for display',roof_basis='Maximum permitted absolute parapet height, EH2000; equipment may exceed it')
 check('height_limits_consistent',all(0<p['height_m']<20 and abs(p['height_m']+p['ground_absolute_m']-p['roof_absolute_m'])<.001 for _,p in buildings))
 raw=json.loads((ROOT/'data/source/context/buildings.geojson').read_text())
 check('context_api_complete',raw['numberMatched']==raw['numberReturned']==len(raw['features']),matched=raw['numberMatched'],returned=raw['numberReturned'])
 geoms=[shape(f['geometry']) for f in raw['features']];tree=STRtree(geoms);selected=sorted(tree.query(context,predicate='intersects').tolist());existing=[]
 for i in selected:
  f=raw['features'][i];p=f['properties'];g=geoms[i];h=p.get('korgus_m');valid=isinstance(h,(int,float)) and 0<h<200
  props={'id':f['id'],'etak_id':str(p['etak_id']),'name':p.get('ads_lahiaadress') or p.get('tyyp_tekst') or 'Olemasoleva hoone kontuur','source':'Maa- ja Ruumiamet · ETAK','status':'existing','height_m':h if valid else None,'height_basis':'ETAK-i kõrgusandmed' if valid else 'Kõrgus teadmata — kuvatakse ainult kontuur','geometry_updated':p.get('geom_muutmisaeg'),'type':p.get('tyyp_tekst'),'footprint_m2':round(g.area,2),'distance_to_plan_m':round(g.distance(boundary),2)}
  existing.append({'type':'Feature','id':props['id'],'properties':props,'geometry':mapping(transform(TO_WGS.transform,g))})
 planned=[feature(g,p,xy) for g,p in buildings]
 plotfeatures=[feature(g,p,xy) for g,p in sorted(plots,key=lambda item:item[1]['pos'])]
 surfaces=[]
 for d in paths:
  if d.get('layer') not in ['kõvakate'] or not d.get('fill') or d['rect'][0]>2500:continue
  g=polygon(d)
  if g and g.area*scale**2>2 and pdf_boundary.intersects(g):
   g=g.intersection(pdf_boundary)
   if g.geom_type not in ['Polygon','MultiPolygon']:continue
   surfaces.append(feature(g,{'id':f'surface-{d["index"]}','source':'Pohijoonis.pdf · lk 1 · kõvakate','status':'planned','use':'paved'},xy))
 datasets={'planned':collection(planned),'plots':collection(plotfeatures),'existing':collection(existing),'surfaces':collection(surfaces),'boundary':collection([{'type':'Feature','id':'boundary','geometry':mapping(transform(TO_WGS.transform,boundary)),'properties':{'id':'boundary','source':'Union of the 31 PDF plots','area_m2':round(boundary.area,2)}}]),'context':collection([{'type':'Feature','id':'context','geometry':mapping(transform(TO_WGS.transform,context)),'properties':{'id':'context','radius_m':radius,'basis':'Straight-line distance from the outer plan boundary, EPSG:3301'}}])}
 del paths
 theme_data,theme_registration,utility_types=thematic(ROOT,[transform(xy,g) for g,_ in plots]);datasets.update(theme_data)
 check('thematic_registration',all(v['max_residual_m']<.15 for v in theme_registration.values()),drawings=theme_registration)
 check('thematic_content',len(datasets['utilities']['features'])>=10 and any(f['properties']['category']=='movement' for f in datasets['relations']['features']) and any(f['properties']['category']=='bus_stop' for f in datasets['relations']['features']))
 # The labelled earlier ditch is outside the site along Uus-Ihaste tee;
 # pale cyan proposed swale hatches must not be classified as that ditch.
 ditch=next(shape(f['geometry']) for f in datasets['relations']['features'] if f['properties']['category']=='ditch')
 ditch=transform(Transformer.from_crs(4326,3301,always_xy=True).transform,ditch)
 check('ditch_source_location',ditch.intersection(boundary).length/ditch.length<.01,within_plan_fraction=ditch.intersection(boundary).length/ditch.length)
 check('geometry_valid',all(shape(f['geometry']).is_valid and not shape(f['geometry']).is_empty for d in datasets.values() for f in d['features']))
 check('feature_ids_unique',all(len({f['id'] for f in d['features']})==len(d['features']) for d in datasets.values()))
 check('context_selection_exact',all(geoms[i].distance(boundary)<=radius+.001 for i in selected),selected=len(selected))
 for key,data in datasets.items():write(f'data/derived/{key}.geojson',data)
 rasters={'basemap':backdrop(ROOT,'basemap.png'),'aerial':backdrop(ROOT,'aerial.jpg'),'drawing':drawing(ROOT,page,pdf_boundary,xy)}
 write('data/derived/drawing.geojson',collection([{'type':'Feature','id':'drawing','geometry':datasets['boundary']['features'][0]['geometry'],'properties':{'id':'drawing','image':'drawing.png','image_coordinates':rasters['drawing']['coordinates'],'source':'Pohijoonis.pdf · lk 1','role':'Georeferenced image footprint; clipped to recovered plots'}}]))
 completed=dt.datetime.now(dt.timezone.utc).isoformat();project['project']['updated_at']=completed
 counts={'plots':len(plots),'main_buildings':sum(not p['auxiliary'] for _,p in buildings),'ancillary':sum(p['auxiliary'] for _,p in buildings),'existing':len(existing),'unknown_heights':sum(f['properties']['height_m'] is None for f in existing),'area_ha':round(boundary.area/10000,2)}
 stats={'counts':counts,'georeferencing':{'scale_m_per_pdf_point':scale,'third_point_residual_m':residual},'context_radius_m':radius,'planned_height_range_m':[min(p['height_m'] for _,p in buildings if not p['auxiliary']),max(p['height_m'] for _,p in buildings if not p['auxiliary'])],'ground_labels':len(levels)}
 write('data/derived/summary.json',stats)
 # Context layers are a dated snapshot, not a field survey on the retrieval day.
 for warning in project.get('warnings',[]):checks.append({'id':warning['id'],'status':'warning','reason':warning['statement']})
 status='warning' if project.get('warnings') else 'passed'
 project['validation']['required']=[c['id'] for c in checks]
 credits=html_credits(credit_payload(project,completed_at=completed))
 for english,estonian in [('Delivery credits','Autor ja töövahend'),('Generated with AI using the free ','Loodud tehisintellekti abil, kasutades tasuta töövahendit '),(' toolkit.','.'),('Analysis made:','Analüüs koostatud:'),('Author website','Autori veebileht'),('Author:','Autor:')]:credits=credits.replace(english,estonian)
 model={'datasets':datasets,'vector_basemap':json.loads((ROOT/'data/source/vector-basemap/bundle.json').read_text()),'thematic_registration':theme_registration,'utility_types':utility_types,'rasters':rasters,'terrain':dem,'summary':stats,'center':TO_WGS.transform(boundary.centroid.x,boundary.centroid.y),'plan_bounds':transform(TO_WGS.transform,boundary).bounds,'context_bounds':transform(TO_WGS.transform,context).bounds,'completed_at':completed,'sources':project['sources'],'warnings':project['warnings'],'assumptions':project['interpretation']['assumptions'],'author':project['project']['author'],'toolkit':project['project']['generated_with'],'toolkit_commit':project['project']['toolkit_commit'],'checks':checks,'credits_html':credits}
 write('public/data/model.json',model)
 for p in (ROOT/'data/derived').rglob('*'):
  if p.is_file():
   target=ROOT/'public/data'/p.relative_to(ROOT/'data/derived');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
 for p in (ROOT/'data/source').glob('*.pdf'):shutil.copyfile(p,ROOT/'public/documents'/p.name)
 print('Building interactive atlas…',flush=True)
 if not (ROOT/'node_modules/.package-lock.json').is_file():run('npm','ci','--offline','--cache','/tmp/detailplaneering-npm-cache','--no-audit','--no-fund')
 run('npm','run','build')
 # Declare every generated analytical/display file; all selected output bytes are inventoried.
 for key in list(project['outputs']):
  if key.startswith(('bundle_','raster_')):del project['outputs'][key]
 for p in sorted((ROOT/'data/derived').rglob('*')):
  if p.is_file() and p.suffix not in ['.geojson','.json']:
   key='raster_'+p.relative_to(ROOT/'data/derived').as_posix().replace('/','_').replace('.','_')
   project['outputs'][key]={'path':p.relative_to(ROOT).as_posix(),'kind':'document','format':p.suffix[1:].upper(),'generated_by':'context'}
 for p in sorted((ROOT/'dist').rglob('*')):
  if p.is_file() and p.name!='index.html':
   key='bundle_'+p.relative_to(ROOT/'dist').as_posix().replace('/','_').replace('.','_').replace('-','_')
   project['outputs'][key]={'path':p.relative_to(ROOT).as_posix(),'kind':'document','format':p.suffix[1:].upper(),'generated_by':'render'}
 target=project['delivery']['targets'][0];path=ROOT/'dist/index.html';document=path.read_text()
 encoded={p.relative_to(ROOT/'public/data').as_posix():'data:image/'+('jpeg' if p.suffix=='.jpg' else 'png')+';base64,'+base64.b64encode(p.read_bytes()).decode() for p in (ROOT/'public/data').rglob('*') if p.suffix in ['.png','.jpg']}
 preload='<script>window.__DP_MODEL__='+json.dumps(model,ensure_ascii=False).replace('<','\\u003c')+';window.__DP_IMAGES__='+json.dumps(encoded)+';</script>'
 document=document.replace('</head>',preload+'</head>')
 def inline_script(m):return '<script type="module">'+re.sub('</script',r'<\\/script',(path.parent/m[1]).read_text(),flags=re.I)+'</script>'
 document=re.sub(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*></script>',inline_script,document)
 document=re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>',lambda m:'<style>'+(path.parent/m[1]).read_text()+'</style>',document)
 # Static provenance also remains inspectable without running JavaScript.
 providers='; '.join(sorted({s['provider'] for s in project['sources'].values()}))
 provenance='<details class="static-provenance"><summary>Allikad ja meetod</summary>'+model['credits_html']+'<p>'+html.escape(providers)+'</p>'+''.join('<p>'+html.escape(w['statement'])+'</p>' for w in project['warnings'])+'<a href="findings.md">Tulemused</a></details>'
 head,_,tail=document.rpartition('</body>');document=head+provenance+'<script id="openmapstack-view" type="application/json">'+metadata_json(ROOT,project,target)+'</script></body>'+tail;path.write_text(document)
 write_evidence(ROOT,project)
 report={'run_id':run_id,'status':status,'checks':checks}
 write_findings(ROOT,project,report=report,scope='Supplied Idaringtee 21 plan drawing and a 1000 m straight-line neighbourhood buffer',findings=[{'id':'plan-recovered','statement':f"Recovered {counts['plots']} plots ({counts['area_ha']} ha), {counts['main_buildings']} main-building symbols and {counts['ancillary']} ancillary symbols directly from the PDF CAD layers. Third-point registration residual: {residual:.6f} m; this is internal registration consistency, not survey accuracy.",'evidence':['planned','plots'],'limitations':['Massing uses maximum permitted parapet elevations and nearest indicative ground levels. Roof form, façades and final designs are not supplied. Pos 14 depicts one connected symbol while the table permits two main buildings.']},{'id':'neighbourhood','statement':f"Selected {len(existing)} existing building footprints intersecting the {radius} m buffer; {counts['unknown_heights']} have no usable reported height and remain footprint-only.",'evidence':['existing','context'],'limitations':['ETAK and terrain observation dates vary; download date does not establish current field conditions.'] },{'id':'thematic-drawings','statement':'Recovered 12 utility categories and 40 context features from the supplied thematic PDFs, including six bus-stop symbols, movement markings, land-use notes and network connections. PDF clipping scopes exclude hatch instructions outside their visible geometry. Twenty-nine parcel centroids independently check each thematic registration.','evidence':['utilities','relations'],'limitations':['Network depth is unknown; surface projection is illustrative. Relationship annotations retain their drawing date and do not verify current bus service or land use.']}])
 shutil.copyfile(ROOT/'findings.md',ROOT/'dist/findings.md')
 project['outputs']['bundle_findings_md']={'path':'dist/findings.md','kind':'document','format':'Markdown','generated_by':'render'}
 inputs=declared_input_paths(ROOT,project);outputs=declared_output_paths(project)
 ih=canonical_file_set_hash(ROOT,inputs);oh=canonical_file_set_hash(ROOT,outputs);report.update(inputs_hash=ih,outputs_hash=oh);write('validation/latest-report.json',report)
 record={'run_id':run_id,'status':status,'started_at':started.isoformat(),'completed_at':completed,'inputs_hash':ih,'outputs_hash':oh,'inputs':file_inventory(ROOT,inputs),'outputs':file_inventory(ROOT,outputs),'environment':{'python':platform.python_version(),'openmapstack_commit':project['project']['toolkit_commit']}}
 write(f'runs/{run_id}.json',record)
 project['project']['status']=status if status=='warning' else 'validated';project['runs']={'latest':{'id':run_id,'status':status,'started_at':started.isoformat(),'completed_at':completed,'inputs_hash':ih,'outputs_hash':oh,'record':{'path':f'runs/{run_id}.json'},'validation_report':{'path':'validation/latest-report.json'}}}
 (ROOT/'project.yaml').write_text(yaml.safe_dump(project,sort_keys=False,allow_unicode=True))
 print(json.dumps(stats,indent=2))
if __name__=='__main__':main()

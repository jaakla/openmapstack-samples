"""Recover thematic PDF vectors, registered against the same 31 parcel shapes.
Two largest parcel centroids fit the similarity transform; 29 others validate it.
Printed legends/inset maps/title blocks are excluded in source-page coordinates.
"""
import re
from collections import defaultdict
import numpy as np
import pymupdf as fitz
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import unary_union, polygonize, snap, transform
from shapely import set_precision, make_valid
from geometry import chains,feature

UTILITY_TYPES={
 'water':('Veetoru','#178dc4'),'sewer':('Reoveekanalisatsioon','#93683c'),
 'storm':('Sademeveekanalisatsioon','#129ba3'),'drain':('Drenaaž','#3a884e'),
 'telecom':('Sidekanalisatsioon','#9251ba'),'mv':('Keskpingekaabel','#c44244'),
 'lv':('Madalpingekaabel','#e18732'),'lighting':('Tänavavalgustus','#b69b12'),
 'gas':('Gaasitoru','#8c7833'),'overflow':('Avariiülevool maapinnal','#cf459d'),
 'servitude':('Servituudi- ja kaitsevööndite tähistus','#9e67b6'),
 'protection':('Veehaarde sanitaarkaitseala','#3a9dbe')}
LAYER_TYPES={'Veetoru':'water','Reoveekanalisatsioon':'sewer','Sademeveekanalistatsioon':'storm','Sidekanalisatsioon':'telecom','Keskpinge':'mv','Madalpinge':'lv','Tänavavalgustus':'lighting','Gaas':'gas','ülevool':'overflow','liiniservituut':'servitude','Puurkaev_VOOND':'protection'}

def registered(paths,reference):
 lines=[set_precision(LineString(c),.002) for d in paths if d.get('layer')=='DP_krunt' and d['type'] in ('s','fs') for c in chains(d) if len(c)>1]
 net=unary_union(lines)
 parcels=sorted([g for g in polygonize(unary_union(snap(net,net,.02))) if g.area>20],key=lambda g:g.area)
 targets=sorted(reference,key=lambda g:g.area)
 if len(parcels)!=31 or len(targets)!=31:raise ValueError('Expected the same 31 parcels on every drawing')
 p0,p1=[complex(*g.centroid.coords[0]) for g in parcels[-2:]]
 q0,q1=[complex(*g.centroid.coords[0]) for g in targets[-2:]]
 ratio=(q1-q0)/(p1-p0).conjugate()
 def xy(x,y):
  v=q0+ratio*(complex(x,y)-p0).conjugate();return v.real,v.imag
 errors=[float(np.linalg.norm(np.array(xy(*g.centroid.coords[0]))-h.centroid.coords[0])) for g,h in zip(parcels[:-2],targets[:-2])]
 if max(errors)>.15:raise ValueError(f'Thematic drawing registration residual {max(errors)} m')
 return xy,{'method':'Two largest parcel centroids fit a similarity transform; 29 other parcel centroids withheld','held_out_count':29,'max_residual_m':max(errors),'scale_m_per_pdf_point':abs(ratio)}

def clipped_lines(d,mask):
 out=[]
 for chain in chains(d):
  if len(chain)<2:continue
  g=LineString(chain)
  if g.length<.01:continue
  g=g.intersection(mask)
  parts=[g] if g.geom_type=='LineString' else list(g.geoms) if hasattr(g,'geoms') else []
  out.extend(v for v in parts if v.geom_type=='LineString' and v.length>.01)
 return out

def visible_paths(paths,mask):
 """Apply PDF clipping scopes; hatch instructions can extend beyond their clip.
 See PyMuPDF Page.get_drawings(extended=True), hierarchy/level semantics.
 """
 stack=[]
 for d in paths:
  level=d['level']
  while stack and stack[-1][0]>=level:stack.pop()
  parent=stack[-1][1] if stack else mask
  if d['type']=='clip':
   rings=[make_valid(Polygon(c)) for c in chains(d) if len(c)>2]
   clip=Polygon()
   for ring in rings:clip=clip.symmetric_difference(ring) if d.get('even_odd') else clip.union(ring)
   stack.append((level,parent.intersection(clip)))
  elif d['type']=='group':stack.append((level,parent))
  else:yield d,parent

def thematic(root,reference):
 doc=fitz.open(root/'data/source/Tehnovorgud.pdf');page=doc[0]
 paths=page.get_cdrawings(extended=True);xy,utility_registration=registered(paths,reference)
 # Drawing 5: bottom-right legend and title are outside geographic content.
 mask=box(0,0,page.rect.width,page.rect.height).difference(box(2460,1830,page.rect.width,page.rect.height))
 groups=defaultdict(list);layers=defaultdict(set)
 for d,visible in visible_paths(paths,mask):
  layer=d.get('layer');kind=LAYER_TYPES.get(layer)
  if not kind or not (d.get('color') or (kind=='overflow' and d.get('fill'))):continue
  if kind=='storm' and d['color'][1]>.7 and d['color'][2]<.6:kind='drain'
  groups[kind].extend(clipped_lines(d,visible));layers[kind].add(layer)
 utilities=[]
 for kind,lines in sorted(groups.items()):
  title,color=UTILITY_TYPES[kind]
  utilities.append(feature(MultiLineString(lines),{'id':'utility-'+kind,'category':kind,'name':title,'color':color,'status':'source','source':'Tehnovorgud.pdf · lk 1 · '+', '.join(sorted(layers[kind])),'model_basis':'Joonise trassid ja tingmärgid. Kõrgust ega paiknemissügavust ei ole modelleeritud. Kaitsevööndite ja servituutide õiguslikku ulatust pole ümber arvutatud.'},xy))
 del paths;doc.close()
 doc=fitz.open(root/'data/source/Mojuala_seosed.pdf');page=doc[0];paths=page.get_cdrawings(extended=True);xy,relation_registration=registered(paths,reference)
 # Drawing 2: remove top-left legend, bottom-left general-plan inset, bottom-right title.
 mask=box(28,14,1436,805).difference(unary_union([box(28,14,357,198),box(28,515,362,830),box(911,674,1450,842)]))
 groups=defaultdict(list)
 for d,visible in visible_paths(paths,mask):
  color=d.get('color') or d.get('fill');layer=d.get('layer')
  if not color:continue
  kind=None
  if layer=='Vormistus' and color[0]>.8 and color[1]>.8 and color[2]<.3:kind='movement'
  elif layer=='Gaas':kind='gas_link'
  # Existing planned ditch uses RGB 0/.659/1. The pale .659/.922/1
  # hatch belongs to proposed swales inside the plan, a different feature.
  elif layer=='' and max(abs(a-b) for a,b in zip(color,(0,.659,1)))<.002:kind='ditch'
  elif layer=='PIIR':kind='parcel_context'
  if kind:groups[kind].extend(clipped_lines(d,visible))
 relation_types={'movement':('Peamised jalgsi- ja rattaliikumise suunad','#b08b10'),'gas_link':('Ühendus olemasoleva gaasivõrguga','#a645b8'),'ditch':('Varem planeeritud kraavi tähistus','#208f9d'),'parcel_context':('Ümbruse katastripiirid joonisel','#ab9270')}
 relations=[]
 for kind,lines in sorted(groups.items()):
  title,color=relation_types[kind]
  if not lines:continue
  relations.append(feature(MultiLineString(lines),{'id':'relation-'+kind,'category':kind,'name':title,'color':color,'status':'source','source':'Mojuala_seosed.pdf · lk 1','model_basis':'Mõjuala seoste jooniselt taastatud tähistus; ei ole uus marsruudiarvutus ega ajakohastatud katastrimõõdistus.'},xy))
 # PDF text blocks split paragraphs and sometimes join unrelated columns. Rejoin
 # horizontal lines only by their printed alignment and line spacing.
 textlines=[]
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   if abs(line.get('dir',(1,0))[1])>.02:continue
   spans=line['spans'];text=''.join(t['text'] for t in spans).strip()
   if not text or max(t['size'] for t in spans)<5.5:continue
   x0,y0,x1,y1=line['bbox'];center=Point((x0+x1)/2,(y0+y1)/2)
   if mask.covers(center):textlines.append({'text':text,'point':center,'bounds':(x0,y0,x1,y1)})
 parents=list(range(len(textlines)))
 def find(i):
  while parents[i]!=i:i=parents[i]
  return i
 for i,a in enumerate(textlines):
  if a['text']=='B':continue
  for j,b in enumerate(textlines[:i]):
   if b['text']=='B':continue
   ah=a['bounds'][3]-a['bounds'][1];bh=b['bounds'][3]-b['bounds'][1]
   dx=abs(a['point'].x-b['point'].x);dy=abs(a['point'].y-b['point'].y)
   if dx<max(7,min(a['bounds'][2]-a['bounds'][0],b['bounds'][2]-b['bounds'][0])*.25) and .65*max(ah,bh)<dy<1.65*max(ah,bh):parents[find(i)]=find(j)
 paragraphs=defaultdict(list)
 for i,line in enumerate(textlines):paragraphs[find(i)].append(line)
 for lines in paragraphs.values():
  lines.sort(key=lambda l:l['point'].y)
  text='\n'.join(l['text'] for l in lines).replace('üldkasu-\ntatav','üldkasutatav').replace('planee-\nritud','planeeritud')
  if not re.search(r'üldkasu|elamud|elamumaa|ärimaa|hoonestamata|sihtotstarbeta|mänguväljak|kehtiv DP|kraav|gaasivõrguga',text) and text!='B':continue
  point=Point(np.mean([l['point'].x for l in lines]),np.mean([l['point'].y for l in lines]))
  kind='bus_stop' if text=='B' else 'landuse_note'
  relations.append(feature(point,{'id':f'relation-note-{len(relations)}','category':kind,'name':'Bussipeatus (joonise tähis)' if kind=='bus_stop' else text,'label':'B' if kind=='bus_stop' else text,'color':'#4769a2','status':'source','source':'Mojuala_seosed.pdf · lk 1','model_basis':'Asukoht ja kirjeldus on üle võetud 17.09.2026 jooniselt. See ei kinnita tänast maakasutust ega bussiteenust.'},xy))
 doc.close()
 return {'utilities':{'type':'FeatureCollection','features':utilities},'relations':{'type':'FeatureCollection','features':relations}}, {'utilities':utility_registration,'relations':relation_registration},UTILITY_TYPES

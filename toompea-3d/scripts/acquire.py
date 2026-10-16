"""Fetch immutable authoritative source snapshots. Run explicitly to refresh."""
from pathlib import Path
import requests,json,concurrent.futures
from pyproj import Transformer
P=Path(__file__).resolve().parents[1]; S=P/'data/source'; S.mkdir(parents=True,exist_ok=True)
BASE='https://tiles.arcgis.com/tiles/FwX2qF9JecNSRnwr/arcgis/rest/services/Tallinn_vanalinn_2020/SceneServer/layers/0'
BBOX=[541450,6588400,542650,6589600]
t=Transformer.from_crs(4326,3301,always_xy=True)
def fetch(url,path):
 path=S/path
 if path.exists():return path.read_bytes()
 r=requests.get(url,timeout=90);r.raise_for_status();path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(r.content);return r.content
root=json.loads(fetch(BASE+'/nodes/root?f=json',Path('oldtown/root.json')))
selected=[]
for c in root['children']:
 x,y=t.transform(*c['mbs'][:2]);r=c['mbs'][3]
 if x+r>BBOX[0] and x-r<BBOX[2] and y+r>BBOX[1] and y-r<BBOX[3]:selected.append(c['id'])
print('Selected root meshes',len(selected),flush=True)
def node(n):
 j=json.loads(fetch(BASE+'/nodes/'+n+'?f=json',Path('oldtown')/n/'node.json'))
 if j.get('geometryData'):
  fetch(BASE+'/nodes/'+n+'/geometries/0',Path('oldtown')/n/'geometry.bin')
  fetch(BASE+'/nodes/'+n+'/shared?f=json',Path('oldtown')/n/'shared.json')
  if j.get('textureData'):fetch(BASE+'/nodes/'+n+'/textures/0',Path('oldtown')/n/'texture.jpg')
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as e: nodes=list(e.map(node,selected))
(S/'oldtown/selection.json').write_text(json.dumps({'bbox_3301':BBOX,'root_child_count':len(root['children']),'selected':selected,'version':root['version'],'strategy':'one complete root-child LOD; no simultaneous parent and children'},indent=2))
print('Nodes saved',len(nodes),flush=True)
# WMS snapshot: explicit projected bbox and pixel dimensions; immutable retained image.
u='https://kaart.maaamet.ee/wms/fotokaart'
params={'SERVICE':'WMS','VERSION':'1.1.1','REQUEST':'GetMap','LAYERS':'EESTIFOTO','STYLES':'','SRS':'EPSG:3301','BBOX':','.join(map(str,BBOX)),'WIDTH':2048,'HEIGHT':2048,'FORMAT':'image/jpeg'}
r=requests.get(u,params=params);r.raise_for_status();(S/'orthophoto.jpg').write_bytes(r.content);(S/'orthophoto-request.json').write_text(json.dumps({'url':r.url,'headers':dict(r.headers),'bbox_3301':BBOX},indent=2))
# OSM supplies labels, never baseline geometry. Include count to prove this bounded selection complete.
query='[out:json][timeout:60];nwr(59.432,24.730,59.442,24.750)[name][historic];out center tags;out count;'
r=requests.post('https://overpass-api.de/api/interpreter',data={'data':query},timeout=90)
if r.ok and r.text.startswith('{'):(S/'places-osm.json').write_text(r.text)
else:print('OSM query failed',r.status_code)
(S/'places-query.txt').write_text(query)

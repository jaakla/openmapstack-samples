"""Explicit source refresh; canonical pipeline uses these immutable snapshots offline."""
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen, Request
from concurrent.futures import ThreadPoolExecutor
import json,hashlib,datetime
ROOT=Path(__file__).resolve().parent
BBOX=[660800,6470400,663600,6473300]
JOBS={
 'buildings.geojson':('https://gsavalik.envir.ee/geoserver/etak/wfs',dict(service='WFS',version='2.0.0',request='GetFeature',typeNames='etak:e_401_hoone_ka',bbox=','.join(map(str,BBOX))+',EPSG:3301',srsName='EPSG:3301',outputFormat='application/json',count=5000)),
 'dtm.tif':('https://teenus.maaamet.ee/ows/wcs-dtm',dict(service='WCS',request='GetCoverage',version='1.0.0',coverage='dtm-1',crs='EPSG:3301',response_crs='EPSG:3301',bbox=','.join(map(str,BBOX)),width=560,height=580,format='GTiff',interpolation='nearest neighbor')),
 'basemap.png':('https://kaart.maaamet.ee/wms/alus',dict(service='WMS',request='GetMap',version='1.1.1',layers='pohi_mvr2',styles='',srs='EPSG:3301',bbox=','.join(map(str,BBOX)),width=2800,height=2900,format='image/png')),
 'aerial.jpg':('https://kaart.maaamet.ee/wms/alus',dict(service='WMS',request='GetMap',version='1.1.1',layers='of10000',styles='',srs='EPSG:3301',bbox=','.join(map(str,BBOX)),width=2800,height=2900,format='image/jpeg')),
}
def fetch(job):
 name,(base,params)=job; url=base+'?'+urlencode(params)
 with urlopen(Request(url,headers={'User-Agent':'OpenMapStack detailplaneering bounded sample'}),timeout=180) as r:body=r.read()
 if name.endswith('geojson'):
  j=json.loads(body)
  assert j['numberMatched']==j['numberReturned']==len(j['features']) and len(j['features'])<5000, 'Incomplete WFS result'
 else:
  assert body[:1]!=b'<','Service returned XML error'
 path=ROOT/'data/source/context'/name;path.write_bytes(body)
 print(name,len(body),flush=True)
 return dict(id=name.split('.')[0],url=url,path=path.relative_to(ROOT).as_posix(),retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),sha256=hashlib.sha256(body).hexdigest(),bbox=BBOX,crs='EPSG:3301')
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=4) as pool: records=list(pool.map(fetch,JOBS.items()))
 (ROOT/'data/source/context/acquisition.json').write_text(json.dumps(records,indent=2)+'\n')

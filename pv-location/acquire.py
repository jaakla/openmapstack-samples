#!/usr/bin/env python3
"""Verify the pinned pilot offline. --normalize reproduces derivatives; --refresh fetches new mutable snapshots.

Normalization needs Python numpy and GDAL osgeo bindings. No credentials are used.
Provider raw JSON/XML bytes are retained as deterministic gzip files (mtime=0).
"""
from pathlib import Path
import argparse, datetime as dt, gzip, hashlib, json, urllib.request
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'data/source'
LOCK=ROOT/'sources.lock.json'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read_json(path):
 data=path.read_bytes()
 return json.loads(gzip.decompress(data) if path.suffix=='.gz' else data)
def verify(lock):
 bad=[a['path'] for a in lock['artifacts'] if not (ROOT/a['path']).is_file() or digest(ROOT/a['path'])!=a['sha256']]
 if bad: raise ValueError('Source pin mismatch: '+', '.join(bad))
 print('Verified',len(lock['artifacts']),'pinned artifacts offline.')
def normalize():
 from pathlib import Path
 import json,datetime as dt,collections,math
 from osgeo import gdal
 import numpy as np
 p=SOURCE;gdal.UseExceptions()
 def write(name,obj):
  (p/name).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n')
 for year in (2024,2025):
  raw=read_json(p/'raw'/f'weather-{year}.json.gz');h=raw['hourly'];rows=[]
  for i,t in enumerate(h['time']):
   end=dt.datetime.fromisoformat(t).replace(tzinfo=dt.timezone.utc);start=end-dt.timedelta(hours=1)
   if start.year!=year:continue
   vals=[h[k][i] for k in ['shortwave_radiation','direct_normal_irradiance','diffuse_radiation','temperature_2m']]
   assert all(v is not None and math.isfinite(v) for v in vals)
   rows.append(dict(zip(['time','ghi','dni','dhi','temperatureC'],[start.isoformat().replace('+00:00','Z')]+vals)))
  expected=(366 if year==2024 else 365)*24;assert len(rows)==expected
  write(f'weather-{year}.json',{'provider':'Open-Meteo / Copernicus ERA5','model':'era5','requestedLocation':{'latitude':58.37,'longitude':26.72},'gridLocation':{'latitude':raw['latitude'],'longitude':raw['longitude'],'elevationM':raw['elevation']},'intervalHours':1,'timeBasis':'interval_start_utc','radiationBasis':'mean over hour; provider end timestamp shifted -1 hour','temperatureBasis':'provider instantaneous value at interval end','rows':rows})
  prices=read_json(p/'raw'/f'prices-{year}.json.gz')['data']['ee'];groups=collections.defaultdict(list)
  assert len({r['timestamp'] for r in prices})==len(prices), 'Duplicate price timestamps'
  assert all(r['timestamp']%900==0 for r in prices), 'Unaligned price timestamps'
  for row in prices:
   t=dt.datetime.fromtimestamp(row['timestamp'],dt.timezone.utc)
   if t.year==year:groups[t.replace(minute=0,second=0,microsecond=0)].append(row['price'])
  assert len(groups)==expected
  assert all(len(v) in (1,4) for v in groups.values())
  write(f'prices-{year}.json',{'provider':'Elering transparency dashboard','zone':'EE','intervalHours':1,'timeBasis':'interval_start_utc','units':'EUR/MWh, wholesale day-ahead, excluding taxes and sales margin','aggregation':'Four equal-duration quarter-hour prices averaged per UTC hour where supplied; hourly output assumption. Negative prices preserved.','sourceIntervalCounts':dict(collections.Counter(len(v) for v in groups.values())),'rows':[{'time':t.isoformat().replace('+00:00','Z'),'priceEurMWh':round(sum(v)/len(v),4)} for t,v in sorted(groups.items())]})
  print(year,'rows',expected,'GHI kWh/m2',round(sum(r['ghi'] for r in rows)/1000,3),'price min',min(x for v in groups.values() for x in v))
 a={};nulls={}
 dtmReference=gdal.Open(str(p/'raw'/'dtm.tif')).ReadAsArray()
 for typ in ['dsm','dtm']:
  ds=gdal.Open(str(p/'raw'/f'{typ}.tif'));arr=ds.ReadAsArray()
  assert ds.GetGeoTransform()==(658125.,5.,0.,6474170.,0.,-5.) and arr.shape==(400,400)
  if typ=='dsm':arr=np.where(arr<dtmReference-2,np.nan,arr)
  a[typ]=[round(float(v),2) if np.isfinite(v) and v>0 else None for v in arr.ravel()];nulls[typ]=a[typ].count(None)
 write('context-grid.json',{'provider':'Maa- ja Ruumiamet','crs':'EPSG:3301','bounds':[658125,6472170,660125,6474170],'width':400,'height':400,'resolutionM':5,'order':'row-major, north to south, west to east','units':'metres above sea level; DSM includes surface objects, DTM bare terrain','nullPolicy':'nonfinite/nonpositive heights or DSM more than 2m below aligned DTM marked null; raw service does not declare nodata; -2m plausibility rule is a conservative quality filter, not source classification','nullCells':nulls,'observationDate':None,'observationDateNote':'WCS is a mutable latest mosaic; per-cell LiDAR acquisition dates not exposed in coverage response. Not asserted contemporaneous with 2024/2025.','dsm':a['dsm'],'dtm':a['dtm']})
 raw=read_json(p/'raw'/'buildings.geojson.gz')
 if raw['numberMatched'] != raw['numberReturned'] or raw['numberReturned'] >= 5000:raise ValueError('WFS response incomplete; add paging before proceeding')
 write('buildings.geojson',{'type':'FeatureCollection','name':'ETAK buildings in bounded 2km pilot; context, not PV detections','features':[{'type':'Feature','id':f['id'],'geometry':f['geometry'],'properties':{'building_id':f['id'],'etak_id':f['properties']['etak_id'],'type':f['properties']['tyyp_tekst'],'height_m_reported':f['properties']['korgus_m'],'geometry_updated':f['properties']['geom_muutmisaeg'],'source':'Maa- ja Ruumiamet ETAK WFS','pv_evidence':False}} for f in raw['features']]})
 print('grid',nulls,'buildings',len(raw['features']),raw['numberMatched'])

def refresh(lock):
 stamp=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
 for source in lock['sources']:
  path=ROOT/source['pin']['path']
  req=urllib.request.Request(source['source_url'],headers={'User-Agent':'OpenMapStack-PV-pilot/1.0 (bounded research sample)'})
  with urllib.request.urlopen(req,timeout=180) as response: payload=response.read()
  if path.suffix=='.gz':
   json.loads(payload)
   payload=gzip.compress(payload,mtime=0)
  elif path.suffix=='.tif' and payload[:2] not in (b'II',b'MM'):raise ValueError('Non-TIFF WCS response')
  elif path.suffix=='.jpg' and payload[:2]!=b'\xff\xd8':raise ValueError('Non-JPEG WMS response')
  path.write_bytes(payload)
  source['pin'].update(sha256=digest(path),captured_at=stamp)
  source['access']['retrieved_at']=stamp
  source['version']['identifier']='local snapshot '+stamp
  print('Fetched',source['id'])
 government=read_json(SOURCE/'government-aggregates.json')
 government['snapshotAt']=stamp
 for entry in government['sources']:
  data=read_json(SOURCE/'raw'/('government-'+entry['status']+'.json.gz'))
  if data.get('exceededTransferLimit'):raise ValueError('Government response truncated')
  entry['records']=[f['attributes'] for f in data['features']]
 (SOURCE/'government-aggregates.json').write_text(json.dumps(government,ensure_ascii=False,indent=2)+'\n')
 # Reproject a rendered display image only; this is never native inference imagery.
 from osgeo import gdal
 source=gdal.Translate('',str(SOURCE/'raw/aerial-3301.jpg'),format='MEM',outputSRS='EPSG:3301',outputBounds=[658125,6474170,660125,6472170])
 warped=gdal.Warp('',source,format='MEM',dstSRS='EPSG:3857',width=1600,height=1600,resampleAlg='bilinear')
 gdal.Translate(str(SOURCE/'aerial.jpg'),warped,format='JPEG',creationOptions=['QUALITY=90'])
 (SOURCE/'aerial.jpg.aux.xml').unlink(missing_ok=True)
 aerial=read_json(SOURCE/'aerial.json');aerial['extractedAt']=stamp;aerial['attribution']='Maa- ja Ruumiameti ortofoto, extracted '+stamp[:10]
 (SOURCE/'aerial.json').write_text(json.dumps(aerial,indent=2)+'\n')
 normalize()
 lock['captured_at']=stamp
 for artifact in lock['artifacts']:
  path=ROOT/artifact['path'];artifact.update(sha256=digest(path),bytes=path.stat().st_size)
 LOCK.write_text(json.dumps(lock,ensure_ascii=False,indent=2)+'\n')
 print('New pins written. Review changed inputs before publication.')
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--refresh',action='store_true',help='Fetch mutable sources and replace local pins explicitly')
 parser.add_argument('--normalize',action='store_true',help='Reproduce weather/prices/context/buildings from pinned raw snapshots')
 args=parser.parse_args();lock=read_json(LOCK)
 if args.refresh:refresh(lock)
 else:
  verify(lock)
  if args.normalize:normalize();verify(lock)
if __name__=='__main__':main()

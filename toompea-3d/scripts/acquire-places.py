from pathlib import Path
import requests,json,time
S=Path(__file__).resolve().parents[1]/'data/source'
queries=['Toompea Castle Tallinn','Alexander Nevsky Cathedral Tallinn','St Mary Cathedral Tallinn','Patkuli viewing platform Tallinn','Kohtuotsa Tallinn','Pikk Hermann Tallinn']
out=[]
for q in queries:
 time.sleep(1.1)
 r=requests.get('https://nominatim.openstreetmap.org/search',params={'q':q,'format':'json','limit':1},headers={'User-Agent':'ToompeaAtlas/1.0 (heritage explorer research)'},timeout=30);r.raise_for_status();out.append({'query':q,'url':r.url,'results':r.json()})
(S/'places-nominatim.json').write_text(json.dumps(out,indent=2))
print('Saved',len(out),'geocoding responses; selected reference labels, not an inventory')

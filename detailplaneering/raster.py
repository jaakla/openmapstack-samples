"""Create Web Mercator display rasters and Mapbox RGB terrain from pinned EPSG:3301 inputs."""
import math,base64
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from osgeo import gdal,osr
from pyproj import Transformer

gdal.UseExceptions()
BBOX=[660800,6470400,663600,6473300]
TO_LL=Transformer.from_crs(3857,4326,always_xy=True)

def crs_wkt(code):
 s=osr.SpatialReference();s.ImportFromEPSG(code);return s.ExportToWkt()

def coords(ds):
 gt=ds.GetGeoTransform();x0,y1=gt[0],gt[3];x1=x0+gt[1]*ds.RasterXSize;y0=y1+gt[5]*ds.RasterYSize
 return [TO_LL.transform(x0,y1),TO_LL.transform(x1,y1),TO_LL.transform(x1,y0),TO_LL.transform(x0,y0)]

def backdrop(root,name):
 src=root/'data/source/context'/name
 original=gdal.Open(str(src))
 expanded=gdal.Translate('',original,format='MEM',rgbExpand='rgb') if original.GetRasterBand(1).GetColorTable() else original
 ds=gdal.Translate('',expanded,format='MEM',outputSRS='EPSG:3301',outputBounds=[BBOX[0],BBOX[3],BBOX[2],BBOX[1]])
 warped=gdal.Warp('',ds,format='MEM',dstSRS='EPSG:3857',width=2800,height=2900,resampleAlg='bilinear',dstAlpha=True)
 output_name=name.replace('.jpg','.png')
 path=root/'data/derived'/output_name
 gdal.Translate(str(path),warped,format='PNG')
 Path(str(path)+'.aux.xml').unlink(missing_ok=True)
 return {'url':output_name,'coordinates':coords(warped)}

def drawing(root,page,boundary,xy):
 import pymupdf as f
 x0,y0,x1,y1=boundary.bounds
 clip=f.Rect(math.floor(x0)-5,math.floor(y0)-5,math.ceil(x1)+5,math.ceil(y1)+5)
 z=1.5; pix=page.get_pixmap(matrix=f.Matrix(z,z),clip=clip,alpha=False)
 img=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
 mask=Image.new('L',img.size,0);drawer=ImageDraw.Draw(mask)
 ox,oy=pix.x/z,pix.y/z
 gs=list(boundary.geoms) if hasattr(boundary,'geoms') else [boundary]
 for g in gs:
  drawer.polygon([((x-ox)*z,(y-oy)*z) for x,y in g.exterior.coords],fill=255)
  for ring in g.interiors:drawer.polygon([((x-ox)*z,(y-oy)*z) for x,y in ring.coords],fill=0)
 img.putalpha(mask);arr=np.array(img)
 ds=gdal.GetDriverByName('MEM').Create('',pix.width,pix.height,4,gdal.GDT_Byte)
 origin=xy(ox,oy);px=xy(ox+1/z,oy);py=xy(ox,oy+1/z)
 ds.SetGeoTransform((origin[0],px[0]-origin[0],py[0]-origin[0],origin[1],px[1]-origin[1],py[1]-origin[1]));ds.SetProjection(crs_wkt(3301))
 for i in range(4):ds.GetRasterBand(i+1).WriteArray(arr[:,:,i]);ds.GetRasterBand(i+1).SetColorInterpretation([gdal.GCI_RedBand,gdal.GCI_GreenBand,gdal.GCI_BlueBand,gdal.GCI_AlphaBand][i])
 warped=gdal.Warp('',ds,format='MEM',dstSRS='EPSG:3857',width=2600,resampleAlg='bilinear',dstAlpha=True)
 path=root/'data/derived/drawing.png';gdal.Translate(str(path),warped,format='PNG');Path(str(path)+'.aux.xml').unlink(missing_ok=True)
 return {'url':'drawing.png','coordinates':coords(warped)}

def terrain(root):
 ds=gdal.Open(str(root/'data/source/context/dtm.tif'))
 raw=ds.ReadAsArray(); gt=ds.GetGeoTransform()
 def sample(x,y):
  col=int((x-gt[0])/gt[1]);row=int((y-gt[3])/gt[5])
  if not(0<=col<raw.shape[1] and 0<=row<raw.shape[0]):raise ValueError('Terrain sample outside coverage')
  v=float(raw[row,col]);assert math.isfinite(v) and v>0
  return round(v,2)
 # One zoom, native ~5 m ground resolution. MapLibre overzooms this measured grid.
 world=20037508.342789244;z=14;n=2**z;span=2*world/n
 merc=Transformer.from_crs(3301,3857,always_xy=True)
 corners=[merc.transform(x,y) for x in (BBOX[0],BBOX[2]) for y in (BBOX[1],BBOX[3])]
 loX,hiX=min(x for x,y in corners),max(x for x,y in corners);loY,hiY=min(y for x,y in corners),max(y for x,y in corners)
 tilepaths=[]
 for x in range(int((loX+world)/span),int((hiX+world)/span)+1):
  for y in range(int((world-hiY)/span),int((world-loY)/span)+1):
   bounds=[x*span-world,world-(y+1)*span,(x+1)*span-world,world-y*span]
   tile=gdal.Warp('',ds,format='MEM',dstSRS='EPSG:3857',outputBounds=bounds,width=256,height=256,resampleAlg='bilinear',dstNodata=-9999)
   vals=tile.ReadAsArray();valid=vals>-9000
   # Extend edge pixels only in display tile padding outside the retained AOI.
   # No analysed feature is outside coverage; this prevents a nodata cliff.
   tx=np.linspace(bounds[0]+span/512,bounds[2]-span/512,256)
   ty=np.linspace(bounds[3]-span/512,bounds[1]+span/512,256)
   xx,yy=np.meshgrid(tx,ty)
   ex,ny=Transformer.from_crs(3857,3301,always_xy=True).transform(xx,yy)
   cols=np.clip(((ex-gt[0])/gt[1]).astype(int),0,raw.shape[1]-1)
   rows=np.clip(((ny-gt[3])/gt[5]).astype(int),0,raw.shape[0]-1)
   vals=np.where(valid,vals,raw[rows,cols])
   encoded=np.round((vals+10000)*10).astype(np.uint32)
   rgb=np.stack([(encoded>>16)&255,(encoded>>8)&255,encoded&255],axis=-1).astype(np.uint8)
   rel=f'terrain/{z}/{x}/{y}.png';path=root/'data/derived'/rel;path.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(rgb).save(path);tilepaths.append(rel)
 ll=[TO_LL.transform(loX,loY),TO_LL.transform(hiX,hiY)]
 return sample,{'zoom':z,'bounds':[*ll[0],*ll[1]],'tiles':tilepaths,'min':float(raw.min()),'max':float(raw.max())}

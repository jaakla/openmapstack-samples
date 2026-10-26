"""PDF vector recovery: source page coordinates -> L-EST97 -> WGS84.
No geometry is drawn by the browser. CAD-layer selection follows the PDF legend.
"""
import json, math, re, csv
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon, LineString, Point, mapping
from shapely.ops import unary_union, polygonize, transform, snap
from shapely import set_precision, make_valid
from pyproj import Transformer

TO_WGS = Transformer.from_crs(3301,4326,always_xy=True)

def registration(root):
    gcps=json.loads((root/'data/overrides/georeferencing.geojson').read_text())['features']
    a,b,c=gcps
    p0=complex(a['properties']['pdf_x'],a['properties']['pdf_y'])
    p1=complex(b['properties']['pdf_x'],b['properties']['pdf_y'])
    q0=complex(*a['geometry']['coordinates']);q1=complex(*b['geometry']['coordinates'])
    # PDF has downward y: conjugation preserves distances and reflects handedness.
    ratio=(q1-q0)/(p1-p0).conjugate()
    def xy(x,y):
        v=q0+ratio*(complex(x,y)-p0).conjugate()
        return v.real,v.imag
    check=xy(c['properties']['pdf_x'],c['properties']['pdf_y'])
    error=math.dist(check,c['geometry']['coordinates'])
    return xy,abs(ratio),error

def chains(d):
    """Flatten cubic Beziers at fixed subdivisions, preserving disconnected rings."""
    result=[];points=[]
    for item in d['items']:
        op=item[0]
        if op=='l': seg=[item[1],item[2]]
        elif op=='c':
            a,b,c,e=[np.array(v) for v in item[1:]]
            seg=[tuple((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*e) for t in np.linspace(0,1,13)]
        elif op=='re':
            x0,y0,x1,y1=item[1];seg=[(x0,y0),(x1,y0),(x1,y1),(x0,y1),(x0,y0)]
        elif op=='qu':
            a,b,c,e=item[1];seg=[a,b,e,c,a]
        else: raise ValueError(f'Unsupported PDF operator {op}')
        if points and math.dist(points[-1],seg[0])>.02:
            result.append(points);points=[]
        if not points: points=[seg[0]]
        points.extend(seg[1:])
    if points:result.append(points)
    return result

def polygon(d):
    rings=[Polygon(c) for c in chains(d) if len(c)>=3]
    if not rings:return None
    g=unary_union([make_valid(p) for p in rings])
    return g

def recover(root,paths,page):
    xy,scale,error=registration(root)
    def metric(g):return transform(xy,g)
    lines=[]
    for d in paths:
        if d.get('layer')=='DP_krunt':
            for chain in chains(d):
                if len(chain)>1: lines.append(set_precision(LineString(chain),.02))
    net=unary_union(lines)
    net=snap(net,net,.08)
    plots=list(polygonize(unary_union(net)))
    plots=[g for g in plots if g.area*scale**2>100 and g.centroid.x<2500 and g.centroid.y>450]
    labels={}
    for b in page.get_text('dict')['blocks']:
        for line in b.get('lines',[]):
            for s in line['spans']:
                match=re.fullmatch(r'POS (\d+)',s['text'].strip())
                if match:
                    x0,y0,x1,y1=s['bbox']; labels[int(match[1])]=Point((x0+x1)/2,(y0+y1)/2)
    parameters={int(f['properties']['pos']):{k:v for k,v in f['properties'].items() if k not in ['source','geometry_origin']} for f in json.loads((root/'data/overrides/plot-parameters.geojson').read_text())['features']}
    assigned=[]
    for g in plots:
        contained=[pos for pos,p in labels.items() if g.covers(p)]
        if len(contained)!=1:raise ValueError(f'Plot has labels {contained}')
        pos=contained[0];props={'id':f'pos-{pos}','pos':pos,'source':'Pohijoonis.pdf · lk 1 · DP_krunt','status':'planned','source_date':'2026-09-17'}
        props.update({k:float(v) if k not in ('use','pos') and v else v for k,v in parameters[pos].items()})
        props['pos']=pos;props['measured_area_m2']=round(metric(g).area,2)
        assigned.append((g,props))
    buildings=[]
    for d in paths:
        if d.get('layer')!='suurim lubatud ehitisealune pind' or not d.get('fill') or d['rect'][0]>2500:continue
        g=polygon(d)
        if not g or g.area*scale**2<3:continue
        memberships=[(p,pr) for p,pr in assigned if p.covers(g.representative_point())]
        if len(memberships)!=1:raise ValueError(f'Building {d["index"]} not assigned to one plot')
        _,pr=memberships[0];area=metric(g).area;aux=area<80
        cap=float(pr['aux_roof_absolute_m'] if aux and pr['aux_roof_absolute_m'] else pr['roof_absolute_m'])
        props={**pr,'id':f'building-{d["index"]}','pdf_path_index':d['index'],'footprint_m2':round(area,2),'auxiliary':aux,'roof_absolute_m':cap,'storeys':1 if aux else pr['storeys'],'source':'Pohijoonis.pdf · lk 1 · suurim lubatud ehitisealune pind','model_basis':'Joonise hoonekontuurist lubatud absoluutse parapetikõrguseni loodud maht; ei ole lõplik arhitektuurne lahendus'}
        buildings.append((g,props))
    return xy,scale,error,assigned,buildings

def feature(g,props,xy):
    metric=transform(xy,g)
    return {'type':'Feature','id':props['id'],'geometry':mapping(transform(TO_WGS.transform,metric)),'properties':props}

def spot_levels(page):
    """Recover only text whose character origins belong to the proposed-grade layer.
    Bounding-box overlap alone would accidentally include nearby surveyed spot heights.
    """
    from shapely.strtree import STRtree
    marks=[Point(c[2]) for s in page.get_texttrace() if s.get('layer')=='_MV PROJ Kqrgused' for c in s['chars']]
    tree=STRtree(marks);levels=[]
    for b in page.get_text('dict',flags=7)['blocks']:
        for line in b.get('lines',[]):
            text=''.join(s['text'] for s in line['spans']).strip()
            if re.fullmatch(r'\d{2}\.\d{2}',text) and all(len(tree.query(Point(s['origin']),predicate='dwithin',distance=.03)) for s in line['spans']):
                x0,y0,x1,y1=line['bbox'];levels.append((Point((x0+x1)/2,(y0+y1)/2),float(text)))
    return levels

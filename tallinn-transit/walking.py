"""Compile the pinned OSM extract into a pedestrian graph (metric EPSG:3301).

Topology follows shared OSM nodes. Degree-two simplification retains every source
vertex along each edge. No synthetic street connection is introduced.
"""
from collections import defaultdict
import math
import osmium
from pyproj import Transformer

BOUNDS = [24.44, 59.27, 25.05, 59.58]
EXCLUDED = {'motorway','motorway_link','construction','proposed','raceway','bus_guideway'}
DENIED = {'no','private','customers','permit','delivery'}

def compile_walk(path):
    points, ways, blocked, anchors = {}, [], set(), set()
    class Reader(osmium.SimpleHandler):
        def node(self, node):
            tags = dict(node.tags)
            if tags.get('foot') in DENIED or (tags.get('access') in DENIED and tags.get('foot') not in {'yes','designated','permissive'}):
                blocked.add(node.id)
            if tags.get('barrier') in {'fence','wall','block','jersey_barrier'} or tags.get('locked') == 'yes':
                blocked.add(node.id)
        def way(self, way):
            t = dict(way.tags)
            h = t.get('highway')
            if not h or h in EXCLUDED or t.get('area') == 'yes' or t.get('foot') in DENIED | {'use_sidepath'}:
                return
            if t.get('access') in DENIED and t.get('foot') not in {'yes','designated','permissive'}:
                return
            if h in {'trunk','trunk_link'} and t.get('foot') not in {'yes','designated','permissive'}:
                return
            seq = []
            for n in way.nodes:
                if not n.location.valid():
                    return
                lon, lat = n.lon, n.lat
                if BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]:
                    points[n.ref] = (lon, lat)
                    seq.append(n.ref)
                else:
                    seq.append(None)
            if len(seq) > 1:
                if seq[0] == seq[-1]:
                    anchors.update(x for x in seq if x is not None)
                direction = 1 if t.get('oneway:foot') in {'yes','1'} else -1 if t.get('oneway:foot') == '-1' else 0
                ways.append((way.id, seq, t.get('name',''), h, direction))
    Reader().apply_file(str(path), locations=True)
    raw, adjacent = [], defaultdict(list)
    for way, seq, name, kind, direction in sorted(ways):
        for a, b in zip(seq, seq[1:]):
            if a is None or b is None or a == b or a in blocked or b in blocked:
                continue
            i = len(raw); raw.append((a,b,name,kind,direction,way))
            adjacent[a].append(i); adjacent[b].append(i)
    transformer = Transformer.from_crs('EPSG:4326','EPSG:3301',always_xy=True)
    ids = sorted(adjacent)
    xy = transformer.transform([points[i][0] for i in ids],[points[i][1] for i in ids])
    index = {key:i for i,key in enumerate(ids)}
    vertices = [[*points[key],round(x,3),round(y,3)] for key,x,y in zip(ids,*xy)]
    def junction(n, meta):
        if n in anchors or len(adjacent[n]) != 2:
            return True
        return any(raw[e][2:5] != meta for e in adjacent[n])
    used, edges = set(), []
    for i,(a,b,name,kind,direction,way) in enumerate(raw):
        if i in used:
            continue
        seq = [a,b]; used.add(i)
        if direction == 0:
            for reverse in [False,True]:
                if reverse:
                    seq.reverse()
                while not junction(seq[-1],(name,kind,direction)):
                    options = [j for j in adjacent[seq[-1]] if j not in used]
                    if not options:
                        break
                    j = options[0]; u,v,*_ = raw[j]; used.add(j)
                    seq.append(v if u == seq[-1] else u)
                if reverse:
                    seq.reverse()
        positions = [index[n] for n in seq]
        metres = sum(math.hypot(vertices[u][2]-vertices[v][2],vertices[u][3]-vertices[v][3]) for u,v in zip(positions,positions[1:]))
        if metres > 0:
            edges.append([positions[0],positions[-1],round(metres,3),positions,name,kind,direction])
    return {'schema':'tallinn-walk/v1','crs':'EPSG:3301','bounds':BOUNDS,'vertices':vertices,'edges':edges,
            'policy':{'speed_m_s':1.25,'max_snap_m':70,'private_access':False,'oneway_foot':True},
            'attribution':'© OpenStreetMapi kaasautorid · ODbL 1.0'}

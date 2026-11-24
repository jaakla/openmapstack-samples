# =============================================================================
# Tallinn new tram line options  --  canonical pipeline
# -----------------------------------------------------------------------------
# Deliberately boring and inspectable. Reads ONLY the immutable snapshots under
# data/source/ (pulled by acquire.py, see data/source/acquisition.json) and the
# scenario definitions under data/overrides/, and creates every declared output,
# the dashboard, the findings, the validation report and the run record.
#
#   python pipeline.py            (or: openmapstack run project.yaml)
#
# All metric work (lengths, buffers, areas, nearest-neighbour, routing) happens
# in EPSG:3301 (L-EST97). EPSG:4326 is used for storage/interchange only.
#
# The proposed lines are HYPOTHETICAL. Their geometry is not drawn by hand: each
# option is declared in scenarios/tram-options.yaml as an ordered list of
# named waypoints (existing public transport stops, street junctions) and the
# streets it follows, and step 7 routes it along the real street network.
# =============================================================================

from __future__ import annotations

import datetime
import io
import json
import logging
import math
import platform
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import pyproj
import scipy
import shapely
import yaml
from scipy.ndimage import distance_transform_edt
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

import view

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source"
OVERRIDES = ROOT / "data" / "overrides"
OUT = ROOT / "data" / "derived"
RUNS = ROOT / "runs"
VALIDATION = ROOT / "validation"

ANALYSIS_CRS = "EPSG:3301"
STORAGE_CRS = "EPSG:4326"

# ---- analysis parameters (mirrored in project.yaml; drift is a failed check) --
CATCHMENTS_M = [300, 400, 500, 600, 800]  # walking distance to a stop, along paths
CANONICAL_CATCHMENT_M = 500               # assumption A2
STOP_SPACING_M = 500.0                    # modelled stop spacing on a proposed line (A3)
EXISTING_STOP_MATCH_M = 80.0              # a modelled stop this close to a tram stop is that stop
OFF_STREET_PENALTY = 8.0                  # cost multiplier for streets an option does not name
MIN_DECLARED_STREET_SHARE = 0.70          # below this the routed line is not the declared one
JUNCTION_TOLERANCE_M = 40.0               # two streets "meet" when this close
CORRIDOR_LAYERS = {"study_corridors_2019": "corridors-feasibility-study-2019.geojson"}
CORRIDOR_SNAP_M = 30.0                    # ends of published corridor lines this close are joined
SCENARIO_GEOMETRY_TOLERANCE_M = 2.0        # stored scenario geometry vs. the line routed from its definition
WRITE_SCENARIOS = False                    # set by build_scenarios.py while it writes the stored geometry
CORRIDOR_MATCH_M = 75.0                    # a routed line this close to a published corridor follows it
CORRIDOR_WAYPOINT_M = 250.0               # a waypoint must lie this close to the corridor it follows
BUS_CORRIDOR_M = 150.0                    # straight-line distance from the alignment to a bus stop
NETWORK_STEP_M = 20.0                     # max spacing of routing nodes along a path
OFF_PATH_M = 50.0                         # off-path allowance drawn around reached paths
SHED_CELL_M = 10.0                        # raster cell used to draw catchments
ROUTE_CUTOFF_M = 2500.0                   # walking distances beyond this are not needed
EXCLUDED_WALK_CLASSES = {"motorway"}
# Street classes a tram alignment may follow at normal cost / at a penalty.
STREET_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified",
                  "living_street", "service", "unknown", "pedestrian"}
MIN_BUILDING_M2 = 20.0                    # floor area below this is not a dwelling or a workplace

# Building Register main-use codes (KAOS, ehitise kasutamise otstarve).
RESIDENTIAL_KAOS = ("111", "112", "113")  # single-family, multi-family, community residences
# Workplaces and destinations: hospitality 121, offices 122, retail/services 123, transport and
# communication 124 (terminals, not garages 1242), industry and warehouses 125, public buildings 126.
WORKPLACE_KAOS = ("121", "122", "123", "1241", "125", "126")
EXISTING_STATUS = "Olemas"                              # EHR status: the building exists
PIPELINE_STATUS = ("Kavandatav", "Püstitamisel")        # planned (permit stage) / under construction
PLAN_IN_PROCESS = ("algatatud", "vastuvõetud", "taotletav")   # detailed plan initiated / adopted for display / applied for

SERVICE_LAYERS = {   # category -> (file, name field)
    "school": [("svc-schools-municipal.geojson", "name"), ("svc-schools-private-state.geojson", "name")],
    "kindergarten": [("svc-kindergartens.geojson", "name")],
    "higher_education": [("svc-universities.geojson", "name"), ("svc-vocational-schools.geojson", "nimi")],
    "hospital": [("svc-hospitals.geojson", "nimi")],
    "pharmacy": [("svc-pharmacies.geojson", "nimi")],
    "shopping": [("svc-shopping-centres.geojson", "name"), ("svc-markets.geojson", "name")],
    "library": [("svc-libraries.geojson", "nimetus")],
}
SERVICE_CATEGORIES = list(SERVICE_LAYERS)

# Scoring: each criterion is the option's value divided by the best option's value (0-1),
# then weighted. The weights are a declared judgement (assumption A8), not a measurement.
STRATEGY_ITEMS = ["sump", "study_2019", "city_2026"]   # each scored 0-1 in tram-options.yaml; fit = their sum (0-3)
CRITERIA = ["new_residents", "residents", "workplaces", "services", "growth", "efficiency", "strategy"]
PROFILES = {
    "balanced":   {"new_residents": 0.20, "residents": 0.10, "workplaces": 0.15, "services": 0.10, "growth": 0.15, "efficiency": 0.15, "strategy": 0.15},
    "coverage":   {"new_residents": 0.40, "residents": 0.15, "workplaces": 0.15, "services": 0.15, "growth": 0.05, "efficiency": 0.10, "strategy": 0.00},
    "growth":     {"new_residents": 0.10, "residents": 0.05, "workplaces": 0.25, "services": 0.05, "growth": 0.40, "efficiency": 0.05, "strategy": 0.10},
    "value":      {"new_residents": 0.15, "residents": 0.10, "workplaces": 0.10, "services": 0.05, "growth": 0.05, "efficiency": 0.50, "strategy": 0.05},
    "plan_led":   {"new_residents": 0.10, "residents": 0.05, "workplaces": 0.10, "services": 0.05, "growth": 0.15, "efficiency": 0.05, "strategy": 0.50},
}
CANONICAL_PROFILE = "balanced"

log = logging.getLogger("pipeline")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

TO_3301 = pyproj.Transformer.from_crs(STORAGE_CRS, ANALYSIS_CRS, always_xy=True)


def read_geojson(name: str) -> gpd.GeoDataFrame:
    """Source GeoJSON is EPSG:4326 (RFC 7946, lon/lat); reproject for metric work."""
    frame = gpd.read_file(SOURCE / name)
    assert frame.crs is not None and frame.crs.to_epsg() == 4326, f"{name}: unexpected CRS {frame.crs}"
    return frame.to_crs(ANALYSIS_CRS)


# ------------------------------ STEP 1 ---------------------------------------
# Administrative division.
#  Source: Tallinn City GIS, Linnaosad_asumid (layer 1 districts, layer 0 sub-districts).
#  The 8 city districts define "Tallinn"; the 84 sub-districts (asum) carry the
#  city's own register population, used only to check the population model.
def load_admin() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, shapely.Geometry]:
    districts = read_geojson("tallinn-districts.geojson").rename(columns={"nimi": "district"})
    districts["district"] = districts["district"].str.replace(" linnaosa", "", regex=False)
    districts["geometry"] = shapely.make_valid(districts.geometry.values)
    districts = districts[["district", "geometry"]].sort_values("district").reset_index(drop=True)
    sub = read_geojson("tallinn-subdistricts.geojson").rename(
        columns={"asumi_nimi": "subdistrict", "linnaosa_nimi": "district", "sum_rahvaarv": "register_population",
                 "asumi_kood_tekst": "code"})
    sub["district"] = sub["district"].str.replace(" linnaosa", "", regex=False)
    sub["geometry"] = shapely.make_valid(sub.geometry.values)
    sub = sub[["code", "subdistrict", "district", "register_population", "geometry"]]
    sub = sub.sort_values("code").reset_index(drop=True)
    city = shapely.union_all(districts.geometry.values)
    return districts, sub, city


# ------------------------------ STEP 2 ---------------------------------------
# Population grid.
#  Source: Statistics Estonia 1 km x 1 km population grid, INSPIRE PD WFS
#  (EPSG:3301 edition), reference period 2024. Raw GML 3.2 kept as downloaded.
#  CRS warning: gml:posList is in EPSG:3301 AXIS ORDER (northing, easting); it is
#  swapped to GIS x,y here and checked against the 1 km grid alignment.
def load_population_grid() -> gpd.GeoDataFrame:
    ns = {"wfs": "http://www.opengis.net/wfs/2.0", "gml": "http://www.opengis.net/gml/3.2"}
    rows = []
    for member in ET.parse(SOURCE / "population-grid-1km.gml").getroot().iterfind("wfs:member", ns):
        feature = member[0]
        fields = {child.tag.split("}")[1]: (child.text or "") for child in feature}
        pos = [float(v) for v in feature.find(".//gml:posList", ns).text.split()]
        ring = [(pos[i + 1], pos[i]) for i in range(0, len(pos), 2)]      # (northing, easting) -> (x, y)
        rows.append({"cell_id": fields["gml_id"], "population": float(fields["value_statisticalvalue_value"]),
                     "reference_period": fields["periodofreference_xlink_title"], "geometry": shapely.Polygon(ring)})
    grid = gpd.GeoDataFrame(rows, crs=ANALYSIS_CRS).sort_values("cell_id").reset_index(drop=True)
    bounds = grid.bounds
    assert np.allclose(grid.area, 1e6, rtol=1e-6), "grid cells are not 1 km squares: axis order wrong?"
    assert np.allclose(bounds.minx % 1000, 0, atol=0.01) or np.allclose(bounds.minx % 1000, 1000, atol=0.01)
    return grid


# ------------------------------ STEP 3 ---------------------------------------
# Buildings.
#  Source: Tallinn City GIS, ETAK_EHR_hooned - ETAK footprints joined by the city
#  with the national Building Register (EHR): status, main use (KAOS) and closed
#  net floor area. Semantic predicates come from those coded fields:
#    ehr_seisund = 'Olemas'                -> the building exists
#    ehr_seisund in Kavandatav/Püstitamisel -> planned or under construction
#    kaos_peamine_kood 111/112/113          -> dwelling
#  A footprint without a register record (no status, no use) is kept as UNKNOWN:
#  it receives no residents and no workplace floor area unless a populated grid
#  cell has no registered dwelling at all (fallback, reported).
def load_buildings(grid: gpd.GeoDataFrame, sub: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    b = gpd.read_parquet(SOURCE / "tallinn-buildings-etak-ehr.parquet")
    assert b.crs is not None and b.crs.to_epsg() == 4326
    b = b.to_crs(ANALYSIS_CRS)
    b["geometry"] = shapely.make_valid(b.geometry.values)
    b = b[b.geometry.geom_type.isin(["Polygon", "MultiPolygon"]) & ~b.geometry.is_empty].copy()
    b["id"] = b["objectid"].astype("int64")
    b["footprint_m2"] = b.area
    b["centroid"] = b.geometry.centroid
    kaos = b["kaos_peamine_kood"].fillna("")
    status = b["ehr_seisund"].fillna("")
    net = b["suletud_netopind"].where(b["suletud_netopind"] > 0)
    floors = b["max_korruste_arv"].where(b["max_korruste_arv"] > 0)
    from_footprint = b["ehitisalune_pind"].where(b["ehitisalune_pind"] > 0).fillna(b["footprint_m2"]) * floors.fillna(1.0)
    b["floor_m2"] = net.fillna(from_footprint)
    b["floor_basis"] = np.where(net.notna(), "ehr_net_floor_area", "footprint_x_floors")
    b["status"] = np.select([status == EXISTING_STATUS, status.isin(PIPELINE_STATUS), status == ""],
                            ["existing", "pipeline", "unknown"], "other")
    is_res = kaos.str.startswith(RESIDENTIAL_KAOS)
    is_work = kaos.str.startswith(WORKPLACE_KAOS)
    b["use"] = np.select([is_res, is_work, kaos == ""], ["residential", "workplace", "unknown"], "other")
    b["use_label"] = b["kaos_peamine_nimetus"]
    big = b["floor_m2"] >= MIN_BUILDING_M2
    b["tier"] = 0
    b.loc[big & (b["status"] == "existing") & is_res, "tier"] = 1
    # Fallback only: an unregistered footprint the topographic database types as a
    # residential-or-public building.
    b.loc[big & (b["status"] == "unknown") & (b["tyyp_tekst"] == "Elu- või ühiskondlik hoone"), "tier"] = 2
    b["workplace_m2"] = np.where(big & (b["status"] == "existing") & is_work, b["floor_m2"], 0.0)
    b["pipeline_home_m2"] = np.where(big & (b["status"] == "pipeline") & is_res, b["floor_m2"], 0.0)
    b["pipeline_work_m2"] = np.where(big & (b["status"] == "pipeline") & is_work, b["floor_m2"], 0.0)

    points = gpd.GeoDataFrame(b[["id"]], geometry=b["centroid"], crs=ANALYSIS_CRS)
    in_cell = gpd.sjoin(points, grid[["cell_id", "geometry"]], predicate="within", how="left")
    b["cell_id"] = b["id"].map(in_cell.drop_duplicates("id").set_index("id")["cell_id"])
    in_sub = gpd.sjoin(points, sub[["code", "subdistrict", "district", "geometry"]], predicate="within", how="left")
    in_sub = in_sub.drop_duplicates("id").set_index("id")
    b["subdistrict"] = b["id"].map(in_sub["subdistrict"])
    b["district"] = b["id"].map(in_sub["district"])
    return b.sort_values("id").reset_index(drop=True)


# ------------------------------ STEP 4 ---------------------------------------
# Dasymetric allocation: each grid cell's residents are shared among the
# registered dwellings whose centroid lies in that cell, in proportion to their
# net floor area. Cells with residents but no registered dwelling fall back to
# unregistered residential-type footprints; cells with none stay unallocated and
# are reported, never silently dropped. Cells straddling the city boundary hold
# residents of the neighbouring municipality too; there the whole cell is
# assigned to Tallinn's buildings (a known overestimate at the edge, checked
# against the city's register population per sub-district).
def allocate_population(b: gpd.GeoDataFrame, grid: gpd.GeoDataFrame, city) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    b = b.copy()
    b["pop_est"] = 0.0
    b["alloc_tier"] = 0
    grid = grid.copy()
    grid["alloc_basis"] = "no_residents"
    inside = shapely.area(shapely.intersection(grid.geometry.values, city)) / 1e6
    grid["share_in_tallinn"] = np.round(inside, 4)
    groups = {cell: frame for cell, frame in b[b["cell_id"].notna() & (b["tier"] > 0)].groupby("cell_id")}
    for row in grid.itertuples():
        if row.population <= 0:
            continue
        frame = groups.get(row.cell_id)
        chosen = None
        if frame is not None:
            for tier in (1, 2):
                subset = frame[frame["tier"] == tier]
                if len(subset) and subset["floor_m2"].sum() > 0:
                    chosen, basis = subset, f"tier{tier}"
                    break
        if chosen is None:
            grid.loc[row.Index, "alloc_basis"] = "unallocated" if row.share_in_tallinn > 0 else "outside_tallinn"
            continue
        # A boundary cell contributes only the part of its population that its
        # land share inside Tallinn suggests when Tallinn holds under half of it.
        population = row.population * (row.share_in_tallinn if row.share_in_tallinn < 0.5 else 1.0)
        b.loc[chosen.index, "pop_est"] = population * chosen["floor_m2"] / chosen["floor_m2"].sum()
        b.loc[chosen.index, "alloc_tier"] = int(basis[-1])
        grid.loc[row.Index, "alloc_basis"] = basis
    return b, grid


# ------------------------------ STEP 5 ---------------------------------------
# Street and path network.
#  Source: Overture Maps transportation segments (OpenStreetMap-derived), release
#  pinned in project.yaml. Segments are split at their connectors. Two graphs
#  share the node set:
#    walk graph   - every road/path open to pedestrians, densified to 20 m, for catchments
#    street graph - the same pieces with their street name and class, for alignments
def _foot_denied(restrictions) -> bool:
    if restrictions is None:
        return False
    for rule in restrictions:
        if rule.get("access_type") != "denied":
            continue
        when = rule.get("when")
        mode = None if when is None else when.get("mode")
        if when is None or mode is None and all(when.get(k) is None for k in ("using", "recognized", "vehicle", "during")):
            return True
        if mode is not None and "foot" in list(mode):
            return True
    return False


def build_network() -> dict:
    table = pq.read_table(SOURCE / "overture-segments.parquet",
                          columns=["id", "geometry", "subtype", "class", "names", "connectors", "access_restrictions"]
                          ).to_pandas().sort_values("id")
    roads = table[table["subtype"] == "road"].copy()
    roads["name"] = roads["names"].map(lambda n: None if n is None else n.get("primary"))
    roads["foot_ok"] = ~roads["class"].isin(EXCLUDED_WALK_CLASSES) & ~roads["access_restrictions"].map(_foot_denied)
    lines = shapely.transform(shapely.from_wkb(roads["geometry"].values),
                              lambda c: np.column_stack(TO_3301.transform(c[:, 0], c[:, 1])))

    connector_ids: dict[str, int] = {}
    parts, part_u, part_v, part_name, part_class, part_foot = [], [], [], [], [], []
    for line, connectors, name, cls, foot in zip(lines, roads["connectors"].values, roads["name"].values,
                                                 roads["class"].values, roads["foot_ok"].values):
        if line.geom_type != "LineString" or line.length <= 0:
            continue
        length = line.length
        stops = sorted((float(c["at"]), str(c["connector_id"])) for c in connectors)
        for (at_a, id_a), (at_b, id_b) in zip(stops[:-1], stops[1:]):
            if id_a == id_b:
                continue
            piece = shapely.ops.substring(line, at_a * length, at_b * length)
            if piece.geom_type != "LineString" or piece.length < 0.01:
                continue
            parts.append(piece)
            part_u.append(connector_ids.setdefault(id_a, len(connector_ids)))
            part_v.append(connector_ids.setdefault(id_b, len(connector_ids)))
            part_name.append(name)
            part_class.append(cls)
            part_foot.append(bool(foot))
    parts = np.array(parts, dtype=object)
    part_u, part_v = np.array(part_u), np.array(part_v)
    part_foot = np.array(part_foot)
    n_conn = len(connector_ids)
    conn_xy = np.zeros((n_conn, 2))
    conn_xy[part_u] = shapely.get_coordinates(shapely.get_point(parts, 0))
    conn_xy[part_v] = shapely.get_coordinates(shapely.get_point(parts, -1))

    # ---- walk graph: densified pieces open to pedestrians ----
    walk_parts = parts[part_foot]
    dense = shapely.segmentize(walk_parts, NETWORK_STEP_M)
    coords, owner = shapely.get_coordinates(dense, return_index=True)
    first = np.r_[True, owner[1:] != owner[:-1]]
    last = np.r_[owner[1:] != owner[:-1], True]
    node = np.empty(len(coords), dtype=np.int64)
    interior = ~(first | last)
    node[interior] = n_conn + np.arange(interior.sum())
    node[first] = part_u[part_foot][owner[first]]
    node[last] = part_v[part_foot][owner[last]]
    n_nodes = n_conn + int(interior.sum())
    xy = np.zeros((n_nodes, 2))
    xy[:n_conn] = conn_xy
    xy[node] = coords
    same = owner[1:] == owner[:-1]
    u, v = node[:-1][same], node[1:][same]
    w = np.hypot(*(coords[1:][same] - coords[:-1][same]).T)
    graph = coo_matrix((np.r_[w, w], (np.r_[u, v], np.r_[v, u])), shape=(n_nodes, n_nodes)).tocsr()
    _, labels = connected_components(graph, directed=False)
    used = np.zeros(n_nodes, dtype=bool)
    used[u] = True
    used[v] = True
    main = np.bincount(labels[used]).argmax()
    in_main = (labels == main) & used
    main_share = float(w[in_main[u]].sum() / w.sum())
    return {
        "xy": xy, "u": u, "v": v, "w": w, "n_nodes": n_nodes, "in_main": in_main, "graph": graph,
        "main_nodes": np.flatnonzero(in_main), "tree": cKDTree(xy[in_main]),
        "street": {"parts": parts, "u": part_u, "v": part_v, "name": np.array(part_name, dtype=object),
                   "class": np.array(part_class, dtype=object), "length": shapely.length(parts),
                   "n_conn": n_conn, "xy": conn_xy},
        "stats": {
            "segments_in_source": int(len(table)), "road_segments": int(len(roads)),
            "foot_denied_or_motorway_excluded": int((~roads["foot_ok"]).sum()), "routing_nodes": n_nodes,
            "routing_edges": int(len(w)), "network_km": round(float(w.sum()) / 1000, 1),
            "main_component_length_share": round(main_share, 4),
        },
    }


def snap(network: dict, xy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Nearest walk-graph node of the main component, and the straight-line gap to it."""
    gap, index = network["tree"].query(xy)
    return network["main_nodes"][index], gap


# ------------------------------ STEP 6 ---------------------------------------
# Existing public transport.
#  Source: Tallinn Transport Department GTFS (pinned). route_type 900 = tram,
#  800 = trolleybus, 3 = bus. Tram stops and line shapes are the existing network;
#  weekday departures per stop measure today's bus service in a corridor.
def load_gtfs() -> dict:
    with zipfile.ZipFile(SOURCE / "tallinn-gtfs.zip") as archive:
        def read(name, **kw):
            return pd.read_csv(io.BytesIO(archive.read(name)), **kw)
        routes, trips, stops = read("routes.txt"), read("trips.txt"), read("stops.txt")
        calendar = read("calendar.txt")
        stop_times = read("stop_times.txt", usecols=["trip_id", "stop_id", "stop_sequence"])
        shapes = read("shapes.txt")
    assert set(routes["route_type"].unique()) <= {3, 800, 900}, "unexpected GTFS route types"
    trips = trips.merge(routes[["route_id", "route_type", "route_short_name", "route_long_name"]], on="route_id")
    # A "weekday" is a Wednesday: services that run on Wednesdays and are valid on the snapshot date.
    feed_day = int(calendar["start_date"].max())
    weekday = calendar[(calendar["wednesday"] == 1) & (calendar["start_date"] <= feed_day) & (calendar["end_date"] >= feed_day)]
    trips["weekday"] = trips["service_id"].isin(weekday["service_id"])
    st = stop_times.merge(trips[["trip_id", "route_type", "weekday", "route_short_name"]], on="trip_id")

    x, y = TO_3301.transform(stops["stop_lon"].values, stops["stop_lat"].values)
    stops = gpd.GeoDataFrame(stops[["stop_id", "stop_code", "stop_name"]], geometry=shapely.points(x, y), crs=ANALYSIS_CRS)
    modes = st.groupby("stop_id")["route_type"].agg(lambda s: sorted(set(s)))
    stops["tram"] = stops["stop_id"].map(modes).map(lambda m: isinstance(m, list) and 900 in m)
    wk = st[st["weekday"]]
    stops["tram_departures_weekday"] = stops["stop_id"].map(wk[wk["route_type"] == 900].groupby("stop_id").size()).fillna(0).astype(int)
    stops["bus_departures_weekday"] = stops["stop_id"].map(wk[wk["route_type"] != 900].groupby("stop_id").size()).fillna(0).astype(int)
    lines_at = st[st["route_type"] == 900].groupby("stop_id")["route_short_name"].agg(lambda s: ", ".join(sorted(set(s))))
    stops["tram_lines"] = stops["stop_id"].map(lines_at)
    stops = stops.sort_values("stop_id").reset_index(drop=True)

    # One line geometry per tram route: its most-used shape.
    tram_trips = trips[trips["route_type"] == 900]
    rows = []
    for (route, name), group in tram_trips.groupby(["route_short_name", "route_long_name"]):
        shape_id = group["shape_id"].value_counts().sort_index().idxmax()
        pts = shapes[shapes["shape_id"] == shape_id].sort_values("shape_pt_sequence")
        sx, sy = TO_3301.transform(pts["shape_pt_lon"].values, pts["shape_pt_lat"].values)
        rows.append({"line": route, "name": name, "weekday_trips": int(group["weekday"].sum()),
                     "geometry": shapely.linestrings(np.column_stack([sx, sy]))})
    lines = gpd.GeoDataFrame(rows, crs=ANALYSIS_CRS).sort_values("line").reset_index(drop=True)
    return {"stops": stops, "tram_lines": lines, "service_day": feed_day,
            "route_types": {int(k): int(v) for k, v in routes["route_type"].value_counts().items()}}


# ------------------------------ STEP 7 ---------------------------------------
# Proposed lines (HYPOTHETICAL scenario geometry).
#  Definition: scenarios/tram-options.yaml, one entry per option:
#    waypoints - ordered; each names an existing stop in the GTFS feed
#                ({stop: NAME, mode: tram|any}), the meeting point of two named streets
#                ({junction: [A, B]}) or a registered building address ({address: A}).
#                No coordinate is typed by hand.
#    streets   - the street names the line follows between its waypoints.
#  The pipeline resolves every waypoint against the immutable sources, then finds
#  the shortest path over the street graph in which a street the option does not
#  name costs OFF_STREET_PENALTY times its length. An option whose waypoint does
#  not resolve, or whose routed line follows the declared streets for less than
#  MIN_DECLARED_STREET_SHARE of its length, is REJECTED and reported.
def _name_key(name) -> str:
    return "" if name is None else " ".join(str(name).lower().replace(".", ". ").split())


def _resolve_waypoint(waypoint: dict, street: dict, stops: gpd.GeoDataFrame, tree: cKDTree, previous,
                      addresses: dict) -> dict:
    if "address" in waypoint:
        point = addresses.get(waypoint["address"])
        if point is None:
            return {"ok": False, "reason": f"address {waypoint['address']!r} not found (or not unique) in the building register layer"}
        gap, node = tree.query(point)
        return {"ok": True, "node": int(node), "xy": street["xy"][node], "label": waypoint["address"], "kind": "address",
                "snap_m": round(float(gap), 1), "source_features": 1}
    if "stop" in waypoint:
        mode = waypoint.get("mode", "tram")
        named = stops[stops["stop_name"] == waypoint["stop"]]
        if mode == "tram":
            named = named[named["tram"]]
        if named.empty:
            return {"ok": False, "reason": f"no {mode} stop named {waypoint['stop']!r} in the GTFS feed"}
        xy = np.column_stack([named.geometry.x, named.geometry.y])
        if np.ptp(xy, axis=0).max() > 400:
            if previous is None:
                return {"ok": False, "reason": f"stop name {waypoint['stop']!r} is ambiguous ({len(named)} stops over {np.ptp(xy, axis=0).max():.0f} m)"}
            keep = np.hypot(*(xy - xy[np.argmin(np.hypot(*(xy - previous).T))]).T) <= 400   # the cluster nearest the previous waypoint
            xy = xy[keep]
        point = xy.mean(axis=0)
        gap, node = tree.query(point)
        return {"ok": True, "node": int(node), "xy": street["xy"][node], "label": waypoint["stop"], "kind": f"{mode}_stop",
                "snap_m": round(float(gap), 1), "source_features": int(len(xy))}
    if "junction" in waypoint:
        a, b = (_name_key(n) for n in waypoint["junction"])
        keys = np.array([_name_key(n) for n in street["name"]], dtype=object)
        nodes_a = np.unique(np.r_[street["u"][keys == a], street["v"][keys == a]])
        nodes_b = np.unique(np.r_[street["u"][keys == b], street["v"][keys == b]])
        if not len(nodes_a) or not len(nodes_b):
            missing = waypoint["junction"][0] if not len(nodes_a) else waypoint["junction"][1]
            return {"ok": False, "reason": f"street {missing!r} not found in the street network"}
        gap, index = cKDTree(street["xy"][nodes_b]).query(street["xy"][nodes_a])
        close = gap <= JUNCTION_TOLERANCE_M
        if not close.any():
            return {"ok": False, "reason": f"{waypoint['junction'][0]} and {waypoint['junction'][1]} do not meet (closest {gap.min():.0f} m)"}
        candidates = street["xy"][nodes_a[close]]
        if np.ptp(candidates, axis=0).max() > 300 and previous is not None:
            # The two streets meet more than once: take the meeting point nearest the previous waypoint.
            pick = nodes_a[close][np.argmin(np.hypot(*(candidates - previous).T))]
        else:
            centre = candidates.mean(axis=0)
            pick = nodes_a[close][np.argmin(np.hypot(*(candidates - centre).T))]
        return {"ok": True, "node": int(pick), "xy": street["xy"][pick], "label": " × ".join(waypoint["junction"]),
                "kind": "junction", "snap_m": round(float(gap[close].min()), 1), "source_features": int(close.sum())}
    return {"ok": False, "reason": "waypoint must name a stop or a junction"}


def corridor_graph(file: str) -> dict:
    """A routable graph of a published corridor layer (the city's own drawing of study corridors).

    Used for an option whose corridor has no street yet (`follow: study_corridors_2019`). The
    lines are noded where they cross or touch and their ends are joined within CORRIDOR_SNAP_M.
    The result has the same shape as the street graph, with every piece named "(published corridor)".
    """
    lines = read_geojson(file)
    merged = shapely.union_all(lines.geometry.values)          # nodes the lines at every crossing
    whole = [g for g in shapely.get_parts(merged) if g.geom_type == "LineString" and g.length > 0.01]
    # Cut every line into pieces of at most 50 m so that a waypoint can join the corridor anywhere.
    parts = []
    for line in whole:
        cuts = np.linspace(0, line.length, max(1, math.ceil(line.length / 50.0)) + 1)
        parts += [shapely.ops.substring(line, a, b) for a, b in zip(cuts[:-1], cuts[1:])]
    parts = np.array(parts, dtype=object)
    ends = np.vstack([shapely.get_coordinates(shapely.get_point(parts, 0)), shapely.get_coordinates(shapely.get_point(parts, -1))])
    # Union-find over end points closer than the snapping tolerance.
    parent = np.arange(len(ends))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in cKDTree(ends).query_pairs(CORRIDOR_SNAP_M):   # consecutive 50 m pieces share an exact end point
        parent[find(i)] = find(j)
    roots = np.array([find(i) for i in range(len(ends))])
    _, node = np.unique(roots, return_inverse=True)
    n = int(node.max()) + 1
    xy = np.zeros((n, 2))
    np.add.at(xy, node, ends)
    xy /= np.bincount(node)[:, None]
    k = len(parts)
    return {"parts": parts, "u": node[:k], "v": node[k:], "name": np.array(["(published corridor)"] * k, dtype=object),
            "class": np.array(["primary"] * k, dtype=object), "length": shapely.length(parts), "n_conn": n, "xy": xy}


def route_options(definitions: dict, network: dict, gtfs: dict, buildings: gpd.GeoDataFrame
                  ) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, list[dict]]:
    streets_graph = network["street"]
    corridor_graphs = {key: corridor_graph(file) for key, file in CORRIDOR_LAYERS.items()}
    street = streets_graph
    # Address waypoints: the centroid of the one existing registered building with that short address.
    known = buildings[(buildings["status"] == "existing") & buildings["ads_lahiaadress"].notna()]
    known = known[~known["ads_lahiaadress"].duplicated(keep=False)]
    addresses = {a: (c.x, c.y) for a, c in zip(known["ads_lahiaadress"], known["centroid"])}
    tram_stops = gtfs["stops"][gtfs["stops"]["tram"]]
    tram_tree = cKDTree(np.column_stack([tram_stops.geometry.x, tram_stops.geometry.y]))
    line_rows, stop_rows, results = [], [], []
    for option in definitions["options"]:
        result = {"id": f"SCENARIO-{option['id']}", "option": option["id"], "action": "add_scenario", "status": "rejected"}
        results.append(result)
        follow = option.get("follow")
        if follow and follow not in corridor_graphs:
            result["reason"] = f"unknown corridor layer {follow!r}"
            continue
        street = corridor_graphs[follow] if follow else streets_graph
        if follow:
            option = {**option, "streets": ["(published corridor)"]}
            result["follows"] = follow
        allowed = np.array([c in STREET_CLASSES for c in street["class"]])
        keys = np.array([_name_key(n) for n in street["name"]], dtype=object)
        conn_tree = cKDTree(street["xy"])
        n = street["n_conn"]
        evidence = [e for e in option.get("evidence") or [] if str(e.get("value") or e.get("title") or "").strip()]
        if not evidence:
            result["reason"] = "no evidence recorded"
            continue
        # stand_in_streets: mapped streets used where the described corridor has no street of its own
        # (a former railway, a park). They route at normal cost and are reported separately.
        stand_in = {_name_key(s) for s in option.get("stand_in_streets") or []}
        declared = {_name_key(s) for s in option["streets"]} | stand_in
        named = option["streets"] + (option.get("stand_in_streets") or [])
        unknown = sorted(s for s in named if _name_key(s) not in set(keys))
        if unknown:
            result["reason"] = "declared street(s) not in the street network: " + ", ".join(unknown)
            continue
        resolved, previous = [], None
        for waypoint in option["waypoints"]:
            r = _resolve_waypoint(waypoint, street, gtfs["stops"], conn_tree, previous, addresses)
            if r["ok"] and follow and r["snap_m"] > CORRIDOR_WAYPOINT_M:
                r = {"ok": False, "reason": f"{r['label']} is {r['snap_m']:.0f} m from the published corridor"}
            if not r["ok"]:
                break
            resolved.append(r)
            previous = r["xy"]
        if len(resolved) != len(option["waypoints"]):
            result["reason"] = r["reason"]
            continue
        on_declared = np.array([k in declared for k in keys])
        cost = street["length"] * np.where(on_declared, 1.0, OFF_STREET_PENALTY)
        cost = np.where(allowed | on_declared, cost, cost * 4.0)     # footpaths only as a last resort
        # Edge lookup: cheapest piece between a node pair.
        order = np.argsort(cost)
        lookup = {}
        for i in order[::-1]:
            lookup[(int(street["u"][i]), int(street["v"][i]))] = i
            lookup[(int(street["v"][i]), int(street["u"][i]))] = i
        graph = coo_matrix((cost[list(lookup.values())], ([k[0] for k in lookup], [k[1] for k in lookup])), shape=(n, n)).tocsr()
        pieces, used, failed = [], [], None
        for a, b in zip(resolved[:-1], resolved[1:]):
            dist, pred = dijkstra(graph, directed=True, indices=a["node"], return_predecessors=True)
            if not np.isfinite(dist[b["node"]]):
                failed = f"no street connection between {a['label']} and {b['label']}"
                break
            path = [b["node"]]
            while path[-1] != a["node"]:
                path.append(int(pred[path[-1]]))
            path.reverse()
            for p, q in zip(path[:-1], path[1:]):
                i = lookup[(p, q)]
                geometry = street["parts"][i]
                if int(street["u"][i]) != p:
                    geometry = shapely.reverse(geometry)
                pieces.append(geometry)
                used.append(i)
        if failed:
            result["reason"] = failed
            continue
        coords = np.vstack([shapely.get_coordinates(p) for p in pieces])
        keep = np.r_[True, np.hypot(*(coords[1:] - coords[:-1]).T) > 0.01]
        line = shapely.linestrings(coords[keep])
        used = np.array(used)
        length = float(line.length)
        share = float(street["length"][used][on_declared[used]].sum() / street["length"][used].sum())
        off = pd.Series(street["length"][used][~on_declared[used]], index=[street["name"][i] or "(unnamed)" for i in used[~on_declared[used]]])
        off = off.groupby(level=0).sum().sort_values(ascending=False)
        on_stand_in = np.array([keys[i] in stand_in for i in used])
        result.update(length_km=round(length / 1000, 2), declared_street_share=round(share, 3),
                      stand_in_street_share=round(float(street["length"][used][on_stand_in].sum() / street["length"][used].sum()), 3),
                      waypoints=[{k: r[k] for k in ("label", "kind", "snap_m", "source_features")} for r in resolved],
                      off_declared_streets={k: round(float(v)) for k, v in off.head(5).items()})
        if share < MIN_DECLARED_STREET_SHARE:
            result["reason"] = f"only {share:.0%} of the routed line follows the declared streets"
            continue
        # The routed line must agree with the scenario geometry stored in data/overrides
        # (written by build_scenarios.py from this same definition). A definition edited without
        # regenerating its geometry, or the reverse, is rejected.
        stored_path = OVERRIDES / "options" / f"{option['id']}.geojson"
        if not WRITE_SCENARIOS:
            if not stored_path.exists():
                result["reason"] = f"scenario geometry file {stored_path.relative_to(ROOT)} is missing; run build_scenarios.py"
                continue
            stored = gpd.read_file(stored_path).to_crs(ANALYSIS_CRS).geometry.iloc[0]
            gap = float(shapely.hausdorff_distance(stored, line))
            result["stored_geometry_gap_m"] = round(gap, 2)
            if gap > SCENARIO_GEOMETRY_TOLERANCE_M:
                result["reason"] = f"stored scenario geometry differs from the routed definition by {gap:.1f} m; run build_scenarios.py"
                continue
        result["status"] = "applied"

        # Modelled stops: evenly spaced, both ends included.
        count = max(1, round(length / STOP_SPACING_M))
        positions = np.linspace(0, length, count + 1)
        points = shapely.line_interpolate_point(line, positions)
        pxy = shapely.get_coordinates(points)
        gap, nearest = tram_tree.query(pxy)
        for i, (point, g, j) in enumerate(zip(points, gap, nearest)):
            existing = bool(g <= EXISTING_STOP_MATCH_M)
            stop_rows.append({"option": option["id"], "seq": i + 1, "at_m": round(float(positions[i])),
                              "kind": "existing_tram_stop" if existing else "modelled_stop",
                              "existing_stop_name": tram_stops["stop_name"].iloc[j] if existing else None,
                              "geometry": point})
        published = option.get("published") or {}
        strategy = option["strategy"]
        line_rows.append({
            "option": option["id"], "title": option["title"], "family": option.get("family", option["id"]),
            "short": option.get("short", option["title"]), "status": option.get("status"),
            "status_label": option.get("status_label"), "description": option.get("description"),
            "from_label": resolved[0]["label"], "to_label": resolved[-1]["label"],
            "length_km": round(length / 1000, 2), "declared_street_share": round(share, 3),
            "stand_in_street_share": result["stand_in_street_share"], "geometry_note": option.get("geometry_note"), "follows": follow,
            "published_length_km": published.get("length_km"), "published_cost_meur": published.get("cost_meur"),
            "published_cost_year": published.get("cost_year"), "published_riders_per_day": published.get("riders_per_day"),
            "published_note": published.get("cost_note"),
            "fit_sump": strategy["sump"]["score"], "fit_study_2019": strategy["study_2019"]["score"],
            "fit_city_2026": strategy["city_2026"]["score"],
            "strategy_fit": round(sum(strategy[k]["score"] for k in STRATEGY_ITEMS), 2), "geometry": line})
    lines = gpd.GeoDataFrame(line_rows, geometry="geometry", crs=ANALYSIS_CRS)
    stops = gpd.GeoDataFrame(stop_rows, geometry="geometry", crs=ANALYSIS_CRS)
    return lines, stops, results


# Published corridors (context + a measured check of every routed line).
#  Sources: the city's drawings of (a) the 2019 feasibility-study corridors with their stage and
#  (b) rail corridors in comprehensive and county plans, with the document and its status.
#  The lines carry no corridor names, so they are not used to pick options; they tell how much
#  of each routed option lies within CORRIDOR_MATCH_M of a corridor the city has published.
def load_corridors() -> gpd.GeoDataFrame:
    study = read_geojson("corridors-feasibility-study-2019.geojson")
    study = gpd.GeoDataFrame({"layer": "study_2019", "document": "Tallinna ja Harjumaa kergrööbastranspordi teostatavus- ja tasuvusanalüüs (2019)",
                              "document_status": None, "kind": "light rail", "stage": study["etapp"].astype("Int64"),
                              "source_fid": study["FID"]}, geometry=study.geometry, crs=ANALYSIS_CRS)
    plan = read_geojson("corridors-planning-documents.geojson")
    clean = lambda col: plan[col].astype(str).str.strip().replace({"": None, "None": None})
    plan = gpd.GeoDataFrame({"layer": "planning_documents", "document": clean("dokument"), "document_status": clean("seisund"),
                             "kind": clean("alaliik"), "stage": pd.array([pd.NA] * len(plan), dtype="Int64"),
                             "source_fid": plan["FID"]}, geometry=plan.geometry, crs=ANALYSIS_CRS)
    both = pd.concat([study, plan], ignore_index=True)
    both = both[~both.geometry.is_empty & both.geometry.notna()]
    return gpd.GeoDataFrame(both, geometry="geometry", crs=ANALYSIS_CRS)


def corridor_overlap(lines: gpd.GeoDataFrame, corridors: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    lines = lines.copy()
    tram_kinds = corridors["kind"].isin(["tramm", "kiirtramm", "light rail"])
    for column, mask in (("study_2019_share", corridors["layer"] == "study_2019"),
                         ("plan_corridor_share", (corridors["layer"] == "planning_documents") & tram_kinds)):
        zone = shapely.union_all(shapely.buffer(corridors.geometry[mask].values, CORRIDOR_MATCH_M))
        lines[column] = np.round(shapely.length(shapely.intersection(lines.geometry.values, zone)) / lines.length.values, 3)
    return lines


# ------------------------------ STEP 8 ---------------------------------------
# Walking distance from every routing node to the nearest stop of (a) the
# existing tram network and (b) each proposed option. Each stop is a virtual node
# joined to its snapped network node by its straight-line gap.
def walk_distances(network: dict, groups: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    n = network["n_nodes"]
    result = {}
    for key, xy in groups.items():
        node, gap = snap(network, xy)
        k = len(xy)
        u = np.r_[network["u"], n + np.arange(k)]
        v = np.r_[network["v"], node]
        w = np.r_[network["w"], np.maximum(gap, 0.01)]
        graph = coo_matrix((np.r_[w, w], (np.r_[u, v], np.r_[v, u])), shape=(n + k, n + k)).tocsr()
        dist = dijkstra(graph, directed=False, indices=n + np.arange(k), min_only=True, limit=ROUTE_CUTOFF_M)
        result[key] = dist[:n]
    return result


# ------------------------------ STEP 9 ---------------------------------------
# Catchment drawings: the paths reachable within the walking limit, drawn with
# the unspent distance (capped at OFF_PATH_M) as an off-path allowance, on a 10 m
# raster. These polygons are a drawing of the measured reach. They do NOT decide
# whether a building is in a catchment: that is the building's own measured
# distance (step 10).
def catchment_polygon(network: dict, dist: np.ndarray, limit_m: float):
    spare = np.clip(limit_m - dist, 0, None)
    spare[~np.isfinite(dist)] = 0
    xy = network["xy"]
    reached = spare >= SHED_CELL_M
    if not reached.any():
        return shapely.Polygon()
    x0 = math.floor(xy[reached, 0].min() / SHED_CELL_M) * SHED_CELL_M - OFF_PATH_M - SHED_CELL_M
    y0 = math.floor(xy[reached, 1].min() / SHED_CELL_M) * SHED_CELL_M - OFF_PATH_M - SHED_CELL_M
    col = ((xy[:, 0] - x0) // SHED_CELL_M).astype(np.int64)
    row = ((xy[:, 1] - y0) // SHED_CELL_M).astype(np.int64)
    pad = int(OFF_PATH_M // SHED_CELL_M) + 2
    shape = (int(row[reached].max()) + pad, int(col[reached].max()) + pad)
    inside = np.zeros(shape, dtype=bool)
    for radius in np.arange(SHED_CELL_M, OFF_PATH_M + 0.1, SHED_CELL_M):
        seeds = np.ones(shape, dtype=bool)
        pick = spare >= radius
        seeds[row[pick], col[pick]] = False
        inside |= distance_transform_edt(seeds, sampling=SHED_CELL_M) <= radius
    rows, cols = np.nonzero(inside)
    cells = shapely.box(x0 + cols * SHED_CELL_M, y0 + rows * SHED_CELL_M,
                        x0 + (cols + 1) * SHED_CELL_M, y0 + (rows + 1) * SHED_CELL_M)
    merged = shapely.make_valid(shapely.simplify(shapely.coverage_union_all(cells), SHED_CELL_M * 0.75))
    parts = [shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 4 * SHED_CELL_M ** 2])
             for p in shapely.get_parts(merged) if p.geom_type == "Polygon" and p.area > 0]
    return shapely.make_valid(shapely.multipolygons(parts))


# ------------------------------ STEP 10 --------------------------------------
# Per-feature walking distance = straight-line gap from the point (building
# centroid, service point) to the nearest routing node + network distance from
# that node to the nearest stop.
def measure_points(network: dict, xy: np.ndarray, dist: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    node, gap = snap(network, xy)
    return {key: values[node] + gap for key, values in dist.items()}


def load_services() -> gpd.GeoDataFrame:
    frames = []
    for category, layers in SERVICE_LAYERS.items():
        for file, name_field in layers:
            frame = read_geojson(file)
            frames.append(gpd.GeoDataFrame({"category": category, "name": frame[name_field].astype(str).str.strip(),
                                            "source_file": file, "source_objectid": frame["objectid"]},
                                           geometry=frame.geometry, crs=ANALYSIS_CRS))
    services = pd.concat(frames, ignore_index=True)
    services = services[~services.geometry.is_empty & services.geometry.notna()]
    # The same institution can appear in two city layers: keep one point per category, name and place.
    services["_x"] = services.geometry.x.round(0)
    services["_y"] = services.geometry.y.round(0)
    services = services.drop_duplicates(["category", "name", "_x", "_y"]).drop(columns=["_x", "_y"])
    services = services.sort_values(["category", "name", "source_objectid"]).reset_index(drop=True)
    services.insert(0, "service_id", np.arange(1, len(services) + 1))
    return gpd.GeoDataFrame(services, geometry="geometry", crs=ANALYSIS_CRS)


def load_plans(city) -> gpd.GeoDataFrame:
    plans = gpd.read_parquet(SOURCE / "tallinn-detailed-plans.parquet")
    assert plans.crs.to_epsg() == 4326
    plans = plans.to_crs(ANALYSIS_CRS)
    plans = plans[plans["seisundi_nimi"].isin(PLAN_IN_PROCESS)].copy()
    plans["geometry"] = shapely.make_valid(plans.geometry.values)
    # One polygon per plan: the register holds a row per procedural step.
    plans = plans.sort_values(["regnr", "objectid"]).dissolve(by="regnr", aggfunc="last").reset_index()
    plans["area_ha"] = (plans.area / 1e4).round(3)
    plans = plans.rename(columns={"nimetus": "name", "seisundi_nimi": "plan_status", "seisundi_kp": "status_date",
                                  "link_sum_andmetele": "register_url"})
    return plans[["regnr", "name", "plan_status", "status_date", "register_url", "area_ha", "geometry"]]


# ------------------------------ STEP 11 --------------------------------------
# Indicators per option and catchment distance. Plain numbers; the view formats them.
def indicators(lines, stops, buildings, bdist, services, sdist, plans, sheds, gtfs) -> pd.DataFrame:
    bus_stops = gtfs["stops"][gtfs["stops"]["bus_departures_weekday"] > 0]
    bus_tree = cKDTree(np.column_stack([bus_stops.geometry.x, bus_stops.geometry.y]))
    rows = []
    for line in lines.itertuples():
        key = line.option
        option_stops = stops[stops["option"] == key]
        # Bus stops within BUS_CORRIDOR_M (straight line) of the alignment.
        sample = shapely.get_coordinates(shapely.segmentize(line.geometry, 25.0))
        near = sorted({j for found in bus_tree.query_ball_point(sample, BUS_CORRIDOR_M) for j in found})
        bus_departures = int(bus_stops["bus_departures_weekday"].iloc[near].sum())
        for limit in CATCHMENTS_M:
            inside = bdist[key] <= limit
            fresh = inside & ~(bdist["existing"] <= limit)
            svc_in = sdist[key] <= limit
            shed = sheds[(key, limit)]
            plan_ha = float(shapely.area(shapely.intersection(plans.geometry.values, shed)).sum() / 1e4)
            row = {
                "option": key, "catchment_m": limit, "canonical": limit == CANONICAL_CATCHMENT_M,
                "length_km": line.length_km, "stops_modelled": int(len(option_stops)),
                "stops_new": int((option_stops["kind"] == "modelled_stop").sum()),
                "residents": round(float(buildings.loc[inside, "pop_est"].sum())),
                "residents_new": round(float(buildings.loc[fresh, "pop_est"].sum())),
                "workplace_floor_m2": round(float(buildings.loc[inside, "workplace_m2"].sum())),
                "workplace_floor_new_m2": round(float(buildings.loc[fresh, "workplace_m2"].sum())),
                "pipeline_home_m2": round(float(buildings.loc[inside, "pipeline_home_m2"].sum())),
                "pipeline_work_m2": round(float(buildings.loc[inside, "pipeline_work_m2"].sum())),
                "plans_in_process_ha": round(plan_ha, 1),
                "services": int(svc_in.sum()),
            }
            for category in SERVICE_CATEGORIES:
                row[f"svc_{category}"] = int((svc_in & (services["category"] == category).values).sum())
            row["bus_departures_weekday"] = bus_departures
            row["residents_per_km"] = round(row["residents"] / line.length_km) if line.length_km else 0
            row["residents_new_per_km"] = round(row["residents_new"] / line.length_km) if line.length_km else 0
            cost = float(line.published_cost_meur) if pd.notna(line.published_cost_meur) else None
            row["published_cost_meur"] = cost
            row["published_cost_year"] = int(line.published_cost_year) if pd.notna(line.published_cost_year) else None
            row["published_cost_meur_per_km"] = round(cost / line.length_km, 1) if cost and line.length_km else None
            row["strategy_fit"] = line.strategy_fit
            row["plan_corridor_share_pct"] = round(100 * line.plan_corridor_share)
            row["study_2019_share_pct"] = round(100 * line.study_2019_share)
            rows.append(row)
    table = pd.DataFrame(rows)
    table["published_cost_year"] = table["published_cost_year"].astype("Int64")   # whole years, empty where none is published
    return table


# ------------------------------ STEP 12 --------------------------------------
# Scores. Each criterion = value / best value among the options for that
# catchment distance (0-1). "growth" averages the two development indicators.
# score = sum(weight x criterion) x 100, per weighting profile.
def scores(matrix: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for limit, group in matrix.groupby("catchment_m"):
        def ratio(column):
            best = group[column].max()
            return group[column] / best if best > 0 else group[column] * 0.0
        crit = pd.DataFrame({
            "new_residents": ratio("residents_new"), "residents": ratio("residents"),
            "workplaces": ratio("workplace_floor_m2"), "services": ratio("services"),
            "growth": (ratio("pipeline_home_m2") + ratio("plans_in_process_ha")) / 2,
            "efficiency": ratio("residents_per_km"), "strategy": group["strategy_fit"] / 3.0,
        })
        for profile, weights in PROFILES.items():
            total = sum(weights[c] * crit[c] for c in CRITERIA) * 100
            rank = total.rank(ascending=False, method="min").astype(int)
            for index in group.index:
                row = {"option": group.loc[index, "option"], "catchment_m": int(limit), "profile": profile,
                       "score": round(float(total[index]), 1), "rank": int(rank[index]),
                       "canonical": bool(limit == CANONICAL_CATCHMENT_M and profile == CANONICAL_PROFILE)}
                row.update({f"c_{c}": round(float(crit.loc[index, c]), 3) for c in CRITERIA})
                rows.append(row)
    return pd.DataFrame(rows).sort_values(["catchment_m", "profile", "rank", "option"]).reset_index(drop=True)


def write_table(table: pd.DataFrame, path: Path) -> None:
    """CSV + XLSX from the same rows (project-spec s.2.5)."""
    table.to_csv(path, index=False, lineterminator="\n")
    with pd.ExcelWriter(path.with_suffix(".xlsx"), engine="openpyxl") as writer:
        table.to_excel(writer, index=False, sheet_name="data")
        # Fixed document timestamps keep the workbook byte-stable across reruns.
        writer.book.properties.created = datetime.datetime(2026, 1, 1)
        writer.book.properties.modified = datetime.datetime(2026, 1, 1)


def to_geojson(frame: gpd.GeoDataFrame, path: Path, decimals: int = 6) -> None:
    out = frame.to_crs(STORAGE_CRS)
    out["geometry"] = shapely.set_precision(out.geometry.values, 10 ** -decimals)
    out = out[~out.geometry.is_empty]
    payload = json.loads(out.to_json(drop_id=True))
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    for folder in (OUT, RUNS, VALIDATION, ROOT / "delivery"):
        folder.mkdir(parents=True, exist_ok=True)
    started = datetime.datetime.now(datetime.timezone.utc)
    run_id = started.strftime("run-%Y%m%d-%H%M%S")
    project = yaml.safe_load((ROOT / "project.yaml").read_text(encoding="utf-8"))
    definitions = yaml.safe_load((ROOT / "scenarios" / "tram-options.yaml").read_text(encoding="utf-8"))

    log.info("step 1-2: districts, population grid")
    districts, sub, city = load_admin()
    grid = load_population_grid()

    log.info("step 3-4: registered buildings, dasymetric allocation")
    buildings, grid = allocate_population(load_buildings(grid, sub), grid, city)

    log.info("step 5-6: street and path network, existing public transport")
    network = build_network()
    gtfs = load_gtfs()

    log.info("step 7: route %d proposed options along the street network", len(definitions["options"]))
    lines, stops, scenario_results = route_options(definitions, network, gtfs, buildings)
    corridors = load_corridors()
    lines = corridor_overlap(lines, corridors)
    for r in scenario_results:
        log.info("  %-28s %s %s", r["option"], r["status"],
                 f"{r.get('length_km')} km, {r.get('declared_street_share', 0):.0%} on declared streets" if "length_km" in r else r.get("reason"))

    log.info("step 8: walking distances to existing and proposed stops")
    tram_stops = gtfs["stops"][gtfs["stops"]["tram"]]
    groups = {"existing": np.column_stack([tram_stops.geometry.x, tram_stops.geometry.y])}
    for key in lines["option"]:
        s = stops[stops["option"] == key]
        groups[key] = np.column_stack([s.geometry.x, s.geometry.y])
    dist = walk_distances(network, groups)

    log.info("step 9: catchment drawings for %d variants", len(groups) * len(CATCHMENTS_M))
    sheds = {(key, limit): catchment_polygon(network, dist[key], limit) for key in groups for limit in CATCHMENTS_M}
    shed_rows = [{"option": key, "catchment_m": limit, "canonical": limit == CANONICAL_CATCHMENT_M,
                  "area_km2": round(shape.area / 1e6, 3), "geometry": shape} for (key, limit), shape in sheds.items()]
    shed_frame = gpd.GeoDataFrame(shed_rows, crs=ANALYSIS_CRS)

    log.info("step 10: measure buildings, services, plans")
    in_city = buildings["district"].notna()
    measured = buildings[in_city & ((buildings["pop_est"] > 0) | (buildings["workplace_m2"] > 0)
                                    | (buildings["pipeline_home_m2"] > 0) | (buildings["pipeline_work_m2"] > 0))].copy()
    measured = measured.reset_index(drop=True)
    bdist = measure_points(network, np.column_stack([measured["centroid"].x, measured["centroid"].y]), dist)
    services = load_services()
    sdist = measure_points(network, np.column_stack([services.geometry.x, services.geometry.y]), dist)
    plans = load_plans(city)

    log.info("step 11-12: indicators, scores")
    matrix = indicators(lines, stops, measured, bdist, services, sdist, plans, sheds, gtfs)
    score_table = scores(matrix)
    canonical_scores = score_table[score_table["canonical"]].set_index("option")
    summary = matrix[matrix["canonical"]].drop(columns=["canonical"]).merge(
        lines[["option", "title", "family", "status_label", "published_length_km"]], on="option")
    summary["score_balanced"] = summary["option"].map(canonical_scores["score"])
    summary["rank_balanced"] = summary["option"].map(canonical_scores["rank"])
    lead = ["rank_balanced", "option", "title", "family", "status_label", "score_balanced", "length_km", "published_length_km"]
    summary = summary[lead + [c for c in summary.columns if c not in lead]].sort_values(["rank_balanced", "option"]).reset_index(drop=True)
    existing_rows = []
    total_pop = float(measured["pop_est"].sum())
    for limit in CATCHMENTS_M:
        inside = bdist["existing"] <= limit
        existing_rows.append({"catchment_m": limit, "tram_stops": int(len(tram_stops)),
                              "residents": round(float(measured.loc[inside, "pop_est"].sum())),
                              "share_of_city_pct": round(100 * float(measured.loc[inside, "pop_est"].sum()) / total_pop, 1),
                              "workplace_floor_m2": round(float(measured.loc[inside, "workplace_m2"].sum()))})
    existing = pd.DataFrame(existing_rows)

    log.info("step 13: export")
    cols = ["id", "etak_id", "ehr_gid", "status", "use", "use_label", "floor_m2", "floor_basis", "pop_est", "alloc_tier",
            "workplace_m2", "pipeline_home_m2", "pipeline_work_m2", "cell_id", "subdistrict", "district"]
    result = gpd.GeoDataFrame(measured[cols], geometry=measured.geometry, crs=ANALYSIS_CRS)
    result["walk_m_existing_tram"] = np.where(np.isfinite(bdist["existing"]), np.round(bdist["existing"]), np.nan)
    for key in lines["option"]:
        result[f"walk_m_{key}"] = np.where(np.isfinite(bdist[key]), np.round(bdist[key]), np.nan)
    for column in ("floor_m2", "pop_est", "workplace_m2", "pipeline_home_m2", "pipeline_work_m2"):
        result[column] = result[column].round(2)
    result.to_parquet(OUT / "buildings.parquet", index=False)

    lines_out = lines.merge(summary.drop(columns=["title", "family", "status_label", "length_km", "published_length_km",
                                                  "published_cost_meur", "published_cost_year", "strategy_fit"]), on="option")
    lines_out["geometry"] = shapely.simplify(lines_out.geometry.values, 1.0)
    to_geojson(lines_out, OUT / "tram-options.geojson")
    to_geojson(stops, OUT / "tram-option-stops.geojson")
    option_sheds = shed_frame[shed_frame["option"] != "existing"]
    to_geojson(option_sheds[option_sheds["canonical"]], OUT / "option-catchments.geojson")
    to_geojson(option_sheds, OUT / "option-catchment-variants.geojson")
    to_geojson(shed_frame[shed_frame["option"] == "existing"], OUT / "existing-tram-catchments.geojson")
    to_geojson(gtfs["tram_lines"], OUT / "existing-tram-lines.geojson")
    tram_out = tram_stops[["stop_id", "stop_code", "stop_name", "tram_lines", "tram_departures_weekday", "geometry"]]
    to_geojson(tram_out, OUT / "existing-tram-stops.geojson")
    for key in lines["option"]:
        services[f"walk_m_{key}"] = np.where(np.isfinite(sdist[key]), np.round(sdist[key]), np.nan)
    services["walk_m_existing_tram"] = np.where(np.isfinite(sdist["existing"]), np.round(sdist["existing"]), np.nan)
    to_geojson(services, OUT / "services.geojson")
    to_geojson(plans, OUT / "plans-in-process.geojson")
    pipeline_buildings = result[result["status"] == "pipeline"][
        ["id", "ehr_gid", "use", "use_label", "floor_m2", "pipeline_home_m2", "pipeline_work_m2", "subdistrict", "geometry"]]
    to_geojson(pipeline_buildings, OUT / "pipeline-buildings.geojson")

    est = measured.groupby("subdistrict")["pop_est"].sum()
    sub_out = sub.copy()
    sub_out["population_est"] = sub_out["subdistrict"].map(est).fillna(0).round()
    sub_out["workplace_floor_m2"] = sub_out["subdistrict"].map(measured.groupby("subdistrict")["workplace_m2"].sum()).fillna(0).round()
    to_geojson(sub_out, OUT / "subdistricts.geojson")
    to_geojson(districts, OUT / "districts.geojson")
    to_geojson(corridors, OUT / "published-corridors.geojson")
    write_table(summary, OUT / "option-summary.csv")
    write_table(matrix, OUT / "option-matrix.csv")
    write_table(score_table, OUT / "option-scores.csv")
    write_table(existing, OUT / "existing-tram-coverage.csv")

    in_tallinn = grid["share_in_tallinn"] > 0
    facts = {
        "run_id": run_id, "analysis_crs": ANALYSIS_CRS,
        "canonical": {"catchment_m": CANONICAL_CATCHMENT_M, "profile": CANONICAL_PROFILE},
        "parameters": {"catchments_m": CATCHMENTS_M, "stop_spacing_m": STOP_SPACING_M, "profiles": PROFILES,
                       "criteria": CRITERIA, "off_street_penalty": OFF_STREET_PENALTY,
                       "bus_corridor_m": BUS_CORRIDOR_M, "off_path_m": OFF_PATH_M},
        "network": network["stats"],
        "gtfs": {"service_day": gtfs["service_day"], "route_types": gtfs["route_types"],
                 "tram_stops": int(len(tram_stops)), "tram_lines": int(len(gtfs["tram_lines"]))},
        "population": {
            "grid_cells_in_frame": int(len(grid)), "grid_cells_touching_tallinn": int(in_tallinn.sum()),
            "grid_population_touching_tallinn": float(grid.loc[in_tallinn, "population"].sum()),
            "unallocated_cells": int((grid["alloc_basis"] == "unallocated").sum()),
            "unallocated_population": float(grid.loc[grid["alloc_basis"] == "unallocated", "population"].sum()),
            "tallinn_population_est": round(total_pop, 1),
            "register_population": float(sub["register_population"].sum()),
            "tier2_population": round(float(measured.loc[measured["alloc_tier"] == 2, "pop_est"].sum()), 1),
            "inhabited_buildings": int((measured["pop_est"] > 0).sum()),
            "reference_period": sorted(grid["reference_period"].unique())[0],
        },
        "buildings": {"in_source": int(len(buildings)),
                      "status_counts": {k: int(v) for k, v in buildings["status"].value_counts().items()},
                      "use_counts": {k: int(v) for k, v in buildings["use"].value_counts().items()},
                      "workplace_floor_m2": round(float(measured["workplace_m2"].sum())),
                      "pipeline_home_m2": round(float(measured["pipeline_home_m2"].sum())),
                      "pipeline_work_m2": round(float(measured["pipeline_work_m2"].sum()))},
        "services": {k: int(v) for k, v in services["category"].value_counts().items()},
        "plans_in_process": int(len(plans)),
        "overrides": scenario_results,
    }
    frames = {"measured": measured, "result": result, "buildings": buildings, "grid": grid, "sub": sub_out,
              "districts": districts, "lines": lines_out, "stops": stops, "sheds": shed_frame, "services": services,
              "plans": plans, "corridors": corridors, "gtfs_stops": gtfs["stops"], "pipeline_buildings": pipeline_buildings, "matrix": matrix, "scores": score_table,
              "summary": summary, "existing": existing, "tram_lines": gtfs["tram_lines"], "tram_stops": tram_out,
              "network": network, "bdist": bdist, "definitions": definitions}

    log.info("step 14: validation")
    report = view.validate(project, facts, frames, ROOT, run_id)

    log.info("step 15: dashboard, findings, run record")
    completed = datetime.datetime.now(datetime.timezone.utc)
    view.render_dashboard(project, facts, frames, report, ROOT, started, completed)
    view.write_findings_file(project, facts, frames, report, ROOT)
    view.finalize_run(project, report, ROOT, started, completed, {
        "python": platform.python_version(), "geopandas": gpd.__version__, "shapely": shapely.__version__,
        "geos": shapely.geos_version_string, "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
        "scipy": scipy.__version__, "numpy": np.__version__, "pandas": pd.__version__,
    })
    top = summary.iloc[0]
    log.info("done %s: top option %s (score %.1f); status %s", run_id, top["title"], top["score_balanced"], report["status"])


if __name__ == "__main__":
    sys.exit(main())

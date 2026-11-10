# =============================================================================
# Tartu schools: 15-minute walking coverage  --  canonical pipeline
# -----------------------------------------------------------------------------
# Deliberately boring and inspectable. Reads ONLY the immutable snapshots under
# data/source/ (pulled by acquire.py, see data/source/acquisition.json) plus the
# overrides declared in project.yaml, and creates every declared output, the
# QGIS companion, the dashboard, the validation report and the run record.
#
#   python pipeline.py            (or: openmapstack run project.yaml)
#
# All metric work (lengths, buffers, areas, nearest-neighbour) happens in
# EPSG:3301 (L-EST97). EPSG:4326 is used for storage/interchange only.
# =============================================================================

from __future__ import annotations

import datetime
import hashlib
import json
import logging
import math
import platform
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import pyproj
import scipy
import shapely
import yaml
from scipy.sparse import coo_matrix
from scipy.ndimage import distance_transform_edt
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

import view

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source"
OUT = ROOT / "data" / "derived"
RUNS = ROOT / "runs"
VALIDATION = ROOT / "validation"

ANALYSIS_CRS = "EPSG:3301"
STORAGE_CRS = "EPSG:4326"

# ---- analysis parameters (mirrored in project.yaml; drift is a failed check) --
WALK_SPEED_KMH = 4.8                      # assumption A2
METRES_PER_MINUTE = WALK_SPEED_KMH * 1000 / 60
MINUTES = [5, 10, 15, 20]                 # thresholds materialised for the view
CANONICAL_MINUTES = 15
SCHOOL_SETS = ["basic_all", "municipal_basic", "all_schools"]
CANONICAL_SET = "basic_all"
# Liik (school type) codes of the city's layer that make up each school set.
SET_LIIK = {
    "basic_all": {1, 2, 4},               # schools of residence + citywide + other (private) basic schools
    "municipal_basic": {1, 2},            # municipal schools of residence + citywide municipal schools
    "all_schools": {1, 2, 3, 4, 6},       # + special-needs schools and upper-secondary stages
}
NETWORK_STEP_M = 20.0                     # max spacing of routing nodes along a path
OFF_PATH_M = 50.0                         # off-path allowance drawn around reached paths
SHED_CELL_M = 10.0                        # raster cell used to draw walksheds
EXCLUDED_ROAD_CLASSES = {"motorway"}
MIN_FOOTPRINT_M2 = 40.0                   # smaller footprints are sheds/garages, not dwellings
FLOOR_HEIGHT_M = 3.0
RESIDENTIAL_CLASSES = {"house", "apartments", "detached", "semidetached_house", "terrace", "residential",
                       "dormitory", "bungalow", "farm", "cabin", "static_caravan", "hut"}
DEFAULT_FLOORS_MULTI = {"apartments", "dormitory", "residential"}
UNSERVED_BUFFER_M = 60.0                  # buildings closer than 2 x this merge into one unserved area
UNSERVED_MIN_POP = 10.0                   # smaller pockets stay visible as buildings, not as named areas

log = logging.getLogger("pipeline")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

TO_3301 = pyproj.Transformer.from_crs(STORAGE_CRS, ANALYSIS_CRS, always_xy=True)


def variant_key(school_set: str, minutes: int) -> str:
    return f"{school_set}_{minutes}"


CANONICAL_VARIANT = variant_key(CANONICAL_SET, CANONICAL_MINUTES)


def read_geojson(name: str) -> gpd.GeoDataFrame:
    """Source GeoJSON is EPSG:4326 (RFC 7946, lon/lat); reproject for metric work."""
    frame = gpd.read_file(SOURCE / name)
    assert frame.crs is not None and frame.crs.to_epsg() == 4326, f"{name}: unexpected CRS {frame.crs}"
    return frame.to_crs(ANALYSIS_CRS)


# ------------------------------ STEP 1 ---------------------------------------
# Administrative division.
#  Source: Tartu City Government GIS, Aluskaardid/KT_haldusjaotus (layers 0, 1, 2).
#  Rationale: the city's own boundary and district geometry define "Tartu" and
#  the areas the answer is reported by. 18 city districts + 12 settlements of the
#  former Tähtvere parish tile the municipality exactly.
def load_admin() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    boundary = read_geojson("tartu-boundary.geojson")[["ONIMI", "geometry"]]
    districts = read_geojson("tartu-districts.geojson").rename(columns={"NIMI": "area_name"})
    districts["area_type"] = "city_district"
    settlements = read_geojson("tartu-settlements.geojson").rename(columns={"ANIMI": "area_name"})
    settlements["area_type"] = "settlement"
    areas = pd.concat([districts[["area_name", "area_type", "geometry"]],
                       settlements[["area_name", "area_type", "geometry"]]], ignore_index=True)
    areas = areas.sort_values("area_name").reset_index(drop=True)
    areas["geometry"] = shapely.make_valid(areas.geometry.values)
    return boundary, gpd.GeoDataFrame(areas, crs=ANALYSIS_CRS)


# ------------------------------ STEP 2 ---------------------------------------
# Schools + overrides.
#  Source: Tartu City Government GIS, Haridus/LU_haridus_avalik layer 0, Jaotus = 3.
#  Semantic predicates come from the layer's coded fields (Liik, Omand,
#  Lopetamise_kp). A record with a closing date is not operating; a missing Liik
#  is never defaulted into a school set.
LIIK_LABEL = {1: "School of residence (municipal)", 2: "Citywide municipal school", 3: "Special-needs school",
              4: "Other Tartu school", 5: "School outside Tartu", 6: "Upper-secondary stage"}
OMAND_LABEL = {1: "municipal", 2: "state", 3: "private"}


def load_schools(project: dict) -> tuple[gpd.GeoDataFrame, list[dict]]:
    schools = read_geojson("tartu-schools.geojson")
    schools["source_id"] = schools["GlobalID"].str.strip("{}")
    schools["name"] = schools["Nimi"].str.strip()
    schools["status"] = np.where(schools["Lopetamise_kp"].notna(), "closed_in_source", "active")

    # Overrides: validated against the immutable source before they take effect.
    results = []
    for override in project.get("overrides") or []:
        result = {"id": override["id"], "action": override["action"], "status": "rejected"}
        target = override.get("target") or {}
        match = schools.index[schools["source_id"] == str(target.get("feature_id", "")).strip("{}")]
        evidence = [e for e in override.get("evidence") or [] if str(e.get("value", "")).strip()]
        if override["action"] != "hide_source_feature" or target.get("source") != "schools":
            result["reason"] = "unsupported override for this pipeline"
        elif len(match) != 1:
            result["reason"] = "target feature not found in the immutable source"
        elif schools.loc[match[0], "name"] != target.get("feature_name"):
            result["reason"] = "asserted feature name does not match the source"
        elif not evidence:
            result["reason"] = "no evidence recorded"
        else:
            schools.loc[match[0], "status"] = "excluded_by_override"
            schools.loc[match[0], "override_id"] = override["id"]
            result.update(status="applied", feature=target.get("feature_name"))
        results.append(result)
    if "override_id" not in schools:
        schools["override_id"] = None

    usable = schools["status"] == "active"
    for school_set, codes in SET_LIIK.items():
        schools[f"in_{school_set}"] = usable & schools["Liik"].isin(codes)
    schools["map_class"] = np.select(
        [schools["status"] != "active", schools[f"in_{CANONICAL_SET}"]], ["excluded", "counted"], "other_school")
    schools["type_label"] = schools["Liik"].map(LIIK_LABEL)
    schools["ownership"] = schools["Omand"].map(OMAND_LABEL)
    schools = schools.sort_values("source_id").reset_index(drop=True)
    return schools, results


# ------------------------------ STEP 3 ---------------------------------------
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
        rows.append({
            "cell_id": fields["gml_id"],
            "population": float(fields["value_statisticalvalue_value"]),
            "special_value": fields.get("value_statisticalvalue_specialvalue_xlink_title", ""),
            "reference_period": fields["periodofreference_xlink_title"],
            "geometry": shapely.Polygon(ring),
        })
    grid = gpd.GeoDataFrame(rows, crs=ANALYSIS_CRS).sort_values("cell_id").reset_index(drop=True)
    bounds = grid.bounds
    assert np.allclose(grid.area, 1e6, rtol=1e-6), "grid cells are not 1 km squares: axis order wrong?"
    assert np.allclose(bounds.minx % 1000, 0, atol=0.01) or np.allclose(bounds.minx % 1000, 1000, atol=0.01)
    return grid


# ------------------------------ STEP 4 ---------------------------------------
# Residential building candidates.
#  Sources: Overture Maps buildings (release pinned in project.yaml) and the
#  city's cadastral parcels whose intended use includes ELAMUMAA (residential).
#  85 % of footprints carry no use class, so a footprint counts as residential
#  (tier 1) when it is classed residential OR is unclassed and its centroid lies
#  on a residential parcel (inside Tartu, where the parcel layer exists). Footprints under 40 m2 and footprints with an
#  explicit non-residential class never receive population.
def load_buildings(grid: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    table = pq.read_table(SOURCE / "overture-buildings.parquet").to_pandas()
    buildings = gpd.GeoDataFrame(
        table[["id", "subtype", "class", "height", "num_floors"]],
        geometry=shapely.from_wkb(table["geometry"].values), crs=STORAGE_CRS,
    ).to_crs(ANALYSIS_CRS)
    buildings["geometry"] = shapely.make_valid(buildings.geometry.values)
    buildings["footprint_m2"] = buildings.area
    buildings["centroid"] = buildings.geometry.centroid
    points = gpd.GeoDataFrame(buildings[["id"]], geometry=buildings["centroid"], crs=ANALYSIS_CRS)

    parcels = read_geojson("tartu-residential-parcels.geojson")[["TUNNUS", "geometry"]]
    parcels["geometry"] = shapely.make_valid(parcels.geometry.values)
    on_parcel = gpd.sjoin(points, parcels, predicate="within", how="inner")["id"]
    buildings["on_residential_parcel"] = buildings["id"].isin(set(on_parcel))
    in_city = gpd.sjoin(points, boundary[["geometry"]], predicate="within", how="inner")["id"]
    buildings["in_tartu"] = buildings["id"].isin(set(in_city))

    in_cell = gpd.sjoin(points, grid[["cell_id", "geometry"]], predicate="within", how="left")
    in_cell = in_cell.drop_duplicates("id").set_index("id")["cell_id"]
    buildings["cell_id"] = buildings["id"].map(in_cell)

    cls = buildings["class"]
    big = buildings["footprint_m2"] >= MIN_FOOTPRINT_M2
    classed_res = cls.isin(RESIDENTIAL_CLASSES)
    unclassed = cls.isna() & buildings["subtype"].isna()
    buildings["tier"] = 0
    buildings.loc[big & unclassed, "tier"] = 2                                       # fallback only
    # The parcel layer covers Tartu only. In the neighbouring municipalities that share
    # border cells there is no land-use evidence, so unclassed footprints there are
    # tier 1 as well; otherwise Tartu's side of a border cell would be over-weighted.
    evidence = buildings["on_residential_parcel"] | ~buildings["in_tartu"]
    buildings.loc[big & (classed_res | (unclassed & evidence)), "tier"] = 1

    # Floors: tagged count, else height / 3 m, else a class default.
    floors = buildings["num_floors"].where(buildings["num_floors"] > 0)
    from_height = (buildings["height"] / FLOOR_HEIGHT_M).round().clip(lower=1)
    default = pd.Series(np.where(cls.isin(DEFAULT_FLOORS_MULTI), 3.0, 1.0), index=buildings.index)
    buildings["floors_est"] = floors.fillna(from_height).fillna(default)
    buildings["floors_basis"] = np.select(
        [floors.notna(), buildings["height"].notna()], ["num_floors", "height"], "class_default")
    buildings["weight"] = buildings["footprint_m2"] * buildings["floors_est"]
    return buildings.sort_values("id").reset_index(drop=True)


# ------------------------------ STEP 5 ---------------------------------------
# Dasymetric allocation: each grid cell's residents are shared among the
# residential footprints whose centroid lies in that cell (Statistics Estonia
# also assigns a building to the cell of its centroid), in proportion to
# footprint area x estimated floors. Cells with residents but no tier-1
# footprint fall back to unclassed footprints; cells with none stay unallocated
# and are reported, never silently dropped.
def allocate_population(buildings: gpd.GeoDataFrame, grid: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    buildings = buildings.copy()
    buildings["pop_est"] = 0.0
    buildings["alloc_tier"] = 0
    grid = grid.copy()
    grid["alloc_basis"] = "no_residents"
    by_cell = buildings[buildings["cell_id"].notna() & (buildings["tier"] > 0)].groupby("cell_id")
    groups = {cell: frame for cell, frame in by_cell}
    for row in grid.itertuples():
        if row.population <= 0:
            continue
        frame = groups.get(row.cell_id)
        chosen = None
        if frame is not None:
            for tier in (1, 2):
                subset = frame[frame["tier"] == tier]
                if len(subset) and subset["weight"].sum() > 0:
                    chosen, basis = subset, f"tier{tier}"
                    break
        if chosen is None:
            grid.loc[row.Index, "alloc_basis"] = "unallocated"
            continue
        buildings.loc[chosen.index, "pop_est"] = row.population * chosen["weight"] / chosen["weight"].sum()
        buildings.loc[chosen.index, "alloc_tier"] = int(basis[-1])
        grid.loc[row.Index, "alloc_basis"] = basis
    return buildings, grid


# ------------------------------ STEP 6 ---------------------------------------
# Walkable network.
#  Source: Overture Maps transportation segments (OpenStreetMap-derived), same
#  pinned release. Segments are split at their connectors and densified so that
#  no routing node is more than NETWORK_STEP_M from the next along a path.
#  Excluded: non-road subtypes, motorways, and segments whose access is denied
#  to pedestrians (a denial naming foot, or a blanket denial such as
#  access=private/no).
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
    table = pq.read_table(SOURCE / "overture-segments.parquet").to_pandas().sort_values("id")
    roads = table[(table["subtype"] == "road") & ~table["class"].isin(EXCLUDED_ROAD_CLASSES)]
    denied = roads["access_restrictions"].map(_foot_denied)
    roads = roads[~denied]
    lines = shapely.transform(shapely.from_wkb(roads["geometry"].values),
                              lambda c: np.column_stack(TO_3301.transform(c[:, 0], c[:, 1])))

    connector_ids: dict[str, int] = {}
    parts, part_u, part_v = [], [], []
    for line, connectors in zip(lines, roads["connectors"].values):
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

    dense = shapely.segmentize(np.array(parts, dtype=object), NETWORK_STEP_M)
    coords, owner = shapely.get_coordinates(dense, return_index=True)
    first = np.r_[True, owner[1:] != owner[:-1]]
    last = np.r_[owner[1:] != owner[:-1], True]
    node = np.empty(len(coords), dtype=np.int64)
    interior = ~(first | last)
    n_conn = len(connector_ids)
    node[interior] = n_conn + np.arange(interior.sum())
    node[first] = np.array(part_u)[owner[first]]
    node[last] = np.array(part_v)[owner[last]]
    n_nodes = n_conn + int(interior.sum())
    xy = np.zeros((n_nodes, 2))
    xy[node] = coords

    same = owner[1:] == owner[:-1]
    u, v = node[:-1][same], node[1:][same]
    w = np.hypot(*(coords[1:][same] - coords[:-1][same]).T)
    graph = coo_matrix((np.r_[w, w], (np.r_[u, v], np.r_[v, u])), shape=(n_nodes, n_nodes)).tocsr()
    _, labels = connected_components(graph, directed=False)
    main = np.bincount(labels).argmax()
    in_main = labels == main
    main_share = float(w[in_main[u]].sum() / w.sum())
    return {
        "xy": xy, "u": u, "v": v, "w": w, "n_nodes": n_nodes, "in_main": in_main,
        "main_nodes": np.flatnonzero(in_main), "tree": cKDTree(xy[in_main]),
        "stats": {
            "segments_in_source": int(len(table)), "road_segments_used": int(len(roads)),
            "foot_denied_segments_excluded": int(denied.sum()), "routing_nodes": n_nodes,
            "routing_edges": int(len(w)), "network_km": round(float(w.sum()) / 1000, 1),
            "main_component_length_share": round(main_share, 4),
        },
    }


def snap(network: dict, xy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Nearest routing node of the main network component, and the straight-line gap to it."""
    gap, index = network["tree"].query(xy)
    return network["main_nodes"][index], gap


# ------------------------------ STEP 7 ---------------------------------------
# Network distance from every routing node to its nearest school, per school set.
# Each school is a virtual node joined to its snapped network node by its
# straight-line gap, so the door-side leg is part of the measured distance.
def route(network: dict, schools: gpd.GeoDataFrame) -> dict:
    n = network["n_nodes"]
    school_xy = np.column_stack([schools.geometry.x, schools.geometry.y])
    school_node, school_gap = snap(network, school_xy)
    k = len(schools)
    u = np.r_[network["u"], n + np.arange(k)]
    v = np.r_[network["v"], school_node]
    w = np.r_[network["w"], np.maximum(school_gap, 0.01)]
    graph = coo_matrix((np.r_[w, w], (np.r_[u, v], np.r_[v, u])), shape=(n + k, n + k)).tocsr()
    result = {"school_gap_m": school_gap}
    for school_set in SCHOOL_SETS:
        members = np.flatnonzero(schools[f"in_{school_set}"].values)
        dist, _, origin = dijkstra(graph, directed=False, indices=n + members, min_only=True,
                                   return_predecessors=True)
        nearest = np.where(origin >= n, origin - n, -1)
        result[school_set] = {"dist": dist[:n], "nearest": nearest[:n], "schools": int(len(members))}
    return result


# ------------------------------ STEP 8 ---------------------------------------
# Walksheds: the paths reachable within the time budget, drawn with the unspent
# budget (capped at OFF_PATH_M) as an off-path allowance, on a 10 m raster. These polygons are a
# drawing of the measured network reach. They do NOT decide whether a building
# is served: that is the building's own measured distance (step 9).
def walkshed(network: dict, dist: np.ndarray, limit_m: float):
    """Rasterised at SHED_CELL_M: a cell is inside when a routing node with at
    least r metres of unspent budget lies within r of the cell centre, for
    r = 10 ... OFF_PATH_M. Cells are dissolved with a coverage union."""
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
    merged = shapely.coverage_union_all(cells)
    # Smooth the staircase and drop pinholes smaller than four cells.
    merged = shapely.make_valid(shapely.simplify(merged, SHED_CELL_M * 0.75))
    parts = [shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 4 * SHED_CELL_M ** 2])
             for p in shapely.get_parts(merged) if p.geom_type == "Polygon" and p.area > 0]
    return shapely.make_valid(shapely.multipolygons(parts))


# ------------------------------ STEP 9 ---------------------------------------
# Building walking distance = straight-line gap from the footprint centroid to
# the nearest routing node + network distance from that node to the school.
def measure_buildings(buildings: gpd.GeoDataFrame, boundary: gpd.GeoDataFrame, areas: gpd.GeoDataFrame,
                      network: dict, routes: dict, schools: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    inhabited = buildings[buildings["pop_est"] > 0].copy()
    points = gpd.GeoDataFrame(inhabited[["id"]], geometry=inhabited["centroid"], crs=ANALYSIS_CRS)
    inside = gpd.sjoin(points, boundary[["geometry"]], predicate="within", how="inner")["id"]
    inhabited = inhabited[inhabited["id"].isin(set(inside))].copy()
    points = points[points["id"].isin(set(inside))]
    area_of = gpd.sjoin(points, areas, predicate="within", how="left").drop_duplicates("id").set_index("id")
    inhabited["area_name"] = inhabited["id"].map(area_of["area_name"])
    inhabited["area_type"] = inhabited["id"].map(area_of["area_type"])
    # Centroids exactly on a shared district edge fall "within" neither: nearest area.
    missing = inhabited["area_name"].isna()
    if missing.any():
        near = gpd.sjoin_nearest(points[points["id"].isin(inhabited.loc[missing, "id"])], areas, how="left")
        near = near.drop_duplicates("id").set_index("id")
        inhabited.loc[missing, "area_name"] = inhabited.loc[missing, "id"].map(near["area_name"])
        inhabited.loc[missing, "area_type"] = inhabited.loc[missing, "id"].map(near["area_type"])

    xy = np.column_stack([inhabited["centroid"].x, inhabited["centroid"].y])
    node, gap = snap(network, xy)
    inhabited["access_gap_m"] = gap
    names = schools["name"].values
    for school_set in SCHOOL_SETS:
        inhabited[f"walk_m_{school_set}"] = routes[school_set]["dist"][node] + gap
        nearest = routes[school_set]["nearest"][node]
        inhabited[f"nearest_school_{school_set}"] = np.where(nearest >= 0, names[np.clip(nearest, 0, None)], None)
    inhabited["walk_min"] = inhabited[f"walk_m_{CANONICAL_SET}"] / METRES_PER_MINUTE
    inhabited["served_15min"] = inhabited[f"walk_m_{CANONICAL_SET}"] <= CANONICAL_MINUTES * METRES_PER_MINUTE
    # Display classes relative to the accepted limit: within it, up to 5 min over,
    # 5-15 min over, more than 15 min over.
    over = inhabited["walk_min"] - CANONICAL_MINUTES
    inhabited["coverage_class"] = np.select([over <= 0, over <= 5, over <= 15], ["served", "over_0_5", "over_5_15"], "over_15")
    return inhabited.sort_values("id").reset_index(drop=True)


# ------------------------------ STEP 10 --------------------------------------
# Unserved areas: inhabited footprints beyond the time budget, buffered by
# UNSERVED_BUFFER_M and dissolved, so neighbouring unserved homes form one named
# pocket. Pockets under UNSERVED_MIN_POP residents are not listed as areas (their
# buildings still count in every total and stay on the map).
def unserved_areas(measured: gpd.GeoDataFrame, school_set: str, minutes: int) -> gpd.GeoDataFrame:
    column = f"walk_m_{school_set}"
    far = measured[measured[column] > minutes * METRES_PER_MINUTE]
    empty = gpd.GeoDataFrame({"variant": [], "geometry": []}, geometry="geometry", crs=ANALYSIS_CRS)
    if far.empty:
        return empty
    merged = shapely.union_all(shapely.buffer(far.geometry.values, UNSERVED_BUFFER_M, quad_segs=4))
    polygons = gpd.GeoDataFrame(geometry=list(shapely.get_parts(merged)), crs=ANALYSIS_CRS)
    polygons["pocket"] = np.arange(len(polygons))
    points = gpd.GeoDataFrame(far[["id", "pop_est", "area_name", column, f"nearest_school_{school_set}"]],
                              geometry=far["centroid"], crs=ANALYSIS_CRS)
    joined = gpd.sjoin(points, polygons, predicate="within", how="inner")
    rows = []
    for pocket, group in joined.groupby("pocket"):
        pop = float(group["pop_est"].sum())
        if pop < UNSERVED_MIN_POP:
            continue
        by_area = group.groupby("area_name")["pop_est"].sum().sort_values(ascending=False)
        by_school = group.groupby(f"nearest_school_{school_set}")["pop_est"].sum().sort_values(ascending=False)
        order = np.argsort(group[column].values)
        cum = np.cumsum(group["pop_est"].values[order])
        median_m = float(group[column].values[order][np.searchsorted(cum, cum[-1] / 2)])
        rows.append({
            "pop_unserved": round(pop, 1), "buildings": int(len(group)),
            "area_name": by_area.index[0],
            "areas": ", ".join(by_area.index[:3]),
            "nearest_school": by_school.index[0] if len(by_school) else None,
            "median_walk_min": round(median_m / METRES_PER_MINUTE, 1),
            "max_walk_min": round(float(group[column].max()) / METRES_PER_MINUTE, 1),
            "geometry": shapely.make_valid(shapely.simplify(polygons.geometry.iloc[pocket], 3.0)),
        })
    if not rows:
        return empty
    result = gpd.GeoDataFrame(rows, crs=ANALYSIS_CRS)
    result["_cx"] = result.geometry.centroid.x
    result = result.sort_values(["pop_unserved", "_cx"], ascending=[False, True]).drop(columns="_cx")
    result = result.reset_index(drop=True)
    result.insert(0, "rank", np.arange(1, len(result) + 1))
    result.insert(0, "variant", variant_key(school_set, minutes))
    result.insert(1, "school_set", school_set)
    result.insert(2, "walk_minutes", minutes)
    result["area_id"] = result["variant"] + "-" + result["rank"].astype(str)
    return result


# ------------------------------ STEP 11 --------------------------------------
# Tables. Plain numbers only; the view formats them.
def coverage_matrix(measured: gpd.GeoDataFrame, routes: dict) -> pd.DataFrame:
    total = measured["pop_est"].sum()
    rows = []
    for school_set in SCHOOL_SETS:
        for minutes in MINUTES:
            served = measured.loc[measured[f"walk_m_{school_set}"] <= minutes * METRES_PER_MINUTE, "pop_est"].sum()
            rows.append({
                "variant": variant_key(school_set, minutes), "school_set": school_set, "walk_minutes": minutes,
                "schools": routes[school_set]["schools"], "population": round(total),
                "pop_served": round(served), "pop_unserved": round(total) - round(served),
                "pct_unserved": round(100 * (1 - served / total), 2),
                "canonical": school_set == CANONICAL_SET and minutes == CANONICAL_MINUTES,
            })
    return pd.DataFrame(rows)


def area_summary(measured: gpd.GeoDataFrame, areas: gpd.GeoDataFrame) -> pd.DataFrame:
    column = f"walk_m_{CANONICAL_SET}"
    rows = []
    for area in areas.itertuples():
        group = measured[measured["area_name"] == area.area_name]
        pop = float(group["pop_est"].sum())
        row = {"area_name": area.area_name, "area_type": area.area_type, "population": round(pop),
               "residential_buildings": int(len(group))}
        for minutes in (10, 15, 20):
            far = float(group.loc[group[column] > minutes * METRES_PER_MINUTE, "pop_est"].sum())
            if minutes == CANONICAL_MINUTES:
                row["pop_unserved_15min"] = round(far)
            row[f"pct_unserved_{minutes}min"] = round(100 * far / pop, 1) if pop > 0 else None
        if pop > 0:
            order = np.argsort(group[column].values)
            cum = np.cumsum(group["pop_est"].values[order])
            row["median_walk_min"] = round(float(group[column].values[order][np.searchsorted(cum, cum[-1] / 2)])
                                           / METRES_PER_MINUTE, 1)
        else:
            row["median_walk_min"] = None
        rows.append(row)
    table = pd.DataFrame(rows)
    total_far = table["pop_unserved_15min"].sum()
    table["share_of_city_unserved_pct"] = (100 * table["pop_unserved_15min"] / total_far).round(1) if total_far else 0.0
    columns = ["area_name", "area_type", "population", "residential_buildings", "pop_unserved_15min",
               "pct_unserved_15min", "share_of_city_unserved_pct", "pct_unserved_10min", "pct_unserved_20min",
               "median_walk_min"]
    return table[columns].sort_values(["pop_unserved_15min", "area_name"], ascending=[False, True]).reset_index(drop=True)


def write_table(table: pd.DataFrame, path: Path) -> None:
    """CSV + XLSX from the same rows (project-spec s.2.5)."""
    table.to_csv(path, index=False, lineterminator="\n")
    with pd.ExcelWriter(path.with_suffix(".xlsx"), engine="openpyxl") as writer:
        table.to_excel(writer, index=False, sheet_name="data")
        # Fixed document timestamps keep the workbook byte-stable across reruns.
        writer.book.properties.created = datetime.datetime(2026, 1, 1)
        writer.book.properties.modified = datetime.datetime(2026, 1, 1)


# ------------------------------ STEP 12 --------------------------------------
# Export. GeoParquet (EPSG:3301) for analysis, GeoJSON (EPSG:4326, 6 decimals)
# for the web view and QGIS, plus a GeoPackage copy (EPSG:3301) of the buildings for QGIS.
def to_geojson(frame: gpd.GeoDataFrame, path: Path, decimals: int = 6) -> None:
    out = frame.to_crs(STORAGE_CRS)
    out["geometry"] = shapely.set_precision(out.geometry.values, 10 ** -decimals)
    out = out[~out.geometry.is_empty]
    payload = json.loads(out.to_json(drop_id=True))
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    for folder in (OUT, RUNS, VALIDATION):
        folder.mkdir(parents=True, exist_ok=True)
    started = datetime.datetime.now(datetime.timezone.utc)
    run_id = started.strftime("run-%Y%m%d-%H%M%S")
    project = yaml.safe_load((ROOT / "project.yaml").read_text(encoding="utf-8"))

    log.info("step 1-2: admin areas, schools, overrides")
    boundary, areas = load_admin()
    schools, override_results = load_schools(project)

    log.info("step 3-5: population grid, residential footprints, dasymetric allocation")
    grid = load_population_grid()
    buildings, grid = allocate_population(load_buildings(grid, boundary), grid)

    log.info("step 6-7: walkable network, nearest-school distances")
    network = build_network()
    routes = route(network, schools)
    schools["network_gap_m"] = np.round(routes["school_gap_m"], 1)

    log.info("step 8: walksheds for %d variants", len(SCHOOL_SETS) * len(MINUTES))
    shed_rows = []
    for school_set in SCHOOL_SETS:
        for minutes in MINUTES:
            shape = walkshed(network, routes[school_set]["dist"], minutes * METRES_PER_MINUTE)
            shed_rows.append({"variant": variant_key(school_set, minutes), "school_set": school_set,
                              "walk_minutes": minutes, "walk_limit_m": minutes * METRES_PER_MINUTE,
                              "schools": routes[school_set]["schools"],
                              "area_km2": round(shape.area / 1e6, 3), "geometry": shape})
    sheds = gpd.GeoDataFrame(shed_rows, crs=ANALYSIS_CRS)

    log.info("step 9-11: building distances, unserved areas, tables")
    measured = measure_buildings(buildings, boundary, areas, network, routes, schools)
    pockets = pd.concat([unserved_areas(measured, s, m) for s in SCHOOL_SETS for m in MINUTES], ignore_index=True)
    pockets = gpd.GeoDataFrame(pockets, geometry="geometry", crs=ANALYSIS_CRS)
    matrix = coverage_matrix(measured, routes)
    summary = area_summary(measured, areas)

    log.info("step 12: export")
    building_cols = ["id", "area_name", "area_type", "pop_est", "footprint_m2", "floors_est", "floors_basis",
                     "alloc_tier", "cell_id", "access_gap_m", "walk_min", "served_15min", "coverage_class",
                     *[f"walk_m_{s}" for s in SCHOOL_SETS], *[f"nearest_school_{s}" for s in SCHOOL_SETS]]
    result = gpd.GeoDataFrame(measured[building_cols], geometry=measured.geometry, crs=ANALYSIS_CRS)
    for column in ["pop_est", "footprint_m2", "access_gap_m", "walk_min", *[f"walk_m_{s}" for s in SCHOOL_SETS]]:
        result[column] = result[column].round(2)
    result.to_parquet(OUT / "residential-buildings.parquet", index=False)

    school_cols = ["source_id", "name", "Liik", "type_label", "ownership", "Aadress", "Koduleht", "status",
                   "map_class", "override_id", "network_gap_m", *[f"in_{s}" for s in SCHOOL_SETS]]
    schools_out = gpd.GeoDataFrame(schools[school_cols].rename(columns={"Liik": "type_code", "Aadress": "address",
                                                                        "Koduleht": "website"}),
                                   geometry=schools.geometry, crs=ANALYSIS_CRS)
    to_geojson(schools_out, OUT / "schools.geojson")
    canonical_shed = sheds[sheds["variant"] == CANONICAL_VARIANT]
    canonical_pockets = pockets[pockets["variant"] == CANONICAL_VARIANT]
    to_geojson(canonical_shed, OUT / "walkshed-15min.geojson")
    to_geojson(sheds, OUT / "walkshed-variants.geojson")
    to_geojson(canonical_pockets, OUT / "unserved-areas.geojson")
    to_geojson(pockets, OUT / "unserved-area-variants.geojson")

    areas_out = areas.merge(summary, on=["area_name", "area_type"], how="left")
    to_geojson(areas_out, OUT / "admin-areas.geojson")
    grid_out = grid[grid.intersects(boundary.geometry.iloc[0])].copy()
    inside = measured.groupby("cell_id")["pop_est"].sum()
    grid_out["pop_allocated_in_tartu"] = grid_out["cell_id"].map(inside).fillna(0).round(1)
    to_geojson(grid_out, OUT / "population-grid.geojson")
    write_table(summary, OUT / "area-summary.csv")
    write_table(matrix, OUT / "coverage-matrix.csv")

    # QGIS-facing copy of the buildings: GeoParquet is not readable by every QGIS build.
    gpkg = OUT / "residential-buildings.gpkg"
    gpkg.unlink(missing_ok=True)
    result.to_file(gpkg, layer="residential_buildings", driver="GPKG", engine="pyogrio",
                   metadata={}, layer_options={"FID": "fid"})
    view.stabilise_gpkg(gpkg)

    facts = {
        "run_id": run_id, "analysis_crs": ANALYSIS_CRS,
        "canonical": {"school_set": CANONICAL_SET, "walk_minutes": CANONICAL_MINUTES,
                      "walk_speed_kmh": WALK_SPEED_KMH, "walk_limit_m": CANONICAL_MINUTES * METRES_PER_MINUTE},
        "parameters": {"minutes": MINUTES, "school_sets": SCHOOL_SETS, "metres_per_minute": METRES_PER_MINUTE,
                       "off_path_m": OFF_PATH_M, "network_step_m": NETWORK_STEP_M,
                       "min_footprint_m2": MIN_FOOTPRINT_M2, "unserved_min_pop": UNSERVED_MIN_POP},
        "network": network["stats"],
        "population": {
            "grid_cells_in_frame": int(len(grid)), "grid_population_in_frame": float(grid["population"].sum()),
            "allocated_in_frame": round(float(buildings["pop_est"].sum()), 1),
            "unallocated_in_frame": float(grid.loc[grid["alloc_basis"] == "unallocated", "population"].sum()),
            "unallocated_cells_touching_tartu": int((grid_out["alloc_basis"] == "unallocated").sum()),
            "unallocated_pop_touching_tartu": float(grid_out.loc[grid_out["alloc_basis"] == "unallocated", "population"].sum()),
            "tartu_population_est": round(float(measured["pop_est"].sum()), 1),
            "tartu_residential_buildings": int(len(measured)),
            "tier2_population_in_tartu": round(float(measured.loc[measured["alloc_tier"] == 2, "pop_est"].sum()), 1),
            "reference_period": sorted(grid["reference_period"].unique())[0],
        },
        "schools": {s: routes[s]["schools"] for s in SCHOOL_SETS},
        "school_records": int(len(schools)), "max_school_gap_m": float(schools["network_gap_m"].max()),
        "overrides": override_results,
    }
    frames = {"measured": measured, "schools": schools, "grid": grid, "areas": areas, "sheds": sheds,
              "pockets": pockets, "matrix": matrix, "summary": summary, "result": result,
              "schools_out": schools_out, "areas_out": areas_out, "grid_out": grid_out, "buildings": buildings,
              "network": network, "routes": routes}

    log.info("step 13: QGIS project")
    facts["qgis"] = view.write_qgis_project(project, ROOT, facts)

    log.info("step 14: validation")
    report = view.validate(project, facts, frames, ROOT, run_id)

    log.info("step 15: dashboard, run record")
    completed = datetime.datetime.now(datetime.timezone.utc)
    view.render_dashboard(project, facts, frames, report, ROOT, started, completed)
    view.finalize_run(project, report, ROOT, started, completed, {
        "python": platform.python_version(), "geopandas": gpd.__version__, "shapely": shapely.__version__,
        "geos": shapely.geos_version_string, "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
        "scipy": scipy.__version__, "numpy": np.__version__, "pandas": pd.__version__,
    })
    canonical = matrix[matrix["canonical"]].iloc[0]
    log.info("done %s: %s of %s residents (%.1f %%) beyond %d min of a school; status %s", run_id,
             canonical["pop_unserved"], canonical["population"], canonical["pct_unserved"],
             CANONICAL_MINUTES, report["status"])


if __name__ == "__main__":
    sys.exit(main())

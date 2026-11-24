"""Canonical pipeline: nationwide screening of Estonia for a nuclear power plant site.

Reads only data/source/ (immutable snapshots, see acquire.py) and criteria.yaml.
Everything is measured once, on a screening grid, in metres:

  * The grid is aligned to Web Mercator (EPSG:3857) so the browser can draw it without
    reprojecting. A cell is 500 Mercator metres, about 255-270 m on the ground.
  * Every distance and every point-in-area test is made at the cell centre in
    L-EST97 (EPSG:3301). EPSG:3857 and EPSG:4326 are never used for a measurement.
  * Cell areas are geodesic (GRS80), one value per grid row.

Run:  openmapstack run project.yaml      (or: python pipeline.py)
"""

from __future__ import annotations

import datetime
import logging
import platform
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import rasterio.features
import shapely
import yaml
from affine import Affine
from pyproj import Geod, Transformer
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source"
DERIVED = ROOT / "data" / "derived"
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("pipeline")

ANALYSIS_CRS = 3301
GRID_CRS = 3857
CELL_M = 500            # grid step in Web Mercator metres
DENSIFY_M = 25          # spacing of the points that stand in for a line when measuring distance
POP_RADIUS_M = 5000     # radius of the "residents within 5 km" measure
# Distances are stored as whole units, rounded down. Every offered threshold is a
# multiple of its unit, so applying a rule to the stored value gives exactly the
# result of applying it to the measured metres.
DISTANCE_UNIT_M = {
    "d_sea": 100, "d_hazard": 100, "d_air_main": 250, "d_air_small": 100, "d_gas": 100,
    "d_fault": 100, "d_fault_basement": 100, "d_dwelling": 50, "d_border": 100,
    "d_grid": 250, "d_road": 100, "d_rail": 100, "d_port": 250,
}
DISTANCE_CAP = 255      # stored value meaning "at least 255 units away"
FLAGS = ["f_protected", "f_natura", "f_hoiuala", "f_keyhab", "f_single", "f_heritage", "f_undermined",
         "f_defence", "f_lake", "f_dense", "f_karst", "f_flood", "f_green", "f_mining", "f_mire",
         "f_groundwater"]
VALUES = ["elevation_m", "pop_density", "pop_5km"]
MAIN_AERODROME_TYPES = ["riiklik lennuväli", "sõjaväelennuväli"]
SMALL_AIRFIELD_TYPES = ["eralennuväli kõvakattega", "lennuväli mururajaga"]
HAZARD_CLASSES = ["ohtlik käitis ohtlikkus A", "ohtlik käitis ohtlikkus B"]
POP_VALUE = "value_statisticalvalue_value"


def read(key: str) -> gpd.GeoDataFrame:
    frame = gpd.read_parquet(SOURCE / f"{key}.parquet")
    assert frame.crs is not None and frame.crs.to_epsg() == ANALYSIS_CRS, f"{key}: CRS is not EPSG:3301"
    return frame


def load_criteria() -> dict:
    return yaml.safe_load((ROOT / "criteria.yaml").read_text(encoding="utf-8"))


def mapped(criteria: dict) -> list[dict]:
    return [c for c in criteria["criteria"] if c["status"] != "not_mapped"]


# ----------------------------------------------------------------------------
# STEP 1  Screening grid
#   Source: EHAK county and municipality boundaries (Maa- ja Ruumiamet).
#   A cell belongs to the land of Estonia when its centre lies in a county polygon.
# ----------------------------------------------------------------------------
class Grid:
    def __init__(self, counties: gpd.GeoDataFrame, municipalities: gpd.GeoDataFrame):
        xmin, ymin, xmax, ymax = counties.to_crs(GRID_CRS).total_bounds
        self.x0 = float(np.floor(xmin / CELL_M) * CELL_M)
        self.y1 = float(np.ceil(ymax / CELL_M) * CELL_M)
        self.cols = int(np.ceil((xmax - self.x0) / CELL_M))
        self.rows = int(np.ceil((self.y1 - ymin) / CELL_M))
        self.transform = Affine(CELL_M, 0, self.x0, 0, -CELL_M, self.y1)
        self.county_names = sorted(counties["maakond"])
        self.muni_names = sorted(municipalities["omavalitsus"])
        county_idx = self.burn(counties, values=counties["maakond"].map({n: i + 1 for i, n in enumerate(self.county_names)}))
        muni_idx = self.burn(municipalities, values=municipalities["omavalitsus"].map({n: i + 1 for i, n in enumerate(self.muni_names)}))
        self.land = county_idx > 0
        self.r, self.c = np.nonzero(self.land)              # row-major order of land cells
        self.n = int(self.r.size)
        self.county = county_idx[self.land].astype(np.uint8) - 1
        self.muni = np.where(muni_idx[self.land] > 0, muni_idx[self.land] - 1, 255).astype(np.uint8)
        mx = self.x0 + (self.c + 0.5) * CELL_M
        my = self.y1 - (self.r + 0.5) * CELL_M
        to_analysis = Transformer.from_crs(GRID_CRS, ANALYSIS_CRS, always_xy=True)
        self.x, self.y = to_analysis.transform(mx, my)       # cell centres, EPSG:3301 metres
        self.xy = np.column_stack([self.x, self.y])
        to_wgs = Transformer.from_crs(GRID_CRS, 4326, always_xy=True)
        self.lon, self.lat = to_wgs.transform(mx, my)
        # Geodesic area of one cell per row (it depends on latitude only).
        geod = Geod(ellps="GRS80")
        lon0, lon1 = to_wgs.transform([self.x0, self.x0 + CELL_M], [self.y1, self.y1])[0]
        edges_lat = to_wgs.transform(np.full(self.rows + 1, self.x0), self.y1 - np.arange(self.rows + 1) * CELL_M)[1]
        self.row_area_m2 = np.array([
            round(abs(geod.polygon_area_perimeter([lon0, lon1, lon1, lon0], [edges_lat[i], edges_lat[i], edges_lat[i + 1], edges_lat[i + 1]])[0]))
            for i in range(self.rows)], dtype=np.int64)
        self.area_m2 = self.row_area_m2[self.r]
        self.bounds_4326 = [*to_wgs.transform(self.x0, self.y1 - self.rows * CELL_M), *to_wgs.transform(self.x0 + self.cols * CELL_M, self.y1)]

    def burn(self, frame: gpd.GeoDataFrame, values=None) -> np.ndarray:
        """Cell-centre rule: a cell takes a polygon's value when its centre is inside it."""
        polygons = frame[frame.geom_type.isin(["Polygon", "MultiPolygon"])]
        geoms = polygons.geometry.to_crs(GRID_CRS)
        burn_values = np.ones(len(polygons), dtype=np.int32) if values is None else np.asarray(values.loc[polygons.index], dtype=np.int32)
        shapes = [(g, int(v)) for g, v in zip(geoms, burn_values) if g is not None and not g.is_empty]
        if not shapes:
            return np.zeros((self.rows, self.cols), dtype=np.int32)
        return rasterio.features.rasterize(shapes, out_shape=(self.rows, self.cols), transform=self.transform,
                                           fill=0, all_touched=False, dtype="int32")

    def flag(self, *frames: gpd.GeoDataFrame) -> np.ndarray:
        out = np.zeros(self.n, dtype=bool)
        for frame in frames:
            out |= self.burn(frame)[self.land] > 0
        return out

    def to_2d(self, values: np.ndarray, fill=0) -> np.ndarray:
        out = np.full((self.rows, self.cols), fill, dtype=values.dtype)
        out[self.r, self.c] = values
        return out

    def cell_of(self, x: float, y: float) -> int | None:
        """Index (in land order) of the cell that contains an EPSG:3301 point."""
        mx, my = Transformer.from_crs(ANALYSIS_CRS, GRID_CRS, always_xy=True).transform(x, y)
        col, row = int((mx - self.x0) // CELL_M), int((self.y1 - my) // CELL_M)
        if not (0 <= row < self.rows and 0 <= col < self.cols) or not self.land[row, col]:
            return None
        return int(np.searchsorted(self.r * self.cols + self.c, row * self.cols + col))


# ----------------------------------------------------------------------------
# Distance helpers (EPSG:3301 metres)
# ----------------------------------------------------------------------------
def sample_points(frame: gpd.GeoDataFrame, densify: bool = True) -> np.ndarray:
    """Points that stand in for the geometries: every vertex, plus points every
    DENSIFY_M along lines and polygon boundaries."""
    geoms = frame.geometry.values
    geoms = geoms[~shapely.is_empty(geoms) & ~shapely.is_missing(geoms)]
    areal = shapely.get_type_id(geoms) >= 3
    lines = np.where(areal & (shapely.get_dimensions(geoms) == 2), shapely.boundary(geoms), geoms)
    if densify:
        lines = shapely.segmentize(lines, DENSIFY_M)
    return shapely.get_coordinates(lines)


def distance_to(grid: Grid, points: np.ndarray) -> np.ndarray:
    return cKDTree(points).query(grid.xy, workers=-1)[0]


def run() -> None:
    started = datetime.datetime.now(datetime.timezone.utc)
    run_id = started.strftime("run-%Y%m%d-%H%M%S")
    project = yaml.safe_load((ROOT / "project.yaml").read_text(encoding="utf-8"))
    criteria = load_criteria()
    DERIVED.mkdir(parents=True, exist_ok=True)
    facts: dict = {}

    # STEP 1 --------------------------------------------------------------
    counties, municipalities = read("counties"), read("municipalities")
    grid = Grid(counties, municipalities)
    log.info("grid %d x %d, %d land cells", grid.rows, grid.cols, grid.n)
    facts["grid"] = {
        "cell_mercator_m": CELL_M, "rows": grid.rows, "cols": grid.cols, "land_cells": grid.n,
        "origin_3857": [grid.x0, grid.y1], "bounds_4326": [round(v, 6) for v in grid.bounds_4326],
        "cell_ground_m": [round(float(np.sqrt(grid.row_area_m2.min())), 1), round(float(np.sqrt(grid.row_area_m2.max())), 1)],
        "land_km2_grid": round(float(grid.area_m2.sum()) / 1e6, 1),
        "land_km2_boundaries": round(float(counties.area.sum()) / 1e6, 1),
    }
    cells = pd.DataFrame({"row": grid.r.astype(np.int32), "col": grid.c.astype(np.int32),
                          "county": np.array(grid.county_names)[grid.county],
                          "municipality": np.where(grid.muni < 255, np.array(grid.muni_names + [""])[np.minimum(grid.muni, len(grid.muni_names))], ""),
                          "area_m2": grid.area_m2})

    # STEP 2 --------------------------------------------------------------
    # Area flags, cell-centre rule. Sources: EELIS nature register, heritage register,
    # mineral deposits register, restrictions register, comprehensive plans.
    mining_claims = read("mining_claims")
    defence_objects = read("defence_objects")
    defence_zones = read("defence_zones")
    border = defence_objects[defence_objects["nahtus_id_vaartus"] == "Riigipiir"]
    assert len(border) > 0 and set(border.geom_type) == {"LineString"}, "state border lines missing"
    structures = defence_objects[defence_objects["nahtus_id_vaartus"] == "Riigikaitseline ehitis"]
    structure_zones = defence_zones[defence_zones["voond_liik_id_vaartus"] == "Riigikaitselise ehitise piiranguvöönd"]
    flags = {
        "f_protected": grid.flag(read("protected_areas")),
        "f_natura": grid.flag(read("natura_birds"), read("natura_habitats")),
        "f_hoiuala": grid.flag(read("conservation_areas")),
        "f_keyhab": grid.flag(read("key_habitats")),
        "f_single": grid.flag(read("single_object_zones")),
        "f_heritage": grid.flag(read("heritage_monuments"), read("heritage_zones")),
        "f_undermined": grid.flag(read("undermined_oil_shale"), read("undermined_phosphorite"),
                                  mining_claims[mining_claims["MAA_ALUNE"] == "1"]),
        "f_defence": grid.flag(structures, structure_zones),
        "f_lake": grid.flag(read("lakes")),
        "f_dense": grid.flag(read("dense_settlements")),
        "f_karst": grid.flag(read("karst"), read("karst_fields")),
        "f_flood": grid.flag(read("flood_hazard"), read("flood_risk_2024")),
        "f_green": grid.flag(read("green_network")),
        "f_mining": grid.flag(read("mineral_deposits"), mining_claims),
        "f_mire": grid.flag(read("mires")),
        "f_groundwater": grid.flag(read("groundwater_unprotected")),
    }
    assert list(flags) == FLAGS
    for name, values in flags.items():
        cells[name] = values
    log.info("area flags done")

    # STEP 3 --------------------------------------------------------------
    # Straight-line distances from each cell centre, EPSG:3301.
    airfields, hazards, ports = read("airfields"), read("hazardous_plants"), read("ports")
    power = read("power_lines_hv")
    gas = pd.concat([read("gas_transmission_359"), read("gas_transmission_3514"), read("gas_transmission_3516")], ignore_index=True)
    dwellings = read("dwellings")
    targets = {
        "d_sea": sample_points(read("sea")),
        "d_hazard": sample_points(hazards[hazards["tyypnimi"].isin(HAZARD_CLASSES)], densify=False),
        "d_air_main": sample_points(airfields[airfields["tyypnimi"].isin(MAIN_AERODROME_TYPES)], densify=False),
        "d_air_small": sample_points(airfields[airfields["tyypnimi"].isin(SMALL_AIRFIELD_TYPES)], densify=False),
        "d_gas": sample_points(gas),
        "d_fault": sample_points(read("faults_bedrock")),
        "d_fault_basement": sample_points(read("faults_basement")),
        "d_dwelling": sample_points(dwellings, densify=False),
        "d_border": sample_points(border),
        "d_grid": sample_points(power[power["nimipinge"] >= 330]),
        "d_road": sample_points(read("main_roads")),
        "d_rail": sample_points(read("railways")),
        "d_port": sample_points(ports[ports["tyypnimi"] == "sadam"], densify=False),
    }
    assert list(targets) == list(DISTANCE_UNIT_M)
    facts["distance_targets"] = {k: int(len(v)) for k, v in targets.items()}
    quantised = {}
    for name, points in targets.items():
        metres = distance_to(grid, points)
        cells[name + "_m"] = np.floor(metres).astype(np.int32)      # whole metres, rounded down
        quantised[name] = np.minimum(np.floor(metres / DISTANCE_UNIT_M[name]), DISTANCE_CAP).astype(np.uint8)
    log.info("distances done")

    # STEP 4 --------------------------------------------------------------
    # Terrain height (Maa- ja Ruumiamet DTM, 100 m) and population (Statistics Estonia 1 km grid).
    with rasterio.open(SOURCE / "dtm-100m.tif") as dtm:
        assert dtm.crs.to_epsg() == ANALYSIS_CRS
        elevation = np.array([v[0] for v in dtm.sample(grid.xy)], dtype=np.float32)
    cells["elevation_m"] = np.clip(np.floor(elevation), 0, 255).astype(np.int32)
    pop = read("population_grid")
    pop["residents"] = pd.to_numeric(pop[POP_VALUE], errors="coerce").fillna(0).astype(np.int64)
    assert pop.geometry.is_valid.all() and pop["inspireid_identifier_localid"].is_unique
    facts["population"] = {"grid_cells": int(len(pop)), "residents_total": int(pop["residents"].sum()),
                           "reference": str(pop["periodofreference_xlink_title"].iloc[0]) if "periodofreference_xlink_title" in pop else None,
                           "last_update": str(pop["gml_description"].iloc[0])}
    cells["pop_density"] = grid.burn(pop, values=pop["residents"])[grid.land].astype(np.int32)
    populated = pop[pop["residents"] > 0]
    centres = shapely.get_coordinates(populated.geometry.centroid.values)
    neighbours = cKDTree(grid.xy).query_ball_point(centres, POP_RADIUS_M, workers=-1)
    pop_5km = np.zeros(grid.n, dtype=np.int64)
    for residents, index in zip(populated["residents"].values, neighbours):
        pop_5km[index] += residents
    cells["pop_5km"] = pop_5km.astype(np.int32)
    log.info("terrain and population done")

    # STEP 5 --------------------------------------------------------------
    # Apply each mapped criterion at its declared threshold. `fails[id]` is true
    # where the cell does not meet the criterion.
    measures = {**flags, **quantised, **{v: cells[v].to_numpy() for v in VALUES}}

    def fails(criterion: dict, threshold=None) -> np.ndarray:
        rule = criterion["rule"]
        if rule["kind"] == "flag":
            return measures[rule["measure"]]
        t = rule["threshold"] if threshold is None else threshold
        if rule["kind"] in ("closer_than", "farther_than"):
            unit = DISTANCE_UNIT_M[rule["measure"]]
            steps = round(t * 1000 / unit)
            assert abs(steps * unit - t * 1000) < 1e-6 and steps < DISTANCE_CAP, f"{criterion['id']}: {t} km is not a multiple of {unit} m"
            q = measures[rule["measure"]]
            return q < steps if rule["kind"] == "closer_than" else q >= steps
        if rule["kind"] == "at_least":
            return measures[rule["measure"]] >= t
        raise ValueError(rule["kind"])

    cell_rules = [c for c in mapped(criteria) if c["rule"]["kind"] != "min_area"]
    area_rule = next(c for c in mapped(criteria) if c["rule"]["kind"] == "min_area")
    failing = {c["id"]: fails(c) for c in cell_rules}
    canonical_ids = [c["id"] for c in cell_rules if c["canonical"]]
    excluded = np.zeros(grid.n, dtype=bool)
    exclusion_count = np.zeros(grid.n, dtype=np.int16)
    for cid in canonical_ids:
        excluded |= failing[cid]
        exclusion_count += failing[cid]
    remaining = ~excluded

    # STEP 6 --------------------------------------------------------------
    # Enough contiguous land: remaining cells joined edge to edge (4-neighbour) must
    # add up to the declared area.
    def contiguous(mask: np.ndarray, min_ha: float):
        labels, count = ndimage.label(grid.to_2d(mask.astype(np.uint8)), structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
        label_of = labels[grid.r, grid.c]
        area = np.bincount(label_of, weights=grid.area_m2.astype(np.float64), minlength=count + 1).astype(np.int64)
        area[0] = 0
        keep = area >= int(min_ha * 10000)
        return keep[label_of] & mask, label_of, area, labels

    min_ha = area_rule["rule"]["threshold"]
    candidate, label_of, label_area, labels_2d = contiguous(remaining, min_ha)
    cells["exclusions_failed"] = exclusion_count
    cells["remaining"] = remaining
    cells["candidate"] = candidate
    for cid in failing:
        cells["fail_" + cid] = failing[cid]
    log.info("screen: %.0f km2 remaining, %.0f km2 in areas of at least %s ha",
             grid.area_m2[remaining].sum() / 1e6, grid.area_m2[candidate].sum() / 1e6, min_ha)

    # STEP 7 --------------------------------------------------------------
    # Candidate areas: one polygon per contiguous group, with the values of the
    # consideration and suitability criteria measured over its cells.
    kept_labels = np.unique(label_of[candidate])
    order = sorted(kept_labels, key=lambda l: (-int(label_area[l]), int(np.flatnonzero(label_of == l)[0])))
    area_id = {int(l): i + 1 for i, l in enumerate(order)}
    cells["area_id"] = np.where(candidate, np.vectorize(lambda l: area_id.get(int(l), 0))(label_of), 0).astype(np.int32)
    id_2d = grid.to_2d(cells["area_id"].to_numpy().astype(np.int32))
    shapes = rasterio.features.shapes(id_2d, mask=id_2d > 0, transform=grid.transform, connectivity=4)
    polygons = gpd.GeoDataFrame([{"area_id": int(v), "geometry": shapely.geometry.shape(g)} for g, v in shapes], crs=GRID_CRS)
    polygons = polygons.dissolve("area_id", as_index=False)
    considerations = [c for c in cell_rules if not c["canonical"] and c["class"] == "consideration"]
    advantages = [c for c in cell_rules if c["class"] == "suitability"]
    sites = read("rep_sites")
    site_areas = read("rep_site_areas")
    planning_area = read("rep_planning_area")
    in_planning = grid.flag(planning_area)
    cells["in_rep_planning_area"] = in_planning
    rows = []
    for aid, group in cells[cells["area_id"] > 0].groupby("area_id"):
        idx = group.index.to_numpy()
        flagged = [c["name"] for c in considerations if failing[c["id"]][idx].mean() > 0.5]
        met = [c["name"] for c in advantages if (~failing[c["id"]][idx]).mean() > 0.5]
        weights = group["area_m2"].to_numpy()
        rows.append({
            "area_id": int(aid),
            "county": group["county"].mode().iat[0],
            "municipality": group["municipality"].mode().iat[0],
            "area_ha": round(float(weights.sum()) / 1e4, 1),
            "cells": int(len(group)),
            "lon": round(float(np.average(grid.lon[idx], weights=weights)), 5),
            "lat": round(float(np.average(grid.lat[idx], weights=weights)), 5),
            "sea_km_min": round(float(group["d_sea_m"].min()) / 1000, 2),
            "elevation_m_median": int(group["elevation_m"].median()),
            "grid_330kv_km_min": round(float(group["d_grid_m"].min()) / 1000, 1),
            "main_road_km_min": round(float(group["d_road_m"].min()) / 1000, 1),
            "port_km_min": round(float(group["d_port_m"].min()) / 1000, 1),
            "dwelling_m_median": int(group["d_dwelling_m"].median()),
            "residents_5km_median": int(group["pop_5km"].median()),
            "considerations_flagged": len(flagged),
            "considerations_list": "; ".join(flagged),
            "advantages_met": len(met),
            "advantages_list": "; ".join(met),
            "in_rep_planning_area": bool(in_planning[idx].mean() > 0.5),
        })
    areas = pd.DataFrame(rows).sort_values("area_id").reset_index(drop=True)
    polygons = polygons.merge(areas, on="area_id").sort_values("area_id").reset_index(drop=True)

    # STEP 8 --------------------------------------------------------------
    # Official candidate sites of the state special plan, checked against this screen.
    dropped = {"Moldova", "Aa - rand", "Aa - mets"}
    site_rows, site_polygons = [], {}
    for _, site in sites.sort_values("nimi").iterrows():
        # The two official layers spell some names differently, so the 95 ha
        # polygon is matched to its site point by position.
        polygon = site_areas.geometry[site_areas.contains(site.geometry)].iloc[0]
        site_polygons[site["nimi"]] = polygon
        inside = np.flatnonzero(shapely.contains_xy(polygon, grid.x, grid.y))
        centre = grid.cell_of(site.geometry.x, site.geometry.y)
        failed_centre = [c["name"] for c in cell_rules if c["canonical"] and centre is not None and failing[c["id"]][centre]]
        shares = {c["id"]: float(failing[c["id"]][inside].mean()) for c in cell_rules if c["canonical"]} if len(inside) else {}
        site_rows.append({
            "site": site["nimi"],
            "rep_status": "dropped in October 2026" if site["nimi"] in dropped else "under assessment",
            "municipality": cells["municipality"].iat[centre] if centre is not None else "",
            "cells_in_95ha_area": int(len(inside)),
            "cells_remaining": int(remaining[inside].sum()),
            "cells_in_candidate_area": int(candidate[inside].sum()),
            "share_remaining_pct": round(100 * float(remaining[inside].mean()), 1) if len(inside) else 0.0,
            "centre_passes": bool(centre is not None and remaining[centre]),
            "centre_fails": "; ".join(failed_centre),
            "main_exclusions_in_area": "; ".join(f"{next(c['name'] for c in cell_rules if c['id'] == k)} {round(100 * v)} %"
                                                 for k, v in sorted(shares.items(), key=lambda kv: -kv[1]) if v >= 0.05),
            "sea_km": round(float(cells["d_sea_m"].iat[centre]) / 1000, 2) if centre is not None else None,
            "elevation_m": int(cells["elevation_m"].iat[centre]) if centre is not None else None,
            "grid_330kv_km": round(float(cells["d_grid_m"].iat[centre]) / 1000, 1) if centre is not None else None,
            "residents_5km": int(cells["pop_5km"].iat[centre]) if centre is not None else None,
            "lon": None, "lat": None,
        })
    site_table = pd.DataFrame(site_rows)
    site_points = sites.to_crs(4326)
    site_table["lon"] = site_table["site"].map(dict(zip(site_points["nimi"], site_points.geometry.x.round(5))))
    site_table["lat"] = site_table["site"].map(dict(zip(site_points["nimi"], site_points.geometry.y.round(5))))
    sites_out = gpd.GeoDataFrame(site_table, geometry=[site_polygons[n] for n in site_table["site"]], crs=ANALYSIS_CRS)

    # STEP 9 --------------------------------------------------------------
    # Tables: the criteria catalogue with what each criterion removes, and counties.
    land_m2 = float(grid.area_m2.sum())
    catalogue = []
    for c in criteria["criteria"]:
        rule = c.get("rule") or {}
        row = {"id": c["id"], "group": next(g["title"] for g in criteria["groups"] if g["id"] == c["group"]),
               "name": c["name"], "name_et": c["name_et"], "class": c["class"], "origin": c["origin"],
               "official_ref": c["ref"], "status": c["status"], "in_accepted_run": bool(c.get("canonical", False)),
               "rule": rule.get("kind", ""), "threshold": rule.get("threshold"), "unit": rule.get("unit", ""),
               "fails_km2": None, "fails_pct_of_land": None, "sole_exclusion_km2": None,
               "official_threshold": c["official_threshold"], "note": c["note"]}
        if c["id"] in failing:
            f = failing[c["id"]]
            row["fails_km2"] = round(float(grid.area_m2[f].sum()) / 1e6, 1)
            row["fails_pct_of_land"] = round(100 * float(grid.area_m2[f].sum()) / land_m2, 2)
            if c["canonical"]:
                row["sole_exclusion_km2"] = round(float(grid.area_m2[f & (exclusion_count == 1)].sum()) / 1e6, 1)
        if rule.get("kind") == "min_area":
            lost = remaining & ~candidate
            row["fails_km2"] = round(float(grid.area_m2[lost].sum()) / 1e6, 1)
            row["fails_pct_of_land"] = round(100 * float(grid.area_m2[lost].sum()) / land_m2, 2)
            row["sole_exclusion_km2"] = row["fails_km2"]
        catalogue.append(row)
    catalogue = pd.DataFrame(catalogue)

    cooling = failing["cooling_sea"]
    county_rows = []
    for name in grid.county_names:
        m = (cells["county"] == name).to_numpy()
        county_rows.append({
            "county": name,
            "land_km2": round(float(grid.area_m2[m].sum()) / 1e6, 1),
            "within_cooling_distance_km2": round(float(grid.area_m2[m & ~cooling].sum()) / 1e6, 1),
            "remaining_km2": round(float(grid.area_m2[m & remaining].sum()) / 1e6, 2),
            "candidate_km2": round(float(grid.area_m2[m & candidate].sum()) / 1e6, 2),
            "candidate_areas": int(areas.loc[areas["county"] == name, "area_id"].count()),
            "largest_area_ha": float(areas.loc[areas["county"] == name, "area_ha"].max()) if (areas["county"] == name).any() else 0.0,
        })
    county_table = pd.DataFrame(county_rows).sort_values("candidate_km2", ascending=False).reset_index(drop=True)

    facts["canonical"] = {
        "criteria_applied": canonical_ids + [area_rule["id"]],
        "thresholds": {c["id"]: c["rule"].get("threshold") for c in mapped(criteria) if c["canonical"] and "threshold" in c["rule"]},
        "land_km2": round(land_m2 / 1e6, 1),
        "remaining_km2": round(float(grid.area_m2[remaining].sum()) / 1e6, 2),
        "candidate_km2": round(float(grid.area_m2[candidate].sum()) / 1e6, 2),
        "candidate_m2": int(grid.area_m2[candidate].sum()),
        "remaining_m2": int(grid.area_m2[remaining].sum()),
        "candidate_cells": int(candidate.sum()), "remaining_cells": int(remaining.sum()),
        "candidate_areas": int(len(areas)),
        "candidate_pct_of_land": round(100 * float(grid.area_m2[candidate].sum()) / land_m2, 3),
    }
    facts["catalogue"] = {
        "total": int(len(catalogue)),
        "by_status": catalogue["status"].value_counts().to_dict(),
        "by_class": catalogue["class"].value_counts().to_dict(),
        "rep_screening_rows": int((catalogue["origin"] == "rep_screening").sum()),
        "rep_screening_mapped": int(((catalogue["origin"] == "rep_screening") & (catalogue["status"] != "not_mapped")).sum()),
        "exclusions_not_mapped": catalogue.loc[(catalogue["class"] == "exclusion") & (catalogue["status"] == "not_mapped"), "name"].tolist(),
    }

    # STEP 10 -------------------------------------------------------------
    # Export. GeoParquet in EPSG:3301 for analysis, GeoJSON (EPSG:4326) for exchange.
    grid_out = gpd.GeoDataFrame(cells, geometry=gpd.points_from_xy(grid.x, grid.y), crs=ANALYSIS_CRS)
    grid_out.to_parquet(DERIVED / "screening-grid.parquet", compression="zstd")
    import view
    view.write_geojson(polygons.to_crs(4326), DERIVED / "candidate-areas.geojson")
    view.write_geojson(sites_out.to_crs(4326), DERIVED / "official-sites.geojson")
    context = {
        "planning_area": planning_area[["geometry"]].assign(kind="REP planning area", name="Planning area of the state special plan"),
        "grid_330kv": power.loc[power["nimipinge"] >= 330, ["geometry"]].assign(kind="330 kV line", name="330 kV transmission line"),
        "aerodromes": airfields.loc[airfields["tyypnimi"].isin(MAIN_AERODROME_TYPES + SMALL_AIRFIELD_TYPES), ["nimi", "tyypnimi", "geometry"]]
            .rename(columns={"nimi": "name"}).assign(kind=lambda d: np.where(d["tyypnimi"].isin(MAIN_AERODROME_TYPES), "State or military aerodrome", "Other airfield")).drop(columns="tyypnimi"),
        "hazardous": hazards.loc[hazards["tyypnimi"].isin(HAZARD_CLASSES), ["nimi", "geometry"]].rename(columns={"nimi": "name"}).assign(kind="Hazardous establishment (A or B)"),
        "ports": ports.loc[ports["tyypnimi"] == "sadam", ["nimi", "geometry"]].rename(columns={"nimi": "name"}).assign(kind="Port"),
        "faults": read("faults_bedrock")[["geometry"]].assign(kind="Bedrock fault", name="Bedrock fault (1:400 000)"),
    }
    reference = pd.concat([f[["kind", "name", "geometry"]] for f in context.values()], ignore_index=True)
    reference = gpd.GeoDataFrame(reference, geometry="geometry", crs=ANALYSIS_CRS)
    reference["geometry"] = shapely.simplify(reference.geometry.values, 20)
    view.write_geojson(reference.to_crs(4326), DERIVED / "reference-features.geojson")
    tables = {"candidate-areas": areas, "criteria-catalogue": catalogue, "county-summary": county_table,
              "official-sites-check": site_table}
    for stem, table in tables.items():
        view.write_table(table, DERIVED / f"{stem}.csv")

    frames = {"grid": grid, "cells": cells, "measures": measures, "failing": failing, "remaining": remaining,
              "candidate": candidate, "areas": areas, "polygons": polygons, "sites_out": sites_out,
              "site_table": site_table, "catalogue": catalogue, "county_table": county_table, "reference": reference,
              "criteria": criteria, "fails": fails, "contiguous": contiguous, "cell_rules": cell_rules,
              "area_rule": area_rule, "counties": counties, "planning_area": planning_area, "sites": sites}
    environment = {"python": platform.python_version(), "platform": platform.platform(),
                   "packages": {m.__name__: m.__version__ for m in (gpd, shapely, np, pd, rasterio)}}
    view.deliver(project, facts, frames, ROOT, run_id, started, environment)


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    run()

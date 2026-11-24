"""Acquire the immutable source snapshots for the Estonian nuclear-siting screening project.

This script is NOT part of the canonical run. It is the documented, repeatable way
the files under data/source/ were pulled; pipeline.py only ever reads those files.
Every request is recorded in data/source/acquisition.json with the service-declared
totals, so completeness is proven rather than assumed.

Run:  python acquire.py [key ...]      (no key = every layer; needs network access)

Hosts:
  gsavalik.envir.ee        Estonian public geoserver (Keskkonnaagentuur / Maa- ja Ruumiamet):
                           EELIS nature register, ETAK topography, EHAK boundaries, POIs,
                           restrictions (kitsendused), heritage, geology
  teenus.maaamet.ee        Maa- ja Ruumiamet WFS: mineral deposits register, 1:400 000 geology
  inspire.geoportaal.ee    Statistics Estonia 1 km population grid (INSPIRE PD WFS)
  teenus.maaamet.ee        also the terrain model WCS (dtm-25)
  gis.skpk.ee              official candidate sites of the state special plan (Skepast&Puhkim for MKM)

Each layer is paged as GeoJSON in EPSG:3301 and stored as one GeoParquet file with the
service's attributes unchanged (geometry column `geometry`, CRS EPSG:3301).
"""

from __future__ import annotations

import datetime
import hashlib
import json
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source"
UA = {"User-Agent": "openmapstack-project-acquire/1.0"}
PAGE = 5000

GS = "https://gsavalik.envir.ee/geoserver/ows"
MAARDLAD = "https://teenus.maaamet.ee/ows/maardlad"
GEOL400 = "https://teenus.maaamet.ee/ows/geoloogia400k"
POP_WFS = "https://inspire.geoportaal.ee/geoserver/PD_rahvastikutihedus/wfs"

# key: (endpoint, typeName, CQL filter or None, file stem)
LAYERS: dict[str, tuple[str, str, str | None]] = {
    # --- administrative frame and sea
    "counties": (GS, "ehak:maakondade_piirid", None),
    "municipalities": (GS, "ehak:omavalitsuste_piirid", None),
    "dense_settlements": (GS, "baasandmed:ehak_tiheasustus", None),
    "sea": (GS, "etak:e_201_meri_a", None),
    # --- nature and environment (EELIS, Keskkonnaagentuur)
    "protected_areas": (GS, "eelis:kr_kaitseala", None),
    "conservation_areas": (GS, "eelis:kr_hoiuala", None),
    "natura_birds": (GS, "eelis:kr_linnuala", None),
    "natura_habitats": (GS, "eelis:kr_loodusala", None),
    "key_habitats": (GS, "eelis:kr_vep", None),
    "karst": (GS, "eelis:kr_karst", None),
    "flood_hazard": (GS, "eelis:kr_yleujutusohuga_ala", None),
    "flood_risk_2024": (GS, "keskkonnaportaal:riskipiirkonnad_2024", None),
    "groundwater_unprotected": (GS, "maaamet:pv_kaitsmata", None),
    "green_network": (GS, "planeeringud:yld_plan_rohev", None),
    # --- geology and mining
    "karst_fields": (GS, "maaamet:geol_hydrogeoloogia_allikadkarstivormid_karstivali", None),
    "faults_bedrock": (GEOL400, "ms:G400_AP_RIKE", None),
    "faults_basement": (GEOL400, "ms:G400_AK_RIKKED", None),
    "mineral_deposits": (MAARDLAD, "ms:maardlapiir", None),
    "mining_claims": (MAARDLAD, "ms:maeeraldis_aktiivne", None),
    "undermined_oil_shale": (MAARDLAD, "ms:PK_altkaevandatud", None),
    "undermined_phosphorite": (MAARDLAD, "ms:EP_altkaevandatud", None),
    # --- man-made hazards, defence, heritage
    "hazardous_plants": (GS, "huvipunkt:ohtlik_ettevote", None),
    "airfields": (GS, "huvipunkt:lennuvali", None),
    "defence_objects": (GS, "kpokitsendused:kpo_avalik_riigikaitse", None),
    "defence_zones": (GS, "kmakitsendused:kma_avalik_riigikaitse", None),
    "heritage_monuments": (GS, "muinsuskaitse:kpo_malestised", None),
    # --- infrastructure
    "power_lines_hv": (GS, "etak:e_601_elektriliin_j", "nimipinge>=110"),
    "ports": (GS, "huvipunkt:sadam", None),
    "main_roads": (GS, "etak:e_501_tee_j", "tyyp=10"),
    "railways": (GS, "etak:e_502_roobastee_j", "tyyp=10"),
    "gas_transmission_359": (GS, "kponahtused:kpo_avalik_gaas_359", None),
    "gas_transmission_3514": (GS, "kponahtused:kpo_avalik_gaas_3514", None),
    "gas_transmission_3516": (GS, "kponahtused:kpo_avalik_gaas_3516", None),
    # --- water, single objects, heritage zones, dwellings
    "lakes": (GS, "eelis:kr_jarv", None),
    "single_object_zones": (GS, "eelis:kr_yksikobjekti_kaitsetsoon", None),
    "heritage_zones": (GS, "muinsuskaitse:kpo_kaitsevoondid", None),
    "mires": (GS, "eelis:sood", None),
    "dwellings": (GS, "maaamet:eluhooned", None),
    # --- population
    "population_grid": (POP_WFS, "PD_rahvastikutihedus:PD.StatisticalDistribution_", None),
}


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def get(url: str, params: dict, timeout: int = 300) -> requests.Response:
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=timeout)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    raise AssertionError


def wfs_layer(key: str, endpoint: str, typename: str, cql: str | None) -> dict:
    base = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": typename}
    if cql:
        base["CQL_FILTER"] = cql
    is_mapserver = "teenus.maaamet.ee" in endpoint
    # resultType=hits is capped at 5000 on some GeoServer layers, so the declared total is
    # read from the first data page (GeoJSON numberMatched) where the service gives one.
    hits = get(endpoint, {**base, "resultType": "hits"}).text
    matched = int(ET.fromstring(hits).attrib["numberMatched"])
    frames, pages, start = [], 0, 0
    while True:
        params = {**base, "srsName": "EPSG:3301", "count": PAGE, "startIndex": start}
        if is_mapserver:
            # MapServer offers GML only. GML 3.2 writes EPSG:3301 as northing, easting;
            # GDAL swaps to x, y for urn-style CRS names, and the bounds check below proves it.
            raw = get(endpoint, params).content
            with tempfile.NamedTemporaryFile(suffix=".gml") as tmp:
                tmp.write(raw)
                tmp.flush()
                page = gpd.read_file(tmp.name).set_crs("EPSG:3301", allow_override=True)
            page = page.drop(columns=[c for c in ("gml_id",) if c in page.columns])
        else:
            text = get(endpoint, {**params, "outputFormat": "application/json"}).text
            if not text.lstrip().startswith("{"):
                raise SystemExit(f"{key}: non-GeoJSON response: {text[:300]}")
            body = json.loads(text)
            if pages == 0 and isinstance(body.get("numberMatched"), int):
                matched = body["numberMatched"]
            page = (gpd.GeoDataFrame.from_features(body["features"], crs="EPSG:3301")
                    if body["features"] else gpd.GeoDataFrame(geometry=[], crs="EPSG:3301"))
        pages += 1
        if len(page) == 0:
            break
        frames.append(page)
        start += len(page)
        if start >= matched and len(page) < PAGE:
            break
    gdf = pd.concat(frames, ignore_index=True) if frames else gpd.GeoDataFrame(geometry=[])
    gdf = gpd.GeoDataFrame(gdf, geometry="geometry", crs="EPSG:3301")
    returned = len(gdf)
    if returned != matched:
        raise SystemExit(f"{key}: returned {returned} != matched {matched}")
    # A source record whose coordinates are not L-EST97 metres (seen: degrees) cannot be placed.
    # It is dropped here, counted and listed, never silently repaired.
    b = gdf.geometry.bounds
    bad = ~((b.minx > 300000) & (b.maxx < 800000) & (b.miny > 6300000) & (b.maxy < 6700000))
    dropped = gdf.loc[bad].drop(columns="geometry").astype(str).to_dict("records")
    gdf = gdf.loc[~bad].reset_index(drop=True)
    xmin, ymin, xmax, ymax = (round(float(v), 1) for v in gdf.total_bounds)
    path = SOURCE / f"{key}.parquet"
    gdf.to_parquet(path, compression="zstd")
    return {
        "endpoint": endpoint, "typename": typename, "cql_filter": cql, "retrieved_at": now(),
        "matched": matched, "returned": returned, "kept": len(gdf),
        "dropped_unplaceable": dropped, "page_size": PAGE, "pages": pages,
        "file": path.name, "size_bytes": path.stat().st_size, "sha256": sha256(path),
        "columns": [c for c in gdf.columns], "geometry_types": sorted(gdf.geom_type.dropna().unique()),
        "bounds_epsg3301": [xmin, ymin, xmax, ymax],
    }


SKPK = "https://gis.skpk.ee/arcgis/rest/services/TEJ_planeering_WEB_avalik/MapServer"
ARCGIS = {"rep_sites": 0, "rep_site_areas": 1, "rep_planning_area": 2}
DTM_WCS = "https://teenus.maaamet.ee/ows/wcs-dtm"
# 100 m grid over the whole dtm-25 coverage (x 365000-740000, y 6375000-6635000)
DTM_SIZE = (3750, 2600)


def arcgis_layer(key: str, layer: int) -> dict:
    """Official REP layers (a handful of features each); returned == service count."""
    url = f"{SKPK}/{layer}/query"
    matched = get(url, {"where": "1=1", "returnCountOnly": "true", "f": "json"}).json()["count"]
    data = get(url, {"where": "1=1", "outFields": "*", "outSR": 3301, "f": "geojson"}).json()
    gdf = gpd.GeoDataFrame.from_features(data["features"], crs="EPSG:3301")
    if len(gdf) != matched:
        raise SystemExit(f"{key}: returned {len(gdf)} != matched {matched}")
    path = SOURCE / f"{key}.parquet"
    gdf.to_parquet(path, compression="zstd")
    return {"endpoint": url, "typename": f"layer {layer}", "cql_filter": None, "retrieved_at": now(),
            "matched": matched, "returned": len(gdf), "page_size": 2000, "pages": 1, "file": path.name,
            "size_bytes": path.stat().st_size, "sha256": sha256(path), "columns": list(gdf.columns),
            "geometry_types": sorted(gdf.geom_type.unique()),
            "bounds_epsg3301": [round(float(v), 1) for v in gdf.total_bounds]}


def dtm() -> dict:
    """Maa- ja Ruumiamet 25 m terrain model (bare ground), resampled by the service to 100 m."""
    params = {"service": "WCS", "version": "2.0.1", "request": "GetCoverage", "coverageId": "dtm-25",
              "format": "image/tiff", "scalesize": f"x({DTM_SIZE[0]}),y({DTM_SIZE[1]})"}
    raw = get(DTM_WCS, params, timeout=900).content
    tmp = SOURCE / "dtm-100m.raw.tif"
    tmp.write_bytes(raw)
    path = SOURCE / "dtm-100m.tif"
    import rasterio
    with rasterio.open(tmp) as src:
        profile = src.profile | {"compress": "deflate", "predictor": 3, "tiled": True,
                                 "blockxsize": 256, "blockysize": 256}
        info = {"width": src.width, "height": src.height, "crs": str(src.crs), "bounds": list(src.bounds),
                "pixel_m": src.res[0]}
        with rasterio.open(path, "w", **profile) as dst:
            dst.write(src.read())
    tmp.unlink()
    return {"endpoint": DTM_WCS, "typename": "dtm-25", "request": params, "retrieved_at": now(), **info,
            "file": path.name, "size_bytes": path.stat().st_size, "sha256": sha256(path)}


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    log_path = SOURCE / "acquisition.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {}
    keys = sys.argv[1:] or [k for k in [*LAYERS, *ARCGIS, "dtm"] if k not in log]
    for key in keys:
        t0 = time.time()
        if key == "dtm":
            log[key] = dtm()
            log_path.write_text(json.dumps(log, indent=1, ensure_ascii=False) + "\n")
            print(f"dtm {log[key]['size_bytes'] / 1e6:.2f} MB", flush=True)
            continue
        log[key] = arcgis_layer(key, ARCGIS[key]) if key in ARCGIS else wfs_layer(key, *LAYERS[key])
        log_path.write_text(json.dumps(log, indent=1, ensure_ascii=False) + "\n")
        r = log[key]
        print(f"{key:28s} {r['returned']:>7d} rows {r['size_bytes'] / 1e6:7.2f} MB {time.time() - t0:6.1f} s", flush=True)


if __name__ == "__main__":
    main()

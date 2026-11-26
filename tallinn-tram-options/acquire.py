"""Acquire the immutable source snapshots for the Tallinn tram-option comparison.

This script is NOT part of the canonical run. It is the documented, repeatable
way the files under data/source/ were pulled; pipeline.py only ever reads those
files. Every request is recorded in data/source/acquisition.json together with
the service-declared totals, so completeness is proven rather than assumed.

Run:  python acquire.py            (needs network access to the hosts below)

Hosts:
  gis.tallinn.ee                           Tallinn City ArcGIS REST (TAR, EHR/ETAK copy, planning register)
  services3.arcgis.com                     Tallinn City ArcGIS Online (rail corridors in planning documents)
  inspire.geoportaal.ee                    Statistics Estonia 1 km population grid (INSPIRE PD WFS)
  transport.tallinn.ee                     Tallinn public transport GTFS
  overturemaps-us-west-2.s3.amazonaws.com  Overture Maps release (anonymous S3)
  geoportaal.maaruum.ee                    Land and Spatial Development Board: ETAK buildings with Building
                                           Register attributes, the national file (buildings around Tallinn)
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import geopandas as gpd
import requests

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source"

TALLINN_GIS = "https://gis.tallinn.ee/arcgis/rest/services"
# Tallinn's ArcGIS Online organisation (owner TallinnGIS): planning-document layers.
TALLINN_AGOL = "https://services3.arcgis.com/FwX2qF9JecNSRnwr/arcgis/rest/services"
POP_WFS = "https://inspire.geoportaal.ee/geoserver/PD_rahvastikutihedus/wfs"
POP_TYPENAME = "PD_rahvastikutihedus:PD.StatisticalDistribution_"  # EPSG:3301 edition
GTFS_URL = "https://transport.tallinn.ee/data/gtfs.zip"
OVERTURE_RELEASE = "2026-11-18.0"
OVERTURE_BUCKET = "overturemaps-us-west-2"

# Study frame. Tallinn's mainland extent is x 531472-552261, y 6579525-6599300
# (EPSG:3301; Aegna island reaches y 6606023), and the corridors of the 2019 study
# reach x 531073 (Tabasalu), x 558367 (Maardu) and y 6580181 (Jüri). The frame adds
# >= 2 km around both and is aligned to the 1 km population grid, so every grid
# cell crossing the city boundary or within reach of a corridor is present in full.
FRAME_3301 = (529000, 6577000, 561000, 6607000)  # xmin, ymin, xmax, ymax (easting, northing)
FRAME_4326 = (24.49, 59.31, 25.09, 59.61)        # the same frame, padded outward (Overture bbox pushdown)

# Buildings outside Tallinn: the national file the city's own layer is a copy of.
NATIONAL_BUILDINGS_URL = ("https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&andmetyyp=ETAK&dl=1"
                          "&f=tuletiskihid-etak_ehr_hooned_gpkg.zip&page_id=618")
NATIONAL_BUILDINGS_FIELDS = ["etak_id", "ehr_gid", "kood_tekst", "tyyp_tekst", "seisund", "kaos_kood_peamine",
                             "kaos_nimetus_peamine", "suletud_netopind", "ehitisalune_pind", "max_korruste_arv",
                             "korgus_m", "ads_lahiaadress", "taisaadress", "muutmisaeg"]

UA = {"User-Agent": "openmapstack-project-acquire/1.0"}


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def arcgis(service_layer: str, where: str, out_fields: str, name: str, precision: int = 7,
           base: str = TALLINN_GIS) -> dict:
    """Page an ArcGIS REST layer (EPSG:4326 GeoJSON pages) until returned == service count.

    Small layers are kept as GeoJSON; a *.parquet name stores the same features
    as GeoParquet (EPSG:4326), which keeps the 50 000-building layer small.
    """
    url = f"{base}/{service_layer}"
    meta = requests.get(url, params={"f": "json"}, headers=UA, timeout=60).json()
    oid = meta.get("objectIdField") or next(f["name"] for f in meta["fields"] if f["type"] == "esriFieldTypeOID")
    page_size = min(int(meta.get("maxRecordCount") or 1000), 2000)
    matched = requests.get(url + "/query", params={"where": where, "returnCountOnly": "true", "f": "json"},
                           headers=UA, timeout=120).json()["count"]
    features, pages, offset = [], 0, 0
    while True:
        params = {"where": where, "outFields": out_fields, "returnGeometry": "true", "outSR": 4326,
                  "geometryPrecision": precision, "orderByFields": oid, "resultOffset": offset,
                  "resultRecordCount": page_size, "f": "geojson"}
        page = requests.get(url + "/query", params=params, headers=UA, timeout=300).json()
        got = page.get("features", [])
        features += got
        pages += 1
        offset += len(got)
        if not got or offset >= matched:
            break
    if len(features) != matched:
        raise SystemExit(f"{name}: returned {len(features)} != matched {matched}")
    path = SOURCE / name
    if name.endswith(".parquet"):
        frame = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
        frame.to_parquet(path, index=False, compression="zstd")
    else:
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False))
    return {"file": name, "url": url, "where": where, "out_fields": out_fields, "out_sr": "EPSG:4326",
            "retrieved_at": now(), "matched": matched, "returned": len(features), "page_size": page_size,
            "pages": pages, "order_by": oid, "service_copyright": meta.get("copyrightText") or None,
            "size_bytes": path.stat().st_size, "sha256": sha256(path)}


def population_grid(name: str) -> dict:
    """Page the WFS (GML 3.2 is its only output format) and keep the raw members.

    The bbox is given in EPSG:3301 axis order (northing, easting), as the
    urn:ogc:def:crs form requires.
    """
    xmin, ymin, xmax, ymax = FRAME_3301
    bbox = f"{ymin},{xmin},{ymax},{xmax},urn:ogc:def:crs:EPSG::3301"
    base = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": POP_TYPENAME,
            "bbox": bbox, "sortBy": "gml_id"}
    members, pages, start, matched, head = [], 0, 0, None, None
    while True:
        text = requests.get(POP_WFS, params={**base, "count": 1000, "startIndex": start},
                            headers=UA, timeout=300).text
        if matched is None:
            matched = int(re.search(r'numberMatched="(\d+)"', text).group(1))
            head = text[: text.index("<wfs:member>")] if "<wfs:member>" in text else text
        got = re.findall(r"<wfs:member>.*?</wfs:member>", text, flags=re.S)
        members += got
        pages += 1
        start += len(got)
        if not got or start >= matched:
            break
    if len(members) != matched:
        raise SystemExit(f"population grid: returned {len(members)} != matched {matched}")
    updates = set(re.findall(r"Last update:(\d{4}-\d{2}-\d{2})", "".join(members)))
    periods = set(re.findall(r"periodofreference_xlink_title>([^<]+)<", "".join(members)))
    head = re.sub(r'\snext="[^"]*"', "", head)
    head = re.sub(r'numberReturned="\d+"', f'numberReturned="{len(members)}"', head)
    path = SOURCE / name
    path.write_text(head + "\n".join(members) + "\n</wfs:FeatureCollection>\n", encoding="utf-8")
    return {"file": name, "url": POP_WFS, "typename": POP_TYPENAME, "bbox": bbox, "retrieved_at": now(),
            "matched": matched, "returned": len(members), "page_size": 1000, "pages": pages,
            "dataset_last_update": sorted(updates)[-1] if updates else None, "reference_periods": sorted(periods),
            "size_bytes": path.stat().st_size, "sha256": sha256(path)}


def national_buildings(name: str) -> dict:
    """Buildings of the frame that lie outside Tallinn, from the national ETAK + Building Register file.

    The file is one GeoPackage for all of Estonia (EPSG:3301). It is downloaded to a temporary
    folder, read with the frame as bbox, and the buildings whose centroid lies in a Tallinn city
    district are dropped: inside the city the pipeline uses the city's own copy of the same layer.
    Geometry and attribute names are kept as published.
    """
    import tempfile
    import zipfile

    import pyogrio
    import shapely

    with tempfile.TemporaryDirectory() as folder:
        archive = Path(folder) / "etak_ehr_hooned_gpkg.zip"
        with requests.get(NATIONAL_BUILDINGS_URL, headers=UA, timeout=900, stream=True) as response:
            response.raise_for_status()
            with archive.open("wb") as handle:
                for chunk in response.iter_content(1 << 20):
                    handle.write(chunk)
            headers = response.headers
        with zipfile.ZipFile(archive) as zipped:
            member = next(m for m in zipped.namelist() if m.endswith(".gpkg"))
            zipped.extract(member, folder)
        package = Path(folder) / member
        info = pyogrio.read_info(package)
        frame = gpd.read_file(package, bbox=FRAME_3301, columns=NATIONAL_BUILDINGS_FIELDS)
        archive_size, archive_hash = archive.stat().st_size, sha256(archive)
    assert frame.crs.to_epsg() == 3301, frame.crs
    districts = gpd.read_file(SOURCE / "tallinn-districts.geojson").to_crs(frame.crs)
    city = shapely.union_all(shapely.make_valid(districts.geometry.values))
    shapely.prepare(city)
    in_city = shapely.within(frame.geometry.centroid.values, city)
    kept = frame[~in_city].sort_values("etak_id").reset_index(drop=True)
    assert kept["etak_id"].is_unique
    path = SOURCE / name
    kept[NATIONAL_BUILDINGS_FIELDS + ["geometry"]].to_parquet(path, index=False, compression="zstd")
    return {"file": name, "url": NATIONAL_BUILDINGS_URL, "layer": member, "retrieved_at": now(),
            "archive_last_modified": headers.get("last-modified"), "archive_etag": headers.get("etag"),
            "archive_size_bytes": archive_size, "archive_sha256": archive_hash,
            "features_in_national_file": int(info["features"]), "bbox_epsg3301": list(FRAME_3301),
            "in_frame": int(len(frame)), "dropped_centroid_in_tallinn": int(in_city.sum()),
            "matched": int((~in_city).sum()), "returned": int(len(kept)),
            "latest_change": str(kept["muutmisaeg"].max()), "out_sr": "EPSG:3301 (as published)",
            "size_bytes": path.stat().st_size, "sha256": sha256(path)}


def gtfs(name: str) -> dict:
    response = requests.get(GTFS_URL, headers=UA, timeout=300)
    response.raise_for_status()
    path = SOURCE / name
    path.write_bytes(response.content)
    return {"file": name, "url": GTFS_URL, "retrieved_at": now(), "returned": 1,
            "last_modified": response.headers.get("last-modified"), "etag": response.headers.get("etag"),
            "size_bytes": path.stat().st_size, "sha256": sha256(path)}


def overture(theme: str, feature_type: str, columns: list[str], name: str) -> dict:
    """Read one Overture feature type for the frame with bbox pushdown; write Parquet (WKB geometry)."""
    import pyarrow.compute as pc
    import pyarrow.dataset as ds
    import pyarrow.fs as fs
    import pyarrow.parquet as pq

    options = {"anonymous": True, "region": "us-west-2"}
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        parsed = urlparse(proxy)
        options["proxy_options"] = {"scheme": parsed.scheme, "host": parsed.hostname, "port": parsed.port}
    s3 = fs.S3FileSystem(**options)
    prefix = f"{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme={theme}/type={feature_type}/"
    dataset = ds.dataset(prefix, filesystem=s3, format="parquet")
    xmin, ymin, xmax, ymax = FRAME_4326
    # bbox OVERLAP (not containment): features crossing the frame edge are kept.
    overlap = ((pc.field("bbox", "xmin") <= xmax) & (pc.field("bbox", "xmax") >= xmin)
               & (pc.field("bbox", "ymin") <= ymax) & (pc.field("bbox", "ymax") >= ymin))
    table = dataset.to_table(columns=columns, filter=overlap).sort_by("id")
    path = SOURCE / name
    pq.write_table(table, path, compression="zstd")
    return {"file": name, "url": f"s3://{prefix}", "release": OVERTURE_RELEASE, "bbox_overlap_4326": list(FRAME_4326),
            "columns": columns, "retrieved_at": now(), "returned": table.num_rows,
            "size_bytes": path.stat().st_size, "sha256": sha256(path)}


SERVICE_LAYERS = {
    # key: (service/layer, name field, extra fields)
    "schools_municipal": ("veebikaart/Haridus_veebikaart/MapServer/0", "name,address"),
    "schools_private_state": ("veebikaart/Haridus_veebikaart/MapServer/2", "name,address"),
    "kindergartens": ("veebikaart/Haridus_veebikaart/MapServer/3", "name,address"),
    "universities": ("veebikaart/Haridus_veebikaart/MapServer/4", "name,address"),
    "vocational_schools": ("veebikaart/Haridus_veebikaart/MapServer/7", "nimi,aadress"),
    "libraries": ("veebikaart/Haridus_veebikaart/MapServer/6", "nimetus,aadress"),
    "hospitals": ("veebikaart/tervishoid_veebikaart/MapServer/0", "nimi,aadress,alias"),
    "pharmacies": ("veebikaart/tervishoid_veebikaart/MapServer/1", "nimi,aadress,tyypnimi"),
    "markets": ("veebikaart/kaubanduskeskused/MapServer/0", "name,address"),
    "shopping_centres": ("veebikaart/kaubanduskeskused/MapServer/1", "name,address"),
}


def main() -> None:
    """`python acquire.py` pulls everything; `python acquire.py KEY ...` re-pulls only the named
    sources and keeps the other entries of acquisition.json (their files are untouched)."""
    import sys
    SOURCE.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    log = {"acquired_at": now(), "frame_epsg3301": list(FRAME_3301), "sources": {}}
    if only:
        log = json.loads((SOURCE / "acquisition.json").read_text())
        log["frame_epsg3301"] = list(FRAME_3301)   # the frame the re-pulled sources were cut to

    s = log["sources"]

    def add(key, fn, *args, **kwargs):
        if not only or key in only:
            s[key] = fn(*args, **kwargs)

    _pull(add)

    (SOURCE / "acquisition.json").write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n")
    for key, entry in s.items():
        print(f"{key:24s} {entry['returned']:>7} rows  {entry['size_bytes'] / 1e6:6.2f} MB  {entry['file']}")


def _pull(add) -> None:

    # 1. Administrative division: 8 city districts and 84 sub-districts (asum) with register population.
    add("districts", arcgis, "Linnaosad_asumid/MapServer/1", "1=1", "objectid,nimi,akood_tekst", "tallinn-districts.geojson")
    add("subdistricts", arcgis, "Linnaosad_asumid/MapServer/0", "1=1",
                               "objectid,asumi_nimi,asumi_kood_tekst,linnaosa_nimi,sum_rahvaarv", "tallinn-subdistricts.geojson")

    # 2. Buildings: the city's join of ETAK footprints with the Building Register (EHR):
    #    status, main use (KAOS code) and closed net floor area. The pipeline decides what counts.
    add("buildings", arcgis, 
        "valised_andmekogud/ETAK_EHR_hooned/MapServer/0", "1=1",
        "objectid,etak_id,ehr_gid,kood_tekst,tyyp_tekst,ehr_seisund,kaos_peamine_kood,kaos_peamine_nimetus,"
        "suletud_netopind,ehitisalune_pind,max_korruste_arv,korgus_etak,ads_lahiaadress,muutmisaeg",
        "tallinn-buildings-etak-ehr.parquet", precision=6)

    # 3. Detailed plans in the Tallinn Planning Register (areas with procedural status).
    add("detailed_plans", arcgis, 
        "detailplaneeringud/Detailplaneeringute_alad_TPR/MapServer/0", "1=1",
        "objectid,id,regnr,nimetus,seisundi_kood,seisundi_nimi,seisundi_kp,men_nimetus,tyyp,link_sum_andmetele",
        "tallinn-detailed-plans.parquet", precision=6)

    # 4. Existing tram infrastructure and stops as the city maps them.
    add("tram_tracks", arcgis, "TAR_trammiteed/MapServer/0", "1=1", "objectid,tar_id,tyyp_id,tahtsus", "tallinn-tram-track-axes.geojson")

    # 5. Public services the city publishes on its web map.
    for key, (layer, fields) in SERVICE_LAYERS.items():
        add(f"svc_{key}", arcgis, layer, "1=1", "objectid," + fields, f"svc-{key.replace('_', '-')}.geojson")

    # 6. Population: Statistics Estonia 1 km grid, raw GML.
    add("population_grid", population_grid, "population-grid-1km.gml")

    # 7. Timetables: existing tram lines and stops, bus service levels.
    add("gtfs", gtfs, "tallinn-gtfs.zip")

    # 8. Overture Maps transportation segments: street names (alignments) and walking network (catchments).
    add("overture_segments", overture, 
        "transportation", "segment",
        ["id", "geometry", "subtype", "class", "subclass", "names", "connectors", "access_restrictions",
         "road_flags", "sources"],
        "overture-segments.parquet")


    # 9. Rail corridors as the city has drawn them from its planning documents:
    #    (a) corridors of the 2019 light-rail feasibility study with their stage (etapp 1-5),
    #    (b) corridors reserved in comprehensive plans, with the document and its status.
    add("study_corridors_2019", arcgis, "Kergrööbastranspordi analüüs 2019/FeatureServer/0", "1=1", "FID,etapp",
        "corridors-feasibility-study-2019.geojson", base=TALLINN_AGOL)
    add("plan_corridors", arcgis, "Rööbasühistranspordi_võrk/FeatureServer/1096", "1=1",
        "FID,perspektii,dokument,seisund,liik,olek,alaliik", "corridors-planning-documents.geojson", base=TALLINN_AGOL)

    # 10. Buildings outside Tallinn (Viimsi, Maardu, Jõelähtme, Rae, Harku, Saue ...): the national
    #     ETAK + Building Register file, cut to the frame. Needs the districts of step 1.
    add("buildings_surroundings", national_buildings, "surroundings-buildings-etak-ehr.parquet")


if __name__ == "__main__":
    main()

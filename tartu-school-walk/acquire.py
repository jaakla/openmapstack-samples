"""Acquire the immutable source snapshots for the Tartu school walking-coverage project.

This script is NOT part of the canonical run. It is the documented, repeatable
way the files under data/source/ were pulled; pipeline.py only ever reads those
files. Every request below is recorded in data/source/acquisition.json together
with the service-declared totals, so completeness is proven rather than assumed.

Run:  python acquire.py            (needs network access to the four hosts below)

Hosts:
  gis.tartulv.ee                         Tartu City Government ArcGIS REST
  inspire.geoportaal.ee                  Statistics Estonia 1 km population grid (INSPIRE PD WFS)
  overturemaps-us-west-2.s3.amazonaws.com  Overture Maps release (anonymous S3)
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source"

TARTU_GIS = "https://gis.tartulv.ee/arcgis/rest/services"
POP_WFS = "https://inspire.geoportaal.ee/geoserver/PD_rahvastikutihedus/wfs"
POP_TYPENAME = "PD_rahvastikutihedus:PD.StatisticalDistribution_"  # EPSG:3301 edition
OVERTURE_RELEASE = "2026-10-21.0"
OVERTURE_BUCKET = "overturemaps-us-west-2"

# Study frame. The municipal boundary extent is x 643847-663718, y 6468443-6482775
# (EPSG:3301). The frame adds >= 2 km on every side and is aligned to the 1 km
# population grid, so that (a) walking routes may leave and re-enter the city and
# (b) every grid cell that crosses the boundary is present in full.
FRAME_3301 = (641000, 6465000, 667000, 6486000)  # xmin, ymin, xmax, ymax (easting, northing)
# The same frame in WGS84 lon/lat, padded outward (used for Overture bbox pushdown).
FRAME_4326 = (26.40, 58.27, 26.90, 58.48)

PAGE = 1000
UA = {"User-Agent": "openmapstack-project-acquire/1.0"}


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def arcgis_geojson(service_layer: str, where: str, out_fields: str, name: str, precision: int = 7) -> dict:
    """Page an ArcGIS REST layer to GeoJSON (EPSG:4326) until returned == service count."""
    url = f"{TARTU_GIS}/{service_layer}/query"
    matched = requests.get(url, params={"where": where, "returnCountOnly": "true", "f": "json"},
                           headers=UA, timeout=60).json()["count"]
    features, pages, offset = [], 0, 0
    while True:
        params = {
            "where": where, "outFields": out_fields, "returnGeometry": "true", "outSR": 4326,
            "geometryPrecision": precision, "orderByFields": "OBJECTID", "resultOffset": offset,
            "resultRecordCount": PAGE, "f": "geojson",
        }
        page = requests.get(url, params=params, headers=UA, timeout=180).json()
        got = page.get("features", [])
        features += got
        pages += 1
        offset += len(got)
        if not got or offset >= matched:
            break
    if len(features) != matched:
        raise SystemExit(f"{name}: returned {len(features)} != matched {matched}")
    path = SOURCE / name
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False))
    return {
        "file": name, "url": f"{TARTU_GIS}/{service_layer}", "where": where, "out_fields": out_fields,
        "out_sr": "EPSG:4326", "retrieved_at": now(), "matched": matched, "returned": len(features),
        "page_size": PAGE, "pages": pages, "size_bytes": path.stat().st_size, "sha256": sha256(path),
    }


def population_grid(name: str) -> dict:
    """Page the WFS (GML 3.2 is its only output format) and keep the raw responses.

    The bbox is given in EPSG:3301 axis order (northing, easting), as the
    urn:ogc:def:crs form requires.
    """
    xmin, ymin, xmax, ymax = FRAME_3301
    bbox = f"{ymin},{xmin},{ymax},{xmax},urn:ogc:def:crs:EPSG::3301"
    base = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": POP_TYPENAME,
            "bbox": bbox, "sortBy": "gml_id"}
    members, pages, start, matched, last_update = [], 0, 0, None, None
    head = None
    while True:
        text = requests.get(POP_WFS, params={**base, "count": PAGE, "startIndex": start},
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
    last_update = sorted(updates)[-1] if updates else None
    # One well-formed document: the first response's root element + every member.
    head = re.sub(r'\snext="[^"]*"', "", head)
    head = re.sub(r'numberReturned="\d+"', f'numberReturned="{len(members)}"', head)
    path = SOURCE / name
    path.write_text(head + "\n".join(members) + "\n</wfs:FeatureCollection>\n", encoding="utf-8")
    return {
        "file": name, "url": POP_WFS, "typename": POP_TYPENAME, "bbox": bbox, "retrieved_at": now(),
        "matched": matched, "returned": len(members), "page_size": PAGE, "pages": pages,
        "dataset_last_update": last_update, "reference_periods": sorted(periods),
        "size_bytes": path.stat().st_size, "sha256": sha256(path),
    }


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
    for bundle in (os.environ.get("SSL_CERT_FILE"), os.environ.get("REQUESTS_CA_BUNDLE")):
        if bundle and Path(bundle).exists():
            options["tls_ca_file_path"] = bundle
            break
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
    return {
        "file": name, "url": f"s3://{prefix}", "release": OVERTURE_RELEASE, "bbox_overlap_4326": list(FRAME_4326),
        "columns": columns, "retrieved_at": now(), "returned": table.num_rows,
        "size_bytes": path.stat().st_size, "sha256": sha256(path),
    }


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    log = {"acquired_at": now(), "frame_epsg3301": list(FRAME_3301), "sources": {}}

    # 1. Schools: every record the city classes as "Kool" (Jaotus = 3). The pipeline,
    #    not this download, decides which school types count.
    log["sources"]["schools"] = arcgis_geojson(
        "Haridus/LU_haridus_avalik/MapServer/0", "Jaotus = 3",
        "OBJECTID,GlobalID,Nimi,Jaotus,Liik,Omand,Aadress,Koduleht,Kood,Lopetamise_kp",
        "tartu-schools.geojson")

    # 2. Administrative division: municipal boundary, city districts, settlements.
    for layer, field, name in ((0, "ONIMI", "tartu-boundary.geojson"),
                               (1, "NIMI", "tartu-districts.geojson"),
                               (2, "ANIMI", "tartu-settlements.geojson")):
        log["sources"][name.removesuffix(".geojson")] = arcgis_geojson(
            f"Aluskaardid/KT_haldusjaotus/MapServer/{layer}", "1=1", f"OBJECTID,{field}", name)

    # 3. Cadastral parcels whose intended land use includes residential land.
    log["sources"]["residential_parcels"] = arcgis_geojson(
        "Aluskaardid/KT_kataster/MapServer/0",
        "SIHT1 = 'ELAMUMAA' OR SIHT2 = 'ELAMUMAA' OR SIHT3 = 'ELAMUMAA'",
        "OBJECTID,TUNNUS,SIHT1,SIHT2,SIHT3,SO_PRTS1,SO_PRTS2,SO_PRTS3,MUUDET",
        "tartu-residential-parcels.geojson", precision=6)

    # 4. Population: Statistics Estonia 1 km grid, raw GML.
    log["sources"]["population_grid"] = population_grid("population-grid-1km.gml")

    # 5. Overture Maps: walkable network and building footprints.
    log["sources"]["overture_segments"] = overture(
        "transportation", "segment",
        ["id", "geometry", "subtype", "class", "subclass", "connectors", "access_restrictions", "sources"],
        "overture-segments.parquet")
    log["sources"]["overture_buildings"] = overture(
        "buildings", "building",
        ["id", "geometry", "subtype", "class", "height", "num_floors", "sources"],
        "overture-buildings.parquet")

    (SOURCE / "acquisition.json").write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n")
    for key, entry in log["sources"].items():
        print(f"{key:24s} {entry['returned']:>7} rows  {entry['size_bytes'] / 1e6:6.2f} MB  {entry['file']}")


if __name__ == "__main__":
    main()

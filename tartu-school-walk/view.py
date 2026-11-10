"""Views and bookkeeping for the Tartu school walking-coverage project.

Everything here is downstream of the analysis in pipeline.py: the QGIS
companion, the validation stage, the dashboard and the run record. Nothing in
this module measures geometry or decides a result; it reads project.yaml and the
frames the pipeline produced.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
import yaml

log = logging.getLogger("pipeline")

# Stable semantic roles -> concrete symbology, shared by the web map, its legend
# and the QGIS project (project-spec s.3). Colours follow the dataviz reference
# palette: one blue for "within the limit", a single-hue red ramp for "beyond".
STYLE = {
    "served": "#2a78d6",
    "over_0_5": "#f08f80",
    "over_5_15": "#dd5a52",
    "over_15": "#8e1f1f",
    "walkshed_fill": "#2a78d6",
    "walkshed_line": "#1c5cab",
    "unserved_line": "#8e1f1f",
    "unserved_fill": "#d03b3b",
    "school": "#0d366b",
    "school_other": "#8a8983",
    "school_excluded": "#eda100",
    "admin_line": "#52514e",
    "grid_line": "#6250d6",
}
CLASS_LABEL = {"served": "Within 15 min", "over_0_5": "15–20 min", "over_5_15": "20–30 min", "over_15": "Over 30 min"}
QGIS_BASEMAPS = [
    {"name": "Maa- ja Ruumiamet base map (WMS)", "checked": True, "srid": 3301,
     "uri": "contextualWMSLegend=0&crs=EPSG:3301&dpiMode=7&featureCount=10&format=image/png&layers=BAASKAART&styles=&url=https://kaart.maaamet.ee/wms/alus"},
    {"name": "OpenStreetMap (XYZ)", "checked": False, "srid": 3857,
     "uri": "type=xyz&url=https://tile.openstreetmap.org/{z}/{x}/{y}.png&zmax=19&zmin=0"},
]
QGIS_EXTENT = [641000, 6465000, 667000, 6486000]


def _rgba(hex_colour: str, alpha: int = 255) -> str:
    h = hex_colour.lstrip("#")
    return f"{int(h[0:2], 16)},{int(h[2:4], 16)},{int(h[4:6], 16)},{alpha}"


def stabilise_gpkg(path: Path) -> None:
    """GeoPackage stamps the write time into gpkg_contents; pin it so reruns hash alike."""
    with sqlite3.connect(path) as db:
        db.execute("UPDATE gpkg_contents SET last_change = '2026-01-01T00:00:00.000Z'")
        db.commit()
    with sqlite3.connect(path) as db:
        db.execute("VACUUM")


# ----------------------------------------------------------------------------
# QGIS project
# ----------------------------------------------------------------------------
def _fill(colour, alpha, outline, width="0.3", style="solid", fill_style="solid"):
    return {"kind": "fill", "alpha": 1, "props": {
        "color": _rgba(colour, alpha), "style": fill_style, "outline_color": _rgba(outline),
        "outline_width": width, "outline_style": style}}


def _marker(colour, outline, size="3.6", name="circle", width="0.5"):
    return {"kind": "marker", "alpha": 1, "props": {
        "name": name, "color": _rgba(colour), "outline_color": _rgba(outline), "outline_width": width, "size": size}}


def _qgis_renderers() -> dict:
    """One renderer per (manifest source, group)."""
    building_categories = [
        {"value": key, "label": CLASS_LABEL[key], "symbol": _fill(STYLE[key], 235, STYLE[key], "0.1")}
        for key in ("served", "over_0_5", "over_5_15", "over_15")]
    D = "data/derived/"
    return {
        ("admin_areas", "context"): {"file": D + "admin-areas.geojson", "srid": 4326, "name": "Districts and settlements", "geometry": "Polygon",
                                     "renderer": {"type": "single", "symbol": _fill("#ffffff", 0, STYLE["admin_line"], "0.3")}},
        ("population_grid_cells", "context"): {"file": D + "population-grid.geojson", "srid": 4326, "name": "Population grid 1 km (2024)", "geometry": "Polygon",
                                               "renderer": {"type": "single", "symbol": _fill("#ffffff", 0, STYLE["grid_line"], "0.2", "dot")}},
        ("walkshed_15min", "walkshed"): {"file": D + "walkshed-15min.geojson", "srid": 4326, "name": "15-minute walkshed (network reach)", "geometry": "Polygon",
                                         "renderer": {"type": "single", "symbol": _fill(STYLE["walkshed_fill"], 40, STYLE["walkshed_line"], "0.3")}},
        ("residential_buildings_gpkg", "buildings"): {"file": D + "residential-buildings.gpkg", "srid": 3301, "layername": "residential_buildings",
                                                      "name": "Homes by walking time to school", "geometry": "Polygon",
                                                      "renderer": {"type": "categorized", "attr": "coverage_class", "categories": building_categories}},
        ("unserved_areas", "unserved"): {"file": D + "unserved-areas.geojson", "srid": 4326, "name": "Unserved areas (beyond 15 min)", "geometry": "Polygon",
                                         "renderer": {"type": "single", "symbol": _fill(STYLE["unserved_fill"], 26, STYLE["unserved_line"], "0.5", "dash")}},
        ("schools", "schools"): {"file": D + "schools.geojson", "srid": 4326, "name": "Schools", "geometry": "Point", "subset": "\"status\" = 'active'",
                                 "renderer": {"type": "categorized", "attr": "map_class", "categories": [
                                     {"value": "counted", "label": "Basic school (counted)", "symbol": _marker(STYLE["school"], "#ffffff")},
                                     {"value": "other_school", "label": "Other school (not counted)", "symbol": _marker("#ffffff", STYLE["school_other"], "2.8")}]}},
        ("schools", "overrides"): {"file": D + "schools.geojson", "srid": 4326, "name": "Excluded by override", "geometry": "Point",
                                   "subset": "\"status\" = 'excluded_by_override'",
                                   "renderer": {"type": "single", "symbol": _marker(STYLE["school_excluded"], "#0b0b0b", "3.6", "cross_fill")}},
    }


def _qgis_spec(project: dict, root: Path) -> dict:
    presentation = project["presentation"]["map"]
    renderers = _qgis_renderers()
    groups = {g["id"]: {"id": g["id"], "title": g["title"], "expanded": g.get("default_open", True), "layers": []}
              for g in presentation["layer_groups"]}
    order = []
    # Manifest layers are bottom-to-top; a QGIS tree paints its first entry on
    # top, so walk the manifest in reverse (project-spec s.5.3).
    for index, layer in enumerate(reversed(presentation["layers"])):
        spec = dict(renderers[(layer["source"], layer["group"])])
        spec.update(id=f"{layer['source']}_{layer['group']}", visible=layer.get("default_visible", True))
        groups[layer["group"]]["layers"].append(spec)
        if layer["group"] not in order:
            order.append(layer["group"])
    return {"root": str(root), "output": "project.qgz", "title": project["project"]["title"], "crs": "EPSG:3301",
            "extent": QGIS_EXTENT, "groups": [groups[g] for g in order], "basemaps": QGIS_BASEMAPS}


def _find_qgis_python() -> str | None:
    candidates = [os.environ.get("OMS_QGIS_PYTHON"), "/usr/bin/python3.12", "/usr/bin/python3", shutil.which("python3")]
    for candidate in dict.fromkeys(c for c in candidates if c):
        try:
            done = subprocess.run([candidate, "-c", "import qgis.core"], capture_output=True, timeout=60,
                                  env={**os.environ, "QT_QPA_PLATFORM": "offscreen"})
        except (OSError, subprocess.SubprocessError):
            continue
        if done.returncode == 0:
            return candidate
    return None


# --- standalone XML builder: the fallback when no QGIS is installed -----------
# Full CRS definitions: a <spatialrefsys> with only srid/authid reads back as an
# INVALID CRS and the layer silently paints nothing (project-spec s.5.2 rule 4).
CRS_DEFINITIONS = {
    3301: {
        "wkt": 'PROJCS["Estonian Coordinate System of 1997",GEOGCS["EST97",DATUM["Estonia_1997",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6180"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4180"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["latitude_of_origin",57.5175539305556],PARAMETER["central_meridian",24],PARAMETER["standard_parallel_1",59.3333333333333],PARAMETER["standard_parallel_2",58],PARAMETER["false_easting",500000],PARAMETER["false_northing",6375000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","3301"]]',
        "proj4": "+proj=lcc +lat_0=57.5175539305556 +lon_0=24 +lat_1=59.3333333333333 +lat_2=58 +x_0=500000 +y_0=6375000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
        "srsid": 1259, "description": "Estonian Coordinate System of 1997", "projectionacronym": "lcc",
        "ellipsoidacronym": "EPSG:7019", "geographic": False,
    },
    4326: {
        "wkt": 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]',
        "proj4": "+proj=longlat +datum=WGS84 +no_defs", "srsid": 3452, "description": "WGS 84",
        "projectionacronym": "longlat", "ellipsoidacronym": "EPSG:7030", "geographic": True,
    },
    3857: {
        "wkt": 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]',
        "proj4": "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs",
        "srsid": 3857, "description": "WGS 84 / Pseudo-Mercator", "projectionacronym": "merc",
        "ellipsoidacronym": "EPSG:7030", "geographic": False,
    },
}


def _x(value) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _srs_xml(srid: int, indent: str) -> str:
    crs = CRS_DEFINITIONS[srid]
    fields = [("wkt", crs["wkt"]), ("proj4", crs["proj4"]), ("srsid", crs["srsid"]), ("srid", srid),
              ("authid", f"EPSG:{srid}"), ("description", crs["description"]),
              ("projectionacronym", crs["projectionacronym"]), ("ellipsoidacronym", crs["ellipsoidacronym"]),
              ("geographicflag", "true" if crs["geographic"] else "false")]
    body = "".join(f"\n{indent}  <{tag}>{_x(value)}</{tag}>" for tag, value in fields)
    return f'{indent}<spatialrefsys nativeFormat="Wkt">{body}\n{indent}</spatialrefsys>'


def _symbol_xml(index: int, symbol: dict) -> str:
    cls = {"fill": "SimpleFill", "line": "SimpleLine", "marker": "SimpleMarker"}[symbol["kind"]]
    props = "".join(f'<prop k="{_x(k)}" v="{_x(v)}"/>' for k, v in symbol["props"].items())
    return f'<symbol type="{symbol["kind"]}" name="{index}" alpha="{symbol["alpha"]}"><layer class="{cls}" enabled="1">{props}</layer></symbol>'


def _renderer_xml(renderer: dict) -> str:
    if renderer["type"] == "single":
        return f'<renderer-v2 type="singleSymbol" enableorderby="0"><symbols>{_symbol_xml(0, renderer["symbol"])}</symbols></renderer-v2>'
    cats = "".join(f'<category value="{_x(c["value"])}" symbol="{i}" label="{_x(c["label"])}" render="true"/>'
                   for i, c in enumerate(renderer["categories"]))
    syms = "".join(_symbol_xml(i, c["symbol"]) for i, c in enumerate(renderer["categories"]))
    return (f'<renderer-v2 type="categorizedSymbol" attr="{_x(renderer["attr"])}" enableorderby="0">'
            f"<categories>{cats}</categories><symbols>{syms}</symbols></renderer-v2>")


def _qgs_document(spec: dict) -> str:
    tree, layers = "", ""
    for group in spec["groups"]:
        nodes = "".join(
            f'      <layer-tree-layer id="{l["id"]}" name="{_x(l["name"])}" providerKey="ogr" expanded="1" '
            f'checked="{"Qt::Checked" if l["visible"] else "Qt::Unchecked"}"/>\n' for l in group["layers"])
        tree += (f'    <layer-tree-group name="{_x(group["title"])}" expanded="{1 if group["expanded"] else 0}" '
                 f'checked="Qt::Checked">\n{nodes}    </layer-tree-group>\n')
        for l in group["layers"]:
            source = f'./{l["file"]}' + (f'|layername={l["layername"]}' if l.get("layername") else "") + (f'|subset={l["subset"]}' if l.get("subset") else "")
            layers += (f'    <maplayer type="vector" geometry="{l["geometry"]}" hasScaleBasedVisibilityFlag="0" '
                       f'styleCategories="AllStyleCategories">\n      <id>{l["id"]}</id>\n'
                       f"      <datasource>{_x(source)}</datasource>\n      <layername>{_x(l['name'])}</layername>\n"
                       f"      <srs>\n{_srs_xml(l['srid'], '        ')}\n      </srs>\n"
                       f'      <provider encoding="UTF-8">ogr</provider>\n      {_renderer_xml(l["renderer"])}\n    </maplayer>\n')
    base_nodes = ""
    for index, base in enumerate(spec["basemaps"]):
        base_nodes += (f'      <layer-tree-layer id="basemap_{index}" name="{_x(base["name"])}" providerKey="wms" expanded="0" '
                       f'checked="{"Qt::Checked" if base["checked"] else "Qt::Unchecked"}"/>\n')
        layers += (f'    <maplayer type="raster" hasScaleBasedVisibilityFlag="0" styleCategories="AllStyleCategories">\n'
                   f"      <id>basemap_{index}</id>\n      <datasource>{_x(base['uri'])}</datasource>\n"
                   f"      <layername>{_x(base['name'])}</layername>\n      <srs>\n{_srs_xml(base['srid'], '        ')}\n      </srs>\n"
                   f'      <provider>wms</provider>\n      <pipe><provider><resampling enabled="false"/></provider>'
                   f'<rasterrenderer type="singlebandcolordata" opacity="1"/></pipe>\n    </maplayer>\n')
    tree += f'    <layer-tree-group name="Basemaps" expanded="1" checked="Qt::Checked">\n{base_nodes}    </layer-tree-group>\n'
    crs = _srs_xml(3301, "    ")
    xmin, ymin, xmax, ymax = spec["extent"]
    return f"""<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="{_x(spec['title'])}" version="3.34.4">
  <homePath path=""/>
  <title>{_x(spec['title'])}</title>
  <projectCrs>
{crs}
  </projectCrs>
  <layer-tree-group>
    <customproperties/>
{tree}  </layer-tree-group>
  <mapcanvas>
    <units>meters</units>
    <extent><xmin>{xmin}</xmin><ymin>{ymin}</ymin><xmax>{xmax}</xmax><ymax>{ymax}</ymax></extent>
    <rotation>0</rotation>
    <destinationsrs>
{crs}
    </destinationsrs>
  </mapcanvas>
  <projectlayers>
{layers}  </projectlayers>
  <properties>
    <Measurement><AreaUnits type="QString">m2</AreaUnits><DistanceUnits type="QString">meters</DistanceUnits></Measurement>
    <Paths><Absolute type="bool">false</Absolute></Paths>
    <SpatialRefSys><ProjectionsEnabled type="int">1</ProjectionsEnabled></SpatialRefSys>
  </properties>
</qgis>
"""


def write_qgis_project(project: dict, root: Path, facts: dict) -> dict:
    """Write project.qgz. PyQGIS builds and verifies it when a QGIS install is
    found; otherwise the standalone XML builder writes the same layer tree and
    the runtime check is reported not_testable (never an implicit pass)."""
    spec = _qgis_spec(project, root)
    target = root / "project.qgz"
    target.unlink(missing_ok=True)
    interpreter = _find_qgis_python()
    if interpreter:
        with tempfile.TemporaryDirectory() as tmp:
            spec_path, result_path = Path(tmp) / "spec.json", Path(tmp) / "result.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            done = subprocess.run([interpreter, str(root / "qgis_build.py"), str(spec_path), str(result_path)],
                                  capture_output=True, text=True, timeout=900,
                                  env={**os.environ, "QT_QPA_PLATFORM": "offscreen"})
            if done.returncode == 0 and result_path.exists() and target.exists():
                result = json.loads(result_path.read_text(encoding="utf-8"))
                result["spec"] = spec
                log.info("QGIS project written and verified by PyQGIS %s", result.get("qgis_version"))
                return result
            log.warning("PyQGIS build failed (%s); using the XML builder", (done.stderr or "").strip()[-400:])
    info = zipfile.ZipInfo("project.qgs", date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(info, _qgs_document(spec).encode("utf-8"))
    log.info("QGIS project written by the standalone XML builder (no QGIS install found)")
    return {"mode": "xml", "spec": spec}


def _qgis_static_check(project: dict, root: Path) -> dict:
    """Read project.qgz back as XML and hold it to the manifest."""
    problems = []
    try:
        with zipfile.ZipFile(root / "project.qgz") as archive:
            name = next(n for n in archive.namelist() if n.endswith(".qgs"))
            document = archive.read(name).decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        return {"id": "qgis_project_static_valid", "status": "failed", "reason": f"unreadable project.qgz: {exc}"}
    import xml.etree.ElementTree as ET
    tree = ET.fromstring(document.split("\n", 1)[1] if document.startswith("<!DOCTYPE") else document)
    layers = tree.findall("./projectlayers/maplayer")
    declared_paths = {"./" + out["path"] for out in project["outputs"].values()}
    vector = 0
    for layer in layers:
        source = layer.findtext("datasource") or ""
        srs = layer.find("./srs/spatialrefsys")
        label = layer.findtext("layername")
        if srs is None or not ((srs.findtext("wkt") or "").strip() or (srs.findtext("proj4") or "").strip()):
            problems.append(f"{label}: incomplete or missing <srs>")
        if layer.get("type") == "vector":
            vector += 1
            path = source.split("|")[0]
            if path.endswith(".gpkg") and "layername=" not in source:
                problems.append(f"{label}: GeoPackage datasource lacks layername=")
            if not path.startswith("./") or not (root / path).exists():
                problems.append(f"{label}: datasource does not resolve relative to the project ({path})")
            elif path not in declared_paths:
                problems.append(f"{label}: datasource {path} is not a declared output")
            else:
                # The declared CRS must be the data's: GeoJSON is EPSG:4326 (RFC 7946), the GeoPackage EPSG:3301.
                actual = pyogrio.read_info(root / path)["crs"]
                if srs is not None and (srs.findtext("authid") or "") != actual:
                    problems.append(f"{label}: declared CRS {srs.findtext('authid')} differs from the data CRS {actual}")
    if tree.findtext("./properties/SpatialRefSys/ProjectionsEnabled") != "1":
        problems.append("ProjectionsEnabled is not set")
    def norm(value):
        return "".join(ch for ch in str(value).lower() if ch.isalnum())
    tree_groups = {norm(g.get("name")) for g in tree.iter("layer-tree-group") if g.get("name")}
    for group in project["presentation"]["map"]["layer_groups"]:
        if norm(group["id"]) not in tree_groups and norm(group["title"]) not in tree_groups:
            problems.append(f"layer group {group['id']} missing from the QGIS layer tree")
    declared = [l for l in project["presentation"]["map"]["layers"] if not l.get("persistence")]
    if vector != len(declared):
        problems.append(f"{vector} vector layers in QGIS, {len(declared)} declared in the manifest")
    if not any(layer.get("type") == "raster" for layer in layers):
        problems.append("no basemap layer")
    return {"id": "qgis_project_static_valid", "status": "failed" if problems else "passed",
            "layers_checked": len(layers), "vector_layers": vector, "problems": problems}


def _qgis_runtime_check(qgis: dict) -> dict:
    if qgis.get("mode") != "pyqgis":
        return {"id": "qgis_runtime_load", "status": "not_testable",
                "reason": "No QGIS install found; project.qgz was written by the standalone XML builder and not opened in QGIS."}
    problems = []
    if not (qgis.get("written") and qgis.get("reopened")):
        problems.append("QgsProject.write/read did not succeed")
    if not qgis.get("project_crs_valid") or qgis.get("project_crs") != "EPSG:3301":
        problems.append(f"project CRS {qgis.get('project_crs')} invalid or unexpected")
    for layer in qgis.get("layers", []):
        if not (layer.get("found") and layer.get("valid") and layer.get("crs_valid") and layer.get("spatial")):
            problems.append(f"{layer['name']}: not a valid spatial layer after reopening")
        elif layer.get("features", 0) <= 0:
            problems.append(f"{layer['name']}: no features")
        elif layer.get("painted_pixels", 0) <= 0:
            problems.append(f"{layer['name']}: paints nothing")
    unreachable = [b["name"] for b in qgis.get("basemaps", []) if not b.get("valid")]
    blank = [b["name"] for b in qgis.get("basemaps", []) if b.get("valid") and b.get("checked") and not b.get("painted_pixels")]
    check = {"id": "qgis_runtime_load", "qgis_version": qgis.get("qgis_version"),
             "layers": [{k: l.get(k) for k in ("name", "valid", "crs", "features", "painted_pixels")} for l in qgis.get("layers", [])],
             "basemaps": qgis.get("basemaps", []), "problems": problems}
    if problems:
        check["status"] = "failed"
    elif unreachable:
        check["status"] = "warning"
        check["reason"] = "Basemap service(s) did not answer from this environment: " + ", ".join(unreachable)
    elif blank:
        check["status"] = "warning"
        check["reason"] = ("Basemap layer is valid (service capabilities read) but drew no pixels in the headless render: "
                           + ", ".join(blank) + ". Confirm the background in QGIS desktop.")
    else:
        check["status"] = "passed"
    return check


# ----------------------------------------------------------------------------
# Validation stage
# ----------------------------------------------------------------------------
def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _graph_check(project: dict) -> dict:
    known = set(project["sources"])
    dangling = []
    step_ids = set()
    for step in project["processing"]["steps"]:
        wanted = [step.get("source"), step.get("input"), *(step.get("inputs") or [])]
        dangling += [f"{step['id']} <- {symbol}" for symbol in wanted if symbol and symbol not in known]
        for produced in str(step.get("output", "")).split(","):
            if produced.strip():
                known.add(produced.strip())
        step_ids.add(step["id"])
    orphans = [f"{key} generated_by {out.get('generated_by')}" for key, out in project["outputs"].items()
               if out.get("generated_by") not in step_ids]
    override_ids = {o["id"] for o in project.get("overrides") or []}
    for step in project["processing"]["steps"]:
        dangling += [f"{step['id']} <- {o}" for o in step.get("overrides") or [] if o not in override_ids]
    problems = dangling + orphans
    return {"id": "manifest_graph_resolves", "status": "failed" if problems else "passed",
            "steps": len(step_ids), "problems": problems}


def validate(project: dict, facts: dict, frames: dict, root: Path, run_id: str) -> dict:
    import pipeline as p
    checks: list[dict] = []
    measured, schools, matrix, summary = frames["measured"], frames["schools"], frames["matrix"], frames["summary"]
    source_dir = root / "data" / "source"

    geodata = {
        "residential_buildings": frames["result"], "schools": frames["schools_out"], "walkshed_variants": frames["sheds"],
        "unserved_area_variants": frames["pockets"], "admin_areas": frames["areas_out"], "population_grid_cells": frames["grid_out"],
    }
    invalid = {name: int((~frame.geometry.is_valid).sum() + frame.geometry.is_empty.sum()) for name, frame in geodata.items()}
    checks.append({"id": "geometry_valid", "status": "passed" if not any(invalid.values()) else "failed",
                   "features_checked": int(sum(len(f) for f in geodata.values())), "invalid_or_empty": invalid})

    crs_seen = {}
    parquet = gpd.read_parquet(root / "data/derived/residential-buildings.parquet")
    crs_seen["residential-buildings.parquet"] = parquet.crs.to_string() if parquet.crs else None
    crs_seen["residential-buildings.gpkg"] = pyogrio.read_info(root / "data/derived/residential-buildings.gpkg")["crs"]
    geojson_crs = {name: pyogrio.read_info(root / "data/derived" / name)["crs"] for name in (
        "schools.geojson", "walkshed-15min.geojson", "walkshed-variants.geojson", "unserved-areas.geojson",
        "unserved-area-variants.geojson", "admin-areas.geojson", "population-grid.geojson")}
    # Coordinates, not just labels: a known school must land where it stands. Hugo Treffneri
    # Gümnaasium (Munga 12) is in the old town, within 400 m of Tartu Town Hall (58.3801 N, 26.7222 E).
    probe = frames["schools_out"]
    probe = probe[probe["name"] == "Hugo Treffneri Gümnaasium"].geometry.iloc[0]
    hall = gpd.GeoSeries([shapely.Point(26.7222, 58.3801)], crs=4326).to_crs(3301).iloc[0]
    offset_m = float(probe.distance(hall))
    located = offset_m < 400
    lonlat = gpd.GeoSeries([probe], crs=3301).to_crs(4326).iloc[0]
    bounds = measured.total_bounds
    in_frame = 640000 < bounds[0] < bounds[2] < 668000 and 6464000 < bounds[1] < bounds[3] < 6487000
    ok = (all(v == "EPSG:3301" for v in crs_seen.values()) and all(v == "EPSG:4326" for v in geojson_crs.values())
          and located and in_frame)
    crs_seen.update(geojson_crs)
    checks.append({"id": "crs_known", "status": "passed" if ok else "failed", "analysis_crs": "EPSG:3301",
                   "storage_crs": "EPSG:4326 (GeoJSON, RFC 7946)", "files": crs_seen,
                   "known_location": {"feature": "Hugo Treffneri Gümnaasium", "lon": round(lonlat.x, 5),
                                      "lat": round(lonlat.y, 5), "metres_from_tartu_town_hall": round(offset_m),
                                      "matches_reference": bool(located)},
                   "buildings_within_study_frame": bool(in_frame)})

    counts = {name: int(len(frame)) for name, frame in geodata.items()}
    counts.update(walkshed_15min=int((frames["sheds"]["variant"] == p.CANONICAL_VARIANT).sum()),
                  unserved_areas=int((frames["pockets"]["variant"] == p.CANONICAL_VARIANT).sum()),
                  area_summary=int(len(summary)), coverage_matrix=int(len(matrix)))
    checks.append({"id": "row_count_gt_zero", "status": "passed" if all(v > 0 for v in counts.values()) else "failed", "rows": counts})
    checks.append({"id": "no_duplicate_building_id", "status": "passed" if measured["id"].is_unique else "failed",
                   "duplicates": int(measured["id"].duplicated().sum())})
    checks.append({"id": "no_null_building_id", "status": "passed" if measured["id"].notna().all() else "failed",
                   "nulls": int(measured["id"].isna().sum())})

    # Semantic predicates: every coded value the selection depends on is inside its documented domain.
    raw_schools = gpd.read_file(source_dir / "tartu-schools.geojson")
    parcels = gpd.read_file(source_dir / "tartu-residential-parcels.geojson", ignore_geometry=True)
    liik_ok = set(raw_schools["Liik"].dropna().astype(int)) <= set(p.LIIK_LABEL) and raw_schools["Liik"].notna().all()
    jaotus_ok = (raw_schools["Jaotus"] == 3).all()
    parcels_ok = bool(((parcels[["SIHT1", "SIHT2", "SIHT3"]] == "ELAMUMAA").any(axis=1)).all())
    checks.append({"id": "source_semantics_verified",
                   "status": "passed" if liik_ok and jaotus_ok and parcels_ok else "failed",
                   "school_type_codes_seen": sorted(int(v) for v in raw_schools["Liik"].dropna().unique()),
                   "schools_with_closing_date": int(raw_schools["Lopetamise_kp"].notna().sum()),
                   "schools_without_type": int(raw_schools["Liik"].isna().sum()),
                   "parcels_all_residential_use": parcels_ok,
                   "buildings_unknown_class_kept_unknown": "unclassed footprints count only with parcel evidence inside Tartu"})

    acquisition = json.loads((source_dir / "acquisition.json").read_text(encoding="utf-8"))["sources"]
    incomplete, drift = [], []
    for key, entry in acquisition.items():
        if "matched" in entry and entry["matched"] != entry["returned"]:
            incomplete.append(key)
        if _sha256(source_dir / entry["file"]) != entry["sha256"]:
            drift.append(entry["file"])
    for key, source in project["sources"].items():
        pin = source.get("pin") or {}
        if pin.get("class") == "local_snapshot" and _sha256(root / pin["path"]) != pin["sha256"]:
            drift.append(f"{pin['path']} (manifest pin)")
    checks.append({"id": "source_result_complete", "status": "failed" if incomplete or drift else "passed",
                   "sources": {k: {"matched": e.get("matched"), "returned": e["returned"]} for k, e in acquisition.items()},
                   "incomplete": incomplete, "hash_mismatch": drift})

    unresolved = [key for key, source in project["sources"].items()
                  if any(marker in source["license"]["name"].lower() for marker in ("not stated", "unknown", "unresolved"))]
    checks.append({"id": "source_licenses_resolved", "status": "warning" if unresolved else "passed",
                   "unresolved": unresolved,
                   **({"reason": "The Tartu city ArcGIS services publish no licence text for: " + ", ".join(unresolved)
                       + ". Reuse terms must be confirmed with the city before redistribution."} if unresolved else {})})

    results = facts["overrides"]
    declared = {o["id"] for o in project.get("overrides") or []}
    applied = {r["id"] for r in results if r["status"] == "applied"}
    checks.append({"id": "overrides_applied", "status": "passed" if declared == applied else "failed", "results": results})
    checks.append(_graph_check(project))

    controls = project["presentation"]["controls"]
    params = project["processing"]["parameters"]
    limit = next(f for f in controls["filters"] if f["id"] == "walk_minutes")
    sets = next(v for v in controls["views"] if v["id"] == "school_set")
    mismatches = []
    def expect(label, declared_value, actual):
        if declared_value != actual:
            mismatches.append(f"{label}: manifest {declared_value!r} != pipeline {actual!r}")
    expect("controls.walk_minutes.canonical", limit["canonical"], p.CANONICAL_MINUTES)
    expect("controls.walk_minutes.options", limit["options"], p.MINUTES)
    expect("controls.school_set.canonical", sets["canonical"], p.CANONICAL_SET)
    expect("controls.school_set.options", sets["options"], p.SCHOOL_SETS)
    expect("parameters.walk_speed_kmh", params["walk_speed_kmh"], p.WALK_SPEED_KMH)
    expect("parameters.walk_minutes", params["walk_minutes"], p.MINUTES)
    expect("parameters.canonical_walk_minutes", params["canonical_walk_minutes"], p.CANONICAL_MINUTES)
    expect("parameters.canonical_school_set", params["canonical_school_set"], p.CANONICAL_SET)
    expect("parameters.school_sets", {k: sorted(v["liik"]) for k, v in params["school_sets"].items()},
           {k: sorted(v) for k, v in p.SET_LIIK.items()})
    expect("parameters.network_step_m", params["network_step_m"], p.NETWORK_STEP_M)
    expect("parameters.off_path_allowance_m", params["off_path_allowance_m"], p.OFF_PATH_M)
    expect("parameters.walkshed_cell_m", params["walkshed_cell_m"], p.SHED_CELL_M)
    expect("parameters.min_footprint_m2", params["min_footprint_m2"], p.MIN_FOOTPRINT_M2)
    expect("parameters.floor_height_m", params["floor_height_m"], p.FLOOR_HEIGHT_M)
    expect("parameters.unserved_buffer_m", params["unserved_buffer_m"], p.UNSERVED_BUFFER_M)
    expect("parameters.unserved_min_pop", params["unserved_min_pop"], p.UNSERVED_MIN_POP)
    variants = set(frames["sheds"]["variant"])
    wanted = {p.variant_key(s, m) for s in p.SCHOOL_SETS for m in p.MINUTES}
    if variants != wanted:
        mismatches.append("walkshed variants do not cover every offered control position")
    columns = {c["name"] for c in project["outputs"]["coverage_matrix"]["table"]["columns"]}
    for option, fields in sets["fields"].items():
        mismatches += [f"view field {f} not a column of coverage_matrix" for f in fields if f not in columns]
    checks.append({"id": "view_controls_match_pipeline", "status": "failed" if mismatches else "passed",
                   "canonical": {"walk_minutes": p.CANONICAL_MINUTES, "school_set": p.CANONICAL_SET},
                   "variants_materialised": len(variants), "problems": mismatches})

    checks.append(_qgis_static_check(project, root))
    checks.append(_qgis_runtime_check(facts["qgis"]))

    # ---- domain checks ----
    pop = facts["population"]
    checks.append({"id": "population_conserved",
                   "status": "passed" if pop["unallocated_cells_touching_tartu"] == 0 else "warning",
                   "grid_population_in_frame": pop["grid_population_in_frame"], "allocated_in_frame": pop["allocated_in_frame"],
                   "unallocated_in_frame": pop["unallocated_in_frame"],
                   "unallocated_cells_touching_tartu": pop["unallocated_cells_touching_tartu"],
                   "note": "Unallocated residents in the frame are in cells outside Tartu with no building footprint."})
    total = pop["tartu_population_est"]
    checks.append({"id": "tartu_population_plausible", "status": "passed" if 90000 <= total <= 108000 else "failed",
                   "tartu_population_est": total, "expected_band": [90000, 108000],
                   "note": "Plausibility band around the roughly 98-100 thousand residents Statistics Estonia reports for Tartu city; not an attested expectation."})
    used = schools[schools[[f"in_{s}" for s in p.SCHOOL_SETS]].any(axis=1)]
    checks.append({"id": "school_snap_distance", "status": "passed" if used["network_gap_m"].max() <= 150 else "failed",
                   "max_gap_m": float(used["network_gap_m"].max()), "schools_checked": int(len(used))})
    share = facts["network"]["main_component_length_share"]
    checks.append({"id": "network_connected", "status": "passed" if share >= 0.95 else "failed",
                   "main_component_length_share": share, **{k: v for k, v in facts["network"].items() if k != "main_component_length_share"}})
    walk = measured[[f"walk_m_{s}" for s in p.SCHOOL_SETS]].to_numpy()
    finite = bool(np.isfinite(walk).all() and (walk >= 0).all())
    checks.append({"id": "walk_distance_finite", "status": "passed" if finite else "failed",
                   "buildings": int(len(measured)), "max_walk_min": round(float(walk[:, 0].max()) / p.METRES_PER_MINUTE, 1)})
    served = matrix.pivot(index="school_set", columns="walk_minutes", values="pop_served")
    by_minutes = bool((served.diff(axis=1).iloc[:, 1:] >= 0).all().all())
    by_set = bool((served.loc["all_schools"] >= served.loc["basic_all"]).all() and (served.loc["basic_all"] >= served.loc["municipal_basic"]).all())
    checks.append({"id": "coverage_monotonic", "status": "passed" if by_minutes and by_set else "failed",
                   "monotonic_in_minutes": by_minutes, "monotonic_in_school_set": by_set})
    canonical = matrix[matrix["canonical"]].iloc[0]
    limit_m = p.CANONICAL_MINUTES * p.METRES_PER_MINUTE
    direct = float(measured.loc[measured[f"walk_m_{p.CANONICAL_SET}"] > limit_m, "pop_est"].sum())
    consistent = (abs(int(summary["population"].sum()) - int(canonical["population"])) <= len(summary)
                  and abs(int(summary["pop_unserved_15min"].sum()) - int(canonical["pop_unserved"])) <= len(summary)
                  and abs(direct - float(canonical["pop_unserved"])) <= 1)
    checks.append({"id": "table_totals_consistent", "status": "passed" if consistent else "failed",
                   "area_summary_population": int(summary["population"].sum()), "matrix_population": int(canonical["population"]),
                   "area_summary_unserved": int(summary["pop_unserved_15min"].sum()), "matrix_unserved": int(canonical["pop_unserved"]),
                   "note": "Area rows are rounded individually, so sums may differ from the city total by rounding only."})

    # Parity: every declared check appears exactly once, verbatim.
    declared_checks = list(project["validation"]["required"]) + [d["name"] for d in project["validation"]["domain_checks"]]
    seen = [c["id"] for c in checks] + ["manifest_report_parity"]
    missing = [name for name in declared_checks if seen.count(name) != 1]
    extra = [name for name in seen if name not in declared_checks]
    checks.append({"id": "manifest_report_parity", "status": "failed" if missing or extra else "passed",
                   "declared": len(declared_checks), "reported": len(seen), "missing_or_repeated": missing, "undeclared": extra})

    statuses = {c["status"] for c in checks}
    status = "failed" if "failed" in statuses else "warning" if statuses & {"warning", "not_testable"} else "passed"
    return {"run_id": run_id, "status": status, "checks": checks,
            "headline": {"population": int(canonical["population"]), "pop_unserved": int(canonical["pop_unserved"]),
                         "pct_unserved": float(canonical["pct_unserved"]), "schools": int(canonical["schools"]),
                         "school_set": p.CANONICAL_SET, "walk_minutes": p.CANONICAL_MINUTES}}


# ----------------------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------------------
def _geojson(frame: gpd.GeoDataFrame, decimals: int = 5, simplify_m: float | None = None) -> dict:
    out = frame.copy()
    if simplify_m:
        out["geometry"] = shapely.make_valid(shapely.simplify(out.geometry.values, simplify_m))
    out = out.to_crs(4326)
    out["geometry"] = shapely.set_precision(out.geometry.values, 10 ** -decimals)
    out = out[~out.geometry.is_empty]
    return json.loads(out.to_json(drop_id=True))


def _records(table: pd.DataFrame) -> list[dict]:
    return json.loads(table.to_json(orient="records"))


def render_dashboard(project: dict, facts: dict, frames: dict, report: dict, root: Path,
                     started: datetime.datetime, completed: datetime.datetime) -> None:
    import pipeline as p
    measured, schools = frames["measured"], frames["schools_out"]
    school_names = list(frames["schools"]["name"])
    area_names = sorted(measured["area_name"].unique())
    name_index = {n: i for i, n in enumerate(school_names)}
    area_index = {n: i for i, n in enumerate(area_names)}
    compact = gpd.GeoDataFrame({
        "id": measured["id"].values, "p": measured["pop_est"].round(2).values,
        "a": measured["area_name"].map(area_index).values,
        "wb": measured["walk_m_basic_all"].round().astype(int).values,
        "wm": measured["walk_m_municipal_basic"].round().astype(int).values,
        "wa": measured["walk_m_all_schools"].round().astype(int).values,
        "sb": measured["nearest_school_basic_all"].map(name_index).values,
        "sm": measured["nearest_school_municipal_basic"].map(name_index).values,
        "sa": measured["nearest_school_all_schools"].map(name_index).values,
    }, geometry=measured.geometry.values, crs=measured.crs)

    presentation = project["presentation"]
    sets = project["processing"]["parameters"]["school_sets"]
    sources = []
    for key, source in project["sources"].items():
        sources.append({"key": key, "provider": source["provider"], "dataset": source["dataset"],
                        "url": source.get("portal_page") or source["source_url"], "source_url": source["source_url"],
                        "retrieved_at": source["access"]["retrieved_at"], "version": source["version"]["identifier"],
                        "license": source["license"]["name"], "license_url": source["license"].get("url"),
                        "rows": source["access"]["file"].get("row_count"), "rationale": source.get("rationale"),
                        "file": source["access"]["file"].get("name")})
    tables = {}
    for entry in presentation["tables"]:
        output = project["outputs"][entry["output"]]
        frame = frames["summary"] if entry["output"] == "area_summary" else frames["matrix"]
        tables[entry["output"]] = {"title": entry["title"], "columns": output["table"]["columns"], "rows": _records(frame),
                                   "default_sort": entry.get("default_sort"),
                                   "downloads": [{"format": fmt, "href": str(Path(output["path"]).with_suffix("." + fmt))}
                                                 for fmt in entry["downloads"]]}
    payload = {
        "project": project["project"] | {"status": "validated" if report["status"] == "passed" else report["status"]},
        "run": {"id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(),
                "status": report["status"]},
        "interpretation": project["interpretation"], "warnings": project.get("warnings") or [],
        "overrides": [o | {"result": next((r for r in facts["overrides"] if r["id"] == o["id"]), None)}
                      for o in project.get("overrides") or []],
        "steps": [{"id": s["id"], "operation": s["operation"], "crs": s.get("crs")} for s in project["processing"]["steps"]],
        "sources": sources, "validation": report, "facts": {k: v for k, v in facts.items() if k != "qgis"},
        "outputs": [{"key": k, "path": o["path"], "format": o["format"], "role": o.get("role", "result"),
                     "kind": o.get("kind", "geodata")} for k, o in project["outputs"].items()],
        "controls": presentation["controls"], "layout": presentation["layout"], "basemap": presentation["map"]["basemap"],
        "layer_groups": presentation["map"]["layer_groups"], "layers": presentation["map"]["layers"],
        "canonical": facts["canonical"], "minutes": p.MINUTES, "metres_per_minute": p.METRES_PER_MINUTE,
        "school_sets": [{"id": key, "label": sets[key]["label"], "schools": facts["schools"][key],
                         "column": {"basic_all": "wb", "municipal_basic": "wm", "all_schools": "wa"}[key],
                         "nearest": {"basic_all": "sb", "municipal_basic": "sm", "all_schools": "sa"}[key]}
                        for key in p.SCHOOL_SETS],
        "style": STYLE, "tables": tables, "school_names": school_names, "area_names": area_names,
        "data": {
            "buildings": _geojson(compact, 5),
            "schools": _geojson(schools, 6),
            "walksheds": _geojson(frames["sheds"], 5),
            "unserved": _geojson(frames["pockets"], 5, simplify_m=5.0),
            "areas": _geojson(frames["areas_out"], 5, simplify_m=3.0),
            "grid": _geojson(frames["grid_out"][["cell_id", "population", "pop_allocated_in_tartu", "alloc_basis", "geometry"]], 5),
        },
    }
    template = (root / "dashboard.template.html").read_text(encoding="utf-8")
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
    html = template.replace("__TITLE__", project["project"]["title"]).replace("/*__PAYLOAD__*/null", blob)
    (root / "dashboard.html").write_text(html, encoding="utf-8")
    log.info("dashboard written (%.1f MB)", len(html.encode("utf-8")) / 1e6)


# ----------------------------------------------------------------------------
# Run record
# ----------------------------------------------------------------------------
def _file_set_hash(root: Path, paths: list[Path]) -> str:
    """Canonical file-set hash (project-spec s.2.8)."""
    digest = hashlib.sha256()
    for relative in sorted({path.relative_to(root).as_posix() for path in paths}):
        encoded = relative.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        digest.update((root / relative).read_bytes())
    return "sha256:" + digest.hexdigest()


def _inventory(root: Path, paths: list[Path]) -> list[dict]:
    return [{"path": relative, "sha256": _sha256(root / relative)}
            for relative in sorted({path.relative_to(root).as_posix() for path in paths})]


def finalize_run(project: dict, report: dict, root: Path, started: datetime.datetime,
                 completed: datetime.datetime, environment: dict) -> None:
    """Write the report and run record, then point project.yaml at them. The
    pipeline owns runs.latest and project.status; they are never hand-edited."""
    inputs = {path for folder in ("data/source", "data/overrides") if (root / folder).is_dir()
              for path in (root / folder).rglob("*") if path.is_file()}
    implementation = project["runtime"]["implementation"]
    inputs |= {root / implementation["pipeline"], *[root / dep for dep in implementation.get("dependencies") or []]}
    outputs = []
    for output in project["outputs"].values():
        outputs.append(root / output["path"])
        outputs += [(root / output["path"]).with_suffix("." + fmt) for fmt in output.get("downloads") or []]
    report["inputs_hash"] = _file_set_hash(root, sorted(inputs))
    report["outputs_hash"] = _file_set_hash(root, outputs)
    (root / "validation" / "latest-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    run_file = root / "runs" / f"{report['run_id']}.json"
    run_file.write_text(json.dumps({
        "run_id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(),
        "status": report["status"], "inputs_hash": report["inputs_hash"], "outputs_hash": report["outputs_hash"],
        "validation_report": "validation/latest-report.json", "environment": environment,
        "headline": report["headline"], "inputs": _inventory(root, sorted(inputs)), "outputs": _inventory(root, outputs),
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    manifest = yaml.safe_load((root / "project.yaml").read_text(encoding="utf-8"))
    manifest["project"]["status"] = "validated" if report["status"] == "passed" else report["status"]
    manifest["project"]["updated_at"] = completed.isoformat()
    manifest["runs"] = {"latest": {
        "id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(),
        "status": report["status"], "inputs_hash": report["inputs_hash"], "outputs_hash": report["outputs_hash"],
        "record": {"path": run_file.relative_to(root).as_posix()},
        "validation_report": {"path": "validation/latest-report.json"}}}
    (root / "project.yaml").write_text(
        yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8")

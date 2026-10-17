#!/usr/bin/env python3
"""Canonical Helsinki source -> raster/network/model -> view -> validation pipeline."""

from __future__ import annotations
import argparse, heapq, json, math, os, shutil, subprocess, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import laspy, numpy as np, yaml
from osgeo import gdal, ogr, osr
from pyproj import Transformer
from openmapstack.integrity import (
    canonical_file_set_hash,
    declared_input_paths,
    declared_output_paths,
    file_inventory,
)
from acquire import digest, verify_archive, main as acquire
from building_mesh import build as build_buildings

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
gdal.UseExceptions()
gdal.SetConfigOption("GDAL_PAM_ENABLED", "NO")
TEMP = ROOT / ".cache" / "pipeline-temp"
TEMP.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TMPDIR", str(TEMP))
os.environ.setdefault("npm_config_cache", str(ROOT / ".cache/npm"))
os.environ["XDG_CACHE_HOME"] = str(ROOT / ".cache/xdg")
P = ROOT / "public/data"
D = ROOT / "data/derived"


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def cog(path, array, bbox):
    array = np.asarray(array, dtype=np.float32)
    h, w = array.shape
    m = gdal.GetDriverByName("MEM").Create("", w, h, 1, gdal.GDT_Float32)
    m.SetGeoTransform(
        [bbox[0], (bbox[2] - bbox[0]) / w, 0, bbox[3], 0, -(bbox[3] - bbox[1]) / h]
    )
    s = osr.SpatialReference()
    s.ImportFromEPSG(3067)
    m.SetProjection(s.ExportToWkt())
    b = m.GetRasterBand(1)
    b.SetNoDataValue(-9999)
    b.WriteArray(np.flipud(np.where(np.isfinite(array), array, -9999)))
    gdal.Translate(
        str(path),
        m,
        format="COG",
        creationOptions=["COMPRESS=DEFLATE", "BLOCKSIZE=256"],
    )


def lidar(project):
    params = project["processing"]
    bbox = params["bbox"]
    res = params["resolution_m"]
    w, h = int((bbox[2] - bbox[0]) / res), int((bbox[3] - bbox[1]) / res)
    size = w * h
    sums = np.zeros(size, dtype=np.float64)
    counts = np.zeros(size, dtype=np.uint32)
    roofs = np.full(size, -np.inf, dtype=np.float32)
    trees = roofs.copy()
    bridges = roofs.copy()
    coverage = np.zeros(size, dtype=bool)
    tx = Transformer.from_crs(3879, 3067, always_xy=True)
    classes = Counter()
    vegetation = []
    total = 0
    for key, source in project["sources"].items():
        if not key.startswith("lidar_") or not source["access"]["file"][
            "name"
        ].endswith(".laz"):
            continue
        path = source["access"]["file"]["name"]
        print("Grid", path, flush=True)
        with laspy.open(path) as f:
            for pts in f.chunk_iterator(1_000_000):
                x, y = tx.transform(np.asarray(pts.x), np.asarray(pts.y))
                z = np.asarray(pts.z)
                keep = (x >= bbox[0]) & (x < bbox[2]) & (y >= bbox[1]) & (y < bbox[3])
                x, y, z = x[keep] - bbox[0], y[keep] - bbox[1], z[keep]
                c = np.asarray(pts.classification)[keep]
                if not len(x):
                    continue
                u, n = np.unique(c, return_counts=True)
                classes.update(dict(zip(u.tolist(), n.tolist())))
                total += len(x)
                ix = (y / res).astype(int) * w + (x / res).astype(int)
                coverage[ix] = True
                ground = np.isin(c, [2, 8])
                np.add.at(sums, ix[ground], z[ground])
                np.add.at(counts, ix[ground], 1)
                for codes, values in [
                    ([6], roofs),
                    ([3, 4, 5], trees),
                    ([17], bridges),
                ]:
                    choose = np.isin(c, codes)
                    np.maximum.at(values, ix[choose], z[choose])
                select = np.flatnonzero(np.isin(c, [3, 4, 5]))[::300]
                vegetation.append(
                    np.column_stack([x[select], z[select], -y[select]]).astype("<f4")
                )
    dtm = (
        np.divide(
            sums, counts, out=np.full(size, -9999, dtype=np.float64), where=counts > 0
        )
        .astype(np.float32)
        .reshape(h, w)
    )
    mem = gdal.GetDriverByName("MEM").Create("", w, h, 1, gdal.GDT_Float32)
    band = mem.GetRasterBand(1)
    band.SetNoDataValue(-9999)
    band.WriteArray(dtm)
    gdal.FillNodata(band, None, params["max_ground_fill_m"] / res, 0)
    dtm = band.ReadAsArray()
    dtm[(dtm == -9999) | ~coverage.reshape(h, w)] = np.nan
    roofs = roofs.reshape(h, w)
    trees = trees.reshape(h, w)
    bridges = bridges.reshape(h, w)
    trees = np.where(trees >= dtm + params["vegetation_min_agl_m"], trees, -np.inf)
    dsm = np.maximum.reduce([dtm, roofs, trees, bridges])
    dsm[~np.isfinite(dtm)] = np.nan
    for name, arr in [
        ("dtm", dtm),
        ("dsm", dsm),
        ("buildings", np.where(np.isfinite(roofs), roofs, np.nan)),
        ("vegetation", np.where(np.isfinite(trees), trees, np.nan)),
    ]:
        cog(D / (name + ".tif"), arr, bbox)

    def quantize(arr, ceil=False):
        v = (arr + 10) / 0.1
        valid = np.isfinite(v)
        if np.any((v[valid] < 0) | (v[valid] > 65534)):
            raise ValueError("Height encoding range exceeded")
        return np.where(valid, np.ceil(v) if ceil else np.rint(v), 65535).astype("<u2")

    quantize(dtm).tofile(P / "dtm.bin")
    quantize(dsm, True).tofile(P / "dsm.bin")
    vp = np.concatenate(vegetation)
    vp = vp[
        vp[:, 1]
        >= dtm[(-vp[:, 2]).astype(int), vp[:, 0].astype(int)]
        + params["vegetation_min_agl_m"]
    ]
    vp.tofile(P / "vegetation.bin")
    stats = {
        "points_in_aoi": total,
        "classes": {str(k): int(v) for k, v in sorted(classes.items())},
        "ground_cells_measured": int(np.count_nonzero(counts)),
        "ground_coverage_fraction": float(np.mean(np.isfinite(dtm))),
        "building_cells": int(np.isfinite(roofs).sum()),
        "high_vegetation_cells": int(np.isfinite(trees).sum()),
        "vegetation_display_points": len(vp),
    }
    return (
        {"width": w, "height": h, "resolution": res, "zOrigin": -10, "zScale": 0.1},
        dtm,
        stats,
    )


def network(project, dtm):
    bbox = project["processing"]["bbox"]
    tx = Transformer.from_crs(4326, 3067, always_xy=True)
    raw = json.loads(Path("data/source/osm-20261016.json").read_text())
    assert "remark" not in raw
    nodes = {e["id"]: e for e in raw["elements"] if e["type"] == "node"}
    points = {i: tx.transform(e["lon"], e["lat"]) for i, e in nodes.items()}
    graph = {}
    edges = {}
    roads = []
    allowed = {
        "primary",
        "secondary",
        "tertiary",
        "residential",
        "unclassified",
        "service",
        "living_street",
        "primary_link",
        "secondary_link",
        "tertiary_link",
    }

    def inside(i):
        x, y = points[i]
        return (
            bbox[0] + 5 < x < bbox[2] - 5
            and bbox[1] + 5 < y < bbox[3] - 5
            and np.isfinite(dtm[int(y - bbox[1]), int(x - bbox[0])])
        )

    for e in raw["elements"]:
        if e["type"] != "way":
            continue
        tags = e["tags"]
        if (
            tags.get("highway") not in allowed
            or tags.get("tunnel") not in [None, "no"]
            or tags.get("bridge") not in [None, "no"]
            or tags.get("layer", "0") != "0"
        ):
            continue
        if any(
            tags.get(k) in ["no", "private"]
            for k in ["access", "motor_vehicle", "motorcar", "vehicle"]
        ):
            continue
        for a, b in zip(e["nodes"], e["nodes"][1:]):
            if a not in points or b not in points or not inside(a) or not inside(b):
                continue
            pa, pb = points[a], points[b]
            length = math.dist(pa, pb)
            if not length:
                continue
            one = tags.get("oneway", "no")
            pairs = (
                [(b, a)]
                if one == "-1"
                else [(a, b)]
                if one in ["yes", "1", "true"] or tags.get("junction") == "roundabout"
                else [(a, b), (b, a)]
            )
            for start, end in pairs:
                graph.setdefault(start, {})[end] = length
                graph.setdefault(end, {})
                edges[(start, end)] = {"way_id": e["id"], "version": e["version"]}
            roads.append(
                {
                    "way_id": e["id"],
                    "version": e["version"],
                    "nodes": [a, b],
                    "coordinates": [
                        [pa[0] - bbox[0], pa[1] - bbox[1]],
                        [pb[0] - bbox[0], pb[1] - bbox[1]],
                    ],
                }
            )
    anchors = json.loads(Path("data/overrides/scenario.geojson").read_text())[
        "features"
    ]
    routes = {}
    vectors = []
    for k, anchor in enumerate(anchors):
        seed = anchor["properties"]["source_node_id"]
        source = nodes[seed]
        assert (
            anchor["geometry"]["coordinates"] == [source["lon"], source["lat"]]
            and anchor["properties"]["source_version"] == source["version"]
            and seed in graph
        )
        distances = {seed: 0}
        previous = {}
        queue = [(0, seed)]
        while queue:
            distance, node = heapq.heappop(queue)
            if distance != distances[node]:
                continue
            for nxt, length in sorted(graph[node].items()):
                d = distance + length
                if d < distances.get(nxt, math.inf):
                    distances[nxt] = d
                    previous[nxt] = node
                    heapq.heappush(queue, (d, nxt))
        end = max(distances, key=lambda n: (distances[n], n))
        path = [end]
        while path[-1] != seed:
            path.append(previous[path[-1]])
        path.reverse()
        assert len(path) > 1
        route_id = "route-" + str(k + 1)
        routes[route_id] = {
            "coordinates": [
                [points[i][0] - bbox[0], points[i][1] - bbox[1]] for i in path
            ],
            "sourceNodeIds": path,
            "sourceEdges": [edges[(a, b)] for a, b in zip(path, path[1:])],
            "lengthM": distances[end],
            "note": "Hypothetical traversal of sourced OSM nodes; reversal is a simulated turn.",
        }
        vectors.append(
            {
                "id": "UAV-" + str(k + 1),
                "type": "uav",
                "route": route_id,
                "speedMps": 8,
                "offsetM": min(250, distances[end] * 0.3),
            }
        )
    scenario = {
        "status": "SIMULATED",
        "routes": routes,
        "vectors": vectors,
        "target": routes["route-2"]["coordinates"][0],
        "zoneSpacingM": project["presentation"]["controls"]["zoneSpacingM"],
        "probabilityThreshold": project["presentation"]["controls"][
            "probabilityThreshold"
        ],
    }
    dump(P / "roads.json", roads)
    dump(P / "scenario.json", scenario)
    path = D / "network.gpkg"
    if path.exists():
        path.unlink()
    ds = ogr.GetDriverByName("GPKG").CreateDataSource(str(path))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3067)
    layer = ds.CreateLayer("streets", srs, ogr.wkbLineString)
    for name in ["way_id", "node_a", "node_b"]:
        layer.CreateField(ogr.FieldDefn(name, ogr.OFTInteger64))
    ds.StartTransaction()
    for road in roads:
        f = ogr.Feature(layer.GetLayerDefn())
        for name, value in [
            ("way_id", road["way_id"]),
            ("node_a", road["nodes"][0]),
            ("node_b", road["nodes"][1]),
        ]:
            f.SetField(name, value)
        geom = ogr.Geometry(ogr.wkbLineString)
        for x, y in road["coordinates"]:
            geom.AddPoint_2D(x + bbox[0], y + bbox[1])
        f.SetGeometry(geom)
        layer.CreateFeature(f)
    ds.CommitTransaction()
    ds = None
    return {
        "road_segments": len(roads),
        "route_lengths_m": [r["lengthM"] for r in routes.values()],
        "routes_valid": all(
            all(
                (a, b) in edges
                for a, b in zip(r["sourceNodeIds"], r["sourceNodeIds"][1:])
            )
            for r in routes.values()
        ),
    }


def photography(project):
    shutil.copyfile("data/source/orthophoto-2021.jpg", P / "basemap.jpg")
    bbox = project["processing"]["bbox"]
    src = gdal.Open("data/source/orthophoto-2021.jpg")
    mem = gdal.Translate(
        "",
        src,
        format="MEM",
        outputSRS="EPSG:3067",
        outputBounds=[bbox[0], bbox[3], bbox[2], bbox[1]],
    )
    gdal.Translate(
        str(D / "orthophoto.tif"), mem, format="COG", creationOptions=["COMPRESS=JPEG"]
    )


def models():
    shutil.copyfile("data/source/quadcopter.glb", "public/models/uav.glb")
    Path("public/models/ATTRIBUTION.txt").write_text(
        "Quadcopter with flight electronics by Innerscene, CC0 1.0.\n"
        "https://www.innerscene.com/tools/library/3d-parts/quadcopter-with-flight-electronics-a25968c1\n"
        "https://creativecommons.org/publicdomain/zero/1.0/\n"
        "Original model unchanged; displayed at annotated 9x scale, never used in LOS.\n"
    )
    legacy_mgrs = Path(
        subprocess.check_output(
            [
                "node",
                "-e",
                "process.stdout.write(require.resolve('mgrs/package.json',{paths:[require.resolve('proj4')]}))",
            ],
            text=True,
        )
    ).parent
    license_dir = ROOT / "public/licenses"
    license_dir.mkdir(exist_ok=True)
    (license_dir / "coordinates.txt").write_text(
        "Coordinate display libraries (pinned by package-lock.json)\n\n"
        "Proj4js 2.22.0 — https://github.com/proj4js/proj4js\n"
        + Path("node_modules/proj4/LICENSE.md").read_text()
        + "\n\n"
        "Proj4js transitive legacy mgrs notices — https://github.com/proj4js/mgrs\n"
        + (legacy_mgrs / "license.md").read_text()
        + "\n\n"
        + "Licensed under"
        + (legacy_mgrs / "readme.md")
        .read_text()
        .split("Licensed under", 1)[1]
        .split("# references:", 1)[0]
        + "\n\ngeographiclib-mgrs 1.0.5 — https://github.com/spatialillusions/geographiclib-mgrs\n"
        + Path("node_modules/geographiclib-mgrs/LICENSE").read_text()
        + "\n"
        + Path("node_modules/geographiclib-mgrs/ORIGINAL_LICENSE").read_text()
        + "\n\n"
        + Path("licenses/OpenMap.txt").read_text()
    )


def desktop(project):
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    runtime_dir = ROOT / ".cache/qt-runtime"
    runtime_dir.mkdir(mode=0o700, exist_ok=True)
    os.environ["XDG_RUNTIME_DIR"] = str(runtime_dir)
    from qgis.core import (
        QgsApplication,
        QgsProject,
        QgsRasterLayer,
        QgsVectorLayer,
        QgsCoordinateReferenceSystem,
        QgsSingleBandPseudoColorRenderer,
        QgsColorRampShader,
        QgsRasterShader,
        QgsRectangle,
        QgsReferencedRectangle,
        QgsLineSymbol,
        Qgis,
    )
    from qgis.PyQt.QtGui import QColor

    app = QgsApplication([], False)
    app.initQgis()
    q = QgsProject.instance()
    q.clear()
    q.setCrs(QgsCoordinateReferenceSystem("EPSG:3067"))
    q.setFilePathStorage(Qgis.FilePathType.Relative)
    q.setTitle("Helsinki visibility · published geometry")
    defs = [
        ("SIMULATED default zones · t=0", "data/derived/default-zones.tif", "zones"),
        ("SIMULATED source-node anchors", "data/overrides/scenario.geojson", "points"),
        ("OSM streets", "data/derived/network.gpkg|layername=streets", "vector"),
        ("High vegetation", "data/derived/vegetation.tif", "raster"),
        (
            "Official LoD2 roofs · display context",
            "data/derived/lod2-roofs.gpkg|layername=roof_surfaces",
            "roofs",
        ),
        ("LiDAR buildings · analysis", "data/derived/buildings.tif", "raster"),
        ("2021 photography", "data/derived/orthophoto.tif", "photo"),
        ("Ground DTM", "data/derived/dtm.tif", "ground"),
    ]
    groups = {
        name: q.layerTreeRoot().addGroup(title)
        for name, title in [
            ("scenario", "SIMULATED vectors & zones"),
            ("obstructions", "Buildings & vegetation"),
            ("ground", "Ground & photography"),
        ]
    }
    for title, path, kind in defs:
        layer = (
            QgsVectorLayer(path, title, "ogr")
            if kind in ["vector", "points", "roofs"]
            else QgsRasterLayer(path, title)
        )
        if not layer.isValid():
            raise ValueError("Invalid QGIS layer: " + title)
        if kind == "vector":
            layer.renderer().setSymbol(
                QgsLineSymbol.createSimple(
                    {"line_color": "110,128,148", "line_width": "0.3"}
                )
            )
        if kind == "roofs":
            from qgis.core import QgsFillSymbol

            layer.renderer().setSymbol(
                QgsFillSymbol.createSimple(
                    {"color": "145,158,150", "outline_style": "no"}
                )
            )
        if kind == "raster":
            color = "#487452" if title == "High vegetation" else "#e6e9eb"
            fn = QgsColorRampShader()
            fn.setColorRampType(QgsColorRampShader.Interpolated)
            fn.setColorRampItemList(
                [
                    QgsColorRampShader.ColorRampItem(-10, QColor(color)),
                    QgsColorRampShader.ColorRampItem(150, QColor(color)),
                ]
            )
            shader = QgsRasterShader()
            shader.setRasterShaderFunction(fn)
            layer.setRenderer(
                QgsSingleBandPseudoColorRenderer(layer.dataProvider(), 1, shader)
            )
        if kind == "points":
            from qgis.core import QgsMarkerSymbol

            layer.renderer().setSymbol(
                QgsMarkerSymbol.createSimple(
                    {"name": "diamond", "color": "6,112,237", "size": "3"}
                )
            )
        if kind == "zones":
            fn = QgsColorRampShader()
            fn.setColorRampType(QgsColorRampShader.Discrete)
            fn.setColorRampItemList(
                [
                    QgsColorRampShader.ColorRampItem(i, QColor(color), label)
                    for i, color, label in [
                        (0, "#00000000", "Unknown"),
                        (1, "#60a86a", "GREEN · low sampled visibility"),
                        (2, "#f5c744", "YELLOW · forecast ≥0.25"),
                        (3, "#ef5456", "RED · direct LOS"),
                    ]
                ]
            )
            shader = QgsRasterShader()
            shader.setRasterShaderFunction(fn)
            layer.setRenderer(
                QgsSingleBandPseudoColorRenderer(layer.dataProvider(), 1, shader)
            )
            layer.setOpacity(0.48)
        q.addMapLayer(layer, False)
        groups[
            "scenario"
            if kind in ["zones", "points"]
            else "obstructions"
            if kind in ["raster", "roofs"]
            else "ground"
        ].addLayer(layer)
    q.viewSettings().setDefaultViewExtent(
        QgsReferencedRectangle(QgsRectangle(*project["processing"]["bbox"]), q.crs())
    )
    q.setFileName(str(ROOT / "project.qgz"))
    assert q.write()
    q.clear()
    assert q.read(str(ROOT / "project.qgz"))
    valid = all(l.isValid() for l in q.mapLayers().values()) and len(
        q.mapLayers()
    ) == len(defs)
    q.clear()
    return valid, app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        acquire()
    started = datetime.now(timezone.utc)
    runid = started.strftime("run-%Y%m%d-%H%M%S")
    project = yaml.safe_load(Path("project.yaml").read_text())
    lock = json.loads(Path("sources.lock.json").read_text())
    checks = []

    def check(cid, passed, message, **extra):
        checks.append(
            {
                "id": cid,
                "status": "passed" if passed else "failed",
                "message": message,
                **extra,
            }
        )

    for folder in [P, D, ROOT / "validation", ROOT / "runs", ROOT / "public/models"]:
        folder.mkdir(parents=True, exist_ok=True)
    for sidecar in D.glob("*.tif.aux.xml"):
        sidecar.unlink()
    for entry in lock["files"]:
        verify_archive(entry)
        path = ROOT / entry["path"]
        if not path.exists():
            raise FileNotFoundError(str(path) + ": run python acquire.py first")
        if digest(path) != entry["sha256"]:
            raise ValueError("Changed source bytes: " + str(path))
    check("source_hashes_match", True, f"Verified {len(lock['files'])} immutable files")
    grid, dtm, stats = lidar(project)
    building_stats = build_buildings(project, ROOT)
    ns = network(project, dtm)
    photography(project)
    models()
    bbox = project["processing"]["bbox"]
    dump(
        P / "scene.json",
        {
            "grid": grid,
            "origin": bbox[:2],
            "buildingMesh": {
                "path": "data/buildings.glb",
                "source": "lod2_tileset",
                "metadata": "data/building-mesh.json",
                "analysis": False,
            },
            "coordinates": project["presentation"]["coordinates"],
            "tracks": project["presentation"]["tracks"],
            "defaults": project["presentation"]["controls"]["defaults"],
            "layers": project["presentation"]["controls"]["layer_defaults"],
            "playback": project["presentation"]["controls"]["playback_defaults"],
            "runId": runid,
            "status": "SIMULATED",
        },
    )
    sources = []
    for key, s in project["sources"].items():
        if key == "lidar_spec":
            continue
        title = s["dataset"]
        url = s["source_url"]
        if key == "uav":
            title = "Quadcopter with flight electronics · Innerscene"
            url = "https://www.innerscene.com/tools/library/3d-parts/quadcopter-with-flight-electronics-a25968c1"
        sources.append(
            {
                "id": key,
                "title": title,
                "url": url,
                "version": s["version"]["identifier"],
                "license": s["license"]["name"],
                "retrievedAt": s["access"]["retrieved_at"],
            }
        )
    dump(
        P / "provenance.json",
        {
            "runId": runid,
            "sources": sources,
            "assumptions": project["interpretation"]["assumptions"],
            "statistics": {**stats, **ns},
            "attribution": "© Helsingin kaupunkimittauspalvelut 2021, CC BY 4.0 (modified). © OpenStreetMap contributors, ODbL 1.0. Models: models/ATTRIBUTION.txt.",
            "research": lock["research"],
            "iteration2Research": lock["iteration2_research"],
            "buildingMesh": {
                k: v for k, v in building_stats.items() if k != "cityBuildingIds"
            },
            "analysisCRS": "EPSG:3067",
            "verticalDatum": "N2000",
        },
    )
    subprocess.run(["node", "scripts/canonical.mjs"], check=True)
    baseline = json.loads((P / "default-snapshot.json").read_text())
    cog(
        D / "default-zones.tif",
        np.fromfile(D / "default-zones.bin", dtype=np.uint8).reshape(
            baseline["rows"], baseline["cols"]
        ),
        bbox,
    )
    qvalid, qapp = desktop(project)
    index = json.loads(Path("data/source/tile-index.geojson").read_text())
    check(
        "source_result_complete",
        index["numberMatched"]
        == index["numberReturned"]
        == len(index["features"])
        == 9,
        "9/9 tile index features, complete LAZ files; Overpass body has no error remark",
    )
    check(
        "crs_known",
        all(
            gdal.Open(str(D / (n + ".tif"))).GetSpatialRef().GetAuthorityCode(None)
            == "3067"
            for n in ["dtm", "dsm", "buildings", "vegetation"]
        ),
        "PROJ XY 3879 -> 3067; N2000 Z unchanged",
    )
    ds = ogr.Open(str(D / "network.gpkg"))
    check(
        "geometry_valid",
        all(f.GetGeometryRef().IsValid() for f in ds.GetLayerByName("streets")),
        "GeoPackage street geometries valid",
    )
    check(
        "row_count_gt_zero",
        stats["points_in_aoi"] > 0 and ns["road_segments"] > 0,
        "Measured point and road counts",
        statistics={**stats, **ns},
    )
    check(
        "obstruction_includes_buildings_and_vegetation",
        stats["building_cells"] > 0 and stats["high_vegetation_cells"] > 0,
        "Class 6 roofs plus class 3/4/5 vegetation ≥2m AGL present",
    )
    check(
        "dtm_coverage",
        stats["ground_coverage_fraction"] > 0.95,
        "At least 95% valid ground; remaining cells explicitly unknown",
        value=stats["ground_coverage_fraction"],
    )
    check(
        "street_routes_follow_source",
        ns["routes_valid"] and min(ns["route_lengths_m"]) > 300,
        "All route segments resolve to retained directed OSM edges",
    )
    check(
        "overrides_applied",
        True,
        "Scenario anchor IDs, versions and source coordinates matched",
        results=[{"id": "SCENARIO-1", "status": "applied"}],
    )
    symbols = set(project["sources"])
    graph_valid = True
    for step in project["processing"]["steps"]:
        graph_valid &= all(
            i in symbols for i in step.get("inputs", [step.get("input")])
        )
        symbols.add(step["output"])
    check(
        "manifest_graph_resolves",
        graph_valid
        and all(
            o["generated_by"] in {s["id"] for s in project["processing"]["steps"]}
            for o in project["outputs"].values()
        ),
        "Ordered symbols and output producers resolve",
    )
    check(
        "view_controls_match_pipeline",
        json.loads((P / "scene.json").read_text())["defaults"]
        == project["presentation"]["controls"]["defaults"],
        "Defaults copied from manifest; baseline uses same worker computation",
    )
    scenario = json.loads((P / "scenario.json").read_text())
    check(
        "lod2_source_complete",
        building_stats["tilesMatched"] == building_stats["tilesReturned"] == 15
        and building_stats["buildingCount"] > 0,
        "Selected official leaf tiles all present; source building IDs retained",
        value=building_stats["buildingCount"],
    )
    check(
        "lod2_alignment",
        building_stats["alignment"]["samples"] > 1000
        and building_stats["alignment"]["medianAbsoluteDifference"] < 2,
        "N2000 roof alignment checked against 2021 LiDAR without fitting; different epochs",
        statistics=building_stats["alignment"],
    )
    check(
        "lod2_mesh_valid",
        building_stats["publishedTriangles"] > 1000
        and all(
            bbox[i] - 1e-7
            <= building_stats["boundsEPSG3067N2000"][0][i]
            <= building_stats["boundsEPSG3067N2000"][1][i]
            <= bbox[i + 2] + 1e-7
            for i in [0, 1]
        ),
        "True triangle clipping to projected AOI, quantized local-frame GLB, source roofs retained",
    )
    check(
        "uav_only_scenario",
        len(scenario["vectors"]) == 3
        and all(v["type"] == "uav" for v in scenario["vectors"])
        and set(project["presentation"]["controls"]["defaults"])
        == {"uavs", "uavHeight"},
        "Only UAVs contribute to current and forecast danger zones",
    )
    check(
        "presentation_contract",
        project["presentation"]["coordinates"]["display"] == "MGRS"
        and len(project["presentation"]["layout"]["sidebar"]["tabs"]) == 3
        and project["presentation"]["legend"]["visible"]
        and project["presentation"]["controls"]["canonical_reset"],
        "MGRS readouts, semantic roles, three collapsible tabs, legend and canonical reset",
    )
    payload = sum(p.stat().st_size for p in (ROOT / "public").rglob("*") if p.is_file())
    check(
        "payload_lt_20mb",
        payload < 20_000_000,
        "All browser data and model bytes before compression, excluding JS/CSS",
        bytes=payload,
    )
    result = subprocess.run(["npm", "test"], check=False)
    acquisition_tests = subprocess.run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests",
            "-p",
            "test_acquire.py",
        ],
        check=False,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    mesh_tests = subprocess.run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests",
            "-p",
            "test_building_mesh.py",
        ],
        check=False,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    check(
        "lod2_conversion_fixtures",
        mesh_tests.returncode == 0,
        "Closed 3D clipping, vertical walls, node/axis transforms and compact GLB fixtures",
    )
    check(
        "analytic_los_tests",
        result.returncode == 0,
        "Analytic/product fixtures via npm test",
    )
    check(
        "archived_sources_reproducible",
        acquisition_tests.returncode == 0,
        "Offline fresh-clone archive restoration and strict corruption rejection via unittest",
    )
    check(
        "qgis_project_static_valid",
        Path("project.qgz").is_file(),
        "QGIS companion written with relative sources",
    )
    check("qgis_layers_valid", qvalid, "Every layer isValid() after artifact reload")
    check(
        "manifest_report_parity",
        set(project["validation"]["required"])
        == {c["id"] for c in checks} | {"manifest_report_parity"},
        "Every required check appears exactly once",
    )
    status = "passed" if all(c["status"] == "passed" for c in checks) else "failed"
    ip = declared_input_paths(ROOT, project)
    op = declared_output_paths(project)
    ih = canonical_file_set_hash(ROOT, ip)
    oh = canonical_file_set_hash(ROOT, op)
    run = {
        "id": runid,
        "run_id": runid,
        "started_at": started.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "inputs_hash": ih,
        "outputs_hash": oh,
        "environment": project["runtime"]["environment"],
        "validation_report": {"path": "validation/latest-report.json"},
        "inputs": file_inventory(ROOT, ip),
        "outputs": file_inventory(ROOT, op),
        "record": {"path": f"runs/{runid}.json"},
    }
    dump(
        ROOT / "validation/latest-report.json",
        {
            "run_id": runid,
            "status": status,
            "inputs_hash": ih,
            "outputs_hash": oh,
            "checks": checks,
        },
    )
    dump(ROOT / "runs" / f"{runid}.json", run)
    project["runs"]["latest"] = {
        k: v for k, v in run.items() if k not in ["inputs", "outputs"]
    }
    project["project"]["status"] = "validated" if status == "passed" else "failed"
    project["project"]["updated_at"] = run["completed_at"]
    Path("project.yaml").write_text(
        yaml.safe_dump(project, sort_keys=False, allow_unicode=True)
    )
    print(
        json.dumps(
            {
                "run": runid,
                "status": status,
                "payload_bytes": payload,
                "statistics": stats,
            }
        ),
        flush=True,
    )
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())

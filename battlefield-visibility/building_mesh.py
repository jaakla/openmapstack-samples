"""Official Helsinki LoD2 b3dm -> AOI-clipped, compact local-frame GLB.

No invented heights/footprints. OGC b3dm transform order is node hierarchy,
Y-up->Z-up, RTC translation, tile transform. The delivered numeric height channel
retains the city's documented N2000 elevations; no geoid shift is introduced.
"""

from __future__ import annotations
import json, math, struct
from pathlib import Path
import numpy as np
from pyproj import Transformer
from scipy.spatial.transform import Rotation
from osgeo import ogr, osr, gdal

gdal.UseExceptions()

UP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)
IDENTITY = np.eye(4)
DOC = "https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d"


def matrix(node):
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=float).reshape(4, 4, order="F")
    m = np.eye(4)
    m[:3, :3] = Rotation.from_quat(
        node.get("rotation", [0, 0, 0, 1])
    ).as_matrix() @ np.diag(node.get("scale", [1, 1, 1]))
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def selected_tiles(tileset, bbox):
    bounds = Transformer.from_crs(3067, 4326, always_xy=True).transform_bounds(
        *bbox, densify_pts=21
    )
    b = np.radians(bounds)
    selected = {}

    def visit(tile, parent):
        transform = (
            parent @ matrix({"matrix": tile["transform"]})
            if "transform" in tile
            else parent
        )
        content = tile.get("content", {})
        if not tile.get("children") and content.get("uri", "").endswith(".b3dm"):
            r = content.get("boundingVolume", tile["boundingVolume"])["region"]
            if r[0] <= b[2] and r[2] >= b[0] and r[1] <= b[3] and r[3] >= b[1]:
                selected[content["uri"]] = transform
        for child in tile.get("children", []):
            visit(child, transform)

    visit(tileset["root"], IDENTITY)
    return selected


def decode_b3dm(path, tile_transform):
    data = Path(path).read_bytes()
    magic, version, length, fj, fb, bj, bb = struct.unpack_from("<4s6I", data)
    if magic != b"b3dm" or version != 1 or length != len(data):
        raise ValueError("Invalid b3dm header")
    feature = json.loads(data[28 : 28 + fj])
    batch = json.loads(data[28 + fj + fb : 28 + fj + fb + bj])
    start = 28 + fj + fb + bj + bb
    magic, version, length = struct.unpack_from("<4sII", data, start)
    if magic != b"glTF" or version != 2:
        raise ValueError("Expected glTF 2")
    jlen, tag = struct.unpack_from("<II", data, start + 12)
    if tag != 0x4E4F534A:
        raise ValueError("Missing JSON chunk")
    gltf = json.loads(data[start + 20 : start + 20 + jlen])
    bin_start = start + 20 + jlen
    blen, tag = struct.unpack_from("<II", data, bin_start)
    if tag != 0x004E4942:
        raise ValueError("Missing BIN chunk")
    binary = data[bin_start + 8 : bin_start + 8 + blen]
    if (
        gltf.get("extensionsRequired")
        or len(gltf["buffers"]) != 1
        or gltf["buffers"][0].get("uri")
    ):
        raise ValueError("Unsupported external/compressed source GLB")

    def accessor(i):
        a = gltf["accessors"][i]
        v = gltf["bufferViews"][a["bufferView"]]
        if a.get("sparse") or a.get("normalized"):
            raise ValueError("Unsupported source accessor")
        dtype = np.dtype(
            {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[a["componentType"]]
        )
        count = {"VEC3": 3, "SCALAR": 1}[a["type"]]
        return np.ndarray(
            (a["count"], count),
            dtype=dtype,
            buffer=binary,
            offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
            strides=(v.get("byteStride", dtype.itemsize * count), dtype.itemsize),
        )

    rtc = np.eye(4)
    rtc[:3, 3] = feature.get("RTC_CENTER", [0, 0, 0])
    ecef_to_ll = Transformer.from_crs(4978, 4979, always_xy=True)
    ll_to_xy = Transformer.from_crs(4326, 3067, always_xy=True)

    def visit(i, parent):
        node = gltf["nodes"][i]
        model = parent @ matrix(node)
        if "mesh" in node:
            for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
                if primitive.get("mode", 4) != 4:
                    raise ValueError("Source primitive is not triangles")
                p = accessor(primitive["attributes"]["POSITION"]).astype(float)
                t = tile_transform @ rtc @ UP @ model
                ecef = (np.column_stack([p, np.ones(len(p))]) @ t.T)[:, :3]
                lon, lat, z = ecef_to_ll.transform(*ecef.T)
                x, y = ll_to_xy.transform(lon, lat)
                xyz = np.column_stack([x, y, z])
                indices = accessor(primitive["indices"]).reshape(-1, 3)
                ids = accessor(primitive["attributes"]["_BATCHID"]).ravel().astype(int)
                if not np.all(ids[indices] == ids[indices[:, :1]]):
                    raise ValueError("Mixed city IDs in triangle")
                yield (
                    primitive.get("material", 0),
                    xyz[indices],
                    np.asarray(batch["id"])[ids[indices[:, 0]]],
                )
        for child in node.get("children", []):
            yield from visit(child, model)

    for root in gltf["scenes"][gltf.get("scene", 0)]["nodes"]:
        yield from visit(root, IDENTITY)


def clip_triangle(triangle, bbox):
    """Closed Sutherland-Hodgman clip; Z interpolates on the original triangle."""
    polygon = list(np.asarray(triangle, dtype=float))
    for axis, bound, sign in [
        (0, bbox[0], 1),
        (0, bbox[2], -1),
        (1, bbox[1], 1),
        (1, bbox[3], -1),
    ]:
        output = []
        if not polygon:
            return []
        previous = polygon[-1]
        previous_inside = sign * (previous[axis] - bound) >= 0
        for current in polygon:
            inside = sign * (current[axis] - bound) >= 0
            if inside != previous_inside:
                fraction = (bound - previous[axis]) / (current[axis] - previous[axis])
                point = previous + fraction * (current - previous)
                point[axis] = bound
                output.append(point)
            if inside:
                output.append(current)
            previous, previous_inside = current, inside
        polygon = output
    triangles = [
        np.array([polygon[0], polygon[i], polygon[i + 1]])
        for i in range(1, len(polygon) - 1)
    ]
    return [
        t
        for t in triangles
        if np.linalg.norm(np.cross(t[1] - t[0], t[2] - t[0])) > 1e-10
    ]


def write_glb(path, parts, bbox):
    """2 cm positions + normalized signed-byte normals, three material batches."""
    binary = bytearray()
    views = []
    accessors = []
    primitives = []
    triangle_count = 0
    collapsed = 0
    materials = [[0.57, 0.62, 0.59, 1], [0.28, 0.34, 0.37, 1], [0.40, 0.46, 0.42, 1]]

    def view(payload, **fields):
        while len(binary) % 4:
            binary.append(0)
        i = len(views)
        views.append(
            dict(buffer=0, byteOffset=len(binary), byteLength=len(payload), **fields)
        )
        binary.extend(payload)
        return i

    def acc(**fields):
        accessors.append(fields)
        return len(accessors) - 1

    for material in sorted(parts):
        triangles = np.concatenate(parts[material])
        local = np.stack(
            [
                triangles[:, :, 0] - bbox[0],
                triangles[:, :, 2],
                bbox[3] - triangles[:, :, 1],
            ],
            axis=2,
        )
        local[:, :, 1] += 10
        q = np.rint(local / 0.02).astype(np.int64)
        if q.min() < 0 or q.max() > 65535:
            raise ValueError("Mesh exceeds 2cm quantization bounds")
        cross = np.cross(q[:, 1] - q[:, 0], q[:, 2] - q[:, 0])
        length = np.linalg.norm(cross, axis=1)
        keep = length > 0
        collapsed += int((~keep).sum())
        q = q[keep]
        cross = cross[keep]
        length = length[keep]
        # Duplicate source triangles, including across tile boundaries, paint once.
        keys = np.sort(
            q.view(np.dtype((np.void, q.dtype.itemsize * 3))).reshape(-1, 3), axis=1
        )
        _, unique = np.unique(keys, axis=0, return_index=True)
        unique.sort()
        q = q[unique]
        cross = cross[unique]
        length = length[unique]
        normals = np.rint(cross / length[:, None] * 127).astype(np.int16)
        rows = np.column_stack([q.reshape(-1, 3), np.repeat(normals, 3, axis=0)])
        vertices, index = np.unique(rows, axis=0, return_inverse=True)
        packed = np.zeros((len(vertices), 12), dtype=np.uint8)
        packed[:, :6] = vertices[:, :3].astype("<u2").view(np.uint8).reshape(-1, 6)
        packed[:, 8:11] = vertices[:, 3:].astype("i1").view(np.uint8)
        vb = view(packed.tobytes(), target=34962, byteStride=12)
        pos = acc(
            bufferView=vb,
            byteOffset=0,
            componentType=5123,
            count=len(vertices),
            type="VEC3",
            min=vertices[:, :3].min(axis=0).tolist(),
            max=vertices[:, :3].max(axis=0).tolist(),
        )
        normal = acc(
            bufferView=vb,
            byteOffset=8,
            componentType=5120,
            normalized=True,
            count=len(vertices),
            type="VEC3",
        )
        ib = view(index.astype("<u4").tobytes(), target=34963)
        indices = acc(
            bufferView=ib, componentType=5125, count=len(index), type="SCALAR"
        )
        primitives.append(
            dict(
                attributes=dict(POSITION=pos, NORMAL=normal),
                indices=indices,
                material=material,
                mode=4,
            )
        )
        triangle_count += len(index) // 3
    while len(binary) % 4:
        binary.append(0)
    gltf = dict(
        asset=dict(
            version="2.0",
            generator="OpenMapStack pinned Helsinki LoD2 pipeline",
            copyright="City of Helsinki, CC BY 4.0; modified clipping/reprojection/quantization",
        ),
        extensionsUsed=["KHR_mesh_quantization"],
        extensionsRequired=["KHR_mesh_quantization"],
        buffers=[dict(byteLength=len(binary))],
        bufferViews=views,
        accessors=accessors,
        materials=[
            dict(
                name=f"Source surface material {i} · tactical palette",
                doubleSided=True,
                pbrMetallicRoughness=dict(
                    baseColorFactor=c, metallicFactor=0, roughnessFactor=0.95
                ),
            )
            for i, c in enumerate(materials)
        ],
        meshes=[dict(primitives=primitives)],
        nodes=[
            dict(
                mesh=0,
                translation=[0, -10, -(bbox[3] - bbox[1])],
                scale=[0.02, 0.02, 0.02],
            )
        ],
        scenes=[dict(nodes=[0])],
        scene=0,
    )
    encoded = json.dumps(gltf, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    output = (
        struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(binary))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )
    Path(path).write_bytes(output)
    return triangle_count, collapsed


def build(project, root):
    bbox = project["processing"]["bbox"]
    source = root / "data/source/lod2"
    tileset = json.loads((source / "tileset.json").read_text())
    selected = selected_tiles(tileset, bbox)
    locked = {
        s["source_url"].split("/16fc3fd5-df6d-4f48-bfd5-9aeee430a02f/")[-1]
        for key, s in project["sources"].items()
        if key.startswith("lod2_") and s["access"]["file"]["name"].endswith(".b3dm")
    }
    if set(selected) != locked:
        raise ValueError("LoD2 AOI tile selection differs from pinned inventory")
    parts = {}
    city_ids = set()
    input_count = 0
    clipped_count = 0
    all_roof_diffs = []
    resolution = project["processing"]["resolution_m"]
    width = int((bbox[2] - bbox[0]) / resolution)
    height = int((bbox[3] - bbox[1]) / resolution)
    dtm = np.fromfile(root / "public/data/dtm.bin", dtype="<u2").reshape(height, width)
    roofs = np.flipud(gdal.Open(str(root / "data/derived/buildings.tif")).ReadAsArray())
    gpkg = root / "data/derived/lod2-roofs.gpkg"
    gpkg.unlink(missing_ok=True)
    ds = ogr.GetDriverByName("GPKG").CreateDataSource(str(gpkg))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3067)
    layer = ds.CreateLayer("roof_surfaces", srs, ogr.wkbPolygon25D)
    layer.CreateField(ogr.FieldDefn("city_id", ogr.OFTString))
    layer.CreateField(ogr.FieldDefn("height_m", ogr.OFTReal))
    ds.StartTransaction()
    roof_count = 0
    mins = np.full(3, np.inf)
    maxs = -mins
    for uri, tile_transform in sorted(selected.items()):
        _, x, y = uri.split("/")
        print("LoD2", uri, flush=True)
        for material, triangles, ids in decode_b3dm(
            source / (x + "-" + y), tile_transform
        ):
            input_count += len(triangles)
            low = triangles.min(axis=1)
            high = triangles.max(axis=1)
            candidates = (
                (high[:, 0] >= bbox[0])
                & (low[:, 0] <= bbox[2])
                & (high[:, 1] >= bbox[1])
                & (low[:, 1] <= bbox[3])
            )
            for triangle, city_id in zip(triangles[candidates], ids[candidates]):
                for clipped in clip_triangle(triangle, bbox):
                    if (
                        np.linalg.norm(
                            np.cross(clipped[1] - clipped[0], clipped[2] - clipped[0])
                        )
                        < 1e-8
                    ):
                        continue
                    parts.setdefault(material, []).append(clipped[None, :, :])
                    city_ids.add(str(city_id))
                    clipped_count += 1
                    mins = np.minimum(mins, clipped.min(axis=0))
                    maxs = np.maximum(maxs, clipped.max(axis=0))
                    cross = np.cross(clipped[1] - clipped[0], clipped[2] - clipped[0])
                    normal = cross / np.linalg.norm(cross)
                    if normal[2] > 0.3:
                        centre = clipped.mean(axis=0)
                        col = int((centre[0] - bbox[0]) / resolution)
                        row = int((centre[1] - bbox[1]) / resolution)
                        if 0 <= col < width and 0 <= row < height:
                            measured = roofs[row, col]
                            ground = dtm[row, col] * 0.1 - 10
                            if (
                                measured != -9999
                                and np.isfinite(measured)
                                and centre[2] > ground + 2
                            ):
                                all_roof_diffs.append(float(centre[2] - measured))
                        ring = ogr.Geometry(ogr.wkbLinearRing)
                        for xyz in [*clipped, clipped[0]]:
                            ring.AddPoint(*xyz)
                        polygon = ogr.Geometry(ogr.wkbPolygon25D)
                        polygon.AddGeometry(ring)
                        f = ogr.Feature(layer.GetLayerDefn())
                        f.SetField("city_id", str(city_id))
                        f.SetField("height_m", float(centre[2]))
                        f.SetGeometry(polygon)
                        layer.CreateFeature(f)
                        roof_count += 1
    ds.CommitTransaction()
    ds = None
    if not parts:
        raise ValueError("No source buildings intersect AOI")
    triangles, collapsed = write_glb(root / "public/data/buildings.glb", parts, bbox)
    differences = np.asarray(all_roof_diffs)
    stats = dict(
        source="City of Helsinki official untextured LoD2",
        sourceTilesetVersion=tileset["asset"]["tilesetVersion"],
        acquisitionEpoch="unknown; continuously maintained model; HTTP export 2026-05-11",
        licence="CC BY 4.0",
        sourceDocumentation=DOC,
        tilesMatched=len(selected),
        tilesReturned=len(locked),
        cityBuildingIds=sorted(city_ids),
        buildingCount=len(city_ids),
        inputTriangles=input_count,
        clippedTriangles=clipped_count,
        publishedTriangles=triangles,
        quantizationCollapsed=collapsed,
        quantizationMetres=0.02,
        boundsEPSG3067N2000=[mins.tolist(), maxs.tolist()],
        roofFaces=roof_count,
        alignment=dict(
            samples=len(differences),
            medianRoofMinus2021DSM=float(np.median(differences)),
            medianAbsoluteDifference=float(np.median(np.abs(differences))),
            p95AbsoluteDifference=float(np.quantile(np.abs(differences), 0.95)),
            note="Independent epochs and roof details differ; no vertical fitting or DSM modification.",
        ),
        renderingVersusAnalysis="This mesh is display context; the 2021 LiDAR DSM alone determines LOS.",
        glbBytes=(root / "public/data/buildings.glb").stat().st_size,
    )
    (root / "public/data/building-mesh.json").write_text(
        json.dumps(stats, indent=2) + "\n"
    )
    return stats

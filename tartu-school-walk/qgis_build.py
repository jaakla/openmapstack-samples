"""Build and verify project.qgz with the real QGIS API (PyQGIS).

Called by view.write_qgis_project() in a subprocess, under whichever Python
interpreter can `import qgis` (it is usually not the pipeline's interpreter):

    python3 qgis_build.py <spec.json> <result.json>

The spec is the layer tree view.py derived from project.yaml. This script holds
no analysis and no styling decisions of its own. After writing the project it
reopens it from a different working directory and checks what a reader would
see: a valid project CRS, every layer valid with features, and every analysis
layer actually painting pixels.
"""

import json
import os
import sys
import tempfile

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from qgis.core import (  # noqa: E402
    Qgis, QgsApplication, QgsCategorizedSymbolRenderer, QgsCoordinateReferenceSystem, QgsFillSymbol,
    QgsLineSymbol, QgsMapRendererSequentialJob, QgsMapSettings, QgsMarkerSymbol, QgsProject, QgsRasterLayer,
    QgsNetworkAccessManager, QgsRectangle, QgsRendererCategory, QgsSingleSymbolRenderer, QgsVectorLayer,
)
from qgis.PyQt.QtNetwork import QNetworkProxy  # noqa: E402
from qgis.PyQt.QtCore import QSize  # noqa: E402
from qgis.PyQt.QtGui import QColor  # noqa: E402

SYMBOL = {"fill": QgsFillSymbol, "line": QgsLineSymbol, "marker": QgsMarkerSymbol}


def make_symbol(spec):
    symbol = SYMBOL[spec["kind"]].createSimple(spec["props"])
    symbol.setOpacity(float(spec.get("alpha", 1)))
    return symbol


def make_renderer(spec):
    if spec["type"] == "single":
        return QgsSingleSymbolRenderer(make_symbol(spec["symbol"]))
    categories = [QgsRendererCategory(c["value"], make_symbol(c["symbol"]), c["label"]) for c in spec["categories"]]
    return QgsCategorizedSymbolRenderer(spec["attr"], categories)


def painted_pixels(layers, extent, crs):
    settings = QgsMapSettings()
    settings.setLayers(layers)
    settings.setDestinationCrs(crs)
    settings.setExtent(extent)
    settings.setOutputSize(QSize(700, 560))
    settings.setBackgroundColor(QColor(255, 255, 255))
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    image = job.renderedImage()
    count = 0
    for y in range(0, image.height(), 2):
        for x in range(0, image.width(), 2):
            if image.pixel(x, y) != 0xFFFFFFFF:
                count += 1
    return count


def use_environment_proxy():
    """QGIS does not read HTTPS_PROXY; without this a proxied build cannot reach any basemap."""
    from urllib.parse import urlparse
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not proxy:
        return
    parsed = urlparse(proxy)
    qt_proxy = QNetworkProxy(QNetworkProxy.HttpProxy, parsed.hostname, parsed.port or 8080,
                             parsed.username or "", parsed.password or "")
    QNetworkProxy.setApplicationProxy(qt_proxy)
    QgsNetworkAccessManager.instance().setFallbackProxyAndExcludes(qt_proxy, [], [])


def main(spec_path, result_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    root = spec["root"]
    app = QgsApplication([], False)
    app.initQgis()
    use_environment_proxy()
    result = {"mode": "pyqgis", "qgis_version": Qgis.QGIS_VERSION, "layers": [], "basemaps": []}

    os.chdir(root)
    project = QgsProject.instance()
    project.clear()
    crs = QgsCoordinateReferenceSystem(spec["crs"])
    project.setCrs(crs)
    project.setTitle(spec["title"])
    tree = project.layerTreeRoot()
    # A QGIS layer tree paints its FIRST entry on top: the spec is already in
    # top-to-bottom order (reverse of presentation.map.layers), basemaps last.
    for group_spec in spec["groups"]:
        group = tree.addGroup(group_spec["title"])
        group.setExpanded(bool(group_spec.get("expanded", True)))
        for layer_spec in group_spec["layers"]:
            uri = os.path.join(root, layer_spec["file"])
            if layer_spec.get("layername"):
                uri += "|layername=" + layer_spec["layername"]
            layer = QgsVectorLayer(uri, layer_spec["name"], "ogr")
            if layer_spec.get("subset"):
                layer.setSubsetString(layer_spec["subset"])
            layer.setRenderer(make_renderer(layer_spec["renderer"]))
            # A layer saved without a CRS is assumed to be in the project CRS and never
            # reprojected. The provider does not always hand one over in a headless
            # session, so the CRS the pipeline wrote (and checks in the file) is stated.
            if not layer.crs().isValid():
                layer.setCrs(QgsCoordinateReferenceSystem("EPSG:%d" % layer_spec["srid"]))
            project.addMapLayer(layer, False)
            node = group.addLayer(layer)
            node.setItemVisibilityChecked(bool(layer_spec.get("visible", True)))
    base_group = tree.addGroup("Basemaps")
    for base in spec["basemaps"]:
        layer = QgsRasterLayer(base["uri"], base["name"], "wms")
        if not layer.crs().isValid():
            layer.setCrs(QgsCoordinateReferenceSystem("EPSG:%d" % base["srid"]))
        project.addMapLayer(layer, False)
        node = base_group.addLayer(layer)
        node.setItemVisibilityChecked(bool(base["checked"]))

    target = os.path.join(root, spec["output"])
    written = project.write(target)
    result["written"] = bool(written)

    # Reopen from somewhere else: relative datasources must still resolve.
    os.chdir(tempfile.gettempdir())
    project.clear()
    result["reopened"] = bool(project.read(target))
    result["project_crs"] = project.crs().authid()
    result["project_crs_valid"] = project.crs().isValid()
    extent = QgsRectangle(*spec["extent"])
    by_name = {layer.name(): layer for layer in project.mapLayers().values()}
    for group_spec in spec["groups"]:
        for layer_spec in group_spec["layers"]:
            layer = by_name.get(layer_spec["name"])
            entry = {"name": layer_spec["name"], "group": group_spec["title"], "found": layer is not None}
            if layer is not None:
                entry.update(valid=layer.isValid(), crs=layer.crs().authid(), crs_valid=layer.crs().isValid(),
                             features=int(layer.featureCount()), spatial=layer.isSpatial(),
                             painted_pixels=painted_pixels([layer], extent, project.crs()) if layer.isValid() else 0)
            result["layers"].append(entry)
    for base in spec["basemaps"]:
        layer = by_name.get(base["name"])
        result["basemaps"].append({"name": base["name"], "found": layer is not None,
                                   "valid": bool(layer and layer.isValid()),
                                   "crs": layer.crs().authid() if layer else None,
                                   "crs_valid": bool(layer and layer.crs().isValid()),
                                   "painted_pixels": painted_pixels([layer], extent, project.crs()) if layer and layer.isValid() else 0,
                                   "checked": bool(base["checked"])})
    result["tree_groups"] = [group.name() for group in project.layerTreeRoot().findGroups()]
    json.dump(result, open(result_path, "w", encoding="utf-8"), indent=2)
    app.exitQgis()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

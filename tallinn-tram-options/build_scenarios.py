"""Write the scenario geometry of every tram option to data/overrides/options/<id>.geojson.

Authoring tool, NOT part of the canonical run. scenarios/tram-options.yaml declares each
option by named waypoints and streets; this script routes them with the pipeline's own
step 7 and stores the resulting lines as override geometry (geometry_origin: scenario). Run it
after editing the definition file. pipeline.py then re-routes every definition and rejects an
option whose stored geometry and definition disagree.

    python build_scenarios.py
"""
from __future__ import annotations

import json
import sys
import types

sys.modules.setdefault("view", types.ModuleType("view"))   # the views are not needed here
import geopandas as gpd
import shapely
import yaml

import pipeline as p


def main() -> None:
    p.WRITE_SCENARIOS = True
    _, sub, _ = p.load_admin()
    buildings = p.load_buildings(p.load_population_grid(), sub)
    definitions = yaml.safe_load((p.ROOT / "scenarios" / "tram-options.yaml").read_text(encoding="utf-8"))
    lines, _, results = p.route_options(definitions, p.build_network(), p.load_gtfs(), buildings)
    folder = p.OVERRIDES / "options"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.geojson"):
        old.unlink()
    for result in results:
        if result["status"] != "applied":
            print(f"REJECTED {result['option']}: {result.get('reason')}")
            continue
        row = lines[lines["option"] == result["option"]].iloc[0]
        geometry = gpd.GeoSeries([row.geometry], crs=p.ANALYSIS_CRS).to_crs(p.STORAGE_CRS).iloc[0]
        geometry = shapely.set_precision(geometry, 1e-7)
        feature = {"type": "Feature", "geometry": json.loads(shapely.to_geojson(geometry)),
                   "properties": {"option": row.option, "name": row.title, "status": "hypothetical", "geometry_origin": "scenario",
                                  "definition": "scenarios/tram-options.yaml", "length_km": row.length_km,
                                  "declared_street_share": row.declared_street_share, "follows": row.follows}}
        (folder / f"{row.option}.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"written  {row.option:22s} {row.length_km:5.2f} km")
    if any(r["status"] != "applied" for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()

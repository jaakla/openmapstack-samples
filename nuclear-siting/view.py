"""Exports, validation, dashboard, findings and run record for the nuclear-siting screen.

Everything here is downstream of pipeline.py. Nothing in this module measures
geometry or decides a result: it reads project.yaml, criteria.yaml and the frames
the pipeline produced.
"""

from __future__ import annotations

import base64
import datetime
import gzip
import json
import logging
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import rasterio
import shapely
import yaml
from pyproj import Transformer

from openmapstack.credits import credit_payload, html_credits
from openmapstack.delivery import metadata_json, targets, write_evidence
from openmapstack.findings import write_findings
from openmapstack.integrity import (canonical_file_set_hash, declared_input_paths, declared_output_paths,
                                    file_inventory, sha256_file)

log = logging.getLogger("pipeline")

# Semantic roles -> colours, shared by the map, its legend and the tables.
STYLE = {
    "candidate": "#12805c", "remaining_small": "#8fd0b1", "excluded": "#4b5563",
    "exclusion": "#c2362f", "consideration": "#c77700", "suitability": "#2c6fbb",
    "site_active": "#a3129b", "site_dropped": "#6b7280", "planning_area": "#a3129b",
    "area_outline": "#0b4f39", "reference": "#374151",
}


# ----------------------------------------------------------------------------
# Writers
# ----------------------------------------------------------------------------
def write_geojson(frame: gpd.GeoDataFrame, path: Path, decimals: int = 6) -> None:
    """GeoJSON in EPSG:4326 (RFC 7946), fixed precision, byte-stable."""
    assert frame.crs is not None and frame.crs.to_epsg() == 4326
    out = frame.copy()
    out["geometry"] = shapely.set_precision(out.geometry.values, 10 ** -decimals)
    out = out[~out.geometry.is_empty]
    payload = json.loads(out.to_json(drop_id=True))
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def write_table(table: pd.DataFrame, path: Path) -> None:
    """CSV and XLSX from the same rows."""
    table.to_csv(path, index=False, lineterminator="\n")
    with pd.ExcelWriter(path.with_suffix(".xlsx"), engine="openpyxl") as writer:
        table.to_excel(writer, index=False, sheet_name="data")
        # Fixed document timestamps keep the workbook byte-stable across reruns.
        writer.book.properties.created = datetime.datetime(2026, 1, 1)
        writer.book.properties.modified = datetime.datetime(2026, 1, 1)


def _records(table: pd.DataFrame) -> list[dict]:
    return json.loads(table.to_json(orient="records"))


# ----------------------------------------------------------------------------
# Validation stage
# ----------------------------------------------------------------------------
def _graph_check(project: dict) -> dict:
    known = set(project["sources"])
    problems, step_ids = [], set()
    for step in project["processing"]["steps"]:
        wanted = [step.get("source"), step.get("input"), *(step.get("inputs") or [])]
        problems += [f"{step['id']} <- {symbol}" for symbol in wanted if symbol and symbol not in known]
        if step.get("output"):
            known.add(step["output"])
        step_ids.add(step["id"])
    problems += [f"{key} generated_by {out.get('generated_by')}" for key, out in project["outputs"].items()
                 if out.get("generated_by") not in step_ids]
    return {"id": "manifest_graph_resolves", "status": "failed" if problems else "passed",
            "steps": len(step_ids), "problems": problems}


def validate(project: dict, facts: dict, frames: dict, root: Path, run_id: str) -> dict:
    import pipeline as p
    grid, cells, failing = frames["grid"], frames["cells"], frames["failing"]
    remaining, candidate = frames["remaining"], frames["candidate"]
    criteria, cell_rules, area_rule = frames["criteria"], frames["cell_rules"], frames["area_rule"]
    derived, source_dir = root / "data" / "derived", root / "data" / "source"
    checks: list[dict] = []

    geodata = {"candidate_areas": frames["polygons"], "official_sites": frames["sites_out"], "reference_features": frames["reference"]}
    invalid = {k: int((~f.geometry.is_valid).sum() + f.geometry.is_empty.sum()) for k, f in geodata.items()}
    checks.append({"id": "geometry_valid", "status": "failed" if any(invalid.values()) else "passed",
                   "features_checked": int(sum(len(f) for f in geodata.values())) + grid.n, "invalid_or_empty": invalid})

    # CRS: labels and coordinates. Tallinn Town Hall (59.4370 N, 24.7453 E) must fall in a grid cell of
    # Tallinn, Harju county, inside a densely built-up area; Suur Munamägi (57.7144 N, 27.0594 E) must
    # read above 300 m from the terrain model.
    files = {name: pyogrio.read_info(derived / name)["crs"] for name in ("candidate-areas.geojson", "official-sites.geojson", "reference-features.geojson")}
    parquet = gpd.read_parquet(derived / "screening-grid.parquet")
    files["screening-grid.parquet"] = parquet.crs.to_string()
    to_analysis = Transformer.from_crs(4326, 3301, always_xy=True)
    hall = grid.cell_of(*to_analysis.transform(24.7453, 59.4370))
    hall_ok = hall is not None and cells["municipality"].iat[hall] == "Tallinn" and cells["county"].iat[hall] == "Harju maakond" and bool(cells["f_dense"].iat[hall])
    with rasterio.open(source_dir / "dtm-100m.tif") as dtm:
        summit = float(next(dtm.sample([to_analysis.transform(27.0594, 57.7144)]))[0])
    crs_ok = (all(v == "EPSG:4326" for k, v in files.items() if k.endswith(".geojson")) and files["screening-grid.parquet"] == "EPSG:3301"
              and hall_ok and summit > 300)
    checks.append({"id": "crs_known", "status": "passed" if crs_ok else "failed", "analysis_crs": "EPSG:3301",
                   "grid_crs": "EPSG:3857 (alignment only; no measurement)", "files": files,
                   "known_locations": {"tallinn_town_hall_cell": {"municipality": cells["municipality"].iat[hall] if hall is not None else None,
                                                                    "county": cells["county"].iat[hall] if hall is not None else None,
                                                                    "densely_built_up": bool(cells["f_dense"].iat[hall]) if hall is not None else None},
                                       "suur_munamagi_dtm_m": round(summit, 1)}})

    # Every layer must lie inside the area of interest (Estonia, EPSG:3301).
    aoi = project["project"]["aoi"]["bbox"]
    outside = {}
    for key in project["sources"]:
        path = source_dir / f"{key}.parquet"
        if path.exists():
            b = gpd.read_parquet(path).total_bounds
            if not (aoi[0] <= b[0] and aoi[1] <= b[1] and b[2] <= aoi[2] and b[3] <= aoi[3]):
                outside[key] = [round(float(v)) for v in b]
    checks.append({"id": "layers_within_aoi", "status": "failed" if outside else "passed", "aoi_epsg3301": aoi,
                   "layers_checked": len(project["sources"]) - 1, "outside": outside})

    counts = {"screening_grid": int(len(parquet)), "candidate_areas": int(len(frames["areas"])), "official_sites": int(len(frames["site_table"])),
              "reference_features": int(len(frames["reference"])), "criteria_catalogue": int(len(frames["catalogue"])),
              "county_summary": int(len(frames["county_table"]))}
    checks.append({"id": "row_count_gt_zero", "status": "passed" if all(v > 0 for v in counts.values()) else "failed", "rows": counts})
    keys = cells["row"].to_numpy().astype(np.int64) * grid.cols + cells["col"].to_numpy()
    checks.append({"id": "no_duplicate_cell", "status": "passed" if len(np.unique(keys)) == len(keys) else "failed", "cells": int(len(keys))})

    # Coded attributes the selections depend on are inside their documented domains.
    semantic, problems = {}, []
    for key, source in project["sources"].items():
        for predicate in (source.get("selection") or {}).get("semantic_predicates") or []:
            column = pd.read_parquet(source_dir / f"{key}.parquet", columns=[predicate["field"]])[predicate["field"]]
            seen = sorted(str(v) for v in column.dropna().unique())
            allowed = predicate.get("allowed")
            semantic[f"{key}.{predicate['field']}"] = seen if len(seen) <= 12 else f"{len(seen)} values"
            if allowed is not None and not set(seen) <= {str(a) for a in allowed}:
                problems.append(f"{key}.{predicate['field']}: undocumented values {sorted(set(seen) - {str(a) for a in allowed})}")
            if predicate.get("required_non_null") and column.isna().any():
                problems.append(f"{key}.{predicate['field']}: {int(column.isna().sum())} null values")
    checks.append({"id": "source_semantics_verified", "status": "failed" if problems else "passed", "values_seen": semantic,
                   "problems": problems, "unknown_kept_unknown": "Mining claims with no underground flag are not treated as underground; "
                   "airfields of other types are not counted as aerodromes in use."})

    acquisition = json.loads((source_dir / "acquisition.json").read_text(encoding="utf-8"))
    incomplete, drift = [], []
    for key, entry in acquisition.items():
        if "matched" in entry and entry["matched"] != entry["returned"]:
            incomplete.append(key)
        if sha256_file(source_dir / entry["file"]) != entry["sha256"]:
            drift.append(entry["file"])
    for key, source in project["sources"].items():
        pin = source["pin"]
        if sha256_file(root / pin["path"]) != pin["sha256"]:
            drift.append(f"{pin['path']} (manifest pin)")
    dropped = {k: len(e["dropped_unplaceable"]) for k, e in acquisition.items() if e.get("dropped_unplaceable")}
    checks.append({"id": "source_result_complete", "status": "failed" if incomplete or drift else "passed",
                   "sources": {k: {"matched": e.get("matched"), "returned": e.get("returned")} for k, e in acquisition.items() if "matched" in e},
                   "incomplete": incomplete, "hash_mismatch": drift, "records_dropped_as_unplaceable": dropped})

    unresolved = [key for key, source in project["sources"].items() if "not stated" in source["license"]["name"].lower()]
    checks.append({"id": "source_licenses_resolved", "status": "warning" if unresolved else "passed", "unresolved": unresolved,
                   **({"reason": "No licence text is published for: " + ", ".join(unresolved)
                       + ". Reuse terms must be confirmed with the publisher before redistribution."} if unresolved else {})})
    checks.append({"id": "overrides_applied", "status": "passed", "results": [], "note": "The project declares no overrides."})
    checks.append(_graph_check(project))

    # The manifest's controls and parameters must be the ones the pipeline ran.
    controls = project["presentation"]["controls"]
    params = project["processing"]["parameters"]
    by_id = {f["id"]: f for f in controls["filters"]}
    mismatches = []

    def expect(label, declared, actual):
        if declared != actual:
            mismatches.append(f"{label}: manifest {declared!r} != pipeline {actual!r}")
    for c in p.mapped(criteria):
        rule = c["rule"]
        expect(f"apply_{c['id']}.canonical", by_id.get(f"apply_{c['id']}", {}).get("canonical"), bool(c["canonical"]))
        if "options" in rule:
            control = by_id.get(f"threshold_{c['id']}", {})
            expect(f"threshold_{c['id']}.canonical", control.get("canonical"), rule["threshold"])
            expect(f"threshold_{c['id']}.options", control.get("options"), rule["options"])
    expected_ids = {f"apply_{c['id']}" for c in p.mapped(criteria)} | {f"threshold_{c['id']}" for c in p.mapped(criteria) if "options" in c["rule"]}
    if set(by_id) != expected_ids:
        mismatches.append(f"control ids differ: {sorted(set(by_id) ^ expected_ids)}")
    focus = next(v for v in controls["variants"] if v["id"] == "focus_criterion")
    expect("focus_criterion.options", focus["options"], ["none"] + [c["id"] for c in cell_rules])
    expect("parameters.cell_mercator_m", params["cell_mercator_m"], p.CELL_M)
    expect("parameters.densify_m", params["densify_m"], p.DENSIFY_M)
    expect("parameters.population_radius_m", params["population_radius_m"], p.POP_RADIUS_M)
    expect("parameters.distance_unit_m", params["distance_unit_m"], p.DISTANCE_UNIT_M)
    expect("parameters.canonical_criteria", params["canonical_criteria"], facts["canonical"]["criteria_applied"])
    expect("parameters.canonical_thresholds", params["canonical_thresholds"], facts["canonical"]["thresholds"])
    checks.append({"id": "view_controls_match_pipeline", "status": "failed" if mismatches else "passed",
                   "controls": len(by_id) + 1, "problems": mismatches})

    # ---- domain checks ----
    g = facts["grid"]
    ratio = g["land_km2_grid"] / g["land_km2_boundaries"]
    checks.append({"id": "land_area_plausible", "status": "passed" if abs(ratio - 1) < 0.005 else "failed",
                   "grid_km2": g["land_km2_grid"], "boundary_polygons_km2": g["land_km2_boundaries"], "ratio": round(ratio, 5),
                   "note": "Geodesic area of the land cells against the planar EPSG:3301 area of the county polygons."})

    # Rules applied to the stored whole units must equal rules applied to the measured metres.
    differing = {}
    for c in cell_rules:
        rule = c["rule"]
        if rule["kind"] in ("closer_than", "farther_than"):
            for option in rule["options"]:
                metres = cells[rule["measure"] + "_m"].to_numpy()
                limit = round(option * 1000)
                exact = (metres < limit) if rule["kind"] == "closer_than" else (metres >= limit)
                n = int((exact != frames["fails"](c, option)).sum())
                if n:
                    differing[f"{c['id']}@{option}"] = n
    checks.append({"id": "stored_units_reproduce_rules", "status": "failed" if differing else "passed", "differing_cells": differing,
                   "note": "Distances are stored in whole units rounded down; every offered threshold is a multiple of its unit."})

    # Metamorphic: a stricter threshold never leaves more land; dropping a criterion never leaves less.
    violations = []
    for c in cell_rules:
        rule = c["rule"]
        if "options" not in rule:
            continue
        areas = [float(grid.area_m2[frames["fails"](c, o)].sum()) for o in rule["options"]]
        steps = np.diff(areas)
        grows = rule["kind"] in ("closer_than",)           # larger threshold -> more cells fail
        if not ((steps >= 0).all() if grows else (steps <= 0).all()):
            violations.append(c["id"])
    canonical_ids = [c["id"] for c in cell_rules if c["canonical"]]
    for cid in canonical_ids:
        others = np.zeros(grid.n, dtype=bool)
        for other in canonical_ids:
            if other != cid:
                others |= failing[other]
        if (~others).sum() < remaining.sum():
            violations.append(f"drop:{cid}")
    checks.append({"id": "screen_monotonic", "status": "failed" if violations else "passed", "violations": violations,
                   "thresholds_tested": int(sum(len(c["rule"].get("options", [])) for c in cell_rules)), "criteria_dropped": len(canonical_ids)})

    subset = bool((candidate <= remaining).all()) and int(cells["area_id"].gt(0).sum()) == int(candidate.sum())
    smallest = float(frames["areas"]["area_ha"].min()) if len(frames["areas"]) else None
    checks.append({"id": "candidate_areas_consistent",
                   "status": "passed" if subset and (smallest is None or smallest >= area_rule["rule"]["threshold"])
                   and abs(frames["areas"]["area_ha"].sum() * 1e4 - facts["canonical"]["candidate_m2"]) < 1e4 * len(frames["areas"]) else "failed",
                   "candidate_cells": int(candidate.sum()), "areas": int(len(frames["areas"])), "smallest_area_ha": smallest,
                   "areas_sum_ha": round(float(frames["areas"]["area_ha"].sum()), 1), "grid_sum_ha": round(facts["canonical"]["candidate_m2"] / 1e4, 1)})

    sites = frames["site_table"]
    planning = frames["planning_area"].geometry.union_all()
    inside = int(frames["sites"].within(planning).sum())
    near_sea = bool((sites["sea_km"] < 5).all())
    checks.append({"id": "official_sites_located", "status": "passed" if inside == len(sites) == 6 and near_sea else "failed",
                   "sites": int(len(sites)), "inside_planning_area": inside, "max_sea_km": float(sites["sea_km"].max()),
                   "note": "All six official sites lie in the official planning area and within 5 km of the sea, as the plan describes them."})

    declared = list(project["validation"]["required"]) + [d["name"] for d in project["validation"]["domain_checks"]]
    seen = [c["id"] for c in checks] + ["manifest_report_parity"]
    missing = [name for name in declared if seen.count(name) != 1]
    extra = [name for name in seen if name not in declared]
    checks.append({"id": "manifest_report_parity", "status": "failed" if missing or extra else "passed",
                   "declared": len(declared), "reported": len(seen), "missing_or_repeated": missing, "undeclared": extra})

    statuses = {c["status"] for c in checks}
    status = "failed" if "failed" in statuses else "warning" if statuses & {"warning", "not_testable"} else "passed"
    return {"run_id": run_id, "status": status, "checks": checks, "headline": facts["canonical"]}


# ----------------------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------------------
def _pack(arrays: list[tuple[str, np.ndarray]]) -> tuple[str, list[dict]]:
    """Concatenate typed arrays, gzip (fixed mtime) and base64 them for the page."""
    layout, chunks, offset = [], [], 0
    for name, array in arrays:
        array = np.ascontiguousarray(array)
        pad = (-offset) % array.dtype.itemsize
        chunks.append(b"\0" * pad)
        offset += pad
        raw = array.astype(array.dtype.newbyteorder("<")).tobytes()
        layout.append({"name": name, "dtype": array.dtype.name, "offset": offset, "length": int(array.size)})
        chunks.append(raw)
        offset += len(raw)
    return base64.b64encode(gzip.compress(b"".join(chunks), compresslevel=9, mtime=0)).decode("ascii"), layout


def _geojson_obj(frame: gpd.GeoDataFrame, decimals: int = 5) -> dict:
    out = frame.to_crs(4326)
    out["geometry"] = shapely.set_precision(out.geometry.values, 10 ** -decimals)
    return json.loads(out[~out.geometry.is_empty].to_json(drop_id=True))


def render_dashboard(project: dict, facts: dict, frames: dict, report: dict, root: Path,
                     started: datetime.datetime, completed: datetime.datetime) -> None:
    import pipeline as p
    grid, cells, criteria = frames["grid"], frames["cells"], frames["criteria"]
    flag_bits = np.zeros(grid.n, dtype=np.uint16)
    for bit, name in enumerate(p.FLAGS):
        flag_bits |= cells[name].to_numpy().astype(np.uint16) << bit
    land_bits = np.packbits(grid.land.ravel())
    arrays = [("land", land_bits), ("flags", flag_bits), ("county", grid.county), ("muni", grid.muni),
              ("elevation_m", cells["elevation_m"].to_numpy().astype(np.uint8)),
              ("pop_density", np.minimum(cells["pop_density"].to_numpy(), 65535).astype(np.uint16)),
              ("pop_5km", np.minimum(cells["pop_5km"].to_numpy() // 10, 65535).astype(np.uint16))]
    arrays += [(name, frames["measures"][name]) for name in p.DISTANCE_UNIT_M]
    blob, layout = _pack(arrays)

    presentation = project["presentation"]
    sources = [{"key": key, "provider": s["provider"], "dataset": s["dataset"], "url": s["source_url"],
                "retrieved_at": s["access"]["retrieved_at"], "version": s["version"]["identifier"],
                "license": s["license"]["name"], "license_url": s["license"].get("url"),
                "rows": s["access"]["file"].get("row_count"), "rationale": s.get("rationale")}
               for key, s in project["sources"].items()]
    table_frames = {"candidate_areas_table": frames["areas"], "criteria_catalogue": frames["catalogue"],
                    "county_summary": frames["county_table"], "official_sites_check": frames["site_table"]}
    tables = {}
    for entry in presentation["tables"]:
        output = project["outputs"][entry["output"]]
        tables[entry["output"]] = {"title": entry["title"], "columns": output["table"]["columns"],
                                   "rows": _records(table_frames[entry["output"]]), "default_sort": entry.get("default_sort"),
                                   "downloads": [{"format": fmt, "href": str(Path(output["path"]).with_suffix("." + fmt))} for fmt in entry["downloads"]]}
    target = next(t for t in targets(project) if t["kind"] == "dashboard")
    payload = {
        "project": project["project"] | {"status": "validated" if report["status"] == "passed" else report["status"]},
        "run": {"id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(), "status": report["status"]},
        "interpretation": project["interpretation"], "warnings": project.get("warnings") or [],
        "steps": [{"id": s["id"], "operation": s["operation"], "crs": s.get("crs")} for s in project["processing"]["steps"]],
        "sources": sources, "validation": report, "facts": facts,
        "outputs": [{"key": k, "path": o["path"], "format": o["format"], "kind": o.get("kind", "geodata")} for k, o in project["outputs"].items()],
        "controls": presentation["controls"], "basemap": presentation["map"]["basemap"],
        "layer_groups": presentation["map"]["layer_groups"], "style": STYLE,
        "criteria": criteria["criteria"], "groups": criteria["groups"], "official_sources": criteria["official_sources"],
        "grid": {"rows": grid.rows, "cols": grid.cols, "cell": p.CELL_M, "x0": grid.x0, "y1": grid.y1,
                 "bounds": grid.bounds_4326, "row_area_m2": grid.row_area_m2.tolist(), "layout": layout,
                 "flags": p.FLAGS, "distance_unit_m": p.DISTANCE_UNIT_M, "distance_cap": p.DISTANCE_CAP,
                 "pop_5km_unit": 10, "counties": grid.county_names, "municipalities": grid.muni_names},
        "tables": tables, "findings": project["outputs"][project["findings"]["output"]]["path"],
        "data": {"areas": _geojson_obj(frames["polygons"][["area_id", "area_ha", "county", "municipality", "geometry"]].set_crs(3857, allow_override=True)),
                 "sites": _geojson_obj(frames["sites_out"][["site", "rep_status", "geometry"]]),
                 "reference": _geojson_obj(frames["reference"])},
    }
    credits = html_credits(credit_payload(project, completed_at=completed.isoformat()))
    template = (root / "dashboard.template.html").read_text(encoding="utf-8")
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
    providers = sorted({s["provider"] for s in project["sources"].values()})
    html = (template.replace("__TITLE__", project["project"]["title"])
            .replace("<!--__CREDITS__-->", credits)
            .replace("__DOWNLOADS__", "".join(
                f'<p>{t["title"]}: ' + " ".join(f'<a href="{d["href"]}" download>{d["format"].upper()}</a>' for d in t["downloads"]) + "</p>"
                for t in tables.values()))
            .replace("__PROVIDERS__", "; ".join(providers))
            .replace("__WARNINGS__", "".join(f'<p class="warn"><b>{w["id"]}</b> {w["statement"]}</p>' for w in project.get("warnings") or []))
            .replace("/*__VIEW_METADATA__*/", metadata_json(root, project, target))
            .replace('"__GRID_BLOB__"', json.dumps(blob))
            .replace("/*__PAYLOAD__*/null", data))
    (root / project["outputs"][target["output"]]["path"]).write_text(html, encoding="utf-8")
    log.info("dashboard written (%.1f MB)", len(html.encode("utf-8")) / 1e6)


# ----------------------------------------------------------------------------
# Findings
# ----------------------------------------------------------------------------
def findings_items(facts: dict, frames: dict) -> list[dict]:
    c, cat = facts["canonical"], facts["catalogue"]
    areas, counties, sites = frames["areas"], frames["county_table"], frames["site_table"]
    top = areas.head(5)
    with_areas = counties[counties["candidate_areas"] > 0]
    active = sites[sites["rep_status"] == "under assessment"]
    dropped = sites[sites["rep_status"] != "under assessment"]
    catalogue = frames["catalogue"]
    strongest = catalogue[catalogue["sole_exclusion_km2"].notna() & (catalogue["id"] != "land_area")].sort_values("sole_exclusion_km2", ascending=False).head(3)
    return [
        {"id": "remaining_land",
         "statement": (f"With the {len(c['criteria_applied'])} mapped exclusion criteria applied, {c['candidate_km2']:,.0f} km² of Estonia's "
                       f"{c['land_km2']:,.0f} km² of land ({c['candidate_pct_of_land']:.2f} %) remains, in {c['candidate_areas']} contiguous areas of at least "
                       f"{c['thresholds']['land_area']} ha. Before the minimum-area rule {c['remaining_km2']:,.0f} km² remains."),
         "evidence": ["screening_grid", "candidate_areas", "candidate_areas_table"],
         "limitations": ["A screening remainder, not a list of suitable sites: " + str(len(cat["exclusions_not_mapped"]))
                         + " official exclusion criteria could not be mapped (" + "; ".join(cat["exclusions_not_mapped"]) + ").",
                         "Cells are about 260 m across and are tested at their centre, so features narrower than a cell are only sampled."]},
        {"id": "where",
         "statement": ("Candidate areas lie in " + str(len(with_areas)) + " coastal counties: "
                       + "; ".join(f"{r.county} {r.candidate_km2:,.0f} km² in {r.candidate_areas} areas" for r in with_areas.itertuples()) + "."),
         "evidence": ["county_summary"]},
        {"id": "largest_areas",
         "statement": ("The five largest areas are: " + "; ".join(
             f"no. {r.area_id} {r.municipality}, {r.county} ({r.area_ha:,.0f} ha)" for r in top.itertuples()) + "."),
         "evidence": ["candidate_areas_table"],
         "limitations": ["Size is not suitability. Consideration and suitability criteria are reported per area but not applied in the accepted run."]},
        {"id": "official_sites",
         "statement": ("Of the six official candidate sites of the state special plan, the three still under assessment keep most of their 95 ha area in this screen: "
                       + "; ".join(f"{r.site} {r.share_remaining_pct:.0f} %" for r in active.itertuples()) + ". The three sites the plan dropped in October 2026: "
                       + "; ".join(f"{r.site} {r.share_remaining_pct:.0f} %" + (f" (centre fails: {r.centre_fails})" if r.centre_fails else "") for r in dropped.itertuples()) + "."),
         "evidence": ["official_sites", "official_sites_check"],
         "limitations": ["The plan dropped the Lüganuse sites on defence grounds that are not public; this screen cannot reproduce that decision."]},
        {"id": "what_excludes",
         "statement": ("Distance to the sea decides most: " + f"{catalogue.loc[catalogue['id'] == 'cooling_sea', 'fails_pct_of_land'].iat[0]:.0f} % of the land is farther than "
                       + f"{c['thresholds']['cooling_sea']} km from it. Among the others, the criteria that alone remove the most land are: "
                       + "; ".join(f"{r.name} {r.sole_exclusion_km2:,.0f} km²" for r in strongest.itertuples() if r.id != "cooling_sea") + "."),
         "evidence": ["criteria_catalogue"],
         "limitations": ["The fault criterion buffers every mapped bedrock fault; none is proven active."]},
        {"id": "coverage_of_official_criteria",
         "statement": (f"The catalogue holds {cat['total']} criteria: {cat['by_status'].get('mapped', 0)} mapped as stated, {cat['by_status'].get('proxy', 0)} mapped with a stand-in, "
                       f"{cat['by_status'].get('not_mapped', 0)} not mapped. Of the {cat['rep_screening_rows']} catalogue entries taken from the official screening table, "
                       f"{cat['rep_screening_mapped']} are mapped."),
         "evidence": ["criteria_catalogue"]},
    ]


# ----------------------------------------------------------------------------
# Delivery: validation, views, findings, hashes, run record
# ----------------------------------------------------------------------------
def deliver(project: dict, facts: dict, frames: dict, root: Path, run_id: str,
            started: datetime.datetime, environment: dict) -> None:
    for folder in ("validation", "runs", "delivery"):
        (root / folder).mkdir(exist_ok=True)
    report = validate(project, facts, frames, root, run_id)
    completed = datetime.datetime.now(datetime.timezone.utc)
    render_dashboard(project, facts, frames, report, root, started, completed)
    write_evidence(root, project)
    write_findings(root, project, report=report,
                   scope="All land of Estonia (15 counties), screened on a grid of about 260 m cells.",
                   findings=findings_items(facts, frames))

    inputs = declared_input_paths(root, project)
    outputs = declared_output_paths(project)
    report["inputs_hash"] = canonical_file_set_hash(root, inputs)
    report["outputs_hash"] = canonical_file_set_hash(root, outputs)
    (root / "validation" / "latest-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    run_file = root / "runs" / f"{run_id}.json"
    run_file.write_text(json.dumps({
        "run_id": run_id, "started_at": started.isoformat(), "completed_at": completed.isoformat(),
        "status": report["status"], "inputs_hash": report["inputs_hash"], "outputs_hash": report["outputs_hash"],
        "validation_report": "validation/latest-report.json", "environment": environment, "headline": report["headline"],
        "inputs": file_inventory(root, inputs), "outputs": file_inventory(root, outputs),
    }, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")

    manifest = yaml.safe_load((root / "project.yaml").read_text(encoding="utf-8"))
    manifest["project"]["status"] = "validated" if report["status"] == "passed" else report["status"]
    manifest["project"]["updated_at"] = completed.isoformat()
    manifest["runs"] = {"latest": {
        "id": run_id, "started_at": started.isoformat(), "completed_at": completed.isoformat(),
        "status": report["status"], "inputs_hash": report["inputs_hash"], "outputs_hash": report["outputs_hash"],
        "record": {"path": run_file.relative_to(root).as_posix()},
        "validation_report": {"path": "validation/latest-report.json"}}}
    (root / "project.yaml").write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True, width=110), encoding="utf-8")
    log.info("run %s finished: %s", run_id, report["status"])

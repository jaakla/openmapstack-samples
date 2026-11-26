"""Validation, dashboard, findings and run record for the Tallinn tram-option comparison.

Everything here is downstream of the analysis in pipeline.py. Nothing in this module measures
geometry or decides a result; it reads project.yaml and the frames the pipeline produced.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import logging
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
import yaml
from openmapstack.credits import credit_payload, html_credits
from openmapstack.delivery import metadata_json, targets, write_evidence
from openmapstack.findings import write_findings
from openmapstack.integrity import canonical_file_set_hash, declared_input_paths, declared_output_paths, file_inventory

log = logging.getLogger("pipeline")

# Colour identifies the part of the city, or "Beyond Tallinn" (six hues, the first six slots of the reference
# categorical palette, light and dark steps); the individual line is named by a label on the map
# and in every list, so identity never rests on colour alone.
FAMILY_COLOURS = {
    "Lasnamäe and Pirita": {"light": "#2a78d6", "dark": "#3987e5"},
    "City centre": {"light": "#eb6834", "dark": "#d95926"},
    "Põhja-Tallinn": {"light": "#1baf7a", "dark": "#199e70"},
    "South": {"light": "#eda100", "dark": "#c98500"},
    "West": {"light": "#e87ba4", "dark": "#d55181"},
    "Beyond Tallinn": {"light": "#7a52c7", "dark": "#a487e8"},
}
STYLE = {
    "existing_tram": "#1f2937", "existing_catchment": "#6b7280", "reach_new": "#d9480f", "reach_existing": "#868e96",
    "reach_both": "#e8a13a", "outside": "#c9c8c2", "workplace": "#5b4bc4", "service": "#0b7285", "plan": "#b5651d",
    "pipeline": "#8e4b10", "corridor_study": "#e0a100", "corridor_plan": "#3b82c4", "admin_line": "#52514e",
}
# The five stages of the 2019 study are an order (first to last), so they take one ramp from dark to
# light rather than five unrelated hues; the stage number is also written on every corridor label.
STAGE_COLOURS = {1: {"light": "#3b0f70", "dark": "#a5b4fc"}, 2: {"light": "#8c2981", "dark": "#d081c8"},
                 3: {"light": "#de4968", "dark": "#f0708a"}, 4: {"light": "#f1873d", "dark": "#f5a35c"},
                 5: {"light": "#c9a227", "dark": "#f2d675"}}
CRITERION_LABEL = {"new_residents": "Residents newly in reach", "residents": "All residents in reach", "workplaces": "Workplace floor area",
                   "services": "Public services", "growth": "Development in preparation", "efficiency": "Residents per km",
                   "strategy": "Strategy fit"}
SERVICE_LABEL = {"school": "School", "kindergarten": "Kindergarten", "higher_education": "Higher or vocational education",
                 "hospital": "Hospital", "pharmacy": "Pharmacy", "shopping": "Shopping centre or market", "library": "Library"}


def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


# ----------------------------------------------------------------------------
# Validation stage
# ----------------------------------------------------------------------------
def _graph_check(project: dict) -> dict:
    known = set(project["sources"])
    dangling, step_ids = [], set()
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
    return {"id": "manifest_graph_resolves", "status": "failed" if problems else "passed", "steps": len(step_ids), "problems": problems}


def validate(project: dict, facts: dict, frames: dict, root: Path, run_id: str) -> dict:
    import pipeline as p
    checks: list[dict] = []
    matrix, scores, summary, lines, stops = frames["matrix"], frames["scores"], frames["summary"], frames["lines"], frames["stops"]
    measured = frames["measured"]
    source_dir = root / "data" / "source"
    derived = root / "data" / "derived"

    geodata = {"tram_options": lines, "tram_option_stops": stops, "option_catchment_variants": frames["sheds"],
               "buildings": frames["result"], "services": frames["services"], "plans_in_process": frames["plans"],
               "pipeline_buildings": frames["pipeline_buildings"], "subdistricts": frames["sub"], "districts": frames["districts"],
               "published_corridors": frames["corridors"], "study_corridors": frames["study_corridors"], "existing_tram_lines": frames["tram_lines"], "existing_tram_stops": frames["tram_stops"]}
    invalid = {name: int((~frame.geometry.is_valid).sum() + frame.geometry.is_empty.sum()) for name, frame in geodata.items()}
    checks.append({"id": "geometry_valid", "status": "passed" if not any(invalid.values()) else "failed",
                   "features_checked": int(sum(len(f) for f in geodata.values())), "invalid_or_empty": invalid})

    # CRS: labels AND coordinates. A known place must land where it stands: the Viru tram stop is
    # beside the Viru Keskus shopping centre, within 400 m of 59.4364 N, 24.7540 E (Viru väljak).
    crs_seen = {"buildings.parquet": gpd.read_parquet(derived / "buildings.parquet").crs.to_string()}
    geojson_crs = {path.name: pyogrio.read_info(path)["crs"] for path in sorted(derived.glob("*.geojson"))}
    viru = frames["tram_stops"][frames["tram_stops"]["stop_name"] == "Viru"].geometry
    reference = gpd.GeoSeries([shapely.Point(24.7540, 59.4364)], crs=4326).to_crs(3301).iloc[0]
    offset_m = float(viru.distance(reference).min())
    lonlat = gpd.GeoSeries([viru.iloc[0]], crs=3301).to_crs(4326).iloc[0]
    aoi = project["project"]["aoi"]["bbox"]
    bounds = gpd.GeoSeries(lines.geometry.values, crs=3301).to_crs(4326).total_bounds
    in_aoi = bool(aoi[0] <= bounds[0] and bounds[2] <= aoi[2] and aoi[1] <= bounds[1] and bounds[3] <= aoi[3])
    ok = (all(v == "EPSG:3301" for v in crs_seen.values()) and all(v == "EPSG:4326" for v in geojson_crs.values())
          and offset_m < 400 and in_aoi)
    checks.append({"id": "crs_known", "status": "passed" if ok else "failed", "analysis_crs": "EPSG:3301",
                   "storage_crs": "EPSG:4326 (GeoJSON, RFC 7946)", "files": {**crs_seen, **geojson_crs},
                   "known_location": {"feature": "tram stop Viru", "lon": round(lonlat.x, 5), "lat": round(lonlat.y, 5),
                                      "metres_from_viru_valjak": round(offset_m), "matches_reference": bool(offset_m < 400)},
                   "options_within_aoi": in_aoi})

    counts = {name: int(len(frame)) for name, frame in geodata.items()}
    counts.update(option_catchments=int(((frames["sheds"]["option"] != "existing") & frames["sheds"]["canonical"]).sum()),
                  existing_tram_catchments=int((frames["sheds"]["option"] == "existing").sum()),
                  option_summary=int(len(summary)), option_matrix=int(len(matrix)), option_scores=int(len(scores)),
                  existing_tram_coverage=int(len(frames["existing"])), study_corridor_table=int(len(frames["study_corridors"])),
                  study_stages=int(len(frames["study_stages"])))
    checks.append({"id": "row_count_gt_zero", "status": "passed" if all(v > 0 for v in counts.values()) else "failed", "rows": counts})
    checks.append({"id": "no_duplicate_option", "status": "passed" if lines["option"].is_unique and summary["option"].is_unique else "failed",
                   "duplicates": int(lines["option"].duplicated().sum())})
    checks.append({"id": "no_null_option", "status": "passed" if lines["option"].notna().all() else "failed",
                   "nulls": int(lines["option"].isna().sum())})

    # Semantic predicates: every coded value the selection depends on lies inside its documented domain.
    raw = pd.read_parquet(source_dir / "tallinn-buildings-etak-ehr.parquet", columns=["ehr_seisund", "kaos_peamine_kood"])
    status_domain = {"Olemas", "Kavandatav", "Püstitamisel", "Lammutatud", "Lammutamisel", "Kustutatud", ""}
    around = pd.read_parquet(source_dir / p.SURROUNDINGS_BUILDINGS, columns=["seisund", "kaos_kood_peamine"])
    status_seen = set(raw["ehr_seisund"].fillna("").unique()) | set(around["seisund"].fillna("").unique())
    kaos = pd.concat([raw["kaos_peamine_kood"], around["kaos_kood_peamine"]]).dropna()
    kaos_ok = bool(kaos.str.fullmatch(r"\d{5}").all())
    plans_raw = pd.read_parquet(source_dir / "tallinn-detailed-plans.parquet", columns=["seisundi_nimi"])
    plan_domain = {"kehtiv", "osaliselt kehtiv", "kehtetu", "lõpetatud", "algatatud", "taotletav", "vastuvõetud"}
    plan_seen = set(plans_raw["seisundi_nimi"].dropna().unique())
    route_types_ok = set(facts["gtfs"]["route_types"]) <= {3, 800, 900}
    semantics_ok = status_seen <= status_domain and kaos_ok and plan_seen <= plan_domain and route_types_ok
    checks.append({"id": "source_semantics_verified", "status": "passed" if semantics_ok else "failed",
                   "building_status_values_seen": sorted(status_seen), "building_use_codes_are_5_digit_kaos": kaos_ok,
                   "buildings_without_register_record_kept_unknown": int((raw["ehr_seisund"].fillna("") == "").sum()
                                                                         + (around["seisund"].fillna("") == "").sum()),
                   "building_layers_checked": ["tallinn-buildings-etak-ehr.parquet", p.SURROUNDINGS_BUILDINGS],
                   "plan_status_values_seen": sorted(plan_seen), "plans_without_status_not_counted": int(plans_raw["seisundi_nimi"].isna().sum()),
                   "gtfs_route_types_seen": sorted(facts["gtfs"]["route_types"])})

    acquisition = json.loads((source_dir / "acquisition.json").read_text(encoding="utf-8"))["sources"]
    incomplete = [key for key, entry in acquisition.items() if "matched" in entry and entry["matched"] != entry["returned"]]
    drift = [entry["file"] for entry in acquisition.values() if _sha256(source_dir / entry["file"]) != entry["sha256"]]
    for source in project["sources"].values():
        pin = source.get("pin") or {}
        if pin.get("class") == "local_snapshot" and _sha256(root / pin["path"]) != pin["sha256"]:
            drift.append(f"{pin['path']} (manifest pin)")
    checks.append({"id": "source_result_complete", "status": "failed" if incomplete or drift else "passed",
                   "sources": {k: {"matched": e.get("matched"), "returned": e["returned"]} for k, e in acquisition.items()},
                   "incomplete": incomplete, "hash_mismatch": drift})

    unresolved = [key for key, source in project["sources"].items() if "not stated" in source["license"]["name"].lower()]
    checks.append({"id": "source_licenses_resolved", "status": "warning" if unresolved else "passed", "unresolved": unresolved,
                   **({"reason": f"{len(unresolved)} Tallinn city layers and the GTFS feed publish no licence text. "
                                 "Reuse terms must be confirmed with the city before redistribution."} if unresolved else {})})

    results = facts["overrides"]
    declared = {o["id"] for o in project.get("overrides") or []}
    applied = {r["id"] for r in results if r["status"] == "applied"}
    checks.append({"id": "overrides_applied", "status": "passed" if declared == applied and len(results) == len(declared) else "failed",
                   "results": [{k: r.get(k) for k in ("id", "status", "reason", "length_km", "declared_street_share",
                                                      "stand_in_street_share", "stored_geometry_gap_m", "follows") if r.get(k) is not None}
                               for r in results]})
    checks.append(_graph_check(project))

    controls, params = project["presentation"]["controls"], project["processing"]["parameters"]
    limit = next(f for f in controls["filters"] if f["id"] == "catchment_m")
    profile = next(v for v in controls["variants"] if v["id"] == "profile")
    mismatches = []

    def expect(label, declared_value, actual):
        if declared_value != actual:
            mismatches.append(f"{label}: manifest {declared_value!r} != pipeline {actual!r}")
    expect("controls.catchment_m.canonical", limit["canonical"], p.CANONICAL_CATCHMENT_M)
    expect("controls.catchment_m.options", limit["options"], p.CATCHMENTS_M)
    expect("controls.profile.canonical", profile["canonical"], p.CANONICAL_PROFILE)
    expect("controls.profile.options", profile["options"], list(p.PROFILES))
    expect("parameters.catchments_m", params["catchments_m"], p.CATCHMENTS_M)
    expect("parameters.canonical_catchment_m", params["canonical_catchment_m"], p.CANONICAL_CATCHMENT_M)
    expect("parameters.stop_spacing_m", params["stop_spacing_m"], p.STOP_SPACING_M)
    expect("parameters.existing_stop_match_m", params["existing_stop_match_m"], p.EXISTING_STOP_MATCH_M)
    expect("parameters.off_street_penalty", params["off_street_penalty"], p.OFF_STREET_PENALTY)
    expect("parameters.min_declared_street_share", params["min_declared_street_share"], p.MIN_DECLARED_STREET_SHARE)
    expect("parameters.corridor_match_m", params["corridor_match_m"], p.CORRIDOR_MATCH_M)
    expect("parameters.bus_corridor_m", params["bus_corridor_m"], p.BUS_CORRIDOR_M)
    expect("parameters.off_path_allowance_m", params["off_path_allowance_m"], p.OFF_PATH_M)
    expect("parameters.residential_kaos", params["residential_kaos"], list(p.RESIDENTIAL_KAOS))
    expect("parameters.workplace_kaos", params["workplace_kaos"], list(p.WORKPLACE_KAOS))
    expect("parameters.plan_statuses_in_process", params["plan_statuses_in_process"], list(p.PLAN_IN_PROCESS))
    expect("parameters.criteria", params["criteria"], p.CRITERIA)
    expect("parameters.profiles", {k: v["weights"] for k, v in params["profiles"].items()}, p.PROFILES)
    expect("parameters.canonical_profile", params["canonical_profile"], p.CANONICAL_PROFILE)
    wanted = {(o, d) for o in lines["option"] for d in p.CATCHMENTS_M}
    if set(zip(matrix["option"], matrix["catchment_m"])) != wanted:
        mismatches.append("indicator rows do not cover every option and walking distance the view offers")
    shed_keys = set(zip(frames["sheds"]["option"], frames["sheds"]["catchment_m"]))
    if not wanted <= shed_keys:
        mismatches.append("catchment drawings do not cover every option and walking distance the view offers")
    score_columns = {c["name"] for c in project["outputs"]["option_scores"]["table"]["columns"]}
    for fields in profile["fields"].values():
        mismatches += [f"view field {f} not a column of option_scores" for f in fields if f not in score_columns]
    for key in ("option_summary", "option_matrix", "option_scores", "existing_tram_coverage", "study_corridor_table", "study_stages"):
        table_columns = [c["name"] for c in project["outputs"][key]["table"]["columns"]]
        actual = list(pd.read_csv(root / project["outputs"][key]["path"], nrows=0).columns)
        if table_columns != actual:
            mismatches.append(f"{key}: declared columns differ from the file ({sorted(set(table_columns) ^ set(actual))})")
    stages_shown = set(int(v) for v in frames["study_corridors"]["stage"])
    if stages_shown != set(STAGE_COLOURS):
        mismatches.append(f"study stages on the map {sorted(stages_shown)} differ from the stage sublayers {sorted(STAGE_COLOURS)}")
    families = {o.get("family") for o in frames["definitions"]["options"]}
    if not families <= set(FAMILY_COLOURS):
        mismatches.append(f"no colour declared for area(s) {sorted(families - set(FAMILY_COLOURS))}")
    checks.append({"id": "view_controls_match_pipeline", "status": "failed" if mismatches else "passed",
                   "canonical": {"catchment_m": p.CANONICAL_CATCHMENT_M, "profile": p.CANONICAL_PROFILE},
                   "variants_materialised": len(wanted) * len(p.PROFILES), "problems": mismatches})

    # ---- domain checks ----
    pop = facts["population"]
    checks.append({"id": "population_conserved", "status": "passed" if pop["unallocated_cells"] == 0 else "warning",
                   "unallocated_cells": pop["unallocated_cells"], "unallocated_population": pop["unallocated_population"],
                   "frame_population": pop["frame_population"], "allocated_population": pop["allocated_population"],
                   **({"reason": f"{pop['unallocated_cells']} populated grid cells of the frame hold no dwelling footprint "
                                 f"({pop['unallocated_population']:.0f} of {pop['frame_population']:.0f} residents); they are not allocated."}
                      if pop["unallocated_cells"] else {})})
    total = pop["tallinn_population_est"]
    checks.append({"id": "tallinn_population_plausible", "status": "passed" if 430000 <= total <= 480000 else "failed",
                   "tallinn_population_est": total, "expected_band": [430000, 480000],
                   "note": "Plausibility band around the roughly 450-460 thousand residents reported for Tallinn; not an attested expectation."})
    sub = frames["sub"]
    corr = float(np.corrcoef(sub["register_population"].fillna(0), sub["population_est"])[0, 1])
    ratio = float(sub["population_est"].sum() / sub["register_population"].sum())
    rel = (sub["population_est"] - sub["register_population"]).abs() / sub["register_population"].clip(lower=1)
    checks.append({"id": "population_matches_register", "status": "passed" if corr >= 0.95 and abs(ratio - 1) <= 0.05 else "failed",
                   "subdistricts": int(len(sub)), "correlation": round(corr, 4), "estimated_over_register": round(ratio, 4),
                   "median_abs_relative_difference": round(float(rel.median()), 3),
                   "note": "Independent check: the city's register population per sub-district is not used in the model."})
    share = facts["network"]["main_component_length_share"]
    checks.append({"id": "network_connected", "status": "passed" if share >= 0.95 else "failed", **facts["network"]})
    low = lines[lines["declared_street_share"] < p.MIN_DECLARED_STREET_SHARE]["option"].tolist()
    checks.append({"id": "options_follow_declared_streets", "status": "failed" if low else "passed",
                   "declared_street_share": dict(zip(lines["option"], lines["declared_street_share"])),
                   "stand_in_street_share": {o: s for o, s in zip(lines["option"], lines["stand_in_street_share"]) if s > 0}, "below_threshold": low})
    best = np.maximum(lines["study_2019_share"], lines["plan_corridor_share"])
    off = lines["option"][best < 0.60].tolist()
    checks.append({"id": "options_match_published_corridors", "status": "warning" if off else "passed",
                   "share_within_75_m": {o: {"study_2019": float(a), "planning_documents": float(b)}
                                         for o, a, b in zip(lines["option"], lines["study_2019_share"], lines["plan_corridor_share"])},
                   "below_60_pct": off,
                   **({"reason": "Less than 60 % of these routed lines lies within 75 m of a corridor the city has published: " + ", ".join(off)
                                 + ". They follow a described street variant the city's drawings do not show."} if off else {})})
    published = lines[lines["published_length_km"].notna()]
    deviation = ((published["length_km"] - published["published_length_km"]) / published["published_length_km"]).round(3)
    far = published["option"][deviation.abs() > 0.30].tolist()
    checks.append({"id": "option_length_plausible", "status": "warning" if far else "passed",
                   "relative_difference_from_published": dict(zip(published["option"], deviation.astype(float))),
                   "options_without_published_length": lines["option"][lines["published_length_km"].isna()].tolist(), "beyond_30_pct": far,
                   **({"reason": "Modelled length differs from the published length by more than 30 % for: " + ", ".join(far)
                                 + ". The published figure describes a different extent of the same corridor (see each option's note)."} if far else {})})
    # The 2019 study figures quoted per option: complete, and the declared stage and rubric score agree
    # with the stage of the study corridors the routed line actually follows in the city's drawing.
    rubric = {1: 1.0, 2: 1.0, 3: 0.5, 4: 0.25, 5: 0.25}
    study_problems = []
    for row in lines.itertuples():
        if pd.isna(row.study_2019_stage) or pd.isna(row.study_2019_bcr) or not row.study_2019_corridor:
            study_problems.append(f"{row.option}: no 2019 study figures recorded")
            continue
        if pd.notna(row.study_2019_stage_drawn) and int(row.study_2019_stage_drawn) != int(row.study_2019_stage):
            study_problems.append(f"{row.option}: declared stage {int(row.study_2019_stage)}, drawing says {int(row.study_2019_stage_drawn)}")
        if abs(rubric[int(row.study_2019_stage)] - row.fit_study_2019) > 1e-9:
            study_problems.append(f"{row.option}: rubric score {row.fit_study_2019} does not follow from stage {int(row.study_2019_stage)}")
    unread = lines["option"][lines["study_2019_stage_drawn"].isna()].tolist()
    checks.append({"id": "study_2019_figures_consistent", "status": "failed" if study_problems else "passed",
                   "stage_declared": {o: int(v) for o, v in zip(lines["option"], lines["study_2019_stage"]) if pd.notna(v)},
                   "stage_read_from_drawing": {o: int(v) for o, v in zip(lines["option"], lines["study_2019_stage_drawn"]) if pd.notna(v)},
                   "stage_not_readable_from_drawing": unread, "problems": study_problems,
                   "note": "The benefit-cost figures are transcribed from Tables 45, 61 and 62 of the 2019 report; this check covers "
                           "their presence and the stage, not the transcription."})
    # The five stages of the 2019 study: every line of the city's drawing is named once, in the stage the
    # drawing gives it, and the drawn length of each stage agrees with the total the report prints.
    study, stage_table = facts["study_2019"], frames["study_stages"]
    missing = study["not_in_drawing"]
    checks.append({"id": "study_stages_complete",
                   "status": "failed" if study["problems"] or len(stage_table) != 5 else "warning" if missing else "passed",
                   "lines_in_drawing": study["lines_in_drawing"], "lines_named": study["lines_named"],
                   "duplicate_lines_dropped": study["duplicate_lines"], "corridors": study["corridors"],
                   "stage_length_km": {int(r.stage): {"report": float(r.length_report_km), "drawn": float(r.length_drawn_km)} for r in stage_table.itertuples()},
                   "length_tolerance": p.STUDY_STAGE_LENGTH_TOLERANCE, "problems": study["problems"], "not_in_drawing": missing,
                   "note": "Corridor codes and the study's figures are transcribed from the report; this check covers the join to the drawing, the stage and the stage lengths, not the transcription.",
                   **({"reason": "Shown on the report's stage maps but absent from the city's drawing, so not on the map: "
                                 + "; ".join(f"stage {m['stage']}, {m['code']} ({m['name']})" for m in missing) + "."} if missing and not study["problems"] else {})})
    _, gap = p.snap(frames["network"], np.column_stack([stops.geometry.x, stops.geometry.y]))
    # Up to 150 m a stop is on the network. Beyond that it stands where no path is mapped yet (a corridor drawn
    # across open land): reported, and the gap still counts in every distance. Beyond the accepted walking
    # distance the stop could reach nothing, which would mean broken geometry.
    far_stops = [f"{o} stop {int(q)} ({g:.0f} m)" for o, q, g in zip(stops["option"], stops["seq"], gap) if g > 150]
    checks.append({"id": "option_stops_on_network",
                   "status": "passed" if gap.max() <= 150 else "warning" if gap.max() <= p.CANONICAL_CATCHMENT_M else "failed",
                   "note": "The gap is walked in a straight line and counted in every distance.",
                   "max_gap_m": round(float(gap.max()), 1), "stops_checked": int(len(stops)), "stops_beyond_150_m": far_stops,
                   **({"reason": f"{len(far_stops)} modelled stops lie more than 150 m from any mapped path, where a study corridor is drawn across open land: "
                                 + ", ".join(far_stops) + ". The gap is counted in their walking distances, so they reach few or no buildings."}
                      if far_stops and gap.max() <= p.CANONICAL_CATCHMENT_M else {})})
    ordered = matrix.sort_values(["option", "catchment_m"])
    monotonic = all(bool((ordered.groupby("option")[c].diff().dropna() >= 0).all())
                    for c in ("residents", "workplace_floor_m2", "services", "pipeline_home_m2"))
    checks.append({"id": "catchments_monotonic", "status": "passed" if monotonic else "failed", "rows": int(len(matrix))})
    bounded = bool((matrix["residents_new"] <= matrix["residents"]).all() and (matrix["workplace_floor_new_m2"] <= matrix["workplace_floor_m2"]).all())
    checks.append({"id": "new_not_more_than_total", "status": "passed" if bounded else "failed"})
    weights_ok = all(abs(sum(w.values()) - 1) < 1e-9 and set(w) == set(p.CRITERIA) for w in p.PROFILES.values())
    crit = scores[[f"c_{c}" for c in p.CRITERIA]].to_numpy()
    recomputed = np.array([sum(p.PROFILES[r.profile][c] * getattr(r, f"c_{c}") for c in p.CRITERIA) * 100 for r in scores.itertuples()])
    score_ok = bool(weights_ok and (crit >= 0).all() and (crit <= 1).all() and np.abs(recomputed - scores["score"]).max() <= 0.1)
    checks.append({"id": "scores_consistent", "status": "passed" if score_ok else "failed", "profiles": len(p.PROFILES),
                   "max_abs_difference_points": round(float(np.abs(recomputed - scores["score"]).max()), 3),
                   "note": "Criteria are stored to 3 decimals, so a recomputed score may differ by rounding only."})
    canonical = matrix[matrix["canonical"]].set_index("option")
    direct_ok = True
    for option in lines["option"]:
        inside = frames["bdist"][option] <= p.CANONICAL_CATCHMENT_M
        direct_ok &= abs(float(measured.loc[inside, "pop_est"].sum()) - canonical.loc[option, "residents"]) <= 1
    same = bool((summary.set_index("option")["residents"] == canonical["residents"].reindex(summary["option"]).values).all())
    checks.append({"id": "table_totals_consistent", "status": "passed" if direct_ok and same else "failed",
                   "options": int(len(summary)), "building_level_sums_match": bool(direct_ok), "summary_matches_matrix": same})

    declared_checks = list(project["validation"]["required"]) + [d["name"] for d in project["validation"]["domain_checks"]]
    seen = [c["id"] for c in checks] + ["manifest_report_parity"]
    missing = [name for name in declared_checks if seen.count(name) != 1]
    extra = [name for name in seen if name not in declared_checks]
    checks.append({"id": "manifest_report_parity", "status": "failed" if missing or extra else "passed",
                   "declared": len(declared_checks), "reported": len(seen), "missing_or_repeated": missing, "undeclared": extra})

    statuses = {c["status"] for c in checks}
    status = "failed" if "failed" in statuses else "warning" if statuses & {"warning", "not_testable"} else "passed"
    top = summary.iloc[0]
    return {"run_id": run_id, "status": status, "checks": checks,
            "headline": {"options": int(len(summary)), "top_option": top["option"], "top_title": top["title"],
                         "top_score": float(top["score_balanced"]), "catchment_m": p.CANONICAL_CATCHMENT_M, "profile": p.CANONICAL_PROFILE,
                         "tallinn_population_est": round(total)}}


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
    measured, lines = frames["measured"], frames["lines"]
    option_ids = list(lines["option"])
    max_reach = max(p.CATCHMENTS_M)
    bdist = frames["bdist"]
    # Buildings for the map: those with residents or workplace floor area within the largest
    # walking distance of any option or of the existing network. Distances are the pipeline's
    # measurements; the browser only compares them with the chosen walking distance.
    near_any = np.zeros(len(measured), dtype=bool)
    for key in ["existing", *option_ids]:
        near_any |= bdist[key] <= max_reach
    keep = near_any & ((measured["pop_est"] > 0) | (measured["workplace_m2"] > 0))
    shown = measured[keep]
    compact = {"id": shown["id"].values, "p": shown["pop_est"].round(1).values, "w": shown["workplace_m2"].round().astype(int).values,
               "u": shown["use_label"].fillna("").values, "s": shown["subdistrict"].fillna(shown["municipality"]).fillna("").values,
               "e": np.where(bdist["existing"][keep] <= max_reach, np.round(bdist["existing"][keep]), -1).astype(int)}
    for index, key in enumerate(option_ids):
        compact[f"o{index}"] = np.where(bdist[key][keep] <= max_reach, np.round(bdist[key][keep]), -1).astype(int)
    compact = gpd.GeoDataFrame(compact, geometry=shapely.simplify(shown.geometry.values, 1.0), crs=measured.crs)

    definitions = {o["id"]: o for o in frames["definitions"]["options"]}
    options = []
    for index, row in enumerate(lines.itertuples()):
        d = definitions[row.option]
        options.append({"id": row.option, "column": f"o{index}", "title": row.title, "short": row.short, "family": row.family,
                        "status": row.status, "status_label": row.status_label, "description": " ".join(d["description"].split()),
                        "geometry_note": " ".join(d["geometry_note"].split()) if d.get("geometry_note") else None,
                        "colour": FAMILY_COLOURS[row.family], "from": row.from_label, "to": row.to_label,
                        "streets": d["streets"], "stand_in_streets": d.get("stand_in_streets") or [], "follows": d.get("follow"),
                        "waypoints": [w.get("stop") or w.get("address") or (f"{w['corridor_end']['end']} of line {w['corridor_end']['fid']} of the corridor drawing"
                                                                                 if "corridor_end" in w else " × ".join(w.get("junction", [])))
                                      for w in d["waypoints"]],
                        "appraisal_2019": d.get("appraisal_2019") or {},
                        "published": d.get("published") or {}, "strategy": d["strategy"], "strategy_fit": row.strategy_fit,
                        "evidence": d["evidence"], "override_id": f"SCENARIO-{row.option}",
                        "declared_street_share": row.declared_street_share, "stand_in_street_share": row.stand_in_street_share,
                        "study_2019_share": row.study_2019_share, "plan_corridor_share": row.plan_corridor_share,
                        "tallinn_share": row.tallinn_share})

    presentation = project["presentation"]
    sources = [{"key": key, "provider": s["provider"], "dataset": s["dataset"], "url": s.get("portal_page") or s["source_url"],
                "retrieved_at": s["access"]["retrieved_at"], "version": s["version"]["identifier"], "license": s["license"]["name"],
                "license_url": s["license"].get("url"), "rows": s["access"]["file"].get("row_count"), "rationale": s.get("rationale"),
                "role": s["role"], "file": s["access"]["file"].get("name")} for key, s in project["sources"].items()]
    table_frames = {"option_summary": frames["summary"], "option_matrix": frames["matrix"], "option_scores": frames["scores"],
                    "existing_tram_coverage": frames["existing"],
                    "study_corridor_table": pd.DataFrame(frames["study_corridors"].drop(columns="geometry")),
                    "study_stages": frames["study_stages"]}
    tables = {}
    for entry in presentation["tables"]:
        output = project["outputs"][entry["output"]]
        tables[entry["output"]] = {"title": entry["title"], "columns": output["table"]["columns"], "rows": _records(table_frames[entry["output"]]),
                                   "default_sort": entry.get("default_sort"),
                                   "downloads": [{"format": fmt, "href": str(Path(output["path"]).with_suffix("." + fmt))} for fmt in entry["downloads"]]}
    params = project["processing"]["parameters"]
    target = targets(project)[0]
    credits = credit_payload(project, completed_at=completed.isoformat())
    payload = {
        "project": project["project"] | {"status": "validated" if report["status"] == "passed" else report["status"]},
        "run": {"id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(), "status": report["status"]},
        "interpretation": project["interpretation"], "warnings": project.get("warnings") or [],
        "steps": [{"id": s["id"], "operation": s["operation"], "crs": s.get("crs")} for s in project["processing"]["steps"]],
        "sources": sources, "validation": report, "facts": facts, "documents": frames["definitions"].get("documents") or {},
        "outputs": [{"key": k, "path": o["path"], "format": o["format"], "role": o.get("role", "result"), "kind": o.get("kind", "geodata")}
                    for k, o in project["outputs"].items()],
        "controls": presentation["controls"], "layout": presentation["layout"], "basemap": presentation["map"]["basemap"],
        "layer_groups": presentation["map"]["layer_groups"], "layers": presentation["map"]["layers"],
        "canonical": facts["canonical"], "catchments": p.CATCHMENTS_M, "criteria": p.CRITERIA, "criterion_labels": CRITERION_LABEL,
        "profiles": [{"id": k, "label": v["label"], "weights": v["weights"]} for k, v in params["profiles"].items()],
        "appraisal_scenarios": p.APPRAISAL_SCENARIOS, "appraisal_headline": p.APPRAISAL_HEADLINE,
        "options": options, "family_colours": FAMILY_COLOURS, "style": STYLE, "stage_colours": STAGE_COLOURS,
        "study": {"document": frames["study_definition"]["document"], "stages": _records(frames["study_stages"]),
                  "not_in_drawing": facts["study_2019"]["not_in_drawing"]}, "service_labels": SERVICE_LABEL, "tables": tables,
        "data": {
            "options": _geojson(lines[["option", "title", "short", "family", "geometry"]], 6),
            "stops": _geojson(frames["stops"], 6),
            "catchments": _geojson(frames["sheds"][frames["sheds"]["option"] != "existing"][["option", "catchment_m", "geometry"]]
                                   .merge(lines[["option", "family"]], on="option"), 5, simplify_m=4.0),
            "existing_catchments": _geojson(frames["sheds"][frames["sheds"]["option"] == "existing"][["catchment_m", "geometry"]], 5, simplify_m=4.0),
            "tram_lines": _geojson(frames["tram_lines"], 5, simplify_m=2.0),
            "tram_stops": _geojson(frames["tram_stops"], 6),
            "buildings": _geojson(compact, 5),
            "services": _geojson(frames["services"][["service_id", "category", "name", "source_file", "geometry"]], 5),
            "plans": _geojson(frames["plans"], 5, simplify_m=3.0),
            "pipeline_buildings": _geojson(frames["pipeline_buildings"][["id", "use", "use_label", "floor_m2", "geometry"]], 5, simplify_m=1.0),
            "corridors": _geojson(frames["corridors"][frames["corridors"]["layer"] == "planning_documents"], 5, simplify_m=5.0),
            "study_corridors": _geojson(frames["study_corridors"], 5, simplify_m=3.0),
            "districts": _geojson(frames["districts"], 5, simplify_m=10.0),
        },
    }
    template = (root / "dashboard.template.html").read_text(encoding="utf-8")
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
    provenance = "; ".join(sorted({s["provider"] for s in project["sources"].values()}))
    warning_items = "".join(f"<li><b>{_esc(w['id'])}</b> ({_esc(w['severity'])}) – {_esc(w['statement'])}</li>" for w in project.get("warnings") or [])
    downloads = "".join(
        f"<li>{_esc(t['title'])}: " + " · ".join(f'<a href="{_esc(d["href"])}" download>{d["format"].upper()}</a>' for d in t["downloads"]) + "</li>"
        for t in tables.values())
    html = (template.replace("__TITLE__", _esc(project["project"]["title"]))
            .replace("<!--__CREDITS__-->", html_credits(credits))
            .replace("<!--__PROVIDERS__-->", _esc(provenance))
            .replace("<!--__WARNINGS__-->", warning_items)
            .replace("<!--__DOWNLOADS__-->", downloads)
            .replace("/*__VIEW_METADATA__*/", metadata_json(root, project, target))
            .replace("/*__PAYLOAD__*/null", blob))
    (root / project["outputs"][target["output"]]["path"]).write_text(html, encoding="utf-8")
    write_evidence(root, project)
    log.info("dashboard written (%.1f MB, %d buildings on the map)", len(html.encode("utf-8")) / 1e6, len(compact))


def _esc(value) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ----------------------------------------------------------------------------
# Findings
# ----------------------------------------------------------------------------
def write_findings_file(project: dict, facts: dict, frames: dict, report: dict, root: Path) -> None:
    import pipeline as p
    summary, scores, existing = frames["summary"], frames["scores"], frames["existing"]
    n = lambda v: f"{v:,.0f}".replace(",", " ")
    reach = p.CANONICAL_CATCHMENT_M
    top = summary.head(3)
    canonical = scores[scores["catchment_m"] == reach]
    winners = {profile: group.sort_values("rank").iloc[0]["option"] for profile, group in canonical.groupby("profile")}
    title = summary.set_index("option")["title"]
    labels = {k: v["label"] for k, v in project["processing"]["parameters"]["profiles"].items()}
    by = summary.set_index("option")
    base = existing[existing["catchment_m"] == reach].iloc[0]
    most_new = summary.sort_values("residents_new", ascending=False).iloc[0]
    most_work = summary.sort_values("workplace_floor_m2", ascending=False).iloc[0]
    densest = summary.sort_values("residents_per_km", ascending=False).iloc[0]
    best_fit = summary.sort_values(["strategy_fit", "rank_balanced"], ascending=[False, True]).iloc[0]
    rank_range = canonical.groupby("option")["rank"].agg(["min", "max"])
    stable = rank_range[rank_range["max"] <= 5].index.tolist()
    d, a = by.loc["pelguranna_d"], by.loc["pelguranna_a"]
    liiv, kaarli, lk = by.loc["liivalaia"], by.loc["kaarli_estonia"], by.loc["liivalaia_kristiine"]
    rahu, laagna = by.loc["lasnamae_rahu"], by.loc["lasnamae_laagna"]
    jarve = by.loc["jarve"]
    fewer_than_jarve = int((summary["residents_new"] < jarve["residents_new"]).sum())
    scenario = "Lines and stops are modelled from public descriptions, not designed alignments."
    # This model's ranking beside the benefit-cost ratio the 2019 study gives for the same corridors.
    both = summary[summary["study_2019_bcr"].notna()]
    rho = float(both["score_balanced"].rank().corr(both["study_2019_bcr"].rank()))
    bcr_rank = both["study_2019_bcr"].rank(ascending=False, method="min")
    gap = (both["rank_balanced"].rank(method="min") - bcr_rank)
    higher_in_study = both.loc[gap.sort_values(ascending=False).index[:3]]
    lower_in_study = both.loc[gap.sort_values().index[:3]]
    best_bcr = both.sort_values(["study_2019_bcr", "rank_balanced"], ascending=[False, True]).drop_duplicates("study_2019_corridor").head(3)
    headline = p.APPRAISAL_SCENARIOS[p.APPRAISAL_HEADLINE]
    study_only = [o["id"] for o in frames["definitions"]["options"] if o.get("follow") and o["id"] != "lasnamae_rahu"]
    added = summary[summary["option"].isin(study_only)].sort_values("rank_balanced")
    sc, stages, study = frames["study_corridors"], frames["study_stages"], facts["study_2019"]
    not_compared = sc[sc["compared"] == "no"]
    beyond = summary[summary["length_in_tallinn_pct"] < 100].sort_values("rank_balanced")
    pop, weights = facts["population"], p.PROFILES[p.CANONICAL_PROFILE]
    items = [
        {"id": "ranking", "evidence": ["option_summary", "option_scores"],
         "statement": (f"With the balanced weighting and a {reach} m walk to a stop, the highest-scoring of the {len(summary)} options are "
                       + "; ".join(f"{r.title} ({r.score_balanced:.1f} of 100)" for r in top.itertuples())
                       + f". The top option changes with the weighting: " + "; ".join(f"{labels[k]}: {title[v]}" for k, v in winners.items()) + "."
                       + (f" Options that stay in the top five under all {len(labels)} weightings: " + ", ".join(title[o] for o in stable) + "." if stable else "")),
         "limitations": ["The score is a declared weighting of seven indicators, not a cost-benefit result; ridership, travel time and construction cost are not modelled.", scenario]},
        {"id": "existing_network", "evidence": ["existing_tram_coverage"],
         "statement": (f"Today {n(base['residents'])} residents, {base['share_of_city_pct']:.1f} % of an estimated {n(facts['population']['tallinn_population_est'])}, "
                       f"live within a {reach} m walk of one of the {int(base['tram_stops'])} existing tram stops."),
         "limitations": ["Residents per building are estimated from the 2024 1 km population grid and registered dwelling floor area."]},
        {"id": "new_coverage", "evidence": ["option_summary", "option_matrix"],
         "statement": (f"{most_new['title']} would bring the most residents newly within reach of a tram: {n(most_new['residents_new'])} "
                       f"over {most_new['length_km']:.1f} km of new track. {most_work['title']} reaches the most workplace floor area "
                       f"({n(most_work['workplace_floor_m2'] / 1000)} thousand m²), and {densest['title']} the most residents per kilometre "
                       f"({n(densest['residents_per_km'])})."),
         "limitations": ["Workplace floor area is a proxy for jobs and visitors, not a count.", scenario]},
        {"id": "pelguranna", "evidence": ["option_matrix", "option_summary"],
         "statement": (f"The funded Pelguranna route (Putukaväil to Kolde pst, modelled {d['length_km']:.2f} km) puts {n(d['residents'])} residents within {reach} m, "
                       f"{n(d['residents_new'])} of them not near a tram today. The route dropped in February 2026 (Puhangu to Stroomi park, {a['length_km']:.2f} km) "
                       f"would reach {n(a['residents'])} and {n(a['residents_new'])}. The funded route has "
                       + ("the highest strategy fit of all options " if d["strategy_fit"] >= summary["strategy_fit"].max() else "a strategy fit ")
                       + f"({d['strategy_fit']:.2f} of 3) but ranks {int(d['rank_balanced'])} of {len(summary)} on the balanced score."),
         "limitations": ["Beyond Sõle the funded route runs in a corridor with no mapped street; the parallel part of Puhangu street stands in for it, up to 100 m away.", scenario]},
        {"id": "city_centre_link", "evidence": ["option_summary", "option_matrix"],
         "statement": (f"The abandoned Liivalaia section ({liiv['length_km']:.2f} km) and the Kaarli pst – Estonia pst alternative ({kaarli['length_km']:.2f} km) both run through "
                       f"areas already served: only {n(liiv['residents_new'])} and {n(kaarli['residents_new'])} residents would be newly within reach. Their strength is "
                       f"destinations: {n(liiv['workplace_floor_m2'] / 1000)} and {n(kaarli['workplace_floor_m2'] / 1000)} thousand m² of workplace floor area. "
                       f"Extending the Liivalaia line to Kristiine raises newly reached residents to {n(lk['residents_new'])}."),
         "limitations": ["A link through the centre mainly shortens journeys and relieves existing lines; this analysis measures reach only.", scenario]},
        {"id": "lasnamae", "evidence": ["option_summary", "option_matrix"],
         "statement": (f"In Lasnamäe the Laagna tee corridor reaches {n(laagna['residents'])} residents ({n(laagna['residents_new'])} new) and the Rahu tee corridor "
                       f"{n(rahu['residents'])} ({n(rahu['residents_new'])} new). The city has chosen trolleybuses for Laagna tee, which leaves it a strategy fit of "
                       f"{laagna['strategy_fit']:.2f} against {rahu['strategy_fit']:.2f} for the Rahu tee corridor."),
         "limitations": ["The Rahu tee line follows the city's published corridor drawing because the street is not built.", scenario]},
        {"id": "jarve", "evidence": ["option_summary"],
         "statement": (f"The Järve extension ({jarve['length_km']:.2f} km) would bring {n(jarve['residents_new'])} residents newly within reach, "
                       + ("the fewest of all options, " if fewer_than_jarve == 0 else f"fewer than all but {fewer_than_jarve} of the other options, ")
                       + f"and ranks {int(jarve['rank_balanced'])} of {len(summary)}; it serves {n(jarve['workplace_floor_m2'] / 1000)} thousand m² of workplace floor area around Järve keskus."),
         "limitations": ["Park-and-ride and interchange with the railway, which the 2022 study names as the purpose of this line, are not measured.", scenario]},
        {"id": "study_2019_appraisal", "evidence": ["option_summary", "tram_options"],
         "statement": (f"The 2019 feasibility study gives every corridor compared here a benefit-cost ratio above 1: in its scenario '{headline}' the ratios run from "
                       f"{both['study_2019_bcr'].min():.1f} to {both['study_2019_bcr'].max():.1f}. Its highest ratios are for "
                       + "; ".join(f"{r.title} ({r.study_2019_bcr:.1f}, corridor {r.study_2019_corridor})" for r in best_bcr.itertuples())
                       + f". This model's balanced ranking and the study's ratios agree in part (rank correlation {rho:.2f} over {len(both)} options). "
                       "The study rates higher than this model: " + ", ".join(f"{r.title} (study {int(bcr_rank[i])}, here {int(r.rank_balanced)})" for i, r in higher_in_study.iterrows())
                       + ". This model rates higher than the study: " + ", ".join(f"{r.title} (here {int(r.rank_balanced)}, study {int(bcr_rank[i])})" for i, r in lower_in_study.iterrows()) + "."),
         "limitations": ["The study's ratio counts travel-time, traffic, environmental and health effects from a transport model of 2018; this model counts who and what is within a walk of a stop.",
                         "The study appraises corridors that are not always the same extent as an option here; several options share one corridor's figures, and some figures cover more than the option (see each option's note).",
                         "The figures are from 2019 and assume the study's Tallinn++ policy package; they are quoted, not recomputed."]},
        {"id": "study_2019_corridors", "evidence": ["option_summary", "option_matrix"],
         "statement": (f"{len(added)} corridors of the 2019 study that are not in current debate were measured on the same basis, drawn as the city published them. "
                       "They rank: " + "; ".join(f"{int(r.rank_balanced)} {r.title} ({n(r.residents)} residents in reach, {n(r.residents_new)} new, study stage {int(r.study_2019_stage)})" for r in added.itertuples()) + "."),
         "limitations": ["These lines follow the city's drawing of the study corridors and were not checked against the street network.",
                         scenario]},
        {"id": "beyond_tallinn", "evidence": ["option_summary", "option_matrix", "buildings"],
         "statement": (f"{len(beyond)} options leave Tallinn. Buildings of the municipalities around the city, from the national building layer, give them "
                       f"residents and workplaces on the same basis as inside it: {n(pop['allocated_outside_tallinn'])} residents in "
                       f"{n(pop['inhabited_buildings_outside_tallinn'])} buildings outside Tallinn are in the model. They rank: "
                       + "; ".join(f"{int(r.rank_balanced)} {r.title} ({r.score_balanced:.1f}; {n(r.residents)} residents in reach, {n(r.residents_outside_tallinn)} of them outside Tallinn; "
                                   f"{int(r.length_in_tallinn_pct)} % of the line in Tallinn)" for r in beyond.itertuples()) + "."),
         "limitations": [f"Public services and detailed plans in process are the city's own layers and are counted in Tallinn only. For a line outside the city the services criterion "
                         f"({100 * weights['services']:.0f} % of the balanced score) and half of the growth criterion ({100 * weights['growth'] / 2:.1f} %) are therefore a lower bound.",
                         "Bus departures are from the Tallinn timetable feed; county lines are not in it.",
                         "The Jüri, Tabasalu and Maardu lines each continue a line that is not built; they are measured on their own.", scenario]},
        {"id": "study_2019_stages", "evidence": ["study_stages", "study_corridor_table", "study_corridors"],
         "statement": (f"The 2019 study orders its corridors in five stages. All {len(sc)} corridors of the city's drawing of them ({study['total_km']:.1f} km, "
                       f"{study['outside_tallinn_km']:.1f} km of it outside Tallinn) are on the map by stage. "
                       + " ".join(f"Stage {int(r.stage)}: {int(r.corridors)} corridors, {r.length_report_km:.1f} km in the report ({r.length_drawn_km:.1f} km drawn), "
                                  f"benefit-cost ratio {r.study_bcr_tram:.1f}." for r in stages.itertuples())
                       + f" {int((sc['compared'] == 'yes').sum())} corridors are compared as options here, those leaving Tallinn included. Not compared: "
                       + ", ".join(not_compared[not_compared["mode"] == "railway"]["corridor"]) + " (existing railways); "
                       + ", ".join(not_compared[not_compared["mode"] == "tram"]["corridor"]) + " (short links)."),
         "limitations": ["Corridor codes, stage totals and benefit-cost ratios are transcribed from the report (chapter 1.6, Tables 45, 61, 62 and 65); the lines are the city's schematic drawing.",
                         f"The benefit-cost ratio is the study's, for the tram variant in its scenario '{headline}', in 2019 assumptions.",
                         *(["Shown on the report's maps but not in the city's drawing, so not on the map: " + "; ".join(f"{m['code']} (stage {m['stage']})" for m in study["not_in_drawing"]) + "."]
                           if study["not_in_drawing"] else [])]},
        {"id": "strategy", "evidence": ["option_summary", "tram_options"],
         "statement": (f"Strategy fit and measured reach point in different directions. {best_fit['title']} has the highest strategy fit ({best_fit['strategy_fit']:.2f} of 3) and ranks "
                       f"{int(best_fit['rank_balanced'])} on the balanced score; the top-ranked option, {top.iloc[0]['title']}, has a strategy fit of {top.iloc[0]['strategy_fit']:.2f}."),
         "limitations": ["Strategy fit is a rubric applied to documents and news up to 24 November 2026; positions change."]},
    ]
    write_findings(root, project, report=report,
                   scope=(f"{len(summary)} tram line options in Tallinn and the municipalities around it, measured at a {reach} m network walk to modelled stops; "
                          f"population 2024, other data November 2026"), findings=items)


# ----------------------------------------------------------------------------
# Run record
# ----------------------------------------------------------------------------
def finalize_run(project: dict, report: dict, root: Path, started: datetime.datetime,
                 completed: datetime.datetime, environment: dict) -> None:
    """Write the report and run record, then point project.yaml at them. The
    pipeline owns runs.latest and project.status; they are never hand-edited."""
    inputs = declared_input_paths(root, project)
    outputs = declared_output_paths(project)
    report["inputs_hash"] = canonical_file_set_hash(root, inputs)
    report["outputs_hash"] = canonical_file_set_hash(root, outputs)
    (root / "validation" / "latest-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    run_file = root / "runs" / f"{report['run_id']}.json"
    run_file.write_text(json.dumps({
        "run_id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(),
        "status": report["status"], "inputs_hash": report["inputs_hash"], "outputs_hash": report["outputs_hash"],
        "validation_report": "validation/latest-report.json", "environment": environment, "headline": report["headline"],
        "inputs": file_inventory(root, inputs), "outputs": file_inventory(root, outputs),
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    manifest = yaml.safe_load((root / "project.yaml").read_text(encoding="utf-8"))
    manifest["project"]["status"] = "validated" if report["status"] == "passed" else report["status"]
    manifest["project"]["updated_at"] = completed.isoformat()
    manifest["runs"] = {"latest": {
        "id": report["run_id"], "started_at": started.isoformat(), "completed_at": completed.isoformat(),
        "status": report["status"], "inputs_hash": report["inputs_hash"], "outputs_hash": report["outputs_hash"],
        "record": {"path": run_file.relative_to(root).as_posix()},
        "validation_report": {"path": "validation/latest-report.json"}}}
    (root / "project.yaml").write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8")

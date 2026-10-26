"""Canonical, offline-from-source PV analysis and dashboard build.

Source refresh is acquire.py. Ordinary execution uses only pinned local
snapshots; every browser preview uses the same src/analysis.js as this batch.
"""
from __future__ import annotations

import csv
import base64
import datetime as dt
import html
import json
import math
import platform
import re
import shutil
import subprocess
from pathlib import Path

import yaml

from openmapstack.credits import credit_payload, html_credits
from openmapstack.delivery import metadata_json, write_evidence
from openmapstack.findings import write_findings
from openmapstack.integrity import (
    canonical_file_set_hash, declared_input_paths, declared_output_paths,
    file_inventory, sha256_file,
)

ROOT = Path(__file__).resolve().parent


def read(path: str):
    return json.loads((ROOT / path).read_text())


def write(path: str, value):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def table(path: str, rows: list[dict], columns: list[str]):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def run(*args: str):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    project = yaml.safe_load((ROOT / "project.yaml").read_text())
    started = dt.datetime.now(dt.timezone.utc)
    run_id = started.strftime("run-%Y%m%d-%H%M%S")
    checks = []

    def check(name, success=None, **details):
        status = details.pop("status", "passed" if success else "failed")
        checks.append({"id": name, "status": status, **details})

    # STEP 1 — assert immutable, dated external snapshots before computation.
    mismatches = []
    for source_id, source in project["sources"].items():
        pin = source["pin"]
        path = ROOT / pin["path"]
        if not path.is_file() or sha256_file(path) != pin["sha256"]:
            mismatches.append(source_id)
    for artifact in read("sources.lock.json")["artifacts"]:
        path = ROOT / artifact["path"]
        if not path.is_file() or sha256_file(path).removeprefix("sha256:") != artifact["sha256"].removeprefix("sha256:"):
            mismatches.append(artifact["path"])
    check("source_hashes_match", not mismatches, mismatched_sources=mismatches)
    if mismatches:
        raise ValueError(f"Immutable source hash mismatch: {mismatches}")

    # STEP 2 — apply the declared hypothetical scenario, without changing sources.
    scenario = read("data/overrides/planning-scenario.geojson")
    feature = scenario["features"][0]
    system = feature["properties"]["system"]
    consumption = feature["properties"].get("consumption", {})
    estimate_keys = {"mode", "dayKwh", "nightKwh", "dayStartHour", "dayEndHour",
                     "timeZone", "importAdderEurMWh", "fillMissingWithEstimate"}
    public_estimate = (consumption.get("mode") == "estimate"
                       and not (set(consumption) - estimate_keys))
    check("canonical_consumption_is_public_estimate", public_estimate,
          reason="The published baseline contains generic day/night assumptions, not uploaded household rows.")
    if not public_estimate:
        raise ValueError("Private household profiles must not enter the published canonical baseline")
    storage = feature["properties"].get("storage", {})
    storage_keys = {"enabled", "capacityMode", "capacityKwh", "powerMode", "chargePowerKw",
                    "dischargePowerKw", "chargeCurrentA", "dischargeCurrentA", "phases",
                    "voltageV", "roundTripEfficiencyPct", "reserveSocPct", "allowGridCharging",
                    "allowBatteryExport", "cyclingCostEurKwh", "socSteps"}
    public_storage = isinstance(storage.get("enabled"), bool) and set(storage) == storage_keys
    check("canonical_storage_config_explicit", public_storage,
          reason="Every battery setting is explicit; the published baseline contains no private profile metadata.")
    if not public_storage:
        raise ValueError("Canonical storage settings must be explicit and contain only supported keys")
    ring = feature["geometry"]["coordinates"][0]
    aoi_corners = read("data/source/aerial.json")["aoiCornersWgs84"]
    west, east = min(p[0] for p in aoi_corners), max(p[0] for p in aoi_corners)
    south, north = min(p[1] for p in aoi_corners), max(p[1] for p in aoi_corners)
    coordinate_valid = (len(ring) >= 4 and ring[0] == ring[-1]
                        and all(len(p) == 2 and all(math.isfinite(v) for v in p)
                                and west <= p[0] <= east and south <= p[1] <= north
                                for p in ring))
    check("scenario_geometry_valid", coordinate_valid, feature_id=feature["id"],
          reason="Closed, finite planning polygon within retained context; the shared engine also checks EPSG:3301 bounds.")
    grid = read("data/source/context-grid.json")
    declared_aoi = project["project"]["aoi"]
    check("canonical_context_matches_declared_aoi",
          grid["bounds"] == declared_aoi["bbox"] and grid["crs"] == declared_aoi["crs"],
          reason="Canonical terrain dimensions and CRS match the manifest AOI, independently of exploratory browser selections.")
    check("overrides_applied", feature["properties"]["status"] == "hypothetical",
          results=[{"id": "SCENARIO-001", "status": "applied",
                      "feature_id": feature["id"], "geometry_origin": "scenario"}])
    if not coordinate_valid:
        raise ValueError("Scenario geometry is outside the supported pilot")

    # STEP 3 — exact same model as browser previews; all metric work is EPSG:3301.
    if not (ROOT / "node_modules/.package-lock.json").is_file():
        run("npm", "ci", "--no-audit", "--no-fund")
    run("node", "scripts/canonical-analysis.mjs")
    analysis = read("data/derived/analysis.json")
    consumption = analysis["consumption"]
    storage = analysis["storage"]
    coverage = analysis["horizon"]["coveragePct"]
    check("horizon_source_coverage", status="passed" if coverage >= 100 else "warning",
          coverage_pct=coverage, warnings=analysis["horizon"]["warnings"])
    seasonal, hourly, monthly = [], [], []
    storage_seasonal, storage_hourly, storage_monthly = [], [], []
    for year in (2024, 2025):
        result = analysis["years"][str(year)]
        summary = result["summary"]
        seasonal.append({"year": year, **summary})
        hourly.extend({"year": year, **row} for row in result["hourly"])
        monthly.extend({"year": year, **row} for row in result["monthly"])
        battery = result["storage"]
        battery_summary = battery["summary"]
        storage_seasonal.append({"year": year, **battery_summary})
        storage_hourly.extend({"year": year, **row} for row in battery["hourly"])
        storage_monthly.extend({"year": year, **row} for row in battery["monthly"])
        weather = read(f"data/source/weather-{year}.json")["rows"]
        prices = read(f"data/source/prices-{year}.json")["rows"]
        expected = 8784 if year == 2024 else 8760
        times = [row["time"] for row in weather]
        price_times = [row["time"] for row in prices]
        start = dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc)
        expected_times = [(start + dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(expected)]
        normalized_times = [dt.datetime.fromisoformat(t.replace("Z", "+00:00")).strftime("%Y-%m-%dT%H:%M:%SZ") for t in times]
        check(f"hourly_coverage_{year}", normalized_times == expected_times and len(set(times)) == expected,
              weather_hours=len(weather), expected_hours=expected)
        check(f"price_coverage_{year}", set(times) == set(price_times) and len(price_times) == expected,
              market_hours=len(prices), expected_hours=expected)
        check(f"energy_ordering_{year}", 0 <= summary["shadedKwh"] <= summary["weatherKwh"] + 1e-7,
              weather_kwh=summary["weatherKwh"], shaded_kwh=summary["shadedKwh"])
        check(f"finite_summary_{year}", all(not isinstance(v, (float, int)) or math.isfinite(v) for v in summary.values()))
        check(f"prices_matched_{year}", summary["pricedHours"] == expected,
              matched_hours=summary["pricedHours"])
        monthly_total = sum(row["shadedKwh"] for row in result["monthly"])
        check(f"monthly_annual_parity_{year}", abs(monthly_total - summary["shadedKwh"]) < 1e-7,
              monthly_shaded_kwh=monthly_total, annual_shaded_kwh=summary["shadedKwh"])
        consumption_balanced = all(
            abs(row["consumptionKwh"] - row["selfConsumedKwh"] - row["importKwh"]) < 1e-7
            and abs(row["shadedKwh"] - row["selfConsumedKwh"] - row["exportKwh"]) < 1e-7
            and min(row["consumptionKwh"], row["selfConsumedKwh"], row["importKwh"], row["exportKwh"]) >= -1e-9
            for row in result["hourly"]
        )
        check(f"consumption_energy_balance_{year}", consumption_balanced,
              hours_checked=len(result["hourly"]))
        check(f"consumption_coverage_{year}", summary["consumptionCoveragePct"] == 100,
              coverage_pct=summary["consumptionCoveragePct"], mode=analysis["consumption"]["mode"])
        check(f"consumption_value_balance_{year}",
              abs(summary["netBenefitEur"] - summary["avoidedImportCostEur"] - summary["exportRevenueEur"]) < 1e-7
              and abs(summary["netBenefitEur"] - summary["baselineImportCostEur"] + summary["netGridCostEur"]) < 1e-7)
        consumption_total = sum(row["consumptionKwh"] for row in result["monthly"])
        check(f"consumption_monthly_parity_{year}", abs(consumption_total - summary["consumptionKwh"]) < 1e-7,
              monthly_consumption_kwh=consumption_total, annual_consumption_kwh=summary["consumptionKwh"])
        battery_balanced = all(
            abs(row["chargeKwh"] - row["chargePvKwh"] - row["chargeGridKwh"]) < 1e-7
            and abs(row["internalChargedKwh"] - row["chargeKwh"] + row["chargeLossKwh"]) < 1e-7
            and abs(row["internalDischargedKwh"] - row["dischargeKwh"] - row["dischargeLossKwh"]) < 1e-7
            and abs(row["socEndKwh"] - row["socStartKwh"] - row["internalChargedKwh"] + row["internalDischargedKwh"]) < 1e-7
            and abs(row["pvKwh"] + row["importKwh"] + row["dischargeKwh"] - row["demandKwh"] - row["exportKwh"] - row["chargeKwh"]) < 1e-7
            and all(storage["reserveKwh"] - 1e-7 <= row[key] <= storage["effectiveCapacityKwh"] + 1e-7
                    for key in ("socStartKwh", "socEndKwh", "maxSocKwh"))
            and abs(row["pvSocEndKwh"] + row["gridSocEndKwh"] - row["socEndKwh"] + storage["reserveKwh"]) < 1e-7
            for row in battery["hourly"]
        ) and abs(battery_summary["socEndKwh"] - storage["reserveKwh"]) < 1e-7
        check(f"storage_energy_balance_{year}", battery_balanced,
              reason="Battery conversion losses, state changes and grid/PV/load flows balance at every modeled hour.")
        check(f"storage_value_balance_{year}",
              abs(battery_summary["operatingCostEur"] - battery_summary["gridImportCostEur"] + battery_summary["exportRevenueEur"] - battery_summary["cyclingCostEur"]) < 1e-7
              and abs(battery_summary["netBenefitEur"] - battery_summary["baselineImportCostEur"] + battery_summary["operatingCostEur"]) < 1e-7
              and abs(battery_summary["incrementalBenefitEur"] - battery_summary["noBatteryNetGridCostEur"] + battery_summary["operatingCostEur"]) < 1e-7
              and abs(battery_summary["noBatteryNetBenefitEur"] - summary["netBenefitEur"]) < 1e-7
              and battery_summary["incrementalBenefitEur"] >= -1e-7)
        check(f"storage_coverage_{year}", battery_summary["coveragePct"] == 100,
              coverage_pct=battery_summary["coveragePct"])
        check(f"storage_disabled_parity_{year}", storage["enabled"] or all(
            abs(battery_summary[battery_key] - summary[base_key]) < 1e-7
            for battery_key, base_key in (("importKwh", "importKwh"), ("exportKwh", "exportKwh"),
                                          ("netBenefitEur", "netBenefitEur"))) ,
              reason="When disabled, storage retains the original imports, exports and household benefit.")
        check(f"storage_monthly_parity_{year}", all(
            abs(sum(row[key] for row in battery["monthly"]) - battery_summary[key]) < 1e-7
            for key in ("chargeKwh", "dischargeKwh", "lossKwh", "incrementalBenefitEur")))
    for key, rows in (("seasonal_summary", seasonal), ("hourly_results", hourly), ("monthly_results", monthly),
                      ("storage_summary", storage_seasonal), ("storage_hourly", storage_hourly),
                      ("storage_monthly", storage_monthly)):
        output = project["outputs"][key]
        columns = [column["name"] for column in output["table"]["columns"]]
        if any(set(row) != set(columns) for row in rows):
            raise ValueError(f"Declared {key} columns differ from the shared analysis engine")
        table(output["path"], rows, columns)
    write("data/derived/planning-scenario.geojson", scenario)

    # Independent truth is unavailable; absence is recorded as not_testable.
    check("owner_15min_field_validation", status="not_testable",
          reason="No owner production CSV was supplied; no measured accuracy is claimed.")
    check("aerial_pv_detection_validation", status="not_testable",
          reason="Later phase: no trained detector, installation labels or evaluated inference.")
    check("government_installation_reconciliation", status="not_testable",
          reason="Available solar thematic data are municipality aggregates, not installation geometry.")

    # STEP 4 — publish immutable data for the browser and canonical CSV downloads.
    copies = {
        **{f"data/source/{kind}-{year}.json": f"public/data/{kind}-{year}.json"
           for kind in ("weather", "prices") for year in (2024, 2025)},
        "data/source/context-grid.json": "public/data/terrain.json",
        "data/source/buildings.geojson": "public/data/buildings.geojson",
        "data/source/aerial.jpg": "public/data/aerial.jpg",
        "data/source/aerial.json": "public/data/aerial.json",
        "data/source/government-aggregates.json": "public/data/government.json",
        "data/derived/planning-scenario.geojson": "public/data/scenario.geojson",
        "data/derived/seasonal-summary.csv": "public/data/seasonal-summary.csv",
        "data/derived/hourly.csv": "public/data/hourly.csv",
        "data/derived/monthly.csv": "public/data/monthly.csv",
        "data/derived/storage-summary.csv": "public/data/storage-summary.csv",
        "data/derived/storage-hourly.csv": "public/data/storage-hourly.csv",
        "data/derived/storage-monthly.csv": "public/data/storage-monthly.csv",
    }
    for source, destination in copies.items():
        (ROOT / destination).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / source, ROOT / destination)
    completed = dt.datetime.now(dt.timezone.utc).isoformat()
    status = "failed" if any(c["status"] == "failed" for c in checks) else "warning"
    project["project"]["status"] = "failed" if status == "failed" else "warning"
    project["project"]["updated_at"] = completed
    aerial = read("data/source/aerial.json")
    payload = {
        "schema": "pv-location-project/v1", "project": project["project"],
        "author": project["project"]["author"], "generated_with": project["project"]["generated_with"],
        "run": {"id": run_id, "completed_at": completed, "status": status},
        "sources": [{"id": key, **source, "retrieved_at": source["access"]["retrieved_at"]}
                    for key, source in project["sources"].items()],
        "warnings": project["warnings"], "assumptions": project["interpretation"]["assumptions"],
        "canonical": {"year": 2025, "system": system, "polygon": feature["geometry"],
                      "consumption": consumption, "storage": storage},
        "results": {year: {**{key: result[key] for key in ("summary", "monthly", "quality")},
                           "storage": {key: result["storage"][key]
                                       for key in ("config", "summary", "monthly", "quality", "assumptions")}}
                    for year, result in analysis["years"].items()},
        "data": {"weather": {str(y): f"data/weather-{y}.json" for y in (2024, 2025)},
                 "prices": {str(y): f"data/prices-{y}.json" for y in (2024, 2025)},
                 "terrain": "data/terrain.json", "buildings": "data/buildings.geojson",
                 "government": "data/government.json", "scenario": "data/scenario.geojson",
                 "aerial": "data/aerial.jpg", "aerialMetadata": "data/aerial.json"},
        "aerial": {"url": "data/aerial.jpg", "coordinates": aerial["coordinatesWgs84NW_NE_SE_SW"],
                   "attribution": aerial["attribution"]},
        "bounds": aerial["aoiCornersWgs84"],
        "downloads": {"summary": "data/seasonal-summary.csv", "hourly": "data/hourly.csv",
                      "monthly": "data/monthly.csv", "scenario": "data/scenario.geojson",
                      "storageSummary": "data/storage-summary.csv", "storageHourly": "data/storage-hourly.csv",
                      "storageMonthly": "data/storage-monthly.csv",
                      "report": "data/canonical-report.pdf"},
    }
    write("public/data/project.json", payload)
    # The published PDF is generated from canonical modeled values, without
    # personal uploaded consumption records or an invented app screenshot.
    run("node", "scripts/canonical-report.mjs")
    pdf_bytes = (ROOT / "public/data/canonical-report.pdf").read_bytes()
    check("canonical_pdf_generated", pdf_bytes.startswith(b"%PDF-") and len(pdf_bytes) > 1000,
          reason="The shared report builder emitted a PDF with scenario, consumption and evidence pages.")
    if not pdf_bytes.startswith(b"%PDF-") or len(pdf_bytes) <= 1000:
        raise ValueError("Canonical PDF report was not produced as a valid PDF document")

    # STEP 5 — canonical app build plus static, input-bound provenance/evidence.
    run("npm", "run", "build")
    # A selected dashboard is its complete bundle, including hashed JS/CSS,
    # worker modules and copied data. Keep every byte in the run inventory.
    for key in list(project["outputs"]):
        if key.startswith("bundle_"):
            del project["outputs"][key]
    for bundle_file in sorted((ROOT / "dist").rglob("*")):
        if bundle_file.is_file() and bundle_file.name != "index.html":
            relative = bundle_file.relative_to(ROOT).as_posix()
            if any(output["path"] == relative for output in project["outputs"].values()):
                continue
            key = "bundle_" + relative.removeprefix("dist/").replace("/", "_").replace(".", "_").replace("-", "_")
            project["outputs"][key] = {"path": relative, "format": bundle_file.suffix.lstrip(".").upper(),
                                       "kind": "document", "generated_by": "render"}
    identical_table = all((ROOT / f"data/derived/{name}.csv").read_bytes()
                          == (ROOT / f"dist/data/{name}.csv").read_bytes()
                          for name in ("seasonal-summary", "storage-summary"))
    check("hosted_table_matches_canonical", identical_table)
    if not identical_table:
        raise ValueError("Hosted seasonal table differs from canonical analytical output")
    target = project["delivery"]["targets"][0]
    path = ROOT / project["outputs"][target["output"]]["path"]
    provenance = "".join(f'<li>{html.escape(s["provider"])} — {html.escape(s["dataset"])} '
                         f'(<a href="{html.escape(s["source_url"], quote=True)}">source</a>), '
                         f'{html.escape(s["license"]["name"])}, retrieved {html.escape(s["access"]["retrieved_at"])}</li>'
                         for s in project["sources"].values())
    warnings = "".join(f'<li><strong>{html.escape(w["id"])}</strong>: {html.escape(w["statement"])}</li>' for w in project["warnings"])
    footer = (f'<footer id="provenance" class="canonical-provenance" data-openmapstack-provenance>'
              f'{html_credits(credit_payload(project, completed_at=completed))}'
              f'<h2>Canonical baseline sources and limitations</h2><ul>{provenance}</ul><ul id="warnings">{warnings}</ul>'
              '<a href="./findings.md">Canonical findings</a> · '
              '<a href="./data/seasonal-summary.csv">Seasonal CSV</a> · '
              '<a href="./data/storage-summary.csv">Storage CSV</a> · '
              '<a href="./data/canonical-report.pdf">Canonical PDF report</a></footer>')
    metadata = metadata_json(ROOT, project, target)
    document = path.read_text()
    # The toolkit's dashboard verifier opens file://, and an inspectable result
    # should also work there. Inline the already bundled application and data;
    # Vite's worker&inline and MapLibre's Blob worker retain background compute.
    embedded = {p.relative_to(ROOT / "public").as_posix(): json.loads(p.read_text())
                for p in sorted((ROOT / "public/data").glob("*.json"))}
    embedded.update({p.relative_to(ROOT / "public").as_posix(): json.loads(p.read_text())
                     for p in sorted((ROOT / "public/data").glob("*.geojson"))})
    data_json = json.dumps(embedded, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    aerial_data = "data:image/jpeg;base64," + base64.b64encode((ROOT / "public/data/aerial.jpg").read_bytes()).decode()
    preload = f'<script>window.__PV_DATA__={data_json};window.__PV_AERIAL_URL__={json.dumps(aerial_data)};</script>'
    document = document.replace("</head>", preload + "</head>")

    def inline_script(match):
        script_path = (path.parent / match.group(1)).resolve()
        script = re.sub(r"</script", lambda closing: "<\\/" + closing.group(0)[2:],
                        script_path.read_text(), flags=re.IGNORECASE)
        return f'<script type="module">{script}</script>'

    document = re.sub(r'<script\b[^>]*\bsrc="([^"]+)"[^>]*></script>', inline_script, document)

    def inline_style(match):
        css = (path.parent / match.group(1)).read_text()
        return f"<style>{css}</style>"

    document = re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', inline_style, document)
    # Libraries may contain literal HTML inside their JavaScript strings.
    # Only the document's final closing body tag is the insertion boundary.
    body, closing_body, tail = document.rpartition("</body>")
    if not closing_body:
        raise ValueError("Built dashboard has no closing body tag")
    document = (body + footer
                + f'<script id="openmapstack-view" type="application/json">{metadata}</script>'
                + closing_body + tail)
    path.write_text(document)
    write_evidence(ROOT, project)

    # STEP 6 — durable findings, complete run inventories and status propagation.
    report = {"run_id": run_id, "status": status, "checks": checks}
    findings = []
    for row in seasonal:
        battery_summary = next(value for value in storage_seasonal if value["year"] == row["year"])
        battery_statement = (
            f" With {storage['effectiveCapacityKwh']:g} kWh storage enabled, modeled PV-plus-storage "
            f"benefit is {battery_summary['netBenefitEur']:.2f} EUR, an incremental "
            f"{battery_summary['incrementalBenefitEur']:.2f} EUR after cycling cost. "
            f"Storage conversion loss is {battery_summary['lossKwh']:.1f} kWh."
            if storage["enabled"] else
            f" Storage is explicitly disabled; the configured capacity would be "
            f"{storage['effectiveCapacityKwh']:g} kWh. The separate storage table retains the "
            "same imports, exports and benefit with zero dispatch."
        )
        findings.append({"id": f"season_{row['year']}",
                         "statement": (f"{row['year']}: clear-sky estimate {row['clearKwh']:.1f} kWh; "
                            f"weather-adjusted shadow-free {row['weatherKwh']:.1f} kWh; "
                            f"locally shaded {row['shadedKwh']:.1f} kWh. Local shadow loss "
                            f"{row['shadingLossKwh']:.1f} kWh ({row['shadingLossPct']:.2f}%). "
                            f"If all generation were exported, wholesale revenue after margin would be "
                            f"{row['shadedRevenueEur']:.2f} EUR; the corresponding all-export shadow loss "
                            f"would be {row['shadowRevenueLossEur']:.2f} EUR. With the declared day/night "
                            f"consumption assumption, demand is {row['consumptionKwh']:.1f} kWh, "
                            f"self-consumed PV {row['selfConsumedKwh']:.1f} kWh, surplus export "
                            f"{row['exportKwh']:.1f} kWh and grid import {row['importKwh']:.1f} kWh. "
                            f"Surplus sales are {row['exportRevenueEur']:.2f} EUR and avoided import cost "
                            f"{row['avoidedImportCostEur']:.2f} EUR, giving net PV benefit "
                            f"{row['netBenefitEur']:.2f} EUR. Local shadows reduce this combined value "
                            f"by {row['shadowNetBenefitLossEur']:.2f} EUR versus shadow-free weather."
                            + battery_statement),
                         "evidence": ["seasonal_summary", "planning_scenario", "hourly_results", "storage_summary"],
                         "limitations": [
                             f"Hypothetical array and estimated {consumption['dayKwh']:g} kWh daytime / "
                             f"{consumption['nightKwh']:g} kWh nighttime local daily demand in "
                             f"{consumption['timeZone']}; daytime is {consumption['dayStartHour']:02d}:00–"
                             f"{consumption['dayEndHour']:02d}:00. The import adder is "
                             f"{consumption['importAdderEurMWh']:g} EUR/MWh; charges are included only "
                             "when explicitly represented in that adder. No owner field validation.",
                             *(["Storage dispatch uses known historical daily prices and finite state resolution. "
                                "Every local-day or covered segment starts and ends at reserve; energy is not "
                                "carried overnight or across unknown input gaps. This is not a live trading "
                                "forecast or a guarantee of a global optimum."] if storage["enabled"] else [])
                         ]})
    findings_path = write_findings(ROOT, project, report=report,
                                  scope=f"one hypothetical {system['kwp']:g} kWp array within the retained manifest AOI, complete UTC years 2024 and 2025",
                                  findings=findings)
    # Hosted reading copy: the canonical findings retain structured metadata;
    # this companion uses the same generated prose with app-local evidence links.
    hosted_findings = findings_path.read_text().split("\n---\n", 1)[1]
    for source, bundled in {"data/derived/seasonal-summary.csv": "data/seasonal-summary.csv",
                            "data/derived/storage-summary.csv": "data/storage-summary.csv",
                            "data/derived/hourly.csv": "data/hourly.csv",
                            "data/derived/planning-scenario.geojson": "data/scenario.geojson",
                            "project.yaml": "https://github.com/jaakla/openmapstack-samples/blob/main/pv-location/project.yaml",
                            "validation/latest-report.json": "https://github.com/jaakla/openmapstack-samples/blob/main/pv-location/validation/latest-report.json"}.items():
        hosted_findings = hosted_findings.replace(f"]({source})", f"]({bundled})")
    (ROOT / "dist/findings.md").write_text(hosted_findings)
    inputs = declared_input_paths(ROOT, project)
    outputs = declared_output_paths(project)
    inputs_hash = canonical_file_set_hash(ROOT, inputs)
    outputs_hash = canonical_file_set_hash(ROOT, outputs)
    report.update(inputs_hash=inputs_hash, outputs_hash=outputs_hash)
    write("validation/latest-report.json", report)
    record = {"run_id": run_id, "status": status, "started_at": started.isoformat(),
              "completed_at": completed, "inputs_hash": inputs_hash, "outputs_hash": outputs_hash,
              "inputs": file_inventory(ROOT, inputs), "outputs": file_inventory(ROOT, outputs),
              "environment": {"python": platform.python_version(), "node": subprocess.check_output(["node", "--version"], text=True).strip()},
              "overrides": [{"id": "SCENARIO-001", "status": "applied"}]}
    write(f"runs/{run_id}.json", record)
    project["project"]["status"] = "failed" if status == "failed" else "warning"
    project["project"]["updated_at"] = completed
    project["runs"]["latest"] = {"id": run_id, "status": status, "started_at": started.isoformat(),
        "completed_at": completed, "inputs_hash": inputs_hash, "outputs_hash": outputs_hash,
        "record": {"path": f"runs/{run_id}.json"}, "validation_report": {"path": "validation/latest-report.json"}}
    (ROOT / "project.yaml").write_text(yaml.safe_dump(project, sort_keys=False, allow_unicode=True))
    if status == "failed":
        raise SystemExit("Analysis validation failed; inspect validation/latest-report.json")


if __name__ == "__main__":
    main()

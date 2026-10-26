import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Sun,
  MapPin,
  Download,
  Moon,
  RotateCcw,
  ChevronDown,
  FileText,
} from "lucide-react";
import MapView from "./MapView.jsx";
import Results from "./Results.jsx";
import AreaPanel from "./AreaPanel.jsx";
import {
  loadEstoniaArea,
  parseAreaBundle,
  serializeAreaBundle,
  verifyEstoniaFootprint,
} from "./areas.js";
import { DEFAULT_STORAGE, normalizeStorageConfig } from "./storage.js";
import { downloadFile } from "./downloads.js";
import { ScenarioPanel, EvidencePanel, ValidationPanel } from "./Panels.jsx";
import { polygonMetrics, solarPosition, validateSystem } from "./analysis.js";
import { withinCoverage } from "./geography.js";
import { exportScenario, exportHourly } from "./downloads.js";
import AnalysisWorker from "./analysis.worker.js?worker&inline";
import {
  DEFAULT_CONSUMPTION,
  normalizeConsumptionConfig,
} from "./consumption.js";
import "./styles.css";
async function json(url) {
  if (window.__PV_DATA__?.[url])
    return structuredClone(window.__PV_DATA__[url]);
  const r = await fetch(new URL(url, document.baseURI));
  if (!r.ok)
    throw new Error(
      `Could not load ${url} (${r.status}). Rebuild the canonical project data.`,
    );
  return r.json();
}
async function loadProject() {
  const project = await json("data/project.json");
  const [terrain, buildings, ...seasons] = await Promise.all([
    json(project.data.terrain),
    json(project.data.buildings || "data/buildings.geojson"),
    ...["2024", "2025"].flatMap((year) => [
      json(project.data.weather[year]),
      json(project.data.prices[year]),
    ]),
  ]);
  return {
    project,
    terrain,
    buildings,
    weather: { 2024: seasons[0], 2025: seasons[2] },
    prices: { 2024: seasons[1], 2025: seasons[3] },
  };
}
function App({ inputs }) {
  const canonical = inputs.project.canonical;
  const [areaContext, setAreaContext] = useState(null);
  const [areaLoading, setAreaLoading] = useState(""),
    [areaError, setAreaError] = useState("");
  const areaRequest = useRef();
  const footprintRequest = useRef();
  const terrain = areaContext?.terrain || inputs.terrain;
  const buildings = areaContext?.buildings || inputs.buildings;
  const weather = areaContext?.weather || inputs.weather;
  const area = areaContext
    ? {
        id: areaContext.id,
        name: `${areaContext.name} · Estonia`,
        center: [areaContext.center.longitude, areaContext.center.latitude],
      }
    : {
        id: "canonical",
        name: "Tartu, Estonia",
        center: [canonical.system.longitude, canonical.system.latitude],
      };
  const project = useMemo(
    () =>
      areaContext
        ? {
            ...inputs.project,
            liveContext: {
              id: areaContext.id,
              name: `${areaContext.name} · Estonia`,
              center: areaContext.center,
              bounds: areaContext.bounds,
              provenance: areaContext.provenance,
            },
            project: {
              ...inputs.project.project,
              aoi: { bbox: areaContext.bounds, crs: "EPSG:3301" },
            },
            aerial: areaContext.aerialMetadata,
            data: { ...inputs.project.data, aerial: areaContext.aerialURL },
            sources: [
              ...inputs.project.sources.filter((source) =>
                /ee_prices/.test(source.id),
              ),
              ...areaContext.sources,
            ],
            warnings: [
              ...inputs.project.warnings,
              ...areaContext.warnings.map((statement, index) => ({
                id: `live_${index}`,
                statement,
              })),
            ],
            downloads: {},
          }
        : inputs.project,
    [inputs.project, areaContext],
  );
  const [storage, setStorage] = useState(canonical.storage || DEFAULT_STORAGE);
  const [system, setSystem] = useState(canonical.system),
    [polygon, setPolygon] = useState(canonical.polygon),
    [year, setYear] = useState(canonical.year),
    [tab, setTab] = useState("Scenario");
  const [consumption, setConsumption] = useState(
    canonical.consumption || DEFAULT_CONSUMPTION,
  );
  const [exporting, setExporting] = useState(false),
    [exportMenu, setExportMenu] = useState(false),
    [pdfError, setPdfError] = useState("");
  const captureMapRef = useRef();
  const exportStateRef = useRef();
  const [drawing, setDrawing] = useState(false),
    [resetVersion, setResetVersion] = useState(0),
    [draft, setDraft] = useState([]),
    [day, setDay] = useState("2025-06-21"),
    [hour, setHour] = useState(12),
    [theme, setTheme] = useState("light");
  const [analysis, setAnalysis] = useState(project.results?.[year] || null),
    [horizon, setHorizon] = useState(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  exportStateRef.current = {
    system,
    polygon,
    year,
    consumption,
    storage,
    day,
    hour,
    areaContext,
  };
  const worker = useRef(),
    sequence = useRef(0);
  const metrics = useMemo(() => {
    try {
      return polygonMetrics(polygon);
    } catch {
      return null;
    }
  }, [polygon]);
  const sun = useMemo(
    () =>
      solarPosition(
        new Date(`${day}T00:00:00Z`).getTime() + hour * 3600000,
        metrics?.latitude ?? system.latitude,
        metrics?.longitude ?? system.longitude,
      ),
    [day, hour, metrics, system.latitude, system.longitude],
  );
  const exploratory =
    !!areaContext ||
    Object.keys(DEFAULT_STORAGE).some(
      (key) => storage[key] !== (canonical.storage || DEFAULT_STORAGE)[key],
    ) ||
    JSON.stringify(system) !== JSON.stringify(canonical.system) ||
    JSON.stringify(polygon) !== JSON.stringify(canonical.polygon) ||
    year !== canonical.year ||
    JSON.stringify(consumption) !==
      JSON.stringify(canonical.consumption || DEFAULT_CONSUMPTION);
  useEffect(() => {
    document.documentElement.dataset.omsState = exploratory
      ? "exploratory"
      : "canonical";
  }, [exploratory]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const w = new AnalysisWorker();
    worker.current = w;
    w.postMessage({
      type: "init",
      inputs: { terrain, weather, prices: inputs.prices },
    });
    w.onmessage = ({ data }) => {
      if (data.id !== sequence.current) return;
      setBusy(false);
      if (data.error) {
        setError(data.error);
        setAnalysis(null);
      } else {
        setAnalysis(data.analysis);
        setHorizon(data.horizon);
        setError("");
      }
    };
    w.onerror = () => {
      setError("The analysis worker failed. Reload the app to retry.");
      setBusy(false);
    };
    return () => w.terminate();
  }, [inputs, terrain, weather]);
  useEffect(() => {
    const id = ++sequence.current;
    if (!polygon) {
      setBusy(false);
      setAnalysis(null);
      setHorizon(null);
      return;
    }
    setBusy(true);
    const timer = setTimeout(
      () =>
        worker.current?.postMessage({
          id,
          system,
          polygon,
          year,
          consumption,
          storage,
        }),
      120,
    );
    return () => clearTimeout(timer);
  }, [system, polygon, year, consumption, storage, terrain]);
  const cancelArea = () => {
    areaRequest.current?.abort();
    if (footprintRequest.current) {
      footprintRequest.current.abort();
      setBusy(false);
    }
    footprintRequest.current = null;
    areaRequest.current = null;
    setAreaLoading("");
  };
  useEffect(
    () => () => {
      areaRequest.current?.abort();
      footprintRequest.current?.abort();
    },
    [],
  );
  const activateArea = (next) => {
    setAreaContext(next);
    setPolygon(null);
    setAnalysis(null);
    setHorizon(null);
    setSystem((current) => ({
      ...current,
      longitude: next.center.longitude,
      latitude: next.center.latitude,
    }));
    setDraft([]);
    setDrawing(true);
    setError("");
    setPdfError("");
    setAreaError("");
    setResetVersion((value) => value + 1);
  };
  const loadArea = async (coordinate) => {
    cancelArea();
    const request = new AbortController();
    areaRequest.current = request;
    setAreaError("");
    setAreaLoading("Checking Estonian land coverage…");
    try {
      const next = await loadEstoniaArea(coordinate, {
        signal: request.signal,
        onProgress: (message) => {
          if (areaRequest.current === request)
            setAreaLoading(
              typeof message === "string"
                ? message
                : message.message || "Loading source data…",
            );
        },
        years: [2024, 2025],
      });
      if (!request.signal.aborted && areaRequest.current === request)
        activateArea(next);
    } catch (err) {
      if (!request.signal.aborted && areaRequest.current === request)
        setAreaError(
          `Area could not be loaded: ${err.message} The previous area is retained.`,
        );
    } finally {
      if (areaRequest.current === request) {
        areaRequest.current = null;
        setAreaLoading("");
      }
    }
  };
  const importArea = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    cancelArea();
    try {
      if (file.size > 40e6) throw new Error("Area bundle exceeds 40 MB.");
      const next = await parseAreaBundle(await file.text());
      activateArea(next);
    } catch (err) {
      setAreaError(`Could not import area bundle: ${err.message}`);
    }
    event.target.value = "";
  };
  const exportArea = async () => {
    try {
      downloadFile(
        "solar-atlas-estonia-area.json",
        await serializeAreaBundle(areaContext),
      );
    } catch (err) {
      setAreaError(`Could not save area bundle: ${err.message}`);
    }
  };
  const reset = () => {
    cancelArea();
    setAreaContext(null);
    setAreaError("");
    setStorage(canonical.storage || DEFAULT_STORAGE);
    setResetVersion((value) => value + 1);
    setSystem(canonical.system);
    setPolygon(canonical.polygon);
    setYear(canonical.year);
    setConsumption(canonical.consumption || DEFAULT_CONSUMPTION);
    setPdfError("");
    setDrawing(false);
    setDraft([]);
    setError("");
  };
  const verifyFootprint = async (shape) => {
    if (!areaContext) return;
    footprintRequest.current?.abort();
    const request = new AbortController();
    footprintRequest.current = request;
    ++sequence.current;
    setBusy(true);
    try {
      await verifyEstoniaFootprint(shape, { signal: request.signal });
      if (request.signal.aborted)
        throw new DOMException("Footprint check cancelled.", "AbortError");
    } finally {
      if (footprintRequest.current === request) {
        footprintRequest.current = null;
        setBusy(false);
      }
    }
  };
  const changePolygon = async (shape) => {
    try {
      const m = polygonMetrics(shape);
      if (!withinCoverage(shape.coordinates[0], terrain))
        throw new Error(
          "The footprint must remain inside the measured coverage, 25 m from its boundary.",
        );
      if (m.areaM2 > 100000)
        throw new Error(
          "Use a footprint smaller than 10 hectares for this nine-sample pilot.",
        );
      await verifyFootprint(shape);
      setPolygon(shape);
      setSystem((s) => ({
        ...s,
        latitude: m.latitude,
        longitude: m.longitude,
      }));
      setError("");
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    }
  };
  const importScenario = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20e6) throw new Error("Scenario exceeds 20 MB.");
      const input = JSON.parse(await file.text());
      if (input.type === "FeatureCollection" && input.features?.length !== 1)
        throw new Error(
          "Import a GeoJSON collection containing exactly one Polygon feature.",
        );
      const item =
        input.type === "FeatureCollection"
          ? input.features?.[0]
          : input.type === "Feature"
            ? input
            : { geometry: input, properties: {} };
      if (item.geometry?.type !== "Polygon")
        throw new Error("Import one Polygon feature in WGS84 GeoJSON.");
      const m = polygonMetrics(item.geometry);
      if (
        !withinCoverage(item.geometry.coordinates[0], terrain) ||
        m.areaM2 > 100000
      )
        throw new Error(
          "Load the matching Estonia area or import its area bundle first. The site must fit inside its measured coverage and be smaller than 10 hectares.",
        );
      const allowed = Object.fromEntries(
        [
          "kwp",
          "azimuthDeg",
          "tiltDeg",
          "mountingHeightM",
          "systemLossPct",
          "salesMarginEurMWh",
        ]
          .filter((k) => item.properties?.[k] != null)
          .map((k) => [k, item.properties[k]]),
      );
      // Older scenarios did not declare power limits; do not inherit a previous
      // scenario's limits when importing those files. Explicit null clears a cap.
      allowed.inverterAcKw = item.properties?.inverterAcKw ?? null;
      allowed.gridExportLimitKw = item.properties?.gridExportLimitKw ?? null;
      const checked = validateSystem({
        ...system,
        ...allowed,
        polygon: item.geometry,
      });
      const importedConsumption = normalizeConsumptionConfig(
        item.properties?.consumption ||
          canonical.consumption ||
          DEFAULT_CONSUMPTION,
      );
      await verifyFootprint(item.geometry);
      const importedStorage = normalizeStorageConfig(
        item.properties?.storage || canonical.storage || DEFAULT_STORAGE,
        checked,
      );
      setPolygon(item.geometry);
      setStorage(importedStorage);
      setConsumption(importedConsumption);
      setSystem({
        ...system,
        ...allowed,
        latitude: checked.latitude,
        longitude: checked.longitude,
      });
      setError("");
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    }
    e.target.value = "";
  };
  useEffect(() => {
    if (!exportMenu) return;
    const closeOutside = (event) => {
      if (!event.target.closest?.(".export-control")) setExportMenu(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") setExportMenu(false);
    };
    document.addEventListener("click", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [exportMenu]);
  const exportPdf = async () => {
    if (busy || areaLoading || !analysis?.hourly || exporting || drawing)
      return;
    const snapshot = exportStateRef.current;
    setExporting(true);
    setPdfError("");
    setExportMenu(false);
    try {
      let mapImage;
      try {
        mapImage = await captureMapRef.current?.();
        if (mapImage)
          mapImage.caption += ` · shadow snapshot ${day} ${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")} UTC`;
      } catch {
        /* PDF retains the georeferenced site diagram if a canvas is unavailable. */
      }
      if (
        Object.keys(snapshot).some(
          (key) => snapshot[key] !== exportStateRef.current[key],
        )
      )
        throw new Error(
          "The scenario changed while capturing the map. Export again to use the new values.",
        );
      const { downloadScenarioReport } = await import("./report.js");
      await downloadScenarioReport({
        project,
        system,
        polygon,
        analysis,
        horizon,
        consumption,
        storage,
        mapImage,
        scenarioState: exploratory ? "exploratory" : "canonical",
      });
    } catch (err) {
      setPdfError(`Could not create the PDF: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <Sun size={34} />
          <h1>Solar Atlas</h1>
          <span>by OpenMapStack</span>
        </div>
        <div className="location">
          <MapPin size={17} />
          {area.name}
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}
            disabled={exporting}
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label="Download modeled hourly CSV"
            title="Download modeled hourly CSV"
            disabled={busy || !!areaLoading || exporting || !analysis?.hourly}
            onClick={() => exportHourly(analysis)}
          >
            <Download size={18} />
          </button>
          <div className="export-control">
            <button
              className="primary export-scenario"
              onClick={exportPdf}
              disabled={
                busy ||
                !!areaLoading ||
                exporting ||
                drawing ||
                !analysis?.hourly ||
                !!error
              }
              title="Download a PDF report of the current scenario"
            >
              {exporting ? "Building PDF…" : "Export scenario"}
              <FileText size={15} />
            </button>
            <button
              className="primary export-options"
              aria-label="More scenario export options"
              aria-haspopup="menu"
              aria-expanded={exportMenu}
              disabled={exporting || busy || !!areaLoading || !!error}
              onClick={() => setExportMenu((v) => !v)}
            >
              <ChevronDown size={15} />
            </button>
            {exportMenu ? (
              <div className="export-menu" role="menu">
                <button
                  role="menuitem"
                  disabled={busy || exporting || drawing || !!error}
                  onClick={() => {
                    try {
                      exportScenario(
                        system,
                        polygon,
                        project,
                        consumption,
                        storage,
                      );
                      setPdfError("");
                    } catch (err) {
                      setPdfError(
                        `Could not export the scenario: ${err.message}`,
                      );
                    }
                    setExportMenu(false);
                  }}
                >
                  Scenario GeoJSON
                </button>
                <button
                  role="menuitem"
                  disabled={
                    busy || !!areaLoading || exporting || !analysis?.hourly
                  }
                  onClick={() => {
                    exportHourly(analysis);
                    setExportMenu(false);
                  }}
                >
                  Hourly energy CSV
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {pdfError ? (
        <div className="app-error" role="alert">
          {pdfError}
        </div>
      ) : null}
      <main
        className={`workspace ${storage.enabled ? "with-storage" : ""}`}
        inert={exporting}
        aria-busy={exporting}
      >
        <aside className="planning-rail">
          <div className="rail-heading">
            <h2>Plan a solar site</h2>
            <p>
              Define a PV system and analyze potential shadows and estimated
              energy yield.
            </p>
          </div>
          <div className="tabs" role="tablist" aria-label="Planning panels">
            {["Scenario", "Evidence", "Validate"].map((name) => (
              <button
                key={name}
                id={`tab-${name}`}
                role="tab"
                aria-selected={tab === name}
                aria-controls={`panel-${name}`}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="panel-scroll">
            {["Scenario", "Evidence", "Validate"].map((name) => (
              <div
                role="tabpanel"
                id={`panel-${name}`}
                aria-labelledby={`tab-${name}`}
                hidden={tab !== name}
                key={name}
              >
                {name === "Scenario" ? (
                  <>
                    <AreaPanel
                      area={area}
                      loading={areaLoading}
                      error={areaError}
                      onLoad={loadArea}
                      onCancel={cancelArea}
                      onReset={reset}
                      onImport={importArea}
                      onExport={exportArea}
                    />
                    <ScenarioPanel
                      {...{
                        system,
                        storage,
                        setStorage,
                        resetVersion,
                        setSystem,
                        year,
                        setYear,
                        drawing,
                        setDrawing,
                        setDraft,
                        reset,
                        importScenario,
                        consumption,
                        setConsumption,
                        analysis,
                      }}
                      area={metrics?.areaM2}
                    />
                  </>
                ) : name === "Evidence" ? (
                  <EvidencePanel {...{ project, analysis, horizon }} />
                ) : (
                  <ValidationPanel
                    {...{
                      analysis,
                      system,
                      horizon,
                      busy,
                      consumption,
                      storage,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </aside>
        <div className="main-surface">
          <div className="state-line">
            <span>
              {exploratory
                ? "Exploratory scenario"
                : "Published planning scenario"}{" "}
              · {year}
            </span>
            <span data-oms-exploratory hidden={!exploratory}>
              Parameters differ from the canonical run.{" "}
              <button data-oms-reset onClick={reset}>
                <RotateCcw size={12} />
                Reset
              </button>
            </span>
            <span>
              {busy
                ? "Calculating…"
                : "Historical weather replay · no forecast"}
            </span>
          </div>
          {error ? (
            <div className="app-error" role="alert">
              {error}
            </div>
          ) : null}
          <MapView
            key={area.id}
            {...{
              resetVersion,
              captureMapRef,
              project,
              terrain,
              buildings,
              polygon,
              drawing,
              setDrawing,
              draft,
              setDraft,
              sun,
              day,
              setDay,
              hour,
              setHour,
              theme,
            }}
            areaCenter={area.center}
            onPolygon={changePolygon}
            heightM={system.mountingHeightM}
          />
          {!polygon ? (
            <div className="empty-site" role="status">
              New area loaded. Draw your PV footprint on the map to calculate
              this site.
            </div>
          ) : null}
          <Results {...{ analysis, year, busy, horizon, consumption }} />
        </div>
      </main>
      <div className="source-strip">
        <span>Weather: Copernicus ERA5 via Open-Meteo</span>
        <span>Surface: Maa- ja Ruumiamet DSM / DTM</span>
        <span>EE prices: Elering · {year}</span>
        <a
          href="https://github.com/jaakla/openmapstack-samples/tree/main/pv-location"
          target="_blank"
          rel="noreferrer"
        >
          Source project ↗
        </a>
      </div>
    </>
  );
}
function Bootstrap() {
  const [inputs, setInputs] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    loadProject()
      .then(setInputs)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <main className="boot-message">
        <Sun size={38} />
        <h1>Solar Atlas</h1>
        <p role="alert">{error}</p>
        <p>Run the documented pipeline to prepare pinned source data.</p>
      </main>
    );
  return inputs ? (
    <App inputs={inputs} />
  ) : (
    <main className="boot-message">
      <Sun size={38} />
      <h1>Solar Atlas</h1>
      <p>Loading the reproducible Tartu pilot…</p>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Bootstrap />);

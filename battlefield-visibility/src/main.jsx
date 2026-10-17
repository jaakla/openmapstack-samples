import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Controls, LayerControls, Legend } from "./Controls.jsx";
import Provenance from "./Provenance.jsx";
import "./styles.css";
import { formatMGRS, parseMGRS, exportSnapshot } from "./coordinates.js";

const ZONES = ["UNKNOWN", "GREEN", "YELLOW", "RED"];
async function load() {
  const base = import.meta.env.BASE_URL;
  const get = async (path) => {
    const response = await fetch(`${base}${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const config = await (await get("data/scene.json")).json();
  const [dtm, dsm, scenario, provenance, { VisibilityScene }] =
    await Promise.all([
      get("data/dtm.bin").then((r) => r.arrayBuffer()),
      get("data/dsm.bin").then((r) => r.arrayBuffer()),
      get("data/scenario.json").then((r) => r.json()),
      get("data/provenance.json").then((r) => r.json()),
      import("./scene.js"),
    ]);
  return {
    config,
    grid: {
      ...config.grid,
      dtm: new Uint16Array(dtm),
      dsm: new Uint16Array(dsm),
    },
    scenario,
    provenance,
    VisibilityScene,
  };
}

function App() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("scenario");
  const [settings, setSettings] = useState(null),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const [layers, setLayers] = useState({}),
    [snapshot, setSnapshot] = useState(null),
    [busy, setBusy] = useState(true);
  const [target, setTarget] = useState(null),
    [exploratory, setExploratory] = useState(false);
  const [mgrsInput, setMgrsInput] = useState(""),
    [coordinateError, setCoordinateError] = useState(""),
    [secondary, setSecondary] = useState(false);
  const host = useRef(null),
    scene = useRef(null),
    worker = useRef(null),
    generation = useRef(0),
    time = useRef(0),
    state = useRef({});
  state.current = { settings, playing, speed, target };
  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (live) {
          setData(d);
          setSettings(d.config.defaults);
          setLayers(d.config.layers);
          setPlaying(d.config.playback.playing);
          setSpeed(d.config.playback.speed);
          setTarget(d.scenario.target);
        }
      })
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    let stopped = false,
      inFlight = false,
      lastWall = performance.now(),
      lastSent = -Infinity;
    const w = new Worker(new URL("./zones.worker.js", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.postMessage({ type: "init", grid: data.grid, scenario: data.scenario });
    const view = new data.VisibilityScene(host.current, data, (position) => {
      moveTarget(position);
    });
    scene.current = view;
    const sceneError = (e) => setError(e.detail);
    host.current.addEventListener("scene-error", sceneError);
    w.onmessage = ({ data: result }) => {
      inFlight = false;
      if (result.error) {
        setBusy(false);
        setError(result.error);
        return;
      }
      if (result.generation !== generation.current) return;
      setBusy(false);
      setSnapshot(result);
      view.updateSnapshot(result);
    };
    w.onerror = (e) => setError(`Visibility worker: ${e.message}`);
    const tick = () => {
      if (stopped) return;
      const now = performance.now(),
        dt = Math.min((now - lastWall) / 1000, 0.2);
      lastWall = now;
      const s = state.current;
      if (s.playing && !document.hidden) time.current += dt * s.speed;
      if (
        !inFlight &&
        s.settings &&
        s.target &&
        (generation.current !== lastSent ||
          (s.playing && now - view.lastUpdate > 1200))
      ) {
        inFlight = true;
        lastSent = generation.current;
        view.lastUpdate = now;
        setBusy(true);
        w.postMessage({
          settings: s.settings,
          target: s.target,
          time: time.current,
          generation: generation.current,
        });
      }
      view.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      stopped = true;
      w.terminate();
      host.current?.removeEventListener("scene-error", sceneError);
      view.dispose();
      scene.current = null;
    };
  }, [data]);
  useEffect(() => {
    scene.current?.setLayers(layers);
  }, [layers, data]);
  useEffect(() => {
    if (data && target) setMgrsInput(formatMGRS(data.config.origin, target));
  }, [data, target]);
  function moveTarget(position) {
    setTarget(position);
    setBusy(true);
    setExploratory(true);
    setCoordinateError("");
    generation.current++;
  }
  function applyCoordinate(e) {
    e.preventDefault();
    try {
      moveTarget(parseMGRS(data.config.origin, mgrsInput, data.grid));
    } catch (error) {
      setCoordinateError(error.message);
    }
  }
  function downloadSnapshot() {
    const blob = new Blob(
      [JSON.stringify(exportSnapshot(data.config, snapshot), null, 2) + "\n"],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "helsinki-uav-snapshot.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function change(key, value) {
    setBusy(true);
    setSettings((s) => ({ ...s, [key]: value }));
    setExploratory(true);
    generation.current++;
  }
  function reset() {
    setBusy(true);
    time.current = 0;
    setSettings({ ...data.config.defaults });
    setTarget([...data.scenario.target]);
    setSpeed(data.config.playback.speed);
    setPlaying(data.config.playback.playing);
    setLayers({ ...data.config.layers });
    setExploratory(false);
    setCoordinateError("");
    setSecondary(false);
    generation.current++;
    scene.current?.resetCamera();
  }
  const ready = data && settings;
  const zone = snapshot && !busy ? ZONES[snapshot.status.zone] : "COMPUTING";
  return (
    <>
      <header>
        <h1>Helsinki visibility</h1>
        <span>SIMULATED · NOT OPERATIONAL</span>
      </header>
      <main>
        <aside>
          <nav aria-label="Workspace">
            {["scenario", "layers", "sources"].map((id) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {id[0].toUpperCase() + id.slice(1)}
              </button>
            ))}
          </nav>
          <div className="sidebar-content">
            {ready ? (
              tab === "sources" ? (
                <Provenance config={data.provenance} />
              ) : tab === "layers" ? (
                <LayerControls layers={layers} setLayers={setLayers} />
              ) : (
                <>
                  <Controls
                    settings={settings}
                    change={change}
                    playing={playing}
                    setPlaying={(value) => {
                      setPlaying(value);
                      if (value) setExploratory(true);
                    }}
                    speed={speed}
                    setSpeed={(value) => {
                      setSpeed(value);
                      setExploratory(true);
                    }}
                  />
                  <details open>
                    <summary>Tracked UAVs</summary>
                    {snapshot?.sensors.length ? (
                      snapshot.sensors.map((sensor) => (
                        <button
                          className="track"
                          key={sensor.id}
                          onClick={() =>
                            scene.current?.focusVector("uav", sensor.id)
                          }
                        >
                          <span>
                            <i className="affiliation hostile" />
                            <strong>{sensor.id}</strong>
                            <small>{settings.uavHeight} m AGL</small>
                          </span>
                          <code>
                            {formatMGRS(data.config.origin, sensor.position)}
                          </code>
                          <small>
                            {busy
                              ? "Updating…"
                              : ZONES[
                                  snapshot.sightlines.find(
                                    (s) => s.id === sensor.id,
                                  )?.zone ?? 0
                                ]}{" "}
                            · own-position LOS
                          </small>
                        </button>
                      ))
                    ) : (
                      <p className="note">No active UAVs</p>
                    )}
                  </details>
                  <Legend />
                </>
              )
            ) : (
              <p className="loading">Loading measured source products…</p>
            )}
          </div>
          <button className="reset" disabled={!ready} onClick={reset}>
            Reset defaults
          </button>
        </aside>
        <section className="map" aria-label="Interactive 3D visibility scene">
          <div className="map-stage">
            <div className="canvas" ref={host} />
            <div className="map-title">
              <h2>Downtown Helsinki</h2>
              <small>
                {exploratory ? "Exploratory scenario" : "Published defaults"} ·{" "}
                {playing ? "Playing" : "Paused"}
              </small>
            </div>
            <div className="snapshot">
              <strong>t = {snapshot?.time.toFixed(1) ?? "0.0"} s</strong>
              <small>
                {busy ? "Computing…" : "1 m LOS surface · 5 min forecast"}
              </small>
            </div>
            <div className="map-tools">
              <button onClick={() => scene.current?.focusVector("uav")}>
                Find UAV
              </button>
              <button onClick={() => scene.current?.resetCamera()}>
                Reset view
              </button>
              <button
                aria-label="Zoom in"
                onClick={() => scene.current?.zoom(0.8)}
              >
                +
              </button>
              <button
                aria-label="Zoom out"
                onClick={() => scene.current?.zoom(1.25)}
              >
                −
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                Could not load the demo: {error}
              </div>
            )}
            <div className="map-hint">
              Drag orbit · two fingers pan / pinch · tap ground to relocate
            </div>
            <footer>
              © Helsingin kaupunkimittauspalvelut 2021 · CC BY 4.0 (modified) ·
              © OpenStreetMap contributors ·{" "}
              <a href={`${import.meta.env.BASE_URL}models/ATTRIBUTION.txt`}>
                LoD2 © City of Helsinki · CC BY 4.0 · Credits
              </a>
            </footer>
          </div>
          <div
            className={`position status-${zone.toLowerCase()}`}
            aria-live="polite"
          >
            <div className="position-heading">
              <strong>
                <i className="affiliation friendly" />
                OWN POSITION · {zone}
              </strong>
              <button disabled={!snapshot || busy} onClick={downloadSnapshot}>
                Export snapshot
              </button>
            </div>
            <p>
              {busy
                ? "Updating visibility for the selected position…"
                : snapshot?.status.visibleTo.length
                  ? `Visible to ${snapshot.status.visibleTo.join(", ")}`
                  : snapshot?.status.zone === 2
                    ? "Forecast visibility ≥25% in the sampled scenario"
                    : snapshot?.status.zone === 1
                      ? "No visibility found in the sampled scenario"
                      : "Unknown, obstructed or outside measured coverage"}
            </p>
            <form className="coordinates" onSubmit={applyCoordinate}>
              <label htmlFor="mgrs">MGRS</label>
              <input
                id="mgrs"
                aria-label="Own position MGRS"
                value={mgrsInput}
                onChange={(e) => setMgrsInput(e.target.value)}
                spellCheck={false}
              />
              <button disabled={!ready} type="submit">
                Set position
              </button>
            </form>
            {coordinateError && (
              <p className="coordinate-error" role="alert">
                {coordinateError}
              </p>
            )}
            <label className="secondary">
              <input
                type="checkbox"
                checked={secondary}
                onChange={(e) => setSecondary(e.target.checked)}
              />
              Show secondary EPSG:3067 coordinates
            </label>
            {secondary && target && (
              <code className="secondary-readout">
                E {Math.round(data.config.origin[0] + target[0])} · N{" "}
                {Math.round(data.config.origin[1] + target[1])} · N2000 heights
              </code>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);

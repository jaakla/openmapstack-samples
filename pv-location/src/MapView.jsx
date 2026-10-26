import { useEffect, useRef, useState } from "react";
import {
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import mapWorkerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { Crosshair, Layers, Sun } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { gridCorners, surfaceImage, withinCoverage } from "./geography.js";
const EMPTY = { type: "FeatureCollection", features: [] };
// Chromium blocks module Blob workers from file://. MapLibre wraps cross-origin
// module URLs in another Blob, so its pinned standalone worker needs a classic
// adapter here. Its only module syntax is the final default export.
const classicMapWorkerSource = mapWorkerSource.replace(
  /export\{[^}]+\};\s*(?=\/\/# sourceMappingURL|$)/,
  "",
);
const localMapWorkerUrl =
  "data:text/javascript;charset=utf-8," +
  encodeURIComponent(classicMapWorkerSource) +
  "#.cjs";
setWorkerUrl(
  location.protocol === "file:"
    ? localMapWorkerUrl
    : URL.createObjectURL(
        new Blob([mapWorkerSource], { type: "text/javascript" }),
      ),
);
const feature = (geometry, properties = {}) => ({
  type: "Feature",
  geometry,
  properties,
});
function scenarioData(polygon, draft) {
  if (draft.length)
    return {
      type: "FeatureCollection",
      features: [
        ...(draft.length >= 3
          ? [feature({ type: "Polygon", coordinates: [[...draft, draft[0]]] })]
          : []),
        ...(draft.length >= 2
          ? [feature({ type: "LineString", coordinates: draft })]
          : []),
        ...draft.map((p) => feature({ type: "Point", coordinates: p })),
      ],
    };
  return polygon
    ? {
        type: "FeatureCollection",
        features: [
          feature(polygon),
          ...polygon.coordinates[0]
            .slice(0, -1)
            .map((p) => feature({ type: "Point", coordinates: p })),
        ],
      }
    : EMPTY;
}
export default function MapView({
  captureMapRef,
  areaCenter,
  resetVersion,
  project,
  terrain,
  buildings,
  polygon,
  drawing,
  setDrawing,
  draft,
  setDraft,
  onPolygon,
  sun,
  day,
  setDay,
  hour,
  setHour,
  heightM,
  theme,
}) {
  const container = useRef(),
    map = useRef(),
    latest = useRef({});
  const [ready, setReady] = useState(false),
    [surface, setSurface] = useState(false),
    [shadows, setShadows] = useState(true),
    [showBuildings, setShowBuildings] = useState(true),
    [aerial, setAerial] = useState(true),
    [error, setError] = useState("");
  latest.current = { drawing, draft, terrain, setDraft, onPolygon, setDrawing };
  useEffect(() => {
    setSurface(false);
    setShadows(true);
    setShowBuildings(true);
    setAerial(true);
    setError("");
  }, [resetVersion]);
  useEffect(() => {
    const corners = gridCorners(terrain);
    const m = new Map({
      container: container.current,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      center: areaCenter,
      zoom: 16,
      maxZoom: 20,
      minZoom: 13,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": theme === "dark" ? "#16251c" : "#e7ede6",
            },
          },
        ],
      },
      attributionControl: {
        compact: false,
        customAttribution: project.aerial?.attribution || "Maa- ja Ruumiamet",
      },
    });
    map.current = m;
    const resizeObserver = new ResizeObserver(() => m.resize());
    resizeObserver.observe(container.current);
    if (captureMapRef)
      captureMapRef.current = async () => {
        if (!m.loaded())
          await Promise.race([
            new Promise((resolve) => m.once("idle", resolve)),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ]);
        m.triggerRepaint();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const canvas = m.getCanvas();
        return {
          fit: "contain",
          dataUrl: canvas.toDataURL("image/jpeg", 0.92),
          width: canvas.width,
          height: canvas.height,
          caption: `Current map view · hypothetical PV polygon · ${project.aerial?.attribution || "Maa- ja Ruumiamet"} · ETAK buildings · © OpenStreetMap contributors`,
        };
      };
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("error", (e) =>
      setError(e.error?.message || "A map layer could not be rendered."),
    );
    m.on("load", () => {
      const aerialUrl =
        (!project.liveContext && window.__PV_AERIAL_URL__) ||
        (project.data.aerial
          ? new URL(project.data.aerial, document.baseURI).href
          : null);
      m.addSource("basemap", {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      });
      m.addLayer({ id: "basemap", type: "raster", source: "basemap" });
      if (aerialUrl) {
        m.addSource("aerial", {
          type: "image",
          url: aerialUrl,
          coordinates: project.aerial?.coordinates || corners,
        });
        m.addLayer({
          id: "aerial",
          type: "raster",
          source: "aerial",
          paint: { "raster-fade-duration": 0 },
        });
      }
      m.addSource("coverage", {
        type: "geojson",
        data: feature({
          type: "Polygon",
          coordinates: [[...corners, corners[0]]],
        }),
      });
      m.addLayer({
        id: "coverage",
        type: "line",
        source: "coverage",
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-dasharray": [3, 3],
        },
      });
      m.addSource("buildings", {
        type: "geojson",
        data: buildings || EMPTY,
        attribution: "ETAK buildings © Maa- ja Ruumiamet",
      });
      m.addLayer({
        id: "buildings",
        type: "line",
        source: "buildings",
        paint: {
          "line-color": "#e7efde",
          "line-width": 1,
          "line-opacity": 0.7,
        },
      });
      m.addSource("surface", {
        type: "image",
        url: surfaceImage(terrain, sun, "surface"),
        coordinates: corners,
      });
      m.addLayer({
        id: "surface",
        type: "raster",
        source: "surface",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 },
      });
      m.addSource("shadows", {
        type: "image",
        url: surfaceImage(terrain, sun, "shadows", heightM),
        coordinates: corners,
      });
      m.addLayer({
        id: "shadows",
        type: "raster",
        source: "shadows",
        paint: { "raster-fade-duration": 0 },
      });
      m.addSource("scenario", {
        type: "geojson",
        data: scenarioData(polygon, []),
      });
      m.addLayer({
        id: "scenario-fill",
        type: "fill",
        source: "scenario",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#d3ee7d", "fill-opacity": 0.35 },
      });
      m.addLayer({
        id: "scenario-line",
        type: "line",
        source: "scenario",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": "#ddf68f", "line-width": 3 },
      });
      m.addLayer({
        id: "scenario-vertices",
        type: "circle",
        source: "scenario",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#fff",
          "circle-stroke-color": "#70943b",
          "circle-stroke-width": 1,
        },
      });
      setReady(true);
    });
    m.on("click", (e) => {
      const v = latest.current;
      if (!v.drawing) return;
      const point = [e.lngLat.lng, e.lngLat.lat];
      if (!withinCoverage([point], v.terrain)) {
        setError(
          "Place the entire site inside the measured coverage, at least 25 m from its edge.",
        );
        return;
      }
      setError("");
      v.setDraft((d) => [...d, point]);
    });
    return () => {
      resizeObserver.disconnect();
      if (captureMapRef) captureMapRef.current = null;
      setReady(false);
      m.remove();
      map.current = null;
    };
  }, [project, terrain, buildings]);
  useEffect(() => {
    const source = ready && map.current?.getSource("scenario");
    if (source) source.setData(scenarioData(polygon, draft));
  }, [ready, polygon, draft]);
  useEffect(() => {
    const source = ready && map.current?.getSource("shadows");
    if (source)
      source.updateImage({
        url: surfaceImage(terrain, sun, "shadows", heightM),
      });
  }, [ready, sun, terrain, heightM]);
  useEffect(() => {
    if (ready && map.current?.isStyleLoaded()) {
      for (const [id, visible] of [
        ["surface", surface],
        ["shadows", shadows],
        ["buildings", showBuildings],
        ["aerial", aerial],
      ])
        if (map.current.getLayer(id))
          map.current.setLayoutProperty(
            id,
            "visibility",
            visible ? "visible" : "none",
          );
      map.current.setPaintProperty(
        "background",
        "background-color",
        theme === "dark" ? "#16251c" : "#e7ede6",
      );
    }
  }, [ready, surface, shadows, showBuildings, aerial, theme]);
  useEffect(() => {
    if (map.current)
      map.current.getCanvas().style.cursor = drawing ? "crosshair" : "";
  }, [drawing]);
  const finish = () => {
    if (draft.length >= 3) {
      onPolygon({ type: "Polygon", coordinates: [[...draft, draft[0]]] });
      setDraft([]);
      setDrawing(false);
    }
  };
  return (
    <section className="map-section" aria-label="PV site map">
      <div
        ref={container}
        className="map"
        data-testid="map"
        data-map-ready={ready}
        aria-label="Measured Estonia area and hypothetical PV polygon"
      />
      <div className="layer-controls" aria-label="Map layers">
        <span>
          <Layers size={15} /> Map layers
        </span>
        {[
          ["Aerial", aerial, setAerial, "aerial"],
          ["Buildings", showBuildings, setShowBuildings, "buildings"],
          ["Surface", surface, setSurface, "surface"],
          ["Shadows", shadows, setShadows, "shadows"],
        ].map(([label, value, setter, id]) => (
          <label key={id}>
            {label}
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => setter(e.target.checked)}
              data-oms-layer-group={id}
              data-layer-group={id}
            />
          </label>
        ))}
      </div>
      <button
        className="recenter icon-button"
        title="Center on the planning site"
        aria-label="Center on the planning site"
        onClick={() =>
          map.current?.flyTo({
            center: polygon?.coordinates[0][0] || areaCenter,
            zoom: 17,
            duration: 500,
          })
        }
      >
        <Crosshair size={18} />
      </button>
      <div className="map-label" data-testid="legend">
        <i /> Hypothetical PV site <span>·</span> 5 m surface coverage
      </div>
      {drawing ? (
        <div className="drawing-message">
          <b>Click to place vertices</b>
          <span>{draft.length} points · at least 3 required</span>
          <button disabled={draft.length < 3} onClick={finish}>
            Finish polygon
          </button>
          <button
            onClick={() => {
              setDrawing(false);
              setDraft([]);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="map-error" role="status">
          {error}
        </div>
      ) : null}
      <div className="sun-controls">
        <Sun size={19} />
        <label>
          <span className="sr-only">Shadow date</span>
          <input
            type="date"
            value={day}
            min="2024-01-01"
            max="2025-12-31"
            onChange={(e) => {
              if (e.target.validity.valid && e.target.value)
                setDay(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="sr-only">Time in UTC</span>
          <input
            type="range"
            min="0"
            max="23.75"
            step="0.25"
            value={hour}
            onChange={(e) => setHour(+e.target.value)}
          />
        </label>
        <output>
          {String(Math.floor(hour)).padStart(2, "0")}:
          {String(Math.round((hour % 1) * 60)).padStart(2, "0")} UTC
        </output>
        <span className="sun-elevation">
          Sun {sun.elevationDeg.toFixed(0)}° · 300 m snapshot
        </span>
      </div>
    </section>
  );
}

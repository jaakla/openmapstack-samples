import { useEffect, useRef, useState } from "react";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import { ChevronDown, MapPin, Upload, Download, X } from "lucide-react";

function AreaMap({ point, onChoose, onClose }) {
  const dialog = useRef(),
    container = useRef(),
    map = useRef();
  const [selected, setSelected] = useState(point);
  useEffect(() => {
    dialog.current.showModal();
    const m = new Map({
      container: container.current,
      center: point,
      zoom: 6.4,
      minZoom: 5,
      maxZoom: 19,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }));
    const marker = new Marker({ color: "#25543a" }).setLngLat(point).addTo(m);
    m.on("click", (event) => {
      const coordinate = [event.lngLat.lng, event.lngLat.lat];
      marker.setLngLat(coordinate);
      setSelected(coordinate);
    });
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  return (
    <dialog
      className="area-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="area-map-title"
    >
      <div className="area-dialog-heading">
        <div>
          <h2 id="area-map-title">Choose an area in Estonia</h2>
          <p>
            Zoom to your site and click its centre. We check land coverage
            before loading.
          </p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close area map"
        >
          <X size={18} />
        </button>
      </div>
      <div
        ref={container}
        className="area-picker-map"
        data-testid="area-picker-map"
      />
      <div className="area-dialog-actions">
        <span>
          {selected[1].toFixed(5)}° N · {selected[0].toFixed(5)}° E
        </span>
        <button
          className="primary"
          onClick={() => {
            onChoose(selected);
            onClose();
          }}
        >
          Use these coordinates
        </button>
      </div>
    </dialog>
  );
}
export default function AreaPanel({
  area,
  loading,
  error,
  onLoad,
  onCancel,
  onReset,
  onImport,
  onExport,
}) {
  const [latitude, setLatitude] = useState(String(area.center[1]));
  const [longitude, setLongitude] = useState(String(area.center[0]));
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    setLatitude(String(area.center[1]));
    setLongitude(String(area.center[0]));
  }, [area.id]);
  return (
    <details className="control-section area-section" open>
      <summary>
        Area of interest <ChevronDown size={15} />
      </summary>
      <div className="area-current">
        <MapPin size={15} />
        <span>{area.name}</span>
        <small>2 × 2 km context</small>
      </div>
      <p className="field-help">
        Choose a new centre within Estonia. Load its measured surface and
        weather, then draw a PV footprint.
      </p>
      <button
        className="area-map-button"
        onClick={() => setPicking(true)}
        disabled={!!loading}
      >
        <MapPin size={15} />
        Choose on map
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onLoad({ latitude: Number(latitude), longitude: Number(longitude) });
        }}
      >
        <div className="coordinate-fields">
          <label>
            Latitude
            <input
              aria-label="Area latitude"
              type="number"
              step="any"
              required
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </label>
          <label>
            Longitude
            <input
              aria-label="Area longitude"
              type="number"
              step="any"
              required
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </label>
        </div>
        <button
          className="primary area-load"
          type="submit"
          disabled={!!loading}
        >
          {loading ? "Loading area…" : "Load Estonia area"}
        </button>
      </form>
      {loading ? (
        <div className="area-progress" role="status">
          <span>{loading}</span>
          <button onClick={onCancel}>Cancel</button>
        </div>
      ) : null}
      {error ? (
        <p className="warning" role="alert">
          {error}
        </p>
      ) : null}
      {area.id !== "canonical" ? (
        <button className="text-button" onClick={onReset} disabled={!!loading}>
          Return to published Tartu area
        </button>
      ) : null}
      <div className="area-bundle-actions">
        <label className="import-link">
          <Upload size={13} />
          Import area bundle
          <input
            aria-label="Import area bundle"
            type="file"
            accept=".json,application/json"
            onChange={onImport}
            disabled={!!loading}
          />
        </label>
        {area.id !== "canonical" ? (
          <button
            className="text-button"
            onClick={onExport}
            disabled={!!loading}
          >
            <Download size={13} />
            Save area bundle
          </button>
        ) : null}
      </div>
      <p className="privacy-note">
        Official Estonia surface, buildings and aerial imagery; ERA5 weather for
        the chosen location. Live loading needs internet. Area bundles keep a
        snapshot for reuse.
      </p>
      {picking ? (
        <AreaMap
          point={[
            Number(longitude) || area.center[0],
            Number(latitude) || area.center[1],
          ]}
          onChoose={(coordinate) => {
            setLongitude(coordinate[0].toFixed(6));
            setLatitude(coordinate[1].toFixed(6));
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </details>
  );
}

export function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "m",
  onChange,
}) {
  return (
    <label className="range-label">
      <span>
        {label}
        <strong>
          {value} {unit}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <small>
        {min} {unit}
        <span>
          {max} {unit}
        </span>
      </small>
    </label>
  );
}
export function Legend() {
  return (
    <details className="legend" open>
      <summary>Legend</summary>
      <div>
        <i className="affiliation hostile" />
        Hostile UAV · simulated
      </div>
      <div>
        <i className="affiliation friendly" />
        Friendly · own position
      </div>
      <div>
        <i className="line red" />
        RED · visible now
      </div>
      <div>
        <i className="line yellow" />
        YELLOW · forecast within 5 min
      </div>
      <div>
        <i className="line green" />
        GREEN · sampled LOS blocked
      </div>
      <div>
        <i className="line unknown" />
        UNKNOWN · missing / obstructed
      </div>
      <div>
        <i className="line past" />
        Past trace · last 2 min
      </div>
      <div>
        <i className="line future" />
        Future route · 5 min
      </div>
      <div>
        <i className="envelope" />
        Terminal speed envelope · ±20%
      </div>
      <p className="note">
        Affiliation symbols are APP-6-inspired, not certified. LOS colours
        describe geometry. GREEN does not establish safety.
      </p>
    </details>
  );
}
export function LayerControls({ layers, setLayers }) {
  return (
    <>
      <details open>
        <summary>Layer groups</summary>
        {[
          ["ground", "Ground & photography"],
          ["obstructions", "Buildings & vegetation"],
          ["scenario", "Simulated UAVs & results"],
        ].map(([key, label]) => (
          <label className="toggle" key={key}>
            <input
              type="checkbox"
              checked={layers[key] !== false}
              onChange={(e) =>
                setLayers({ ...layers, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </details>
      <details open>
        <summary>Analysis & scenario</summary>
        {[
          ["red", "Direct visibility zones"],
          ["yellow", "Forecast visibility zones"],
          ["green", "No sampled visibility zones"],
          ["los", "Drone → own position LOS"],
          ["traces", "Dotted past traces"],
          ["predictions", "Dashed future routes"],
          ["uncertainty", "Terminal speed envelope"],
          ["affiliations", "Affiliation symbols & labels"],
        ].map(([key, label]) => (
          <label className="toggle" key={key}>
            <input
              type="checkbox"
              checked={layers[key] !== false}
              onChange={(e) =>
                setLayers({ ...layers, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </details>
      <details open>
        <summary>Source context</summary>
        {[
          ["buildings", "Building meshes · display only"],
          ["vegetation", "Measured vegetation"],
          ["roads", "Sourced OSM routes"],
        ].map(([key, label]) => (
          <label className="toggle" key={key}>
            <input
              type="checkbox"
              checked={layers[key] !== false}
              onChange={(e) =>
                setLayers({ ...layers, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </details>
      <Legend />
    </>
  );
}
export function Controls({
  settings,
  change,
  playing,
  setPlaying,
  speed,
  setSpeed,
}) {
  return (
    <>
      <details open>
        <summary>Drone scenario</summary>
        <Range
          label="UAV height (AGL)"
          min={10}
          max={150}
          value={settings.uavHeight}
          onChange={(v) => change("uavHeight", v)}
        />
        <label className="count">
          UAV count
          <select
            aria-label="Number of UAVs"
            value={settings.uavs}
            onChange={(e) => change("uavs", Number(e.target.value))}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </details>
      <details open>
        <summary>Playback</summary>
        <div className="playback">
          <button className="primary" onClick={() => setPlaying(!playing)}>
            {playing ? "Pause" : "Play"}
          </button>
          <label>
            Speed
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.5, 1, 2, 5].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="note">
          Simulated flights over sourced route shapes. Forecast weights are
          uncalibrated scenarios.
        </p>
      </details>
    </>
  );
}

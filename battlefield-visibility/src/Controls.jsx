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
export function Controls({
  settings,
  change,
  playing,
  setPlaying,
  speed,
  setSpeed,
  reset,
  layers,
  setLayers,
}) {
  return (
    <>
      <details open>
        <summary>Scenario</summary>
        <Range
          label="UAV height (AGL)"
          min={10}
          max={150}
          value={settings.uavHeight}
          onChange={(v) => change("uavHeight", v)}
        />
        <Range
          label="Tank sensor height"
          min={1}
          max={8}
          step={0.5}
          value={settings.tankHeight}
          onChange={(v) => change("tankHeight", v)}
        />
        {["tanks", "uavs"].map((key) => (
          <label className="count" key={key}>
            Number of {key === "uavs" ? "UAVs" : "tanks"}
            <select
              aria-label={`Number of ${key}`}
              value={settings[key]}
              onChange={(e) => change(key, Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        ))}
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
      </details>
      <details open>
        <summary>Layers</summary>
        {[
          ["red", "Direct visibility (current)"],
          ["yellow", "Forecast visibility (5 min)"],
          ["green", "Low visibility (occluded)"],
          ["buildings", "Measured buildings"],
          ["vegetation", "High vegetation"],
          ["roads", "OSM streets"],
          ["predictions", "Predicted paths"],
        ].map(([key, label]) => (
          <label className="toggle" key={key}>
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={(e) =>
                setLayers({ ...layers, [key]: e.target.checked })
              }
            />
            <i className={key} />
            {label}
          </label>
        ))}
      </details>
      <button className="reset" onClick={reset}>
        Reset defaults
      </button>
    </>
  );
}

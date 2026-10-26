import { useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  Upload,
  RotateCcw,
  PenLine,
  Info,
  ArrowUpRight,
} from "lucide-react";
import { parseOwnerCsv, compareOwnerData } from "./analysis.js";
import { number } from "./Results.jsx";
import { downloadFile } from "./downloads.js";
import ConsumptionPanel from "./ConsumptionPanel.jsx";
function Section({ title, children }) {
  return (
    <details className="control-section" open>
      <summary>
        {title}
        <ChevronDown size={15} />
      </summary>
      <div>{children}</div>
    </details>
  );
}
function Field({
  label,
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  range = false,
  hint,
}) {
  return (
    <label className={`field ${range ? "range-field" : ""}`}>
      <span>
        {label}
        {hint ? (
          <span className="hint" title={hint}>
            <Info size={12} />
          </span>
        ) : null}
        {range ? (
          <output>
            {value}
            {unit}
          </output>
        ) : null}
      </span>
      {range ? (
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          data-oms-control={id}
          onInput={(e) => onChange(+e.target.value)}
          onChange={(e) => onChange(+e.target.value)}
        />
      ) : (
        <span className="number-input">
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              if (e.target.value !== "") onChange(+e.target.value);
            }}
          />
          {unit}
        </span>
      )}
    </label>
  );
}
export function ScenarioPanel({
  resetVersion,
  consumption,
  setConsumption,
  analysis,
  system,
  setSystem,
  year,
  setYear,
  area,
  drawing,
  setDrawing,
  setDraft,
  reset,
  importScenario,
}) {
  const field = (name) => (v) => setSystem((s) => ({ ...s, [name]: v }));
  return (
    <>
      <p className="scenario-notice">
        <Info size={15} /> Planning scenario · not an existing installation.
      </p>
      <Section title="Site geometry">
        <div className="geometry-buttons">
          <button
            className="primary"
            onClick={() => {
              setDraft([]);
              setDrawing(!drawing);
            }}
          >
            <PenLine size={16} />
            {drawing ? "Drawing…" : "Draw site"}
          </button>
          <button data-oms-reset onClick={reset}>
            <RotateCcw size={15} /> Reset
          </button>
        </div>
        <div className="area-row">
          <span>Polygon area</span>
          <strong>{number(area)} m²</strong>
        </div>
        <p className="field-help">
          Draw inside the measured 2 × 2 km pilot. Site geometry describes the
          footprint; nameplate capacity is entered separately.
        </p>
        <label className="import-link">
          <Upload size={13} /> Import scenario GeoJSON
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={importScenario}
          />
        </label>
      </Section>
      <Section title="PV system">
        <Field
          label="DC capacity"
          value={system.kwp}
          onChange={field("kwp")}
          min={0.1}
          max={100000}
          step={0.1}
          unit="kWp"
        />
        <Field
          label="Facing azimuth"
          id="azimuth"
          value={system.azimuthDeg}
          onChange={field("azimuthDeg")}
          min={0}
          max={360}
          unit="°"
          range
          hint="Panel-facing direction, clockwise from north. South is 180°."
        />
        <div className="range-endpoints">
          <span>0° N</span>
          <span>180° S</span>
          <span>360° N</span>
        </div>
        <Field
          label="Panel tilt"
          id="tilt"
          value={system.tiltDeg}
          onChange={field("tiltDeg")}
          min={0}
          max={90}
          unit="°"
          range
        />
        <Field
          label="Height above terrain"
          id="height"
          value={system.mountingHeightM}
          onChange={field("mountingHeightM")}
          min={0.5}
          max={30}
          step={0.5}
          unit=" m"
          range
          hint="Receiver height above the bare-earth DTM. For rooftops include the roof height."
        />
        <Field
          label="System loss"
          value={system.systemLossPct}
          onChange={field("systemLossPct")}
          min={0}
          max={60}
          step={1}
          unit="%"
        />
      </Section>
      <ConsumptionPanel
        key={resetVersion}
        {...{ consumption, setConsumption, analysis }}
      />
      <Section title="Historical market">
        <label className="field">
          <span>Market year</span>
          <select
            aria-label="Market year"
            data-oms-control="year"
            value={year}
            onChange={(e) => setYear(+e.target.value)}
          >
            <option value="2024">2024</option>
            <option value="2025">2025</option>
          </select>
        </label>
        <Field
          label="Sales margin"
          value={system.salesMarginEurMWh}
          onChange={field("salesMarginEurMWh")}
          min={0}
          max={200}
          step={0.5}
          unit="€/MWh"
        />
        <p className="field-help">
          Full-year weather and price replay, not a future forecast or long-term
          climate normal.
        </p>
      </Section>
    </>
  );
}
function Credits({ project }) {
  const author = project.author,
    time = project.run.completed_at,
    tool = project.generated_with;
  return (
    <section
      data-openmapstack-credits={
        document.querySelector(".canonical-provenance") ? undefined : ""
      }
      className="runtime-credits"
    >
      <p>
        Generated with AI using the free{" "}
        <a data-oms-credit="toolkit" href={tool.url}>
          {tool.tool}
        </a>{" "}
        toolkit.
      </p>
      <p>
        Analysis made:{" "}
        <time
          dateTime={time}
          data-oms-credit="analysis"
          data-oms-clock-source="runs.latest.completed_at"
        >
          {time}
        </time>
      </p>
      <p>
        Author:{" "}
        <a data-oms-credit="author" href={`mailto:${author.email}`}>
          {author.name} ({author.email})
        </a>{" "}
        ·{" "}
        <a data-oms-credit="author-url" href={author.url}>
          Profile
        </a>
      </p>
    </section>
  );
}
export function EvidencePanel({ project, analysis, horizon }) {
  return (
    <div
      className="evidence-panel"
      data-testid="provenance"
      data-openmapstack-provenance={
        document.querySelector(".canonical-provenance") ? undefined : ""
      }
    >
      <Credits project={project} />
      <Section title="Source evidence">
        {project.sources.map((source) => (
          <a
            className="source-row"
            key={source.id}
            href={source.source_url}
            target="_blank"
            rel="noreferrer"
          >
            <strong>
              {source.dataset || source.id}
              <ArrowUpRight size={13} />
            </strong>
            <span>{source.provider}</span>
            <small>
              {typeof source.license === "object"
                ? source.license.name
                : source.license}{" "}
              · retrieved {source.retrieved_at?.slice(0, 10)}
            </small>
          </a>
        ))}
      </Section>
      <Section title="Run and coverage">
        <dl className="quality-list">
          <div>
            <dt>Canonical run</dt>
            <dd>{project.run.id}</dd>
          </div>
          <div>
            <dt>Surface resolution</dt>
            <dd>5 m DSM / DTM</dd>
          </div>
          <div>
            <dt>Shading radius</dt>
            <dd>{number(horizon?.radiusM)} m</dd>
          </div>
          <div>
            <dt>Horizon coverage</dt>
            <dd>{number(horizon?.coveragePct, 1)}%</dd>
          </div>
          <div>
            <dt>Weather intervals</dt>
            <dd>{number(analysis?.summary.weatherHours)} hours</dd>
          </div>
          <div>
            <dt>Market intervals</dt>
            <dd>{number(analysis?.summary.pricedHours)} hours</dd>
          </div>
        </dl>
      </Section>
      <Section title="Limitations">
        <div data-testid="warnings">
          {project.warnings.map((w) => (
            <p className="warning" key={w.id}>
              {w.statement}
            </p>
          ))}
          {analysis?.quality.warnings.map((w) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
        </div>
      </Section>
      <Section title="PV inventory extension">
        <p className="field-help">
          Government municipality counts are context, not individual solar
          sites. AOI-wide aerial segmentation, residential recall and
          installation reconciliation have not been validated. No installation
          detections are presented as facts.
        </p>
      </Section>
      <Section title="Published downloads">
        {Object.entries(project.downloads || {}).map(([key, url]) => (
          <a className="download-link" key={key} href={url} download>
            <Download size={14} />
            {key}
          </a>
        ))}
        <a
          className="download-link"
          href="https://github.com/jaakla/openmapstack-samples/issues/4"
          target="_blank"
          rel="noreferrer"
        >
          Issue #4 scope
          <ArrowUpRight size={14} />
        </a>
      </Section>
    </div>
  );
}
export function ValidationPanel({ analysis, system, busy }) {
  const [upload, setUpload] = useState(null),
    [error, setError] = useState("");
  const comparison = useMemo(
    () =>
      upload?.valid && analysis ? compareOwnerData(upload, analysis) : null,
    [upload, analysis],
  );
  const load = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 15e6)
        throw new Error("CSV exceeds the 15 MB browser limit.");
      const parsed = parseOwnerCsv(await file.text());
      setUpload({ ...parsed, fileName: file.name });
      setError("");
    } catch (err) {
      setError(err.message);
      setUpload(null);
    }
    e.target.value = "";
  };
  return (
    <div className="validation-panel">
      <Section title="Compare your production">
        <p className="field-help">
          Import 15-minute interval energy from the same site. Set the polygon,
          DC capacity and array configuration to match your installation first.
        </p>
        <label className="upload-zone">
          <Upload size={23} />
          <strong>Choose production CSV</strong>
          <span>Processed locally in this browser</span>
          <input type="file" accept=".csv,text/csv" onChange={load} />
        </label>
        <p className="field-help">
          Headers <code>time,energy_kwh</code>. Use interval-start timestamps
          with <code>Z</code> or an explicit UTC offset. Values are kWh per 15
          minutes, not kW.
        </p>
        <button
          className="text-button"
          onClick={() =>
            downloadFile(
              "production-format.csv",
              "time,energy_kwh\n",
              "text/csv",
            )
          }
        >
          Download CSV header
        </button>
        {error ? (
          <p className="warning" role="alert">
            {error}
          </p>
        ) : null}
        {upload ? (
          <>
            <p>
              {upload.fileName}: {number(upload.rows.length)} valid intervals
            </p>
            {upload.errors.slice(0, 6).map((e) => (
              <p className="warning" key={e}>
                {e}
              </p>
            ))}
            {upload.warnings.map((w) => (
              <p className="warning" key={w}>
                {w}
              </p>
            ))}
          </>
        ) : (
          <p className="pending-note">
            Owner calibration: pending real production data.
          </p>
        )}
      </Section>
      {comparison ? (
        <Section title="Overlapping intervals">
          <dl className="quality-list">
            {[
              ["Matched", `${comparison.matchedIntervals} intervals`],
              ["Measured", `${number(comparison.actualKwh, 2)} kWh`],
              ["Modeled", `${number(comparison.modelKwh, 2)} kWh`],
              ["Bias", `${number(comparison.biasPct, 1)}%`],
              ["MAE", `${number(comparison.maeKwh, 3)} kWh / interval`],
              ["RMSE", `${number(comparison.rmseKwh, 3)} kWh / interval`],
              ["Outside model year", comparison.outsideModelIntervals],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="warning">{comparison.assumption}</p>
          <button
            disabled={!comparison.matchedIntervals || busy}
            onClick={() =>
              downloadFile(
                "production-comparison.csv",
                [
                  "time,actual_kwh,model_kwh,error_kwh",
                  ...comparison.matched.map((r) =>
                    [r.time, r.actualKwh, r.modelKwh, r.errorKwh].join(","),
                  ),
                ].join("\n"),
                "text/csv",
              )
            }
          >
            <Download size={14} />
            Export comparison
          </button>
        </Section>
      ) : null}
      <p className="field-help">
        Current DC capacity: {number(system.kwp, 1)} kWp. Hourly model energy is
        divided equally into four quarters; this comparison does not establish
        quarter-hour timing accuracy.
      </p>
    </div>
  );
}

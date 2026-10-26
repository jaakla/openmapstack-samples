import {
  ChevronDown,
  Download,
  Upload,
  RotateCcw,
  PenLine,
  Info,
  ArrowUpRight,
} from "lucide-react";
import { number } from "./Results.jsx";
import { downloadFile } from "./downloads.js";
import ConsumptionPanel from "./ConsumptionPanel.jsx";
import StoragePanel from "./StoragePanel.jsx";
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
  storage,
  setStorage,
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
            aria-label="Import scenario GeoJSON"
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
        {[
          ["inverterAcKw", "Inverter AC output limit", 0.1],
          ["gridExportLimitKw", "Grid export limit", 0],
        ].map(([key, label, min]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <span className="number-input">
              <input
                type="number"
                aria-label={label}
                min={min}
                max={1000000}
                step={0.1}
                placeholder="Not specified"
                value={system[key] ?? ""}
                onChange={(e) =>
                  field(key)(e.target.value === "" ? null : +e.target.value)
                }
              />
              kW
            </span>
          </label>
        ))}
        <p className="field-help">
          Keep panel capacity at 20 kWp for a 20 kWp array, even with a 15 kW
          inverter. The inverter caps AC production; the grid limit caps surplus
          exports after local use and battery flows. Blank means no specified
          limit; 0 kW grid export means no export.
        </p>
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
        <p className="field-help">
          System loss includes aggregate conversion and electrical losses.
          Inverter clipping is calculated separately when an AC limit is set.
        </p>
      </Section>
      <StoragePanel
        {...{ storage, setStorage, system, analysis, consumption }}
      />
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
      {project.liveContext ? (
        <p className="warning">
          Live exploratory area: {project.liveContext.name}. Sources below
          belong to this loaded area. The Tartu canonical run is the parent
          project, not a validation of this area.
        </p>
      ) : null}
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
              · retrieved{" "}
              {(source.retrieved_at || source.access?.retrieved_at)?.slice(
                0,
                10,
              )}
            </small>
          </a>
        ))}
      </Section>
      <Section title="Run and coverage">
        <dl className="quality-list">
          <div>
            <dt>
              {project.liveContext ? "Parent canonical run" : "Canonical run"}
            </dt>
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
export { default as ValidationPanel } from "./ProductionValidationPanel.jsx";

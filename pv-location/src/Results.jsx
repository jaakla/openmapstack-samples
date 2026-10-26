import StorageResults from "./StorageResults.jsx";
import { Sun, Cloud, TreePine, ArrowRight, Coins, Tag } from "lucide-react";
import { number } from "./format.js";
export { number } from "./format.js";
const series = [
  { key: "clearKwh", label: "Clear-sky reference", color: "#25543a" },
  { key: "weatherKwh", label: "Weather adjusted", color: "#78a84d" },
  { key: "shadedKwh", label: "After local shadows", color: "#b0d18b" },
];
function MonthlyChart({ monthly = [] }) {
  const max = Math.max(
    1,
    ...monthly.flatMap((m) => series.map((s) => m[s.key] || 0)),
  );
  return (
    <div className="monthly-chart">
      <div className="chart-caption">
        Monthly energy <span>kWh</span>
      </div>
      <div className="chart-body">
        <div className="chart-grid">
          <span>{number(max)}</span>
          <span>{number(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {monthly.map((m) => (
            <div className="month" key={m.month}>
              <div className="bar-group">
                {series.map((s) => (
                  <div
                    key={s.key}
                    className="bar"
                    style={{
                      height: `${((m[s.key] || 0) / max) * 100}%`,
                      background: s.color,
                    }}
                    title={`${m.month} · ${s.label}: ${number(m[s.key])} kWh`}
                  />
                ))}
              </div>
              <span>
                {new Date(m.month + "-01T00:00:00Z").toLocaleString("en-GB", {
                  month: "short",
                  timeZone: "UTC",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
function ConsumptionBalance({ summary }) {
  const rows = [
    ["Local demand", "consumptionKwh"],
    ["Used on site", "selfConsumedKwh"],
    ["Exported", "exportKwh"],
    ["Curtailed by grid limit", "curtailedKwh"],
    ["Grid import", "importKwh"],
  ];
  return (
    <div
      className="consumption-balance"
      aria-label="PV and household energy balance"
    >
      {rows.map(([label, key]) => (
        <div key={key}>
          <span>{label}</span>
          <strong data-testid={key}>
            {number(summary[key])}
            <small> kWh</small>
          </strong>
          {summary[key] == null &&
          summary[`covered${key[0].toUpperCase()}${key.slice(1)}`] != null ? (
            <small>
              {number(summary[`covered${key[0].toUpperCase()}${key.slice(1)}`])}{" "}
              covered
            </small>
          ) : null}
        </div>
      ))}
    </div>
  );
}
export default function Results({ analysis, year, busy, horizon }) {
  const s = analysis?.summary || {};
  return (
    <section
      className={`results ${busy ? "updating" : ""}`}
      aria-label="Estimated PV results"
      aria-busy={busy}
    >
      <div className="energy-results">
        <h2>
          Estimated annual energy yield{" "}
          <span>{busy ? "Recomputing…" : `${year} weather replay`}</span>
        </h2>
        <div className="energy-flow">
          {[
            [
              Sun,
              "Clear-sky reference",
              "modeled ideal conditions",
              "clearKwh",
            ],
            [
              Cloud,
              "Weather adjusted",
              "ERA5, before local shadows",
              "weatherKwh",
            ],
            [
              TreePine,
              "After local shadows",
              "terrain, buildings and trees",
              "shadedKwh",
            ],
          ].map(([Icon, label, caption, key], i) => (
            <div className="flow-stage" key={key}>
              <div className="flow-label">
                <Icon size={25} />
                <div>
                  {label}
                  <small>{caption}</small>
                </div>
              </div>
              <strong data-testid={key}>
                {number(s[key])}
                <span> kWh/yr</span>
              </strong>
              {i < 2 ? <ArrowRight className="flow-arrow" size={19} /> : null}
            </div>
          ))}
        </div>
        <div className="power-limit-results" data-testid="power-limit-results">
          <div>
            <span>Inverter clipping</span>
            <strong data-testid="inverter-clipping">
              {number(s.shadedInverterClippingKwh)} kWh/yr
            </strong>
          </div>
          <div>
            <span>Grid-limit curtailment · without battery</span>
            <strong data-testid="grid-curtailment">
              {number(s.curtailedKwh)} kWh/yr
            </strong>
          </div>
          <p>
            Energy totals above are available AC production after inverter
            clipping, before grid-limit curtailment. Clipping uses
            hourly-average power; brief peaks within an hour remain unresolved.
          </p>
        </div>
        <MonthlyChart monthly={analysis?.monthly} />
        <ConsumptionBalance summary={s} />
        {s.consumptionCoveragePct < 100 ? (
          <p className="consumption-partial" role="status">
            Partial demand coverage: {number(s.consumptionCoveragePct, 1)}%.
            Full-year consumption and savings are unknown; covered values are
            not extrapolated.
          </p>
        ) : null}
        <p className="model-caveat">
          Uncalibrated estimate · older surface mosaic ·{" "}
          {horizon
            ? `${number(horizon.coveragePct, 1)}% of horizon rays complete`
            : "checking horizon coverage"}
          . Unobserved obstacles may add losses.
        </p>
        <p className="result-note">
          {number(s.solarRetentionPct, 1)}% of clear-sky reference ·{" "}
          {number(s.capacityFactorPct, 1)}% nameplate capacity factor ·{" "}
          {number(s.specificYieldKwhKwp)} kWh/kWp
        </p>
      </div>
      <div className="economic-results">
        <h2>
          Economic results{" "}
          <span>
            {year} EE market
            {analysis?.storage?.config?.enabled ? " · without battery" : ""}
          </span>
        </h2>
        <div className="money-row">
          <Coins size={21} />
          <div>
            Avoided purchases<small>self-consumed PV × import price</small>
          </div>
          <strong data-testid="avoided-purchases">
            €{number(s.avoidedImportCostEur)}
          </strong>
        </div>
        <div className="money-row">
          <Tag size={20} />
          <div>
            Surplus export income<small>after sales margin</small>
          </div>
          <strong data-testid="net-revenue">
            €{number(s.exportRevenueEur)}
          </strong>
        </div>
        <div className="pv-value">
          <span>
            Annual PV value<small>avoided purchases + export income</small>
          </span>
          <strong data-testid="pv-value">€{number(s.netBenefitEur)}</strong>
        </div>
        <div className="bill-comparison">
          <span>
            Grid cost without PV <b>€{number(s.baselineImportCostEur)}</b>
          </span>
          <span>
            Net grid cost with PV <b>€{number(s.netGridCostEur)}</b>
          </span>
        </div>
        <div className="loss-breakdown">
          <h3>Local shadow effect</h3>
          <div>
            <span>Energy loss</span>
            <strong>{number(s.shadingLossPct, 1)}%</strong>
          </div>
          <div className="loss-track">
            <i style={{ width: `${Math.min(100, s.shadingLossPct || 0)}%` }} />
          </div>
          <div>
            <span>{number(s.shadingLossKwh)} kWh/yr</span>
            <strong>€{number(s.shadowNetBenefitLossEur)} /yr</strong>
          </div>
        </div>
        <p className="result-note">
          Self-use matched within each modeled hour, without storage. Import
          adder and export margin are applied separately. Fixed fees, VAT and
          financing excluded; negative prices retained.
        </p>
      </div>
      <StorageResults storage={analysis?.storage} />
    </section>
  );
}

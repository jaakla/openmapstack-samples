import { BatteryCharging, ArrowUpRight } from "lucide-react";
import { number } from "./format.js";
export default function StorageResults({ storage }) {
  if (!storage?.config?.enabled) return null;
  const s = storage.summary || {};
  const money = (value) =>
    Number.isFinite(value)
      ? `${value < 0 ? "−" : ""}€${number(Math.abs(value))}`
      : "—";
  const metrics = [
    ["PV into battery", "chargePvKwh"],
    ["Grid into battery", "chargeGridKwh"],
    ["Battery to local use", "dischargeToLoadKwh"],
    ["Battery sales", "dischargeToGridKwh"],
    ["Grid imports", "importKwh"],
    ["Grid exports", "exportKwh"],
    ["Battery losses", "lossKwh"],
    ["PV used on site", "pvSelfConsumedKwh"],
    ["PV curtailed by grid limit", "curtailedKwh"],
  ];
  const max = Math.max(
    1,
    ...(storage.monthly || []).map((row) =>
      Math.abs(row.incrementalBenefitEur || 0),
    ),
  );
  return (
    <section
      className="storage-results"
      data-testid="storage-results"
      aria-label="Battery storage results"
    >
      <div className="storage-results-heading">
        <h2>
          <BatteryCharging size={20} />
          PV + battery
        </h2>
        <span>
          Historical daily optimisation · after transfer and cycling costs
        </span>
      </div>
      <div className="storage-value-grid">
        <div>
          <span>Without battery</span>
          <strong data-testid="no-battery-value">
            {money(s.noBatteryNetBenefitEur)}
          </strong>
          <small>annual PV value</small>
        </div>
        <div>
          <span>With battery</span>
          <strong data-testid="with-battery-value">
            {money(s.netBenefitEur)}
          </strong>
          <small>PV and storage value / year</small>
        </div>
        <div className="storage-uplift">
          <span>
            <ArrowUpRight size={14} />
            Added by storage
          </span>
          <strong data-testid="battery-benefit">
            {money(s.incrementalBenefitEur)}
          </strong>
          <small>after {money(s.cyclingCostEur)} cycling costs</small>
        </div>
      </div>
      <div className="storage-energy-grid">
        {metrics.map(([label, key]) => (
          <div key={key}>
            <span>{label}</span>
            <strong data-testid={`battery-${key}`}>
              {number(s[key])}
              <small> kWh</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="storage-monthly">
        <span>Monthly added value</span>
        <div>
          {(storage.monthly || []).map((row) => (
            <div
              className="storage-month"
              key={row.month}
              title={`${row.month}: ${money(row.incrementalBenefitEur)}`}
            >
              {Number.isFinite(row.incrementalBenefitEur) ? (
                <i
                  style={{
                    height: `${Math.max(1, (Math.abs(row.incrementalBenefitEur || 0) / max) * 46)}px`,
                    background:
                      (row.incrementalBenefitEur || 0) < 0
                        ? "var(--oms-warn)"
                        : "var(--oms-accent)",
                  }}
                />
              ) : (
                <span
                  className="storage-month-unknown"
                  aria-label="Unknown monthly battery value"
                >
                  —
                </span>
              )}
              <span>
                {new Date(row.month + "-01T00:00:00Z").toLocaleString("en-GB", {
                  month: "short",
                  timeZone: "UTC",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="result-note">
        Grid import cost {money(s.gridImportCostEur)} · export receipts{" "}
        {money(s.exportRevenueEur)} · self-sufficiency{" "}
        {number(s.selfSufficiencyPct, 1)}%. Grid-charged energy is tracked
        separately from solar energy.
      </p>
      {s.coveragePct < 100 ? (
        <p className="consumption-partial">
          Battery coverage {number(s.coveragePct, 1)}%. Full-year value is
          unknown; missing inputs are not extrapolated.
        </p>
      ) : null}
      <p className="model-caveat">
        Known historical prices, approximate charge levels, no forecast. Daily
        reserve closure prevents free initial energy; no overnight carry between
        optimisation days. Investment, fixed charges and taxes excluded.
      </p>
    </section>
  );
}

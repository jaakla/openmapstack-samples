import { ChevronDown, BatteryCharging } from "lucide-react";
import { number } from "./Results.jsx";
function Amount({
  label,
  value,
  onChange,
  unit,
  min = 0,
  max = 100000,
  step = 0.5,
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="number-input">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            if (e.target.value !== "") onChange(Number(e.target.value));
          }}
        />
        {unit}
      </span>
    </label>
  );
}
export default function StoragePanel({
  storage,
  setStorage,
  system,
  analysis,
  consumption,
}) {
  const update = (key) => (value) =>
    setStorage((current) => ({ ...current, [key]: value }));
  const capacity =
    storage.capacityMode === "auto" ? 2 * system.kwp : storage.capacityKwh;
  const power = (amps) =>
    (amps * storage.voltageV * (storage.phases === 3 ? Math.sqrt(3) : 1)) /
    1000;
  return (
    <details className="control-section storage-section" open>
      <summary>
        Battery storage <ChevronDown size={15} />
      </summary>
      <label className="storage-enable">
        <input
          type="checkbox"
          checked={storage.enabled}
          onChange={(e) => update("enabled")(e.target.checked)}
        />
        <span>
          <BatteryCharging size={17} />
          Enable battery storage
        </span>
      </label>
      <p className="field-help">
        Store solar for later use, or trade between cheap and expensive hours.
        Compare annual value with the same site without a battery.
      </p>
      {storage.enabled ? (
        <>
          <label className="field">
            <span>Battery inverter arrangement</span>
            <select
              aria-label="Battery inverter arrangement"
              value={storage.inverterConnection ?? "shared"}
              onChange={(e) => update("inverterConnection")(e.target.value)}
            >
              <option value="shared">Shared PV and battery inverter</option>
              <option value="separate">Separate battery inverter</option>
            </select>
          </label>
          <p className="field-help">
            A shared arrangement caps combined PV and battery AC supply at the
            inverter limit above. This approximation does not recover DC energy
            clipped before the PV inverter or simulate a full hybrid inverter.
            Both arrangements share the site’s grid export limit.
          </p>
          <label className="field">
            <span>Battery sizing</span>
            <select
              aria-label="Battery sizing"
              value={storage.capacityMode}
              onChange={(e) => update("capacityMode")(e.target.value)}
            >
              <option value="auto">Automatic · 2 × PV DC capacity</option>
              <option value="fixed">Fixed capacity</option>
            </select>
          </label>
          {storage.capacityMode === "auto" ? (
            <div className="storage-capacity">
              <strong data-testid="battery-capacity">
                {number(capacity, 1)} kWh
              </strong>
              <span>2 × {number(system.kwp, 1)} kWp</span>
            </div>
          ) : (
            <Amount
              label="Battery capacity"
              value={storage.capacityKwh}
              onChange={update("capacityKwh")}
              min={0.1}
              unit="kWh"
            />
          )}
          <label className="field">
            <span>Power units</span>
            <select
              aria-label="Battery power units"
              value={storage.powerMode}
              onChange={(e) => update("powerMode")(e.target.value)}
            >
              <option value="kw">kW · AC power</option>
              <option value="amps">A · AC current</option>
            </select>
          </label>
          {storage.powerMode === "kw" ? (
            <>
              <Amount
                label="Charge power"
                value={storage.chargePowerKw}
                onChange={update("chargePowerKw")}
                unit="kW"
              />
              <Amount
                label="Discharge power"
                value={storage.dischargePowerKw}
                onChange={update("dischargePowerKw")}
                unit="kW"
              />
            </>
          ) : (
            <>
              <label className="field">
                <span>AC connection</span>
                <select
                  aria-label="Battery AC connection"
                  value={storage.phases}
                  onChange={(e) =>
                    setStorage((current) => ({
                      ...current,
                      phases: Number(e.target.value),
                      voltageV: e.target.value === "3" ? 400 : 230,
                    }))
                  }
                >
                  <option value="3">Three phase · 400 V line-to-line</option>
                  <option value="1">Single phase · 230 V</option>
                </select>
              </label>
              <Amount
                label="Charge current"
                value={storage.chargeCurrentA}
                onChange={update("chargeCurrentA")}
                unit="A"
              />
              <Amount
                label="Discharge current"
                value={storage.dischargeCurrentA}
                onChange={update("dischargeCurrentA")}
                unit="A"
              />
              <p className="field-help">
                {number(power(storage.chargeCurrentA), 2)} kW charge ·{" "}
                {number(power(storage.dischargeCurrentA), 2)} kW discharge, at
                unity power factor. AC limits apply at the battery connection.
              </p>
            </>
          )}
          <Amount
            label="Round-trip efficiency"
            value={storage.roundTripEfficiencyPct}
            onChange={update("roundTripEfficiencyPct")}
            min={50}
            max={100}
            step={1}
            unit="%"
          />
          <Amount
            label="Reserve state of charge"
            value={storage.reserveSocPct}
            onChange={update("reserveSocPct")}
            max={95}
            step={1}
            unit="%"
          />
          <Amount
            label="Cycling cost"
            value={storage.cyclingCostEurKwh}
            onChange={update("cyclingCostEurKwh")}
            max={10}
            step={0.01}
            unit="€/kWh"
          />
          <p className="field-help">
            Planning cost per kWh discharged. Efficiency and cycling costs
            reduce trading gains; equipment and financing costs are excluded.
          </p>
          <label className="fill-gaps">
            <input
              type="checkbox"
              checked={storage.allowGridCharging}
              onChange={(e) => update("allowGridCharging")(e.target.checked)}
            />
            <span>Allow charging from the grid</span>
          </label>
          <label className="fill-gaps">
            <input
              type="checkbox"
              checked={storage.allowBatteryExport}
              onChange={(e) => update("allowBatteryExport")(e.target.checked)}
            />
            <span>Allow battery sales to the grid</span>
          </label>
          <button
            className="storage-arbitrage"
            onClick={() =>
              setStorage((current) => ({
                ...current,
                allowGridCharging: true,
                allowBatteryExport: true,
              }))
            }
          >
            Enable price arbitrage
          </button>
          <p className="field-help">
            Import transfer adder:{" "}
            <b>{number(consumption.importAdderEurMWh, 1)} €/MWh</b> (Local
            consumption). Export deduction:{" "}
            <b>{number(system.salesMarginEurMWh, 1)} €/MWh</b> (Historical
            market). Include applicable variable network costs in these inputs.
          </p>
          <p className="privacy-note">
            Historical daily optimisation uses known prices, discrete charge
            levels and the configured costs. Each local day starts and ends at
            reserve. This is a planning scenario, not a price forecast or a
            battery controller.
          </p>
          {analysis?.storage?.quality?.warnings?.map((warning) => (
            <p className="warning compact-warning" key={warning}>
              {warning}
            </p>
          ))}
        </>
      ) : (
        <div className="storage-preview">
          {number(capacity)} kWh ·{" "}
          {storage.capacityMode === "auto"
            ? "follows PV size"
            : "fixed capacity"}
        </div>
      )}
    </details>
  );
}

import { useState } from "react";
import { ChevronDown, Upload, FileCheck2, X, Info } from "lucide-react";
import { parseConsumptionCsv } from "./consumption.js";
import { number } from "./Results.jsx";
function Amount({ label, value, onChange, unit = "kWh/day", max = 100000 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="number-input">
        <input
          aria-label={label}
          type="number"
          min="0"
          max={max}
          step="0.5"
          value={value}
          onChange={(e) => {
            if (e.target.value !== "") onChange(+e.target.value);
          }}
        />
        {unit}
      </span>
    </label>
  );
}
export default function ConsumptionPanel({
  consumption,
  setConsumption,
  analysis,
}) {
  const [error, setError] = useState("");
  const update = (key) => (value) =>
    setConsumption((c) => ({ ...c, [key]: value }));
  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 15e6)
        throw new Error("Enefit CSV exceeds the 15 MB browser limit.");
      const bytes = await file.arrayBuffer();
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        content = new TextDecoder("windows-1257").decode(bytes);
      }
      const parsed = parseConsumptionCsv(content, {
        fileName: file.name,
        timeZone: "Europe/Tallinn",
      });
      if (!parsed.valid)
        throw new Error(
          parsed.errors.slice(0, 4).join(" ") ||
            "No valid consumption intervals were found.",
        );
      setConsumption((c) => ({
        ...c,
        timeZone: "Europe/Tallinn",
        mode: "csv-calendar",
        rows: parsed.rows,
        metadata: parsed.metadata,
        sourceWarnings: parsed.warnings,
        fillMissingWithEstimate: false,
      }));
      setError("");
    } catch (err) {
      setError(err.message);
    }
    event.target.value = "";
  };
  const imported = !!consumption.rows?.length;
  const quality = analysis?.consumption?.quality;
  return (
    <details className="control-section consumption-section" open>
      <summary>
        Local consumption <ChevronDown size={15} />
      </summary>
      <label className="field consumption-mode">
        <span>Demand profile</span>
        <select
          aria-label="Consumption profile"
          value={consumption.mode}
          onChange={(e) => {
            update("mode")(e.target.value);
            setError("");
          }}
        >
          <option value="estimate">Day / night estimate</option>
          {imported ? (
            <>
              <option value="csv-calendar">Enefit calendar replay</option>
              <option value="csv-exact">Enefit exact dates</option>
            </>
          ) : null}
        </select>
      </label>
      <p className="field-help consumption-times">
        Day {String(consumption.dayStartHour).padStart(2, "0")}:00–
        {String(consumption.dayEndHour).padStart(2, "0")}:00 · night otherwise
        <br />
        {consumption.timeZone} local time, including clock changes.
      </p>
      <Amount
        label="Day consumption"
        value={consumption.dayKwh}
        onChange={update("dayKwh")}
      />
      <Amount
        label="Night consumption"
        value={consumption.nightKwh}
        onChange={update("nightKwh")}
      />
      <p className="field-help">
        Energy per day, spread evenly through each period.{" "}
        {consumption.mode === "estimate"
          ? "Editable planning assumptions."
          : "Used only when gap filling is explicitly enabled."}
      </p>
      <Amount
        label="Import price adder"
        value={consumption.importAdderEurMWh}
        onChange={update("importAdderEurMWh")}
        unit="€/MWh"
        max={1000}
      />
      <p className="field-help">
        Added to the selected year's hourly spot price for imports and avoided
        purchases. Enter applicable variable fees here; fixed charges and VAT
        are excluded.
      </p>
      <label className="consumption-upload">
        <Upload size={15} />
        <span>
          {imported ? "Replace Enefit CSV" : "Upload Enefit historical CSV"}
        </span>
        <input
          aria-label="Upload Enefit historical CSV"
          type="file"
          accept=".csv,text/csv"
          onChange={upload}
        />
      </label>
      <p className="privacy-note">
        Processed locally. Customer names, address and EIC are discarded. PDF
        reports contain aggregate results.
      </p>
      {imported ? (
        <div className="consumption-file">
          <FileCheck2 size={15} />
          <div>
            <strong>
              {consumption.metadata?.fileName || "Enefit consumption profile"}
            </strong>
            <span>{number(consumption.rows.length)} source intervals</span>
          </div>
          <button
            className="icon-button"
            aria-label="Remove Enefit consumption data"
            onClick={() => {
              setConsumption((c) => {
                const { rows, metadata, sourceWarnings, ...rest } = c;
                return {
                  ...rest,
                  mode: "estimate",
                  fillMissingWithEstimate: false,
                };
              });
              setError("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {consumption.mode !== "estimate" ? (
        <>
          <p className="field-help">
            {consumption.mode === "csv-calendar"
              ? "Replays the source month's day and local time in the selected model year. This is an estimated load profile; historical prices are replaced by that year's EE market prices."
              : "Uses source timestamps exactly. Consumption outside the selected year is not matched."}
          </p>
          <label className="fill-gaps">
            <input
              type="checkbox"
              checked={consumption.fillMissingWithEstimate}
              onChange={(e) =>
                update("fillMissingWithEstimate")(e.target.checked)
              }
            />
            <span>Fill missing intervals with the day/night estimate</span>
          </label>
          <p className="warning compact-warning">
            <Info size={12} /> Enefit “Tarbimine” measures grid imports. If the
            site already has PV or storage, it does not capture all household
            demand. “Tootmine” is not assumed to be gross PV output.
          </p>
        </>
      ) : null}
      {quality ? (
        <p className="consumption-coverage" role="status">
          {number(analysis.summary.consumptionCoveragePct, 1)}% model-year
          demand coverage
          {analysis.summary.imputedHours
            ? ` · ${number(analysis.summary.imputedHours, 1)} hours estimated`
            : ""}
        </p>
      ) : null}
      {consumption.sourceWarnings?.slice(0, 3).map((w) => (
        <p className="warning compact-warning" key={w}>
          {w}
        </p>
      ))}
      {error ? (
        <p className="warning" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}

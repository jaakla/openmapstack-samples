import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Upload } from "lucide-react";
import { compareOwnerData } from "./analysis.js";
import {
  combineSolarmanImports,
  parseProductionFiles,
} from "./production-import.js";
import { loadProductionWeather } from "./production-weather.js";
import ProductionWorker from "./production.worker.js?worker&inline";
import { number } from "./format.js";
import { downloadFile } from "./downloads.js";

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
function Facts({ rows }) {
  return (
    <dl className="quality-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
const clock = (time) =>
  time ? `${time.slice(0, 16).replace("T", " ")} UTC` : "—";

export default function ProductionValidationPanel({
  analysis,
  system,
  horizon,
  busy,
}) {
  const [originalUpload, setUpload] = useState(null),
    [error, setError] = useState("");
  const [maxGapMinutes, setMaxGapMinutes] = useState(30);
  const [reading, setReading] = useState(false),
    [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherRecord, setWeatherRecord] = useState(null),
    [weatherError, setWeatherError] = useState("");
  const [periodResult, setPeriodResult] = useState(null),
    [modelBusy, setModelBusy] = useState(false);
  const worker = useRef(),
    sequence = useRef(0),
    fileSequence = useRef(0),
    weatherRequest = useRef();
  const modelSystem = analysis?.system ?? system;
  const coordinateKey = `${modelSystem.latitude},${modelSystem.longitude}`;
  const upload = useMemo(
    () =>
      originalUpload?.sourceFormat === "solarman-xlsx"
        ? {
            ...combineSolarmanImports([originalUpload], { maxGapMinutes }),
            fileNames: originalUpload.fileNames,
          }
        : originalUpload,
    [originalUpload, maxGapMinutes],
  );
  const period = useMemo(() => {
    if (!upload?.valid) return null;
    const rows = upload.rows;
    return {
      start: rows[0].time,
      end: new Date(
        Date.parse(rows.at(-1).time) + rows.at(-1).durationMinutes * 60000,
      ).toISOString(),
    };
  }, [upload]);
  const periodKey = period ? `${period.start}/${period.end}` : "";
  const weather =
    weatherRecord?.coordinateKey === coordinateKey &&
    weatherRecord?.periodKey === periodKey
      ? weatherRecord.data
      : null;
  const periodTooLong =
    period &&
    Date.parse(period.end) - Date.parse(period.start) > 366 * 86400000;
  const selectedModel = weather
    ? periodResult?.system === modelSystem &&
      periodResult?.horizon === horizon &&
      periodResult?.weather === weather
      ? periodResult.analysis
      : null
    : analysis;
  const comparison = useMemo(
    () =>
      upload?.valid && selectedModel && !busy
        ? compareOwnerData(upload, selectedModel)
        : null,
    [upload, selectedModel, busy],
  );

  useEffect(() => {
    return () => {
      ++fileSequence.current;
      weatherRequest.current?.abort();
      worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    ++sequence.current;
    if (!weather || !horizon || busy) {
      setModelBusy(false);
      return;
    }
    const id = sequence.current;
    worker.current ??= new ProductionWorker();
    setModelBusy(true);
    worker.current.onmessage = ({ data }) => {
      if (data.id !== sequence.current) return;
      setModelBusy(false);
      if (data.error) setWeatherError(data.error);
      else
        setPeriodResult({
          analysis: data.analysis,
          system: modelSystem,
          horizon,
          weather,
        });
    };
    worker.current.onerror = () => {
      setModelBusy(false);
      setWeatherError(
        "Production comparison could not be calculated. Reload and retry.",
      );
    };
    worker.current.postMessage({ id, system: modelSystem, horizon, weather });
  }, [weather, modelSystem, horizon, busy]);
  useEffect(() => {
    weatherRequest.current?.abort();
    setWeatherLoading(false);
    setWeatherError("");
  }, [coordinateKey, periodKey]);

  async function load(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    const id = ++fileSequence.current;
    weatherRequest.current?.abort();
    setReading(true);
    setError("");
    setUpload(null);
    setWeatherRecord(null);
    setPeriodResult(null);
    try {
      const parsed = await parseProductionFiles(files, { maxGapMinutes });
      if (id === fileSequence.current) setUpload(parsed);
    } catch (e) {
      if (id === fileSequence.current) {
        setError(e.message);
        setUpload(null);
      }
    } finally {
      if (id === fileSequence.current) setReading(false);
    }
  }
  function remove() {
    ++fileSequence.current;
    ++sequence.current;
    weatherRequest.current?.abort();
    setUpload(null);
    setError("");
    setWeatherRecord(null);
    setPeriodResult(null);
    setReading(false);
    setWeatherLoading(false);
  }
  async function loadWeather() {
    weatherRequest.current?.abort();
    const request = new AbortController();
    weatherRequest.current = request;
    setWeatherLoading(true);
    setWeatherError("");
    setPeriodResult(null);
    try {
      const data = await loadProductionWeather(period, modelSystem, {
        signal: request.signal,
      });
      if (!request.signal.aborted)
        setWeatherRecord({ data, coordinateKey, periodKey });
    } catch (e) {
      if (!request.signal.aborted) setWeatherError(e.message);
    } finally {
      if (weatherRequest.current === request) setWeatherLoading(false);
    }
  }

  return (
    <div className="validation-panel">
      <Section title="Compare your production">
        <p className="field-help">
          Import Deye / Solarman detailed-data Excel exports directly. Select
          several monthly files together. First match the site polygon, DC
          capacity, tilt and orientation to your installation in Scenario.
        </p>
        <label className="upload-zone">
          <Upload size={23} />
          <strong>
            {reading
              ? "Reading production files…"
              : "Choose Excel or CSV files"}
          </strong>
          <span>Processed locally in this browser</span>
          <input
            aria-label="Upload production files"
            type="file"
            multiple
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
            onChange={load}
            disabled={reading}
          />
        </label>
        <p className="field-help">
          Solarman: Updated Time, Time Zone and Production Power(W). Power is
          integrated using the actual time between readings, including mixed
          sampling intervals. One month is enough for a period comparison.
        </p>
        {originalUpload?.sourceFormat === "solarman-xlsx" ? (
          <>
            <label className="field">
              <span>Maximum interpolation span</span>
              <select
                aria-label="Maximum interpolation span"
                value={maxGapMinutes}
                onChange={(event) =>
                  setMaxGapMinutes(Number(event.target.value))
                }
              >
                <option value="7.5">7.5 minutes (strict)</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </label>
            <p className="field-help">
              Estimate energy between neighboring power readings up to this
              span. This accommodates five-, ten- and fifteen-minute logging.
              Longer outages stay unknown. Changing the limit recalculates this
              file immediately.
            </p>
          </>
        ) : null}
        <details className="production-csv-help">
          <summary>Using another system’s CSV?</summary>
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
        </details>
        {error ? (
          <p className="warning" role="alert">
            {error}
          </p>
        ) : null}
        {upload ? (
          <div data-testid="production-import-summary">
            <p>{upload.fileNames.join(", ")}</p>
            <p>
              {number(upload.rows.length)} valid intervals
              {upload.summary
                ? ` from ${number(upload.summary.sampleCount)} power samples`
                : ""}
            </p>
            {upload.summary ? (
              <Facts
                rows={[
                  ["Export time zone", upload.summary.timeZones.join(", ")],
                  ["First sample", clock(upload.summary.firstTime)],
                  ["Last sample", clock(upload.summary.lastTime)],
                  [
                    "Typical reading spacing",
                    `${number(upload.summary.typicalIntervalMinutes, 1)} minutes`,
                  ],
                  [
                    "Largest integrated span",
                    `${number(upload.summary.maxIntegratedGapMinutes, 1)} minutes`,
                  ],
                  [
                    "Integrated duration",
                    `${number(upload.summary.coveredHours, 2)} hours`,
                  ],
                  [
                    "Longer spans interpolated",
                    `${number(upload.summary.extendedSegments)} / ${number(upload.summary.extendedHours, 2)} hours`,
                  ],
                  [
                    "Outages excluded",
                    `${number(upload.summary.gapCount)} / ${number(upload.summary.excludedGapHours, 2)} hours`,
                  ],
                  [
                    "Integrated PV energy",
                    `${number(upload.summary.estimatedKwh, 2)} kWh`,
                  ],
                ]}
              />
            ) : null}
            {upload.errors.slice(0, 6).map((message, i) => (
              <p className="warning" key={i}>
                {message}
              </p>
            ))}
            {upload.warnings.map((message, i) => (
              <p className="warning" key={i}>
                {message}
              </p>
            ))}
            <button className="text-button" onClick={remove}>
              Remove production data
            </button>
          </div>
        ) : (
          <p className="pending-note">
            Owner calibration: pending real production data.
          </p>
        )}
      </Section>
      {upload?.valid ? (
        <Section title="Weather for this period">
          <p className="field-help">
            {clock(period.start)} to {clock(period.end)}. Compare only these
            dates at the current scenario location:{" "}
            {number(modelSystem.latitude, 5)}°N,{" "}
            {number(modelSystem.longitude, 5)}°E, {number(modelSystem.kwp, 1)}{" "}
            kWp.
          </p>
          <button
            className="production-weather-button"
            onClick={loadWeather}
            disabled={
              busy || !horizon || weatherLoading || modelBusy || periodTooLong
            }
          >
            {weatherLoading
              ? "Loading period weather…"
              : modelBusy
                ? "Calculating comparison…"
                : "Load weather for imported dates"}
          </button>
          {periodTooLong ? (
            <p className="warning">
              Choose monthly files spanning at most 366 days for one weather
              comparison.
            </p>
          ) : null}
          <p className="field-help">
            Loads historical ERA5 weather using only the dates and scenario
            coordinates. Your production readings stay in this browser. Revenue
            scenarios remain on their selected market year.
          </p>
          {weatherError ? (
            <p className="warning" role="alert">
              {weatherError}
            </p>
          ) : null}
          {weather ? (
            <p className="field-help">
              Location-specific ERA5 period loaded.{" "}
              <a
                href={weather.provenance.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Weather source
              </a>
            </p>
          ) : null}
        </Section>
      ) : null}
      {comparison ? (
        <Section title="Complete hourly comparison">
          {!comparison.matchedHours ? (
            <p className="warning" data-testid="production-no-overlap">
              {comparison.outsideModelIntervals
                ? "No complete shared hours in the selected model year. Load weather for imported dates to compare this scenario."
                : "No complete shared hours. Partial, overlapping or unavailable hours are excluded."}
            </p>
          ) : null}
          <div data-testid="production-comparison">
            <Facts
              rows={[
                [
                  "Matched",
                  `${number(comparison.matchedHours)} complete ${comparison.matchedHours === 1 ? "hour" : "hours"}`,
                ],
                [
                  upload.sourceFormat === "solarman-xlsx"
                    ? "Integrated from power"
                    : "Measured interval energy",
                  `${number(comparison.actualKwh, 2)} kWh`,
                ],
                [
                  "Matched coverage",
                  comparison.candidateHours
                    ? `${number((100 * comparison.matchedHours) / comparison.candidateHours, 1)}% of ${number(comparison.candidateHours)} candidate hours`
                    : "—",
                ],
                ["Modeled", `${number(comparison.modelKwh, 2)} kWh`],
                ["Bias", `${number(comparison.biasPct, 1)}%`],
                ["MAE", `${number(comparison.maeKwh, 3)} kWh / hour`],
                ["RMSE", `${number(comparison.rmseKwh, 3)} kWh / hour`],
                ["Partial hours excluded", number(comparison.partialHours)],
                ["Overlapping hours excluded", number(comparison.overlapHours)],
                [
                  "Outside model period",
                  `${number(comparison.outsideModelHours, 2)} hours`,
                ],
              ]}
            />
          </div>
          {comparison.matchedHours > 0 &&
          comparison.matchedHours < 0.8 * comparison.candidateHours ? (
            <p className="warning">
              Only {number(comparison.matchedHours)} of{" "}
              {number(comparison.candidateHours)} candidate hours were compared.
              Review the interpolation limit and excluded coverage before
              interpreting accuracy metrics.
            </p>
          ) : null}
          <p className="warning">{comparison.assumption}</p>
          {comparison.warnings.map((message, i) => (
            <p className="warning" key={i}>
              {message}
            </p>
          ))}
          <button
            disabled={!comparison.matchedHours || busy || modelBusy}
            onClick={() =>
              downloadFile(
                "production-comparison.csv",
                [
                  "time,actual_kwh,model_kwh,error_kwh,coverage_minutes,source_segments,max_sample_span_minutes,longer_span_minutes,max_interpolation_span_minutes",
                  ...comparison.matched.map((row) =>
                    [
                      row.time,
                      row.actualKwh,
                      row.modelKwh,
                      row.errorKwh,
                      row.coverageMinutes,
                      row.sourceIntervals,
                      row.maxSampleGapMinutes ?? "",
                      row.longerSpanMinutes ?? 0,
                      upload.summary?.integrationMaxGapMinutes ?? "",
                    ].join(","),
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
        Exploratory comparison of the current scenario. Measurements are
        integrated over actual timestamps and aggregated to complete UTC hours
        to match the hourly weather model. Shorter sampling gaps are
        interpolated only within the selected limit; longer outages are
        excluded. A monthly file is not extrapolated to annual accuracy. Check
        that the device clock and the export’s UTC offset are correct.
      </p>
    </div>
  );
}

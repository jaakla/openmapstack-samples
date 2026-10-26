import { ChevronDown, CircleCheck, CircleAlert, Info } from "lucide-react";
import { number } from "./format.js";
import { PRODUCTION_ASSESSMENT_POLICY } from "./production-assessment.js";

const guide = PRODUCTION_ASSESSMENT_POLICY.bands.map((band) => [
  band.minExclusivePct == null
    ? `Up to ${band.maxInclusivePct}%`
    : band.maxInclusivePct == null
      ? `Over ${band.minExclusivePct}%`
      : `Over ${band.minExclusivePct}–${band.maxInclusivePct}%`,
  band.label,
]);

export default function ProductionAssessment({ assessment }) {
  if (!assessment) return null;
  const { total, hourly, coverage } = assessment;
  const tone =
    assessment.status === "assessed" ? assessment.band.tone : "neutral";
  const Icon =
    tone === "good"
      ? CircleCheck
      : tone === "review" || tone === "poor"
        ? CircleAlert
        : Info;
  const hasBias = Number.isFinite(total.biasPct);
  const lower = total.biasPct < 0;
  const modelLimited = assessment.caveats.some(({ code }) =>
    code.startsWith("model_limitation_"),
  );
  return (
    <section
      className="production-assessment"
      data-testid="production-assessment"
      data-assessment-status={assessment.status}
      data-tone={tone}
      aria-label="Quick assessment"
    >
      <div className="assessment-kicker">
        <Icon size={17} aria-hidden="true" />
        <span>Quick assessment</span>
      </div>
      <h3 data-testid="assessment-headline">
        {assessment.status === "assessed"
          ? assessment.band.label
          : assessment.status === "limited"
            ? modelLimited
              ? "Model assumptions need review"
              : "More data needed"
            : "No useful comparison yet"}
      </h3>
      {hasBias ? (
        <p className="assessment-result" data-testid="assessment-result">
          {Math.abs(total.biasPct) < 0.05 ? (
            "The model and imported production have nearly the same energy total."
          ) : (
            <>
              The model estimates{" "}
              <strong>
                {number(Math.abs(total.biasPct), 1)}% {lower ? "less" : "more"}{" "}
                energy
              </strong>{" "}
              than your imported production:{" "}
              {number(Math.abs(total.differenceKwh), 1)} kWh{" "}
              {lower ? "lower" : "higher"} over the matched hours.
            </>
          )}
        </p>
      ) : (
        <p className="assessment-result">
          A useful percentage comparison needs matching hours with positive
          recorded production.
        </p>
      )}
      <p className="assessment-scope">
        {number(coverage.matchedHours)} matched hours across{" "}
        {number(coverage.matchedDays)} days (UTC).{" "}
        {Number.isFinite(coverage.coveragePct)
          ? `${number(coverage.coveragePct, 1)}% of the overlapping date window is covered.`
          : "Full-period coverage is unknown."}
      </p>
      {Number.isFinite(hourly.maeKwh) ? (
        <div className="assessment-hourly">
          <strong>Hour-by-hour variation</strong>
          <p>
            Typical absolute difference:{" "}
            <strong>{number(hourly.maeKwh, 2)} kWh per matched hour.</strong>
          </p>
          {Number.isFinite(hourly.nmaePct) ? (
            <p>
              Absolute hourly differences add up to {number(hourly.nmaePct, 1)}%
              of imported energy. A close total can hide errors that cancel
              between hours.
            </p>
          ) : null}
          <p>
            Grid weather cannot follow every local cloud. Check timestamp
            alignment as well as the period’s total.
          </p>
        </div>
      ) : null}
      {assessment.status !== "assessed" ? (
        <p className="assessment-evidence">
          {modelLimited
            ? "Review the model limitations before relying on the energy ranges below."
            : "More complete data is needed before using the energy ranges below as a useful assessment."}
        </p>
      ) : null}
      <details className="assessment-details">
        <summary>
          What is a good range?
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <p>
          Compare the total energy difference with your imported production, in
          either direction.
        </p>
        <table className="assessment-guide">
          <thead>
            <tr>
              <th>Difference</th>
              <th>Quick guide</th>
            </tr>
          </thead>
          <tbody>
            {guide.map(([range, label]) => (
              <tr key={range}>
                <td>{range}</td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          These are app screening guidelines, not a formal acceptance standard.
          They assess this period’s energy total; they do not certify hourly or
          annual accuracy.
        </p>
        <p>
          <a
            href="https://pvpmc.sandia.gov/model-validation/model-validation-procedure/"
            target="_blank"
            rel="noreferrer"
          >
            Sandia: model validation
          </a>
          {" · "}
          <a
            href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/data-sources-calculation-methods_en"
            target="_blank"
            rel="noreferrer"
          >
            JRC: weather uncertainty
          </a>
        </p>
      </details>
      <details className="assessment-details">
        <summary>
          {assessment.status === "assessed"
            ? "What to check next"
            : modelLimited
              ? "Why this comparison is limited"
              : "Why more data is needed"}
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <ul>
          {assessment.caveats.map(({ code, message }) => (
            <li key={code}>{message}</li>
          ))}
        </ul>
        <ol>
          {assessment.nextChecks.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ol>
      </details>
      <p className="assessment-footer">
        Screening guide for the matched period. Field accuracy remains
        unverified.
      </p>
    </section>
  );
}

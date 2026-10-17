import { useRef, useState } from "react";
import {
  CONTACT_LOS, formatAzimuth, formatElevation, formatRange, formatRangeRate, formatSigned,
} from "./contact.js";

function ContactCard({ contact: c, busy, onFocus }) {
  const [copyResult, setCopyResult] = useState(null);
  const reportText = useRef(null);
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(c.line);
      setCopyResult({ line: c.line, message: "Copied this report" });
    } catch {
      reportText.current?.focus();
      reportText.current?.select();
      setCopyResult({ line: c.line, message: "Report selected · copy manually" });
    }
  }
  return (
    <article className="contact-card" aria-label={`${c.id} relative contact`}>
      <button className="track" onClick={onFocus} aria-label={`Focus ${c.id}`}>
        <span>
          <i className="affiliation hostile" />
          <strong>{c.id}</strong>
          <small>{formatRange(c.aglM)} AGL</small>
        </span>
        <code>{c.mgrs ?? "MGRS unavailable"}</code>
      </button>
      <p className={`contact-los contact-los-${c.zone}`}>
        <span className="contact-dot" />{CONTACT_LOS[c.zone] ?? CONTACT_LOS[0]}
      </p>
      <dl className="contact-readings">
        <div><dt>Bearing · grid</dt><dd>{formatAzimuth(c.bearingGridDeg)}</dd></div>
        <div><dt>Elevation angle</dt><dd>{formatElevation(c.elevationDeg)}</dd></div>
        <div><dt>Slant range</dt><dd>{formatRange(c.slantRangeM)}</dd></div>
        <div><dt>Ground range</dt><dd>{formatRange(c.horizontalRangeM)}</dd></div>
        <div><dt>Δh · above own</dt><dd>{formatSigned(c.relativeHeightM)} m</dd></div>
        <div><dt>Ground speed</dt><dd>{c.groundSpeedMps === null ? "UNKNOWN" : `${c.groundSpeedMps.toFixed(1)} m/s`}</dd></div>
        <div className="contact-wide"><dt>Course · grid</dt><dd>{formatAzimuth(c.courseGridDeg)}</dd></div>
        <div className="contact-wide"><dt>Range rate · horizontal</dt><dd>{formatRangeRate(c.horizontalRangeRateMps)}</dd></div>
      </dl>
      <p className="contact-true">
        True bearing {c.bearingTrueDeg === null ? "undefined" : `${c.bearingTrueDeg.toFixed(1)}°`}
        {" · "}γ {formatSigned(c.convergenceDeg, 2)}°
      </p>
      <details className="contact-report">
        <summary>Contact report line</summary>
        <textarea ref={reportText} readOnly rows={8} value={c.line} aria-label={`${c.id} contact report line`} />
        <button onClick={copyReport} disabled={busy}>Copy report line</button>
        <p className="copy-result" role="status">
          {copyResult?.line === c.line ? copyResult.message : ""}
        </p>
      </details>
    </article>
  );
}

export default function TrackedUavs({ snapshot, busy, onFocus }) {
  return (
    <details open className="tracked-uavs">
      <summary>Tracked UAVs</summary>
      <p className="contact-reference">
        SIMULATED tracks · t={snapshot?.time.toFixed(1) ?? "—"} s
        {busy ? " · updating…" : ""}<br />
        GRID N · 6400 mil / turn
      </p>
      <details className="contact-reference-details">
        <summary>North &amp; range reference</summary>
        <p>Grid = EPSG:3067 / UTM 35N, matching MGRS. True bearing = grid bearing + γ
          (meridian convergence at OWN). No magnetic reference. Own position is
          stationary at 2 m AGL; range rate is horizontal, negative closing.</p>
      </details>
      {snapshot?.contacts.length ? snapshot.contacts.map((contact) => (
        <ContactCard key={contact.id} contact={contact} busy={busy}
          onFocus={() => onFocus(contact.id)} />
      )) : <p className="note">{snapshot ? "No active UAVs" : "Waiting for contact snapshot…"}</p>}
    </details>
  );
}

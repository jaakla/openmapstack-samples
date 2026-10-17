export default function Provenance({ config }) {
  return (
    <div className="sources">
      <details open>
        <summary>Published project</summary>
        <p>{config.runId}</p>
        <p>
          These zones are an exploratory browser calculation over published
          geometry. They do not change the validated source products.
        </p>
        <a href={`${import.meta.env.BASE_URL}data/provenance.json`} download>
          Download provenance & assumptions
        </a>
      </details>
      <details open>
        <summary>Sources & licenses</summary>
        {config.sources.map((s) => (
          <p key={s.id}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
            <br />
            <small>
              {s.version} · retrieved {s.retrievedAt.slice(0, 10)}
              <br />
              {s.license}
            </small>
          </p>
        ))}
      </details>
      <details open>
        <summary>Assumptions & limits</summary>
        {config.assumptions.map((a) => (
          <p key={a.id}>{a.statement}</p>
        ))}
      </details>
      <p className="note">
        Simulation, not operational intelligence. A GREEN zone means no
        visibility found under the sampled model; it does not establish safety.
      </p>
    </div>
  );
}

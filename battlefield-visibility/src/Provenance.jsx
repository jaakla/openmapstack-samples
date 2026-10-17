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
        <p>
          <a href={`${import.meta.env.BASE_URL}licenses/coordinates.txt`}>
            Coordinate library licenses & notices
          </a>
        </p>
        <p>
          Display: MGRS, one-metre squares. Analysis: EPSG:3067 / N2000.
          Building meshes are source context; the LiDAR DSM alone determines
          obstruction.
        </p>
      </details>
      <details open>
        <summary>Sources & licenses</summary>
        {config.sources
          .filter((s) => !s.id.startsWith("lod2_") || s.id === "lod2_tileset")
          .map((s) => (
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
      {config.buildingMesh && (
        <details>
          <summary>Official LoD2 building inventory</summary>
          <p>
            {config.buildingMesh.buildingCount} source building IDs ·{" "}
            {config.buildingMesh.tilesReturned}/
            {config.buildingMesh.tilesMatched} tiles ·{" "}
            {config.buildingMesh.publishedTriangles.toLocaleString()} triangles
          </p>
          <p>
            Continuously maintained city model. Acquisition epoch unknown; HTTP
            export 11 May 2026. Rendered roofs differ from the 2021 analysis
            surface.
          </p>
          <a href={`${import.meta.env.BASE_URL}data/building-mesh.json`}>
            Source IDs, bounds & alignment report
          </a>
        </details>
      )}
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

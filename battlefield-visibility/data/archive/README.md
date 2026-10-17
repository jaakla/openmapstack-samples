# Immutable API response snapshots

These gzip files retain the **exact original response bytes** acquired on
2026-10-17, including the live services' timestamps and wrappers. They are
committed with this project; they are not recomputed from a later API response.

- `osm-20261016.json.gz`: © OpenStreetMap contributors, ODbL 1.0,
  https://www.openstreetmap.org/copyright. Historical data cutoff
  `2026-10-16T00:00:00Z`; original Overpass query is in `sources.lock.json`.
- `tile-index.geojson.gz`: City of Helsinki / City Survey Services, CC BY 4.0,
  https://creativecommons.org/licenses/by/4.0/. Nine features selected by the
  original WFS query retained in `sources.lock.json` and `project.yaml`.

- `tileset-lod2.json.gz`: City of Helsinki official untextured LoD2,
  CC BY 4.0. Exact original `tilesetVersion: 291269823412` manifest response.
  The 15 selected leaf `.b3dm` files remain under ignored `data/source/lod2/`;
  every URL and SHA-256 is pinned in the lock. The archived manifest proves the
  AOI selection independently of a future live service response. Viewer configuration
  URL and the research handoff remain in the README; no viewer access token is needed.

The lock pins both compressed archive bytes and original uncompressed bytes.
`acquire.py` verifies the archive, decompresses into ignored `data/source/`, and
verifies the original checksum. It never requests these live endpoints during
reproduction, never strips wrapper fields, and never accepts a checksum mismatch.
Live queries are discovery/update operations for a new reviewed source version,
not substitutes for the archived snapshots. Large survey and source model files
remain outside normal git.

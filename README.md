# OpenMapStack samples

Source-backed geospatial applications built with [OpenMapStack](https://github.com/jaakla/openmapstack-skills).

## Toompea Digital Atlas

Explore surveyed architecture, airborne LiDAR, terrain, cross sections, measurements, and sun studies of Toompea hill in Tallinn.

[![Preview of the Toompea Digital Atlas, showing surveyed architecture and explorer controls](toompea-3d/docs/toompea-preview.png)](https://jaakla.github.io/openmapstack-samples/toompea-3d/)

- [Open the live atlas](https://jaakla.github.io/openmapstack-samples/toompea-3d/)
- [Project documentation and source evidence](toompea-3d/README.md)

The `Deploy GitHub Pages` workflow tests and builds the prepared browser assets on every push to `main`, then publishes the atlas under `toompea-3d/`. The site root is a gallery linking the independent Toompea and Helsinki demos.

The original large LAZ survey files use Git LFS. Normal Pages builds skip those objects; full GIS recompilation requires `git lfs pull` and the numerical/desktop dependencies documented in the project.

## Helsinki visibility

A simulated tank/UAV visibility study over measured downtown Helsinki LiDAR.

- [Project, sources, reproduction and limitations](battlefield-visibility/README.md)
- Published under `battlefield-visibility/` when approved and merged; this change does not deploy it.

The shared Pages workflow tests and builds both demos on PRs; deployment is restricted to `main`.

# OpenMapStack samples

Source-backed geospatial applications built with [OpenMapStack](https://github.com/jaakla/openmapstack-skills).

## Toompea Digital Atlas

Explore surveyed architecture, airborne LiDAR, terrain, cross sections, measurements, and sun studies of Toompea hill in Tallinn.

[![Preview of the Toompea Digital Atlas, showing surveyed architecture and explorer controls](toompea-3d/docs/toompea-preview.png)](https://jaakla.github.io/openmapstack-samples/toompea-3d/)

- [Open the live atlas](https://jaakla.github.io/openmapstack-samples/toompea-3d/)
- [Project documentation and source evidence](toompea-3d/README.md)

## UAV visibility

Explore simulated hostile UAVs over downtown Helsinki using 2021 city LiDAR, including vegetation, and official LoD2 buildings. Live RED/YELLOW/GREEN line-of-sight zones for a 2 m observer, a five-minute forecast, and MGRS contact reports describe the simulated situation.

[![Preview of UAV visibility, showing simulated UAV contacts and line-of-sight zones over downtown Helsinki](battlefield-visibility/docs/uav-visibility-preview.png)](https://jaakla.github.io/openmapstack-samples/battlefield-visibility/)

- [Open the live demo](https://jaakla.github.io/openmapstack-samples/battlefield-visibility/)
- [Project documentation and source evidence](battlefield-visibility/README.md)

## Publishing

The shared `Deploy GitHub Pages` workflow tests and builds both demos on pull requests and pushes to `main`. Pushes to `main` publish the prepared browser assets under `toompea-3d/` and `battlefield-visibility/`; the [site root](https://jaakla.github.io/openmapstack-samples/) is a gallery linking both independent demos.

Normal Pages builds use committed browser assets and skip raw Git LFS downloads. Toompea's original large LAZ survey files use Git LFS; full GIS recompilation requires `git lfs pull` and the numerical/desktop dependencies documented in that project. UAV visibility's raw acquisitions are excluded from normal git; its project documentation describes acquisition and full recompilation.

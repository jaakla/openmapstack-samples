# Iteration 2 browser and visual QA

The flow under test was load → source-backed 3D scene → MGRS relocation and export
→ individual UAV LOS → count/height/playback → layer groups → exact default reset.

Browser plugin not available; regular Playwright Chromium was used. Development
checks ran at `http://127.0.0.1:5175/`; production checks ran at
`http://127.0.0.1:5176/openmapstack-samples/battlefield-visibility/`.
Viewports: desktop **1536×1024**, touch **390×844**, and narrow **320×700**.
The headless renderer used SwiftShader; this is not a physical-phone benchmark.
Temporary profiles, downloads, scripts and caches stayed under the worktree.

| Check | Result |
| --- | --- |
| Page identity / meaningful content | Pass: Helsinki title, measured terrain, official LoD2 roofs, vegetation and licensed UAV model |
| Framework overlays / console / assets | Pass: no overlays, console errors/warnings or HTTP asset failures; GLB and worker loaded |
| Individual LOS | Pass: all four statuses at MGRS-selected measured positions; rendered endpoints match drone altitude and own position at 2 m AGL |
| MGRS controls / export | Pass: valid entry, rejected invalid input without moving target, optional EPSG:3067 display, downloaded JSON with MGRS own/drone locations |
| Playback / tracks | Pass: 0–3 UAVs, AGL change to 150 m, 5× playback, dotted elapsed history, nine future hypotheses and three terminal envelopes |
| Layer controls / provenance | Pass: individual and group switches mark the view exploratory; reset restores the published label; official LoD2 inventory and source/licence details accessible |
| Canonical reset | Pass: t=0, manifest defaults/layers/target, secondary display off; exact zone counts `[2408,1288,198,6]` restored |
| Responsive layout | Pass: no horizontal overflow or title/snapshot/toolbar/readout overlaps at all three viewports |

Road edges are batched into one draw call. Before label leaders, the default scene
used 67 draw calls versus roughly 3,000 before batching. Source edges and measured
surfaces are unchanged. This improves rendering cost but does not establish an
FPS target on untested hardware.

## Visual comparison

The generated design reference and rendered screenshots were inspected with
`view_image`. The implemented design follows the reference's dark console palette,
monospace telemetry, tab/collapsible hierarchy, map-first mobile stacking and
restrained borders. Final screenshots were inspected again after the changes.

| Comparison | Verified treatment |
| --- | --- |
| Copy / semantics | Required title, simulation label, UAV controls and MGRS; corrected concept legend to RED = visible |
| Layout | Sidebar on desktop; map/readout first on phone; controls clear at 320px |
| Typography | Deliberate control sizes and monospace coordinate/telemetry readouts |
| Palette / symbols | Dark blue-green surfaces, olive controls, hostile red diamond and friendly blue frame; status colour independent of affiliation |
| Asset treatment | Real untextured LoD2 roofs and pinned 2021 imagery replace the concept's illustrative textured city; no generated geometry or map image used |
| Dense state | Screen-sized UAV labels use leader lines and avoid each other; past/future strokes and terminal envelope remain distinct |

Intentional differences from the visual concept are driven by the published
10–150 m range, accurate visibility semantics, source-backed untextured buildings,
and working MGRS entry/export. The design was checked against these requirements;
no unresolved functional or responsive finding remains in the tested Chromium
views. Physical Android/iOS GPU performance and Safari remain unmeasured.

## Screenshots

Published defaults, desktop:

![Desktop published defaults](iteration-2-desktop.png)

Published defaults, 390px phone (full page):

![390px phone published defaults](iteration-2-phone-390.png)

Exploratory playback paused near t=120 s: three UAVs at 150 m AGL, 5× playback
speed selected. This is not the published t=0 state.

![Three-UAV traces and forecast](iteration-2-tracks.png)

# Solar Atlas interface

Reference: `interface-concept.png`, generated with the built-in Image Gen tool, 1536 × 1024.

Use a 64px white header, a 340–380px white planning rail, a dominant aerial map, and a white results band below the map. At narrow sizes the map precedes the planning panel. Font: system sans, dark forest headings, muted gray text, tabular numerals. Background is true white; primary #1d5037, scenario #cce778, muted #69736e, border #dde3df. Controls use 6px radius. The sun logo is a lucide outline icon. No marketing sections.

Components: header/export actions; three ARIA tabs (Scenario, Evidence, Validate); collapsible geometry/system/market sections; numeric and range fields; map with aerial/surface/coverage switches; date/time sun control; three-stage energy flow; grouped monthly chart; revenue and shadow-loss column; source/author footer. Live results come from data and the shared engine; the concept's empty numbers are filled with those results.

Intentional functional changes from concept: a 5m authoritative DSM is a combined building/tree surface, so the layer is labeled Surface rather than claiming a classified building layer. Explicit pilot coverage replaces unrestricted location search. Actual date, source attribution, quality limits, CSV comparison and exports expand the evidence/validation tabs. Canonical credits include AI/free-toolkit attribution and run time. No generated map imagery is used as geographical evidence.


## Verified implementation ledger

The generated concept and latest browser capture were both inspected with `view_image` at the reference 1536 × 1024 size. Browser plugin was unavailable; Playwright Chromium supplied desktop and 390/320 px checks.

- Composition: the white header, 380 px desktop rail, large aerial canvas and split energy/revenue band match the concept.
- Palette: true white surfaces, forest-green type/actions and lime hypothetical geometry retained; a dark theme uses explicit alternate tokens.
- Typography: compact system-sans controls and large tabular yield values match the reference hierarchy; no browser-default control typography.
- Controls: Scenario/Evidence/Validate tabs, geometry buttons, array inputs and date/time scrubber retain the specified component family; actual market selector is a select instead of the concept's segmented pair.
- Map: pinned official imagery replaces the illustrative generated map. Official building outlines and real source-grid shadows are functional overlays; no generated geographical evidence is used.
- Results: real model values fill the concept's empty values; monthly groups preserve the three semantic green series, and revenue uses the shared year/margin calculation.
- Responsive behavior: map comes before the planning rail on phones; both 390 and 320 px avoid horizontal overflow and keep controls reachable.

Above-the-fold copy was checked against the concept and requested workflows. Intentional additions are the canonical/exploratory state, partial-horizon and old-surface disclosure, CSV import/export, above-terrain height clarification, historical-weather wording, and canonical toolkit/author/time credits. The extra explanatory copy makes the desktop rail scroll. Model coverage and data evidence take priority over illustration-specific scenery. These are the recorded functional deviations; no unresolved clipping or broken controls remain.

The browser interaction suite verifies canonical replay, changes and reset, drawn polygons, scenario export/import, local production CSV comparison and rejection of ambiguous timestamps. Date clearing retains the previous valid sun state.

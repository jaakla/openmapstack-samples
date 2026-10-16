# Toompea interface specification

Reference: `interface-concept.png`, created using the built-in image tool. This is a UI reference only; the illustrated geography is excluded from all source data and from the rendered application.

- Paper: warm ivory #f4f1eb. Canvas: mineral gray #e6e2da. Ink #292b29. Fine border #d2cec6. Burnt orange accent #ae5434. No colored wash over the measured scene.
- Typography: Libre Caslon Display for museum headings, introductory copy, and place names. DM Sans for interface text. Large serif title 42 px; body 22 px; controls 10–12 px; tracked section labels 9 px.
- Desktop: slim 84 px header, fixed 306 px left panel, unframed 3D canvas filling remaining height, 53 px attribution footer. Main navigation Explore / Places / About the atlas. Source and help controls in header.
- Sidebar: introduction, collapsible Your view and Light & atmosphere sections, 3-mode segmented switch, four layer switches, sunlight slider, featured place.
- Canvas: code-native labels attached to real geocoded locations, vertical home/zoom/top/fullscreen/snapshot controls, floating Orbit/Pan/Inspect toolbar, actual orthophotographic overview, calibrated 100 m scale.
- Responsive: below 850 px, panel becomes a dismissible overlay. Mobile controls stay available and the canvas keeps most of the screen. Source dialog scrolls independently. No clipped fixed-width desktop layout.
- Signature components: fine rules, compact orange switches, serif landmark titles, warm translucent canvas toolbar. Modest camera easing and control transitions. Reduced-motion CSS disables UI animations.
- Intentional reference deviation: the illustration’s invented geography is replaced with actual surveyed I3S geometry, LiDAR-derived terrain, and source imagery. Model fidelity is constrained by the source LOD and point-cloud observations, never by the generated design reference.

Generation record: built-in Image Gen, prompt preserved verbatim in `concept-prompt.txt`. The generated concept is saved at `design/interface-concept.png`. Both are design artifacts, not geographic observations.

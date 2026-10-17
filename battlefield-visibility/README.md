# Helsinki visibility

Independent OpenMapStack project for issue #1. All movement and forecasts are
**SIMULATED**, exploratory, and not operational intelligence.

## Development

`npm ci`, `npm test`, `npm run dev`; production: `npm run build`.

The simulation follows published source-node routes with deterministic ping-pong
motion. The tank remains on source street edges. Forecasts sample the next five
minutes at 60 second intervals under three equally weighted speed hypotheses
(0.8, 1.0, 1.2). A hypothesis counts once if any future sample can see the target.
The displayed probability is a scenario weight, not an empirically calibrated
probability. Yellow uses at least 0.25 per vector; current LOS overrides yellow.
Short visibility windows between forecast samples can be missed.

LOS uses conservative supercover grid traversal through every intersected DSM
cell. A grazing ray blocks. Unknown/outside measured coverage stays UNKNOWN,
never green. Analytic arrays in tests are fixtures only, not Helsinki geometry.

Source acquisition, pipeline reproduction, provenance and validation instructions
will accompany the measured-data implementation. Large raw downloads are ignored.

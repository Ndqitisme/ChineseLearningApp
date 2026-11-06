# Credits (tools/skins/ai2d/rig/motion)

No third-party assets are used in this folder.

- **Code.** All code here is original and MIT, like the project.
  - `lib/fk.mjs`, `lib/ik.mjs`, `lib/limits.mjs`, `lib/compose.mjs`, `lib/body.mjs`, `lib/layer2d.mjs`, `lib/behaviour.mjs`, `gen_spec.mjs`, `check_spec.mjs`, `make_bad.mjs`, `prove_issues.mjs`, `preview.mjs`, `fallback_sweep.mjs` and `run.mjs`.
- **Methods used, not code copied.**
  - Fritsch–Carlson monotone cubic interpolation (1980).
  - Drillis–Contini body segment ratios.
  - The VRM 1.0 humanoid bone and expression names, from the VRM specification by the VRM Consortium (MIT/CC-BY specification text; no files copied).
- **Dev tools, not redistributed.** puppeteer-core 24.20.0 (Apache-2.0), unmodified, installed in this folder's `node_modules`; it drives headless Chrome for the rig's renders and gates (`../render.mjs`, `../gates.mjs`).

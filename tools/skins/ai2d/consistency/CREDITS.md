# Credits: consistency checker (tools/skins/ai2d/consistency)

| Asset | Source | Licence | Changes |
|---|---|---|---|
| Likeness harness (likeness.py, MediaPipe face_landmarker.task) | `tools/skins/ai2d/harness/` (frozen; its CREDITS.md lists the model: Apache-2.0) | as listed there | none; imported read-only and run as a subprocess |
| Look B art (Codex image generations) in `fixtures/b_r1/`, `fixtures/r1_clean/`, `fixtures/wave_key_4x.png`, `fixtures/seeded/` | the look B lever, run unchanged | CC0-1.0 | rendered at 4x and 1x; seeded copies carry painted defects |
| Python packages (numpy, scipy, scikit-image, opencv, Pillow, mediapipe) | `tools/skins/ai2d/.venv`, pinned in `tools/skins/ai2d/harness/requirements.lock` | BSD / Apache-2.0 / HPND | none |

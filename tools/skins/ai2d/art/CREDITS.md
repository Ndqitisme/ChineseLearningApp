# Credits (tools/skins/ai2d/art)

| Asset | Source | Licence | Changes |
|---|---|---|---|
| src/master.png, face_hd.png, face_{smile,blink,talk}.png, raise.png, wave.png | Codex image generations of look B, stored byte-identical | CC0-1.0 | Keyed, glasses repainted, lower face warped, LAB graded, cut into parts (run.py). |
| src/tuck.png, think.png, talk.png, happy.png, sleep.png, head_yaw12.png, head_pitch15.png, head_pitch15_closed.png | Codex CLI 0.166 built-in image_gen; prompts in gen/p_*.txt, calls in generations.log | CC0-1.0 | Same pipeline; keys give left-arm forearm and hand regions only; views are glasses-free heads that get the drawn glasses. |
| b_r1.py | The look B lever, this repo | this repo's code (MIT) | Used as a library with its globals pointed at this folder. |
| Drawn glasses, jaw warp, parts | run.py output | this repo's code (MIT) | Not applicable. |
| Two-foot stance (work/master_stance.png) | run.py step_legs: src/master.png's own straight leg (her left), mirrored and splayed for her right leg, shoes sheared toes-out | CC0-1.0 (derived from the Codex master) | No new generation: the image service refused the Codex legs edit (generations.log). |
| face-reference.png | references/character/, AI-generated, supplied by the user | private; not redistributed | Never packed. Read by the harness and the grade. Not sent to Codex (the inputs are src/master.png, src/face_hd.png, src/head_pitch15.png). |
| figure-outfit-reference.png | references/character/ | photo of a real person | Never read or sent. codex_gen.sh refuses an input whose sha256 matches it. |
| Frozen likeness harness | tools/skins/ai2d/harness/ | this repo's code (MIT) | None; run read-only as a subprocess and imported for palette regions. |
| numpy, opencv-python-headless, scikit-image, scipy, Pillow, mediapipe | PyPI, in tools/skins/ai2d/.venv (from tools/skins/ai2d/harness/requirements.lock) | BSD-3 / Apache-2.0 / BSD-3 / BSD-3 / MIT-CMU / Apache-2.0 | None. |

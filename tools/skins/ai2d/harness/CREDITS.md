# Credits (tools/skins/ai2d/harness)

The harness measures how closely a candidate image of the character matches the face reference: palette, face geometry, glasses and app-size legibility (see RUBRIC.md).

Third-party material the harness uses. None of it is copied into `src/`, `public/` or any shipped file.

| Name | URL | Licence | Use and changes |
|---|---|---|---|
| MediaPipe Face Landmarker model, float16 v1 (`models/face_landmarker.task`, sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`) | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task (model card: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | Apache-2.0 | Unchanged. Stored here so the freeze hash covers it. Loaded as data by the mediapipe runtime; nothing in the download is executed. |
| mediapipe 1.2.2 (Python package, venv only) | https://pypi.org/project/mediapipe/ | Apache-2.0 | Unchanged; runs the model. |
| OpenCV 5.0.0 (opencv-python-headless, venv only) | https://pypi.org/project/opencv-python-headless/ | Apache-2.0 | Unchanged. |
| scikit-image 0.26.0 (venv only) | https://pypi.org/project/scikit-image/ | BSD-3-Clause | Unchanged; CIEDE2000, Lab, Sato filter, Hessian. |
| NumPy, SciPy, Pillow (venv only) | https://pypi.org | BSD-3-Clause, BSD-3-Clause, MIT-CMU | Unchanged. |

The libraries are dev tools installed in `tools/skins/ai2d/.venv/` (gitignored, made from `tools/skins/ai2d/harness/requirements.lock`), not assets shipped in the MIT repo. BSD-3 and MIT-CMU are permissive.

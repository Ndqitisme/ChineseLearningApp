# Third-party notices

| Component | Used for | License | Source |
|---|---|---|---|
| Assistant character artwork (Tiểu Mai) | Source drawings in `tools/skins/ai2d/`, rig parts atlas in `public/skins/assistant/` | Generated for this project with the image tool in OpenAI Codex; released under CC0 1.0 | — |
| MediaPipe Face Landmarker model (`face_landmarker.task`, float16 v1) | Likeness check in the character tools (`tools/skins/ai2d/harness/`); not shipped in the app | Apache-2.0 | https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker |
| App icon and logo artwork | Icon, tray icon, logo | Generated for this project with the image tool in OpenAI Codex; name banner drawn by `tools/logo/compose.py` with Nunito (SIL OFL 1.1) | — |
| CVDICT | Vietnamese meanings | CC BY-SA 4.0 | https://github.com/ph0ngp/CVDICT |
| CC-CEDICT | Basis of CVDICT; pinyin cross-check | CC BY-SA 4.0 | https://cc-cedict.org/wiki/ |
| complete-hsk-vocabulary | HSK 3.0 word lists (levels new-1..new-6, 2021 standard GF 0025—2021; levels newest-1..newest-6, syllabus finalized November 2025) | MIT (English meanings from CC-CEDICT: CC BY-SA 4.0) | https://github.com/drkameleon/complete-hsk-vocabulary |
| hanviet-pinyin-wordlist | Sino-Vietnamese readings for HSK 4–6 characters, keyed by character and pinyin; merged into `data/hanviet/chars.tsv` (rows after the `# HSK 4–6 characters` line) by `tools/data/hanviet-chars.ts` | MIT, Copyright (c) 2024 Phong Phan — `public/licenses/MIT-hanviet-pinyin-wordlist.txt` | https://github.com/ph0ngp/hanviet-pinyin-wordlist (commit b9923df) |
| hanzi-writer-data (Make Me a Hanzi) | Stroke order data in `public/strokes/` | Arphic Public License — `public/licenses/ARPHICPL.TXT` | https://github.com/chanind/hanzi-writer-data |
| Hanzi Writer | Stroke animation and writing quiz | MIT | https://github.com/chanind/hanzi-writer |
| pinyin-pro | Context-aware pinyin for hover tooltips | MIT | https://github.com/zh-lx/pinyin-pro |
| ts-fsrs | FSRS review scheduling | MIT | https://github.com/open-spaced-repetition/ts-fsrs |
| pitchy | Pitch detection for tone practice | MIT | https://github.com/ianprime0509/pitchy |
| LXGW WenKai Lite, subset and renamed "TieuMai Kai" (OFL reserved font name) | Chinese and pinyin font | SIL OFL 1.1 — `public/licenses/OFL-TieuMaiKai.txt` | https://github.com/lxgw/LxgwWenKai-Lite |
| Nunito (subset) | UI font | SIL OFL 1.1 — `public/licenses/OFL-Nunito.txt` | https://github.com/googlefonts/nunito |
| Tauri, Svelte, Vite | Application framework | MIT / Apache-2.0 | https://tauri.app, https://svelte.dev |

The vocabulary dataset (`data/`, `src/generated/`) combines CC BY-SA sources with content written for this project (topic word lists, short meanings, example sentences, the HSK 1–3 part of the Hán Việt table). It is distributed under CC BY-SA 4.0. The AI-assisted parts still need review by native speakers.

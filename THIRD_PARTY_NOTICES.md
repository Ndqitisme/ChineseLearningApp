# Third-party notices

| Component | Used for | License | Source |
|---|---|---|---|
| MakeHuman / MPFB2 system assets — base body, `young_caucasian_female` skin, `ponytail01` hair, `eyebrow001`, `eyelashes02`, `shoes04`, eyes, teeth, tongue, expression targets | Assistant character, built in Blender and pre-rendered to 2D frames; hair and brows tinted, skin warmed, lips tinted, brown eyes, socks removed | CC0 — details in `public/skins/assistant/CREDITS.txt` | https://static.makehumancommunity.org/assets/assetpacks.html |
| `toigo_round_glasses_leopard` by MargaretToigo | Original variant's glasses; hidden in the reference variant, replaced by original silver wire geometry | CC0 | https://static.makehumancommunity.org/assets/assetpacks/glasses01.html |
| `elvs_male_shirt_untucked_bd1` by Elvaerwyn | Character's shirt; short sleeves, asymmetric cropped hem, white cotton material | CC-BY (version not stated by the pack) | https://static.makehumancommunity.org/assets/assetpacks/shirts02.html |
| `mtknife_pleated_mini_skirt` by MTKnife | Original variant's skirt; replaced by original fitted tartan geometry in the reference variant | CC-BY (version not stated by the pack) | https://static.makehumancommunity.org/assets/assetpacks/skirts02.html |
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

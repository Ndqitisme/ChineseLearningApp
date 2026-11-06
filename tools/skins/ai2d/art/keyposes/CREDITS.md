# Credits (tools/skins/ai2d/art/keyposes)

| Asset | Source | Licence | Changes |
|---|---|---|---|
| src/wave_ul.png, wave_ur.png, drag.png, land.png | Codex CLI 0.166 built-in image_gen: edits of ../src/master.png, each with its 3D pose guide as a second input (prompts gen/p_*.txt, calls in ../generations.log) | CC0-1.0 | Keyed, graded with the art lever's per-region grade, registered to the master, cut into continuous limbs (run.py). |
| src/head_yawm12.png, head_yawp12.png, head_pitchm15.png | Codex edits of ../gen/face_hd_in.png with a 3D head-angle guide, glasses kept (head_yawp12: a later call, with head_yawm12 mirrored as the angle reference instead of the 3D guide) | CC0-1.0 | Keyed, jaw-warped to the reference profile, mouth moved to the rest head's nose-to-mouth ratio on the turned views, graded (hair closed-loop to the rest head); shipped variant has Codex's glasses painted out and the rest head's wire redrawn as one two-lens template centred where the rest lenses sit on the eyes; neck stub shaded toward the rest neck; the codexGlasses variant keeps Codex's glasses. |
| src/mask_think.png, mask_tuck.png | Codex recolours of ../src/think.png and ../src/tuck.png (arm painted flat blue/magenta) | CC0-1.0 | Used only as a segmentation silhouette for the arm where it overlaps the face and hair. Never shipped. |
| ../src/wave.png, think.png, tuck.png, talk.png, happy.png, master.png | Codex generations in tools/skins/ai2d/art/src/ | CC0-1.0 | Cut into continuous limbs. |
| ../out/parts/torso.png | tools/skins/ai2d/art/run.py output | CC0-1.0 (derived) | Left sleeve area refilled from the wave key and inpainted, shirt carried 14 master px under both armholes (the right from the master's own pixels), specks under 32 px removed: torso__noLeftSleeve.png. |
| references/character/sample_2026-11-05T051444.292.glb | TRELLIS.2 model made by the user from the master (MIT tool), local and gitignored | private; guide only | Voxel-remeshed, decimated, rigged with distance weights and posed in Blender (guide/blender_guide.py); renders are inputs to Codex, never shipped. |
| Blender 4.5 | portable install, outside the repo | GPL (tool only) | None. |
| Frozen likeness harness | tools/skins/ai2d/harness/ | this repo's code (MIT) | None; run read-only as a subprocess. |
| face-reference.png | references/character/ | private; not redistributed | Read by the harness and the jaw profile only; never sent to Codex. |
| figure-outfit-reference.png | references/character/ | photo of a real person | Never read or sent. gen/codex_gen2.sh refuses an input whose sha256 matches it. |

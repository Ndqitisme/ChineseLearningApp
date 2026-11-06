Consistency checker for rendered frames of the character. Frozen: see FROZEN. Do not edit any file it
lists.

WHAT IT IS
One tool, run unchanged on any set of rendered frames. It sits next to the likeness harness
(tools/skins/ai2d/harness/, frozen), imports it read-only and calls it as a subprocess. It does not
copy or change it.

The fixture frames come from look B, an earlier look of the character. File and key names call them
r1 (fixtures/r1_clean, HOLDOUT_R1).

VERIFY, THEN RUN (from the repo root; the venv is tools/skins/ai2d/.venv, made from
tools/skins/ai2d/harness/requirements.lock)
  (cd tools/skins/ai2d/consistency && grep -E '^[0-9a-f]{64}  ' FROZEN | sha256sum -c)
  (cd tools/skins/ai2d/harness && grep -E '^[0-9a-f]{64}  ' FROZEN | sha256sum -c)

  tools/skins/ai2d/.venv/Scripts/python.exe -I \
    tools/skins/ai2d/consistency/consistency.py \
    --frames <DIR> --out <OUT>
    [--ref references/character/face-reference.png]  (default)
    [--spec tools/skins/ai2d/motion-v1/motion-spec.json]   (default; pass tools/skins/ai2d/rig/motion/motion-spec.json for rig frames)
    [--no-likeness]                                   (skips check 4; the run can then not pass)

  Exit 0: every check ran and passed on every frame. 1: something failed or could not run. 2: bad input.
  Time: about 4 s per frame plus about 25 s per clip for the likeness harness
  (70 fixture frames: about 6 minutes).

  Sensitivity proof (rebuilds fixtures/seeded/, runs/, proof.json; needs the fixture frames, see FIXTURES):
    tools/skins/ai2d/.venv/Scripts/python.exe -I tools/skins/ai2d/consistency/prove.py

INPUT (DIR)
  DIR/manifest.json
  DIR/rest/4x/0000.png    DIR/rest/1x/0000.png
  DIR/<clip>/4x/NNNN.png  DIR/<clip>/1x/NNNN.png      one pair per frame, same name
  4x = 556x1360 RGBA rendered natively at 4x (not upscaled). 1x = 139x340 RGBA, the app frame.
  The 4x frame box-downsampled must equal the 1x frame (check 0).

  manifest.json (all coordinates in 4x pixels, y down):
  {
    "scale": 4,
    "rest_joints": { "<bone>": [[x0,y0],[x1,y1]], ... },     proximal joint first
    "allowed_holes": { "rest": {"0": [[x,y],...]}, "<clip>": {"<frame>": [[x,y],...]} },
    "clips": { "<clip>": {
        "peak": <frame index>,                 the frame the likeness harness grades (default 0)
        "head_views": [<frame index>, ...],    frames that show a declared head view (turn, sleep pitch)
        "joints": { "<frame>": { "<bone>": [[x0,y0],[x1,y1]] } },   bones as posed in that frame
        "change_zones": { "<frame>": [[x0,y0,x1,y1], ...] }        optional: boxes where new content
                                                                    is intended (props, a mouth shape)
    } }
  }
  Bone names follow motion-spec twoD part names (leftUpperArm, leftForearm, leftHand, leftThigh,
  leftShin, leftShoe, ...). A bone missing from rest_joints is ignored. A frame without joints uses
  rest_joints. An allowed point declares a background gap the art really has (the hand-on-hip loop,
  the space between fingers, the ponytail/neck gap). Each one must be checked by eye on the evidence
  image; an undeclared hole or see-through patch is a defect.

OUTPUT (OUT)
  report.json   per frame: every check with its numbers and pass flag, and "fails"; per clip: summary
                (frames failed per check, head SSIM min, hold-out medians, likeness harness result).
  sheets/<clip>.png    contact sheet: each frame at 1x over light (#f0f0f0) and dark (#10141f),
                       green border = clean, red border + failing check names.
  evidence/<clip>_<NNNN>.png   4x over dark for every failing frame. Red = hole, magenta = island,
                       yellow = ghost, cyan = see-through, orange = new seam line, light green = halo,
                       circles along each bone = limb samples (green covered, red not).
  heads/<clip>_<peak>.png        the head crop given to the likeness harness (1024 px, rest coordinates).
  heads/*_holdout.png            hold-out pixel sets drawn on the reference and on each graded head.
  likeness/<clip>_<peak>/        likeness harness output (metrics.json, compare.png, stdout.txt).

HOW THE HEAD IS FOUND
  MediaPipe face mesh (the likeness harness's detect_mesh) runs once on the rest frame. That gives the face
  oval, eye and mouth boxes, the head box (oval +8 % face width, chin +4 %), the likeness crop (a
  square from the hair top, twice the oval width) and the neck band (chin to 0.55 face heights below,
  one face width wide). Each frame's head is aligned to the rest head with OpenCV ECC (Euclidean,
  phase-correlation start) on the head box. All head checks run on the aligned head.

THE CHECKS AND THEIR THRESHOLDS
  Each line: what it measures; the bar; the clean fixture value; the seeded-defect value. All measured
  on 70 clean fixture frames (rest, 48 idle, 21 wave) and 10 seeded frames, one run each. Everything is
  deterministic: two full prove.py runs gave a byte-identical proof.json, and a rerun of the fixture
  lever rebuilt all 143 fixture files byte-identically (runs/r1_clean_sha_*.txt).

  0. agree_4x_1x. Mean |area-downsampled 4x - 1x| over premultiplied RGBA, 0-255.
     Bar <= 6.0. Clean max 1.63. Seed (wrong 1x twin) 6.92.

  1. holdout. Colour on pixel sets the art grade does not aim at. The look B grade moves each region's robust
     median on the harness's own masks (likeness.regions) onto the reference, so those medians are
     self-graded. The hold-outs are:
       <region>.bright  the pixels of the harness mask at or above its median L* (hair, skin, iris with
                        highlights dropped as the harness does, lips);
       hair.place       crown and the side hair beside each temple patch, harness masks removed;
       skin.place       lower cheeks beside the mouth corners and the nose bridge, harness masks removed.
     Each frame's hold-out uses the rest head's keypoints on the aligned head (a fresh mesh per frame
     moved the samples by itself: +6.6 L on two idle frames). Declared head views get their own mesh.
     Bar: |dL| <= 4, |dC| <= 3, |dh| <= 10 deg when both chromas >= 6, against
     the reference's same sets. Compared on medians in CIELAB / LCh.
     Clean fixture rest: hair.bright +1.2/+0.8/+5.2, skin.bright -0.7/-0.8/+2.6, skin.place +2.9/-0.5/+1.5,
     lips.bright -2.5/-0.6/-0.4 pass. hair.place -4.32 L FAILS (crown hair darker than the photo's crown).
     iris.bright +4.79 L, -3.07 C FAILS (reference iris L 22.6 C 7.4, fixture iris L 27.3 C 4.3: lighter
     and greyer). Seed (hue +15 deg): dh +14 to +20 on hair, skin and lips.
     Caution: these sets are now public. A grade that aims at them stops them being hold-outs.

  2a. see_through. Pixels at least 3 px inside the silhouette whose L* over the light and over the
     dark background differ by more than 8 (alpha below about 0.9): a cut or gap showing the desktop.
     A component of >= 36 4x px fails unless an allowed point lies in it.
     Clean rest: largest 17 px (hair edge). Clean idle: hair-strand gaps up to 29-34 px; neck/collar
     comps 36-99 px in 39 of 48 frames (a real fixture defect, below). Seed (half-alpha neck line): 309 px.
     The bar sits between the strand gaps (<= 34) and the seams (>= 36): that margin is thin.
  2b. seam. Thin lines (|L - median7x7 L| > 12 L) on opaque pixels, over both backgrounds, that no rest
     line (widened 2 px) explains when carried by the torso, the head transform, half of it (the neck)
     or the transform of a declared bone. Counted in the neck band and in a 28 px disk at each declared
     joint. A band fails with > 40 new line px. Clean max 20 (wave). Seed (opaque pale neck line): 158.
     This compares with rest, so a seam drawn into the rest frame itself is caught only if it is
     see-through (2a) or by the eye on the contact sheet.
  2c. halo. Silhouette edge pixels (outer 2 px) brighter than both their nearest interior pixel and the
     dark background by > 10 L (light key fringe), or darker than both on the light background.
     Bar: share of edge pixels <= 0.10 and <= the rest frame's share + 0.02.
     Clean: 0.051-0.061 (rest 0.061; this is the art's own rim light, not visible at 1x by eye).
     Seed (2 px pale ring on the legs): 0.354.

  3. head_ssim. SSIM of the aligned head against the rest head on the head box, both Gaussian-blurred
     with sigma 1.0 4x px (a quarter app pixel; evens out resampling blur), over pixels opaque in both
     heads (strands swaying over the background are motion, not identity), eye and mouth boxes + 4 px
     masked out. Declared head views are reported, not gated.
     Bar >= 0.97. Clean min 0.9789 (idle, 1.5 deg head tilt). Seed (head of a separate
     Codex generation of the same character): 0.853. Unblurred and unmasked, clean idle fell to 0.898:
     that variant measured hair sway and resampling, not identity.

  4. likeness_peak. The frozen likeness harness on the head crop of the rest frame and of each clip's peak
     frame, with that frame's 1x as --body. Every harness metric must pass.
     Clean fixture: rest, idle 0, wave 6 each 12/12 ran, 0 failed. Seeds: hue shift fails palette.hair,
     skin, lips; swapped head fails palette.hair, skin, iris, lips.

  5a. holes. Background components (alpha < 16) not touching the frame border: >= 24 px at 4x or
     >= 4 px at 1x. Allowed when an allowed point lies in it, or (not on rest) when half of it overlaps
     an allowed rest hole. Clean: all fixture gaps declared (5 on rest, finger gaps on wave 4, 5, 15, 16).
     Seed (10 px disc in the skirt): 317 px at 4x, 14 px at 1x.
  5b. islands. Foreground components apart from the body with >= 24 (4x) / >= 2 (1x) px of alpha >= 128.
     Clean: none (two faint hair wisps of alpha <= 88 do not count). Seed (24 px piece of shirt): 576 px.
  5c. limbs. Each declared bone: projected length / rest length must sit within +-25 % of a rung its
     motion-spec part has (twoD.parts.<bone>.variants: 1 / 0.64 / 0.41 / 0.26, end-on <= 0.21), and the
     bone must be drawn: 24 samples from 10 % to 90 % of the bone, each covered when alpha >= 128 and
     its colour is within dE76 10 of some rest sample of the same bone. Covered share >= 0.85 and
     >= 0.5 on the distal 20 %. Clean: 1.0 except wave 2 and 18 at 0.792 (a real fixture defect, below).
     Clean colour distance on drawn limbs max 9 at the joint ends (excluded) and <= 7 inside.
     Seed (distal half of the raised forearm and the hand erased): cover 0.333, distal 0.0.
  5d. ghost. At half resolution, premultiplied RGBA content that no rest pixel within 8 4x px matches
     within 24 (max channel), outside the zones where change is declared: every bone of the frame and
     of rest (capsule radius 0.25 x bone length + 10; a hand capsule past each forearm), the head box
     (+15 % face width) at rest and at the aligned position, and change_zones. Components >= 150 4x px
     fail. Clean: none in 70 frames. Seed (rest hand copied at 45 % opacity onto the shirt): 460 + 224 px.

  6. Contact sheets per clip, and evidence images, for the eye (see OUTPUT).

  The seeded frames also trip the checks the defect explains: the island and the erased forearm leave
  new content or fragments (ghost, islands), the halo ring is partly transparent (see_through), and
  every seed shares the fixture rest's iris and crown hold-out failures.

KNOWN DEFECTS IN THE CLEAN FIXTURE (each checked by eye on evidence/)
  - Iris lighter and greyer than the reference (every frame).
  - Crown hair 4.3 L darker than the reference crown (rest, wave; 21 of 48 idle frames). It misses the
    bar by 0.3 L. Whether that matters is a judgement for the art; the number is measured.
  - Idle: a semi-transparent jagged cut line at the neck/collar join in 39 of 48 frames (pale jagged
    outlines at the head/torso join).
  - Wave 5 and 15: a dark semi-transparent cut line on the inside of the elbow.
  - Wave 2 and 18: the declared forearm runs over the sleeve, not a drawn forearm (a stump).
  The proof (prove.py) requires the checker to report each of these and nothing else on the clean
  fixture frames.

FIXTURES
  fixtures/make_r1_frames.py   renders look B (a local copy of its lever in fixtures/b_r1/, gitignored,
                               run unchanged, two functions wrapped) into fixtures/r1_clean/ at 4x and
                               1x, with the arm skeleton per wave frame and the declared gaps. About
                               5 min. Only fixtures/r1_clean/manifest.json is stored in the repo.
  fixtures/wave_key_4x.png     the look B Codex wave key (keyed, app box at 4x), the "swapped head" seed.
  prove.py                     builds fixtures/seeded/<case>/ and runs everything (proof.json).

LIMITS
  - Head views (yaw, sleep pitch) are not gated by SSIM; hold-out runs on their own mesh.
  - A seam painted opaque into the rest frame itself is not detected (2b compares with rest).
  - The see-through bar (36 px) is close to the largest hair-strand gap (34 px).
  - Ghost and seam checks trust the declared bones. A ghost inside a declared limb zone is missed.
  - Limb coverage is colour-based: a limb lying over a part of the same colour counts as covered.
  - Not built: a mesh-against-probe agreement test.
  - The fixture art is a Codex output: licence CC0-1.0 (see CREDITS.md).

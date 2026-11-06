# Likeness rubric (frozen with the harness)

The harness (`likeness.py`) measures palette, face geometry, glasses and app-size legibility of a candidate against the face reference. This rubric pairs each trait with the harness number that backs it.

Fill one copy of this table per candidate.
Score each trait 0, 1 or 2 by looking at the crop named in "Proof". Cite the exact file you looked at.
The metric column is the harness number that backs or contradicts the eye; quote its value and pass flag from `metrics.json`.
When eye and metric disagree, score by eye, write both, and say why in the note.

Crops come from `compare.png` written by `likeness.py`:

- **A**: reference face crop (top-left, clean).
- **B**: candidate face crop (top, second column, clean).
- **A' / B'**: the same crops annotated (bottom row). Orange = hair samples, cyan = skin, magenta = iris, red = lips, blue ellipses = glasses rims found (red = best ring below the SNR bar, so "no glasses"), yellow line = brow line, pink line = fringe lower edge.
- **C**: candidate body at 139x340 (the app size).
- **D**: candidate body at 2x.
- **E**: the measured face at 6x from the 139x340 cell, annotated, then clean.

Scores: **2** = matches the reference trait; **1** = recognisably the trait but clearly off in one named way; **0** = missing or wrong.

## Face and hair (from face-reference.png)

| # | Trait | 2 means | Proof | Metric | Score | Note |
|---|---|---|---|---|---|---|
| F1 | Warm medium-brown hair | Same hue family and lightness as A at a glance | A vs B, orange samples in A'/B' | `palette.hair` | | |
| F2 | Soft centre-parted, see-through wispy fringe reaching the brows | Parted at centre, forehead visible through strands, tips at brow level | A vs B, pink and yellow lines in B' | `geometry.fringe_minus_brow_over_face_height` | | |
| F3 | Thin face-framing strands in front of the ears; rest tied back low | Thin strands hang in front of both ears; no loose mass at the back; tie sits low | A vs B, D | none | | |
| F4 | Round, thin, clear-silver metal glasses, large relative to the face | Round lenses, thin light rim, rim width close to A's share of the face | A vs B, blue ellipses in A'/B' | `geometry.glasses_rim_diameter_over_face_width` | | |
| F5 | Soft round face, full cheeks, small rounded chin | Oval-round outline, no pointed or long chin | A vs B | `geometry.interocular_over_face_width` (face width side) | | |
| F6 | Brown eyes, gentle double eyelid, natural lashes, slightly downturned calm gaze | Brown iris, visible crease, lashes not heavy, outer corners level or a little low | A vs B | `palette.iris`, `geometry.eye_width_over_face_width`, `geometry.eye_opening_over_eye_width` | | |
| F7 | Small soft nose | Small tip, no hard bridge line, nose-to-mouth gap like A | A vs B | `geometry.nose_to_mouth_over_face_height` | | |
| F8 | Full soft lips, closed gentle half-smile, pink-beige | Closed mouth, slight upturn, pink-beige colour | A vs B, red samples | `palette.lips` | | |
| F9 | Fair warm skin, light natural blush | Fair, warm (not grey or yellow), faint cheek blush | A vs B, cyan samples | `palette.skin` | | |

## Body, outfit and pose (from the text description of the figure reference)

| # | Trait | 2 means | Proof | Metric | Score | Note |
|---|---|---|---|---|---|---|
| B1 | White cropped collared short-sleeve shirt with a black bow at the collar | All four parts visible: white, cropped above the waist, collar, short sleeves, black bow | D | none | | |
| B2 | Grey plaid fitted mini pencil skirt | Grey plaid pattern readable, fitted, mini length | D | none | | |
| B3 | Slim build, long legs | Slim waist and limbs; legs about half the body height | D | none | | |
| B4 | Rest pose: weight on one leg, left hand on hip, right arm relaxed | All three visible in the rest frame | C, D | none | | |

## App-size legibility (139x340)

| # | Trait | 2 means | Proof | Metric | Score | Note |
|---|---|---|---|---|---|---|
| L1 | Eyes read at app size | Two distinct dark eyes in C without zooming | C, E | `legibility.eyes.<frame>` | | |
| L2 | Glasses read at app size | A ring is visible around each eye in C or D | C, D, E | `legibility.glasses.<frame>` | | |

## Totals

- Face score: sum of F1 to F9 (max 18).
- Body score: sum of B1 to B4 (max 8).
- Legibility score: sum of L1 and L2 (max 4).
- Harness: copy `summary.metrics_ran`, `summary.failed`, `summary.failed_ids`, `ref_mode`, `cand_mode` from `metrics.json`.

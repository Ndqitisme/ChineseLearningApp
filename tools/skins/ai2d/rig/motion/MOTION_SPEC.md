# Tiểu Mai motion spec

`tools/skins/ai2d/rig/motion/motion-spec.json` is the source of truth; this page explains it. `gen_spec.mjs` generates it, `check_spec.mjs` validates it against limits that live only in `lib/limits.mjs`, and `run.mjs` rebuilds and re-checks everything, including `prove_issues.mjs` (each numbered issue fails on the earlier `tools/skins/ai2d/motion-v1/` scheduler and passes here). The reference implementations are in `lib/`: `fk.mjs` (skeleton, curves, FK), `compose.mjs` (pose composer, overlays), `body.mjs` (balance, body volumes, contacts), `ik.mjs` (solvers), `layer2d.mjs` (what a cut-out rig draws) and `behaviour.mjs` (the scheduler and the mouth layer). The rig that draws the art from this spec is `src/lib/rig/rig-player.js` with `rig.json`, built by `tools/skins/ai2d/rig/build_rig.mjs`.

The spec has a two-foot stance with rigged legs, a standing idle that is a held frame plus events, and 36 checker rules. Think, hair tuck and happy rise straight from the hip in front of the body through keys matched to the rig's in-between drawings (`FRONT`, `TUCKMID`); on the way down the hand passes in front of the belly (`INFRONT`) to the hip.

## 0. What ships

- **Runtime: the live layered 2D rig** (`src/lib/rig/rig-player.js`, WebGL with skinned limb meshes). It ticks at 30 fps while a clip, overlay or blink plays, 15 fps in a slow idle event, 10 fps in the sleep loop, and not at all while the rest frame is held or the window is hidden; a tick presents a frame only when something visible moved. Atlas 1024×1024, 4,194,304 B decoded. `tools/skins/ai2d/rig/gates.mjs` measures its CPU, memory and fps into `rig/out/gates.json`.
- **VRM** stays supported by the convention but is not shipped: its decoded RAM is over the budget.
- **The sprite sheet** is a degraded emergency fallback. The checker prints its findings in a separate block: 37 on this spec (28 pop, 7 easeFrames, 1 frozenHold, 1 budget). It fails the run only if a spec ships it.

## 1. Convention (all rigs)

- **Bones.** VRM 1.0 normalized humanoid names. In three-vrm, write to `getNormalizedBoneNode(name).rotation`. VRM 0.x: `VRMUtils.rotateVRM0`, then negate X and Z of every rotation and of `hipsOffset`.
- **Axes.** +Y up, +Z the way she faces, +X her left. Orthographic camera on +Z turned `camera.yawDeg` = 14°.
- **Rotations.** Degrees, three.js Euler order `XYZ` (matrix = Rx·Ry·Rz), local to the T-pose.
  - The elbow is a hinge: `lowerArm` moves only on Y (X, Z within 0 ± 5°). That holds because the forearm's parent X axis is the humerus.
  - **`upperArm.x` is not humeral rotation** (issue 8). Rx is the outermost turn about the parent's X axis, which is the humerus only in the T-pose; on a lowered arm it swings the arm. Humeral and femoral rotation are measured by swing-twist decomposition against the limb hanging straight down (palm in, kneecap forward), + internal. Ranges (inferred, AAOS-style): shoulder −90…+70, hip −45…+40 (`TWIST`). Rest measures +63.6° (left arm, hand on hip), +15.1° (right), +0.1° (legs).
  - Forearm pronation and supination are `hand.x`. `foot.y` turns the toes: − out for the right foot, + out for the left.
- **Composition.** `final = rest + Σ idle layer (inside its events) × idleWeight(t) + clip delta (+ overlay)`, channel by channel (`lib/compose.mjs`). Idle layers may drive `hipsOffset`. Bones a clip drives default to idle weight 0.35; the weight ramps over `idle.rampMs` = 250 ms at rest ends. A coupled layer takes one weight, the smallest of its listed channels (`coupled: [...]`), so the pelvis shift and the leg re-solve fade together and the feet never slide.
- **Curves, expressions, gaze, fingers, frame, 2D.** Monotone cubic Hermite keys `[tMs, value, "h"?]`; VRM 1.0 expression presets; gaze `[yaw, pitch]`; fingers `[curl, spread, thumb]`; `frame.pxPerM` and origin derived from every sampled pose plus a 4 cm margin; layered 2D as in `lib/layer2d.mjs`.

## 2. Rest pose and the living idle

### Rest stance (solved in `gen_spec.mjs`)

- Both feet planted under the hips, supports 20.1 cm apart (hip joints 18 cm), toes out 8° (`foot.y` ∓8).
- Knees straight but relaxed: 7.1° flex (the rule is 1–10°). Thighs `[1.2, ±0.1, ∓0.1]`, feet `[−8.3, ∓8, ±0.1]` (soles flat).
- Pelvis level (`hips [0,0,0]`), spine and chest +0.6° / +0.3°. Centre of mass 0.15 cm from the middle between the feet (rule ≤ 3 cm).
- Knee direction: turned in 0.1°, 0.0 cm medial of the hip-ankle line (rules ≤ 12° and ≤ 1.5 cm).
- Left hand on the hip (fingertip 0.99 cm, wrist 2.95 cm off the pelvis; rules ≤ 1 and ≤ 3 cm), right arm hanging (elbow 15.7°).
- The rest legs are the mean of the weight sway below, so the idle oscillates around the stance.

### Idle: a held frame plus events

While she stands idle one frame is held and nothing is redrawn. She moves only in events, each easing out of the rest frame and landing back on it exactly.

| Event | Source | What moves |
|---|---|---|
| blink | `idle.events.blink`: every 2–6 s, 15 % double | Eyelids (2 presented frames each). |
| breath | `idle.schedule`, 4.2 s each | Chest, upper chest, shoulders; right arm counter-rotates; left arm re-solved on the hip. |
| weightShift | `idle.schedule`, 4.2 s each, alternating sides | Half a sway period: the pelvis shifts 6 mm toward one foot and back, rolls about 1.2°, the unloaded knee softens up to 10°; thighs and feet re-solved by IK so both feet stay put. |
| glance | `idle.schedule`, 1.6–2.2 s each | The head turns up to 6° (signed, per event) and pitches up to ±1.2°, then comes back. |
| idle clips | `stateMachine.events.idleTick`, every 25–45 s | look, hairTuck or breathe (weighted, seeded). |

- **Schedule.** `idle.schedule` is a fixed 120 s cycle of 11 events from a seeded generator, at least 5 s apart; the longest gap is 11.9 s. Each layer names its event kind; outside its windows it adds exactly nothing (`lib/fk.mjs idleAt`). Sine layers are windowed by a plateau with smoothstep ends (30 % of the event), so they start and end at rest with zero velocity.
- **Sway fit.** At 16 phases, the pelvis target (shift, roll, drop by the leg the bent knee loses) is solved with `plantFeet` and a held knee; each channel is fitted to mean + A·sin x + B·cos 2x. A weight shift runs x from 0 to π (or π to 2π for the other side).
- **Saccades** play only inside glance events (`idle.events.saccade.onlyIn`). The 2D rig draws the eyes into the head drawings and does not move them.
- **Checker rules** (`lib/limits.mjs IDLE`): `heldFrame` — no layer may run outside events, and between events the composed pose equals rest bit for bit, over the whole cycle; `idleEvents` — something happens at least every 20 s, no event moves more than 0.3° in its first or last 33 ms, and the expected presented rate is at most 5 fps. The rate counts a frame whenever a drawn joint moved 0.5 px at 2× (measured over the cycle at 30 Hz), 2 per blink, and the idle clips at 30 fps. On this spec: 0.90 (body events) + 0.57 (blinks) + 2.24 (idle clips) = 3.71 fps; held share 67 % of the time.
- **Fixtures.** `heldFrame` (an always-on breath), `idleGap` (one event per cycle: she stands frozen), `idleBudget` (events back to back and idle ticks every 6–14 s).
- **Feet through the idle.** Planted (no slide > 1.2 cm, no float or sink > 6 mm, heel up ≤ 8 mm), tested at 30 Hz inside every event of the 120 s cycle.

## 3. Clips

Every clip starts and ends at rest through eased in-betweens; gestures use the left arm only.

| Clip | Notes |
|---|---|
| happy | Knee bounce: three dips (1.8, 1.0, 0.4 cm) with both feet planted by IK. Fist pump keys timed to the velocity limit. The hand rises from the hip through `FRONT`. |
| drag | Lift: the thighs trail back and the knees fold as she goes up; the left hand leaves the hip and the arm hangs (a hand at the collarbone does not read as lifted), swinging 1.5 cm with the legs. Loop: pendulum legs, period 1.6 s; thighs ±10° (left) and ±9° (right, the frame-edge side) fore-aft and ±2° / ±1.5° sideways; the shin follows 200 ms later with ±12° (follow-through), the foot 300 ms later with ±8°; the legs swing nearly together (0.6 rad apart; half a cycle apart, the swing projects sideways at the 14° camera and the feet cross). The sway layer is muted as a whole while airborne. |
| drag exit (land) | The legs reach down (110 ms), ground contact at 160 ms, knees absorb 2.5 cm (300 ms), rebound to 0.4 cm (480 ms), a second bob of 0.9 cm (620 ms), settle by 800 ms. |
| sleep | Relaxed stance: knees soften and the hips settle 8 mm (enter), rising to 5 mm with each slow breath (loop), back up on waking. The head keeps sinking a little between 1.9 and 3.3 s, so the loop never holds still for 600 ms: no idle layer runs under it. |
| talk | The body only; the visemes live in the gated mouth layer (`stateMachine.mouth`). The hand leaves the hip and the arm hangs a moment (`DROP`) before the palm-up offer, and the same on the way back, so the forearm never sweeps across the belly, a stretch no drawing of the 2D rig can show. The loop's beats dip the forearm and flick the wrist (forearm −40 to −10°, hand −15 to +23° projected). |
| think, hairTuck | The hand rises straight from the hip in front of the body (`FRONT`, then `TUCKMID` for the tuck) and comes back down in front of the belly (`INFRONT`). Think enter ends at 1050 ms, think exit takes 1100 ms. |
| look, notice, nod | Upper-chest share 0.15, 0.08 and 0.06, so the idle sway keeps the right hand inside the silhouette and the resting left hand out of the pelvis. |
| wave | A key at 330 ms brings the hand up in front of the body before it rises (the elbow leads out from the shoulder); the raise lands at 720 ms. The swings stay 0.05 m clear of the hair. |

The art's rest legs (`tools/skins/ai2d/art/out/parts.json`) and this skeleton differ in proportion (art legs about 7 % shorter). The rig does not pin art parts at spec joints: it retargets the spec's change of angle and projected length from rest onto the art's own joints (`rig-player.js`), so the difference does not stretch the art.

## 4. Behaviour (bound to `src/pet/Pet.svelte`)

Source lines in each event's `at` are found by text when the spec is generated and re-verified by the checker (`sourceRefs`), which fails on a stale line.

| Event | Clip | Priority | Rule |
|---|---|---|---|
| dragStart | drag | 100 | Held until dragEnd; preempts anything (120 ms blend). |
| dragEnd | exits drag → land | — | A release during the enter goes to the land at the enter's end (issue 4). |
| longIdle / quietHours | sleep | 90 | Sleep is a **state**: while `sleeping` is set, the scheduler requests sleep again whenever nothing plays, after a drag or a fullscreen hide (issues 1, 2). |
| userBack | exits sleep → wave | locks | Emitted by the rig whenever `sleeping` goes true → false: `wake()`, click `resume()`, and `nextNow()` (issue 3). |
| nextNow | — | — | `clearsSleep`: while asleep it is a userBack; otherwise nothing. |
| known | happy | 70, locks | |
| reveal | exits think → nod | 55, locks | Emitted from `reveal()`. |
| wordShownRevealed / speakStart | talk | 50 | Until the current utterance ends; minimum 1.6 s, maximum 6 s. |
| speakEnd | exits talk | — | Carries the utterance token; a cancelled utterance's late end is ignored (issue 10). |
| wordShownGuess | think | 50 | Until reveal; maximum 8 s. |
| click | nod **overlay** | — | An additive head/neck nod that starts at once over any clip; cooldown 600 ms (issue 7). |
| appStart, fullscreenShow (hidden > 5 min) | wave | 40, locks | fullscreenShow while asleep resumes sleep instead. |
| hoverEnter | notice | 30 | Cooldown 8 s. There is no `greet` event. |
| menuOpen / menuClose | gaze; suppress fidgets | 0 | No idle pick while the menu is open (issue 9). |
| fullscreenHide | stop all, reset to rest | — | The draw loop stops; `sleeping` is kept. |
| idleTick (25–45 s, nothing playing; `intervalMs`, `lib/behaviour.mjs idleTickTimes`) | look 0.4 / hairTuck 0.25 / breathe 0.35 | 10 | Weighted pick with a seeded RNG, never the last pick, never a clip on cooldown (8 / 45 / 20 s), nothing while asleep or the menu is open (issue 5). |

- **Mouth.** `stateMachine.mouth` is its own layer: viseme weight = pattern × gate, gate 1 while the current utterance plays, fading over 150 ms after. Nothing moves the mouth without sound (issue 6). `lib/behaviour.mjs mouthAt`.
- **Preempt, lock, queue, exits.** One queue slot, newest wins, minimum priority 40, expiry 4500 ms (covers wake 1500 + wave 2650); a lock yields only to priority ≥ 90; a loop finishes its cycle if the boundary is within 400 ms, else blends into the exit over 200 ms.
- **Proof.** 21 scenarios (`lib/limits.mjs BEHAVIOUR`): 10 general ones and 11 tagged with an issue number. Every tagged scenario fails on the motion-v1 scheduler and passes here (`prove-issues.json`).

### What the app needs

1. **Rig player.** `rig-player.js` (RigPlayer, Timeline, startLoop) and `lib/` live in `src/lib/rig/`: one `<canvas>` at 139×340 × devicePixelRatio; 30 fps in clips and blinks, 15 fps in idle events, 10 fps in the sleep loop, no ticks while the rest frame is held, stopped while hidden (`visibilitychange`, plus `setHidden(true)` from the fullscreen hide). Call `poke()` after every event so a sleeping loop wakes. It replaces `SpritePlayer`; keep `hit` and `facing`; the mirror stays a CSS `scaleX(-1)`.
2. **Assets.** `atlas.webp` (1024×1024), `rig.json`, `motion-spec.json`. `LOOPING` and `transitions.ts` are not used.
3. **Speech signals** (`src/lib/speech/index.ts`). `speak()` resolves when speech starts (after `speechSynthesis.speak(u)` for system voices, after `await audio.play()` for http/pack). `onStart`/`onEnd` carry a token per `speak()` call: `utterance.onstart`/`onend`/`onerror`, audio `playing`/`ended`/`error`, and an end for the old token when `speechSynthesis.cancel()` or `audio.pause()` replaces it.
4. **Pet.svelte events.** appStart after `restorePlacement()`; `hiddenSince` in the visibility effect; emit `reveal` from `reveal()`; emit `userBack` whenever `sleeping` goes true → false (including `nextNow()`); `menuOpen`/`menuClose`; route the `player.play(...)` calls to `rig.request(event)`; replace `idleLoop` with the idleTick scheduler; add notice and nod.
5. **Fallback.** If the atlas fails to load, show the sprite sheet's idle frame.

## 5. Budget arithmetic

Caps come from `lib/limits.mjs`: decoded image RAM ≤ 9,452,000 B (the sprite sheet, 1390·1700·4).

- **layered2d.** The real atlas holds 28 parts (art body, head, face and leg parts; the key-pose whole-arm drawings, head views and sleeveless torso), 280,915 px, in a 1024×1024 sheet (26.8 % filled). Decoded: 4,194,304 B. With the canvas backing store at dpr 2 (278·680·4 = 756,160 B) and the measured JS heap, the total is in `rig/out/gates.json`. The spec's own estimate (`twoD.atlas`, 539,462 px) is kept as the checker's planning bound.
- **Sprite fallback.** 5 fps would need 119 frames, a 1390×4080 sheet, 22,684,800 B (2.40× the cap).

## 6. What `check_spec.mjs` enforces (36 rules)

Every rule has a seeded defect in `fixtures/bad-spec.json` and a file in `fixtures/single/` (43 files) that must fail with that rule.

- **Ranges:** `jointRange`, `exprRange`, `gazeRange`, `fingerRange`, `hinge`, **`twist`** (swing-twist of upper arms and thighs).
- **Rest and timing:** `restEnds`, `seam`, `layerSeam`, `structure`.
- **Motion quality:** `velocity`, `pop`, `easeFrames`.
- **Arms and silhouette:** `leftArmOnly`, `rightSilhouette`, `edgeSilhouette`, `penetration`, `contact`.
- **Legs:** `balance` (two-foot: COM within 3 cm of the midpoint at rest and of the support segment in every planted frame; pelvis level at rest), **`kneeIn`** (knee direction ≤ 12° toward the midline and ≤ 1.5 cm medial, every frame), **`footFloat`** (planted toe ≤ 6 mm above the ground, heel up ≤ 8 mm), `footPlant` (ankle and toe slide ≤ 1.2 cm, no sink; in clips and through the standing idle), `rest` (knee flex 1–10°, feet 14–30 cm apart, toes out 2–20°, plus the elbow rules).
- **Liveliness:** `frozenHold` (clips: 600 ms windows). **Standing idle:** `heldFrame`, `idleEvents` (section 2).
- **Frame and 2D:** `frameFit`, `layerForeshorten`, `layerViews`.
- **Coverage and behaviour:** `coverage`, `stateMachine` (clips, overlays and picks resolve), `queueExpiry`, `behaviour` (21 scenarios), **`lipSync`** (no visemes in the talk body clip; a mouth layer gated by speaking; no viseme outside speech in any scenario), **`sourceRefs`** (every cited file:line holds its text), **`implemented`** (every event key is implemented by `lib/behaviour.mjs`).
- **Budget:** `budget`.

## Numbered issues: where each is closed

Each proof fails on `tools/skins/ai2d/motion-v1/` and passes on this spec (`prove_issues.mjs`).

| # | Issue | Closed by | Proof |
|---|---|---|---|
| 1 | Drag while asleep loses sleep | Sleep as a state (`behaviour.mjs idleNow`) | scenario `dragWhileAsleep` |
| 2 | Fullscreen hide while asleep | `fullscreenShow.resumeIfSleeping` | scenario `hideShowAsleep` |
| 3 | nextNow never wakes her | `nextNow.clearsSleep`; userBack on any true → false | scenario `nextWhileAsleep` |
| 4 | Release during an enter waits a loop | Enter end goes to the exit when released | scenarios `quickDrag`, `revealDuringThinkEnter` |
| 5 | Idle picker always looks | Weighted seeded pick, noRepeat, cooldowns | scenario `idleVariety` (200 ticks) |
| 6 | Mouth moves with no sound | Gated mouth layer; visemes out of talk | scenario `speechlessTalk` (motion-v1 spec), rule `lipSync`, fixture `lipSync` |
| 7 | Click nod late or dropped | Additive nod overlay | scenarios `clickDuringTalk`, `clickDuringThink`; fixture `behaviour` |
| 8 | upperArm.x is not twist | Convention text; rule `twist` | fixture `twist` (pure 70° twist, joint positions unchanged) |
| 9 | Stale references; unimplemented keys | Generated `at` refs; `sourceRefs`, `implemented`; menu suppression implemented; no `greet` event | fixtures `sourceRefs`, `implemented`; scenario `menuSuppressesFidgets` |
| 10 | Speech end race | Tokens on speakStart/speakEnd | scenario `speechCancelRace` |
| 11 | Stiffness proof sub-pixel | Per-region rule; idle is a held frame plus events: `idleEvents` fails a dead idle, `heldFrame` an always-on one | fixtures `heldFrame`, `idleGap`, `idleBudget` |

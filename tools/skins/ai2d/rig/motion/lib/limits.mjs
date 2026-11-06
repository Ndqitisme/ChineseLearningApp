// Every limit the checker enforces lives here, not in the spec, so a spec cannot widen its own
// ranges or raise its own budget. The generator's IK reads the same joint ranges so it never
// proposes a pose the checker rejects.
const L = (x, y, z) => ({ x, y, z });

// Human joint ranges, absolute normalized-space Euler degrees in the declared convention (XYZ).
// Derived from typical active ranges of motion (AAOS-style tables) mapped to the axes; inferred,
// not measured on a person.
// lowerArm.x is held at 0 +/- 5: in XYZ order an X turn on the forearm spins the elbow hinge
// about the humerus, which no elbow can do. Humeral rotation goes to upperArm.x and forearm
// pronation / supination to hand.x.
export const LIMITS = {
  hips: L([-20, 20], [-30, 30], [-15, 15]),
  spine: L([-20, 30], [-25, 25], [-20, 20]), chest: L([-20, 30], [-25, 25], [-20, 20]), upperChest: L([-20, 30], [-25, 25], [-20, 20]),
  neck: L([-40, 45], [-45, 45], [-30, 30]), head: L([-35, 35], [-50, 50], [-30, 30]),
  leftShoulder: L([-10, 10], [-20, 20], [-15, 25]), rightShoulder: L([-10, 10], [-20, 20], [-25, 15]),
  leftUpperArm: L([-90, 90], [-130, 45], [-100, 95]), rightUpperArm: L([-90, 90], [-45, 130], [-95, 100]),
  leftLowerArm: L([-5, 5], [-150, 0], [-5, 5]), rightLowerArm: L([-5, 5], [0, 150], [-5, 5]),
  leftHand: L([-90, 90], [-35, 35], [-80, 80]), rightHand: L([-90, 90], [-35, 35], [-80, 80]),
  leftUpperLeg: L([-120, 30], [-40, 40], [-30, 45]), rightUpperLeg: L([-120, 30], [-40, 40], [-45, 30]),
  leftLowerLeg: L([0, 150], [-5, 5], [-5, 5]), rightLowerLeg: L([0, 150], [-5, 5], [-5, 5]),
  leftFoot: L([-30, 50], [-30, 30], [-20, 20]), rightFoot: L([-30, 50], [-30, 30], [-20, 20]),
};

/** Peak geodesic angular speed per bone, deg/s (inferred from motion-capture ranges of casual gestures). */
export const VEL = { hips: 120, spine: 150, chest: 150, upperChest: 150, neck: 350, head: 350, leftShoulder: 120, rightShoulder: 120,
  leftUpperArm: 400, rightUpperArm: 400, leftLowerArm: 500, rightLowerArm: 500, leftHand: 700, rightHand: 700,
  leftUpperLeg: 400, rightUpperLeg: 400, leftLowerLeg: 600, rightLowerLeg: 600, leftFoot: 500, rightFoot: 500 };

export const MOTION = {
  exprVelPerS: 25,          // a blink closes in 60-80 ms, peak rate ~1.5x the mean
  gaze: { yaw: 30, pitch: 25 },
  maxStepDeg: 30,           // largest turn of any bone between two shown frames (a pop)
  minEaseFrames: 2,         // in-betweens from rest to the first pose and back, at the shown fps
  rightArmMaxDeltaDeg: 10,  // the right arm may sway, never gesture
  silhouetteTolM: 0.015,    // ~3 px at the frame scale
  footSlideM: 0.012,
  frozenWindowMs: 600, frozenDeg: 0.3, frozenExpr: 0.02, actionFrozenMs: 900,
  idleRampMinMs: 250,       // the idle layer's weight must ramp over at least this at a section's rest ends
  layerSeamDeg: 0.25,       // largest jump allowed between idle-only and a section at its rest boundary
};

/** Body volumes for penetration and contact, in the parent bone's local frame (metres, 1.60 m skeleton). */
export const BODY = {
  // Pelvis and hips, hips-local y relative to the hips joint. Half-width a (x), half-depth b (z).
  // Covers world y ~0.78-1.03 at rest. Widest at the trochanters; the iliac crest is narrower.
  pelvisProfile: [[-0.14, 0.155, 0.095], [-0.07, 0.17, 0.10], [0.0, 0.16, 0.095], [0.06, 0.14, 0.088], [0.12, 0.125, 0.082]],
  // Ribcage around the chest joint, used above world y 0.95 + hips lift.
  torso: { yFrom: 0.95, yTo: 1.36, a: 0.125, bLow: 0.085, bHigh: 0.11, bSplitY: 1.12 },
  penetrationE: 0.8,        // ellipse value below which a hand site is inside the body
  contactTipM: 0.01,        // hand-on-hip: fingertip within 1 cm of the pelvis surface
  contactWristM: 0.03,      // and the wrist (bone centre, ~2 cm under the skin) within 3 cm
  contactIdleM: 0.015,      // the contact holds within 1.5 cm while the idle layer runs
};

// Segment masses (fraction of body mass) at segment midpoints, Dempster via Winter (2009).
export const MASS = [['hips', 'spine', 0.142], ['spine', 'neck', 0.355], ['neck', 'headTop', 0.081],
  ['leftUpperArm', 'leftLowerArm', 0.028], ['rightUpperArm', 'rightLowerArm', 0.028], ['leftLowerArm', 'leftHand', 0.016], ['rightLowerArm', 'rightHand', 0.016],
  ['leftHand', 'leftHandTip', 0.006], ['rightHand', 'rightHandTip', 0.006],
  ['leftUpperLeg', 'leftLowerLeg', 0.1], ['rightUpperLeg', 'rightLowerLeg', 0.1], ['leftLowerLeg', 'leftFoot', 0.0465], ['rightLowerLeg', 'rightFoot', 0.0465],
  ['leftFoot', 'leftToes', 0.0145], ['rightFoot', 'rightToes', 0.0145]];

// Two-foot stance (user feedback 2026-11-05): both feet planted under the hips, about hip width, toes
// slightly out, knees straight but relaxed. A weight shift exists only as a slow sway with both feet down.
export const BALANCE = {
  stance: 'both',
  comTolM: 0.03,            // centre of mass (ground projection) within 3 cm of the segment between the two support points
  restComMidTolM: 0.03,     // at rest, within 3 cm of the midpoint between the feet
  maxRestPelvisTiltDeg: 3,  // the rest pelvis is level (no contrapposto drop)
  groundTolM: 0.006,        // a planted toe stays within 6 mm of the ground, never above (float) or below (sink)
  heelLiftM: 0.008,         // a planted heel (ankle) never rises more than 8 mm: no tiptoe
};

/** Legs: the knee is a hinge that points forward; no knee turned in. Anatomy inferred, not measured on a person. */
export const LEGS = {
  kneeInDeg: 12,            // the knee's flexion direction may turn toward the midline by at most this (ground plane, vs the pelvis forward)
  kneeMedialM: 0.015,       // and the knee may sit at most 1.5 cm medial of the hip-ankle line (frontal plane of the pelvis)
  restKneeFlexDeg: [1, 10], // rest knees straight but relaxed: not locked (0), not bent
  feetApartM: [0.14, 0.30], // rest support points apart, about hip width (hip joints 0.18 m apart)
  toeOutDeg: [2, 20],       // rest toes slightly out
};

/**
 * Humeral and femoral rotation (twist about the bone), measured by swing-twist decomposition against a
 * declared reference: the limb hanging straight down with the palm (arm) or the kneecap (leg) facing
 * forward. + is internal rotation. Ranges inferred from typical active ROM tables (AAOS-style): shoulder
 * internal ~70, external ~90; hip internal ~40, external ~45. The upperArm.x channel is NOT this twist:
 * under XYZ order it swings the arm (CHECK-r2 issue 8).
 */
export const TWIST = { UpperArm: [-90, 70], UpperLeg: [-45, 40] };

/**
 * Liveliness per region of the drawn figure (CHECK-r2 issue 11). In every window of the given length,
 * some point of the region moves at least minPx2x pixels at 2x. Thresholds are guesses, kept labelled as
 * such until checked against a viewed render.
 */
/**
 * Standing idle (user decision 3, 2026-11-05): one held frame plus events. heldFrame: outside every event
 * window the composed pose equals rest exactly (no always-on layer). idleEvents: something happens at least
 * every maxGapMs (body events; blinks come every 2-6 s on top); each event starts and ends at rest with at most
 * edgeDeg of change in its first and last 33 ms; the expected presented rate stays under maxPresentFps, from
 * presenting a frame only when a drawn joint moved >= presentPx (2x px) since the last presented frame, plus
 * 2 presents per blink and the idle clips at 30 fps. The 5 fps budget comes from the lead's CPU guide (about
 * 0.43 points of a core per presented fps against a 2-point margin).
 */
export const IDLE = { maxGapMs: 20000, edgeDeg: 0.3, maxPresentFps: 5, presentPx: 0.5, eventFps: 30, blinkPresents: 2 };

/** The app's frame (skin.json contract) and how a pose must sit in it. */
export const FRAME = { w: 139, h: 340, skinMarginM: 0.04, minRestFill: 0.88, maxRestFill: 1.0 };

export const BUDGET = {
  // Decoded image RAM of whatever ships, against v4's sheet: 1390 * 1700 * 4. More needs the lead's approval.
  ramCapBytes: 9_452_000,
  evalFps: [30, 60],
  spriteFrameBytes: FRAME.w * FRAME.h * 4,
  maxFaceCells: 96,
  atlasMaxFill: 0.85,
  runtimes: ['layered2d', 'vrm', 'sprite'],
};

/** Layered 2D rig: what a flat drawing can show. */
export const TWO_D = {
  maxScaleDev: 0.25,        // a limb drawing may be stretched or squashed along its bone by at most 25 % of its nominal length
  noViewYawTolDeg: 8,       // a part without turn views may turn out of the image plane by at most this
  headYawHalfStepDeg: 5,    // head views at most 10 deg apart in yaw: the nearest view is within 5 deg, parallax covers the rest
  headPitchHalfStepDeg: 10, // and at most 20 deg apart in pitch
  minPartLenShare: 0.9,     // a limb drawing is at least 90 % of its bone length at 2x the frame scale
  minPx: 0.25,              // 2D frozen-hold test inside clips: some part moves at least this many px (1x) in every window (standing idle uses IDLE)
};

/** Behaviour: rules the state machine must meet, and the scenarios that reproduce Pet.svelte's real call order. */
export const BEHAVIOUR = {
  // Each scenario is a list of [tMs, event, payload?]. Same-tick events model synchronous calls
  // (onSpriteUp -> resume -> nextNow -> advance -> showNext; loop() -> wake(); advance()).
  scenarios: {
    appStart: { events: [[0, 'appStart'], [1500, 'wordShownRevealed'], [1500, 'speakStart'], [2400, 'speakEnd']],
      expect: [['completes', 'wave'], ['startsAfter', 'talk', 'wave']] },
    clickNoBubble: { events: [[0, 'idle'], [1000, 'click'], [1000, 'wordShownRevealed']],
      expect: [['startsWithin', 'nod', 1000, 150], ['completes', 'nod'], ['plays', 'talk']] },
    clickWithBubble: { events: [[1000, 'click'], [2500, 'wordShownRevealed']],
      expect: [['startsWithin', 'nod', 1000, 150], ['plays', 'talk']] },
    userBack: { events: [[0, 'longIdle'], [9000, 'userBack'], [9000, 'wordShownRevealed']],
      expect: [['completes', 'sleep.exit'], ['completes', 'wave'], ['startsAfter', 'talk', 'wave']] },
    known: { events: [[0, 'wordShownRevealed'], [700, 'known'], [2200, 'wordShownRevealed']],
      expect: [['completes', 'happy'], ['startsAfter', 'talk', 'happy']] },
    guessReveal: { events: [[0, 'wordShownGuess'], [2600, 'reveal']],
      expect: [['completes', 'think.exit'], ['completes', 'nod']] },
    dragDuringTalk: { events: [[0, 'wordShownRevealed'], [0, 'speakStart'], [500, 'dragStart'], [3000, 'dragEnd']],
      expect: [['preempts', 'drag', 'talk'], ['completes', 'drag.exit']] },
    idleTickBusy: { events: [[0, 'wordShownRevealed'], [0, 'speakStart'], [300, 'idleTick'], [2500, 'speakEnd']],
      expect: [['never', 'look'], ['never', 'hairTuck'], ['never', 'breathe']] },
    quietHover: { events: [[0, 'quietHours'], [4000, 'hoverEnter']],
      expect: [['never', 'notice'], ['never', 'sleep.exit']] },
    hideShow: { events: [[0, 'appStart'], [800, 'fullscreenHide'], [400000, 'fullscreenShow']],
      expect: [['stopsAt', 800], ['completes', 'wave', 400000]] },
    // ---- run 2: one scenario per CHECK-r2 behaviour issue; each fails on the r1 scheduler (prove_issues.mjs)
    dragWhileAsleep: { issue: 1, events: [[0, 'longIdle'], [10000, 'dragStart'], [12000, 'dragEnd']],
      expect: [['completes', 'drag.exit'], ['playsAfter', 'sleep.loop', 'drag.exit']] },
    hideShowAsleep: { issue: 2, events: [[0, 'longIdle'], [5000, 'fullscreenHide'], [400000, 'fullscreenShow']],
      expect: [['stopsAt', 5000], ['neverAfter', 'wave', 400000], ['playsAfter', 'sleep.loop', 'sleep.enter']] },
    nextWhileAsleep: { issue: 3, events: [[0, 'longIdle'], [9000, 'nextNow'], [9000, 'wordShownRevealed'], [9000, 'speakStart', { token: 1 }], [10500, 'speakEnd', { token: 1 }]],
      expect: [['completes', 'sleep.exit'], ['plays', 'talk']] },
    quickDrag: { issue: 4, events: [[0, 'dragStart'], [300, 'dragEnd']],
      expect: [['exitBy', 'drag', 440], ['never', 'drag.loop']] },
    revealDuringThinkEnter: { issue: 4, events: [[0, 'wordShownGuess'], [400, 'reveal']],
      expect: [['exitBy', 'think', 1050], ['completes', 'nod']] },
    idleVariety: { issue: 5, events: [...Array(200).keys()].map((i) => [10000 * (i + 1), 'idleTick']),
      expect: [['picksAll', ['look', 'hairTuck', 'breathe']], ['noRepeat']] },
    speechlessTalk: { issue: 6, events: [[0, 'appStart'], [1500, 'wordShownRevealed'], [1500, 'speakStart', { token: 1 }], [2400, 'speakEnd', { token: 1 }]],
      expect: [['completes', 'wave'], ['plays', 'talk']], mouth: true },
    clickDuringTalk: { issue: 7, events: [[0, 'wordShownRevealed'], [0, 'speakStart', { token: 1 }], [300, 'click'], [4000, 'speakEnd', { token: 1 }]],
      expect: [['startsWithin', 'nod', 300, 150], ['playingAt', 'talk', 3000]] },
    clickDuringThink: { issue: 7, events: [[0, 'wordShownGuess'], [500, 'click'], [2600, 'reveal']],
      expect: [['startsWithin', 'nod', 500, 150], ['completes', 'think.exit']] },
    menuSuppressesFidgets: { issue: 9, events: [[0, 'menuOpen'], [7000, 'idleTick'], [9000, 'menuClose'], [20000, 'idleTick']],
      expect: [['noIdleIn', 0, 9000], ['idleIn', 9000, 60000]] },
    speechCancelRace: { issue: 10, events: [[0, 'wordShownRevealed'], [0, 'speakStart', { token: 1 }], [1000, 'speakStart', { token: 2 }], [1010, 'speakEnd', { token: 1 }], [3500, 'speakEnd', { token: 2 }]],
      expect: [['playingAt', 'talk.loop', 3000]], mouth: true },
  },
  queueNote: 'The queue expiry must cover the longest one-shot and every locked chain (wake exit + wave).',
};

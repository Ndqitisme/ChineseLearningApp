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

export const BALANCE = {
  standingFoot: 'rightFoot',
  comTolM: 0.03,            // centre of mass (ground projection) within 3 cm of the standing foot's support point
  minShoulderCounterTiltDeg: 2.0, maxShoulderCounterTiltDeg: 4.5,
  freeToeAboveGroundM: [-0.004, 0.02], // the free foot rests on its toe: not below the ground, at most 2 cm above
};

/** The app's frame (skin.json contract) and how a pose must sit in it. */
export const FRAME = { w: 139, h: 340, skinMarginM: 0.04, minRestFill: 0.88, maxRestFill: 1.0 };

export const BUDGET = {
  // Decoded image RAM of whatever ships, against the shipped sprite sheet: 1390 * 1700 * 4.
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
  minPx: 0.25,              // 2D frozen-hold test: some part moves at least this many px (1x) in every window
};

/** Behaviour: rules the state machine must meet, and the scenarios that reproduce Pet.svelte's real call order. */
export const BEHAVIOUR = {
  // Each scenario is a list of [tMs, event, payload?]. Same-tick events model synchronous calls
  // (onSpriteUp -> resume -> nextNow -> advance -> showNext; loop() -> wake(); advance()).
  scenarios: {
    appStart: { events: [[0, 'appStart'], [1500, 'wordShownRevealed'], [1500, 'speakStart'], [2400, 'speakEnd']],
      expect: [['completes', 'wave'], ['startsAfter', 'talk', 'wave']] },
    clickNoBubble: { events: [[0, 'idle'], [1000, 'click'], [1000, 'wordShownRevealed']],
      expect: [['completes', 'nod'], ['startsAfter', 'talk', 'nod']] },
    clickWithBubble: { events: [[1000, 'click'], [2500, 'wordShownRevealed']],
      expect: [['completes', 'nod'], ['plays', 'talk']] },
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
  },
  queueNote: 'The queue expiry must cover the longest one-shot and every locked chain (wake exit + wave).',
};

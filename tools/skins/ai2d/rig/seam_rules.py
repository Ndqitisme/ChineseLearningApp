"""Rules for seam_check.py that compare a frame with the drawing it was posed from.

The drawing a limb shows in a frame is known: the right arm and the legs are always the rest drawings (taken from
the rendered rest frame at 4x, where the leg parts are already composited), and the left arm is the key the
renderer reports (manifest arm.keys[arm.ti] -> rig.leftArm.keys[k].chain, a part of out/atlas.png). A frame point
on a limb is carried back into its drawing through its nearest posed bone: t along the bone, d across it, onto the
same bone of the drawing (drawing_point).

cut     straight step edges inside skin that the drawing does not have. Candidates: Hough segments on
        the luminance gradient inside the limb's opaque skin, where the two sides differ by >= STEP_L in L* the
        same way along the segment (a step, not a crease line). Each sample point is carried into the drawing:
          - the drawing has a step of the same sign there (>= half the frame's step): explained (painted shading);
          - the drawing's outline is there (one side outside it), and the side outside it, carried in through its
            own nearest bone, lands outside the drawing as well: explained (the limb in front of other skin: a
            hand over the face, the forearm over the other arm);
          - otherwise unexplained: a layer edge of the drawing lying over the drawing itself (a fold: the r4-hairTuck
            fixture elbow, the rigid-elbow seed), or a line the drawing never had (the painted cut seed).
        Score: the longest segment with more than half its samples unexplained, in 1x px.
bulge   the limb's width across its bone against the drawing's width at the same bone parameter, where the
        frame's limb is bounded by background on both sides: a knob at the elbow, a blob at the wrist.
jump    one-frame pose jumps of the posed left arm: a joint (elbow, wrist, hand tip) moving more than
        JUMP_K times its larger move on the frames either side, and at least JUMP_MIN 1x px.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
STEP_L = 2.5          # L* across a candidate step
JUMP_K, JUMP_MIN = 1.8, 4.0
LIMB_BONES = {"leftArm": ["leftUpperArm", "leftForearm", "leftHand"], "rightArm": ["rightUpperArm", "rightForearm", "rightHand"],
              "leftLeg": ["leftThigh", "leftShin", "leftShoe"], "rightLeg": ["rightThigh", "rightShin", "rightShoe"]}


def lab_L(rgb):
    return cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32) * (100 / 255)


def skin_of(img):
    lab = cv2.cvtColor(np.ascontiguousarray(img[..., :3]), cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lab[..., 0] * 100 / 255
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    C, h = np.hypot(a, b), np.degrees(np.arctan2(b, a))
    return (C >= 6) & (h > 20) & (h < 95) & (L > 35)


class Tex:
    """A drawing as a texture: L (blurred), alpha, its bones [(A, B) x3] in texture px, and px per 1x px."""
    def __init__(self, rgba, bones, s):
        self.L = cv2.GaussianBlur(lab_L(rgba[..., :3]), (0, 0), 0.5 * s / 2)
        self.a = rgba[..., 3].astype(np.float32)
        self.bones = [(np.array(A, float), np.array(B, float)) for A, B in bones]
        self.s = s

    def at(self, img, q):
        x, y = int(round(q[0])), int(round(q[1]))
        if 0 <= y < img.shape[0] and 0 <= x < img.shape[1]:
            return float(img[y, x])
        return None


class Ref:
    """Drawings of every limb: rest ones from the rest frame (4x), left-arm keys from the atlas (2x)."""
    def __init__(self, rest4x, rest_bones4x, rig_path=HERE / "out" / "rig.json", atlas_path=HERE / "out" / "atlas.png"):
        self.rig = json.loads(Path(rig_path).read_text(encoding="utf8"))
        self.atlas = np.array(Image.open(atlas_path).convert("RGBA"))
        self.rest = {limb: Tex(rest4x, [rest_bones4x[b] for b in names], 4.0) for limb, names in LIMB_BONES.items()}
        self.cache = {}

    def drawing(self, limb, arm):
        if limb != "leftArm" or not arm:
            return self.rest[limb]
        key = arm["keys"][arm["ti"]]
        chain = self.rig["leftArm"]["keys"][key]["chain"]
        if chain == "leftArm.rest":
            return self.rest[limb]
        if chain not in self.cache:
            p = self.rig["parts"][chain]
            x, y, w, h = p["rect"]
            ox, oy = p["pos"]
            B = p["bones"]
            tp = lambda q: [(q[0] - ox) * 2, (q[1] - oy) * 2]
            self.cache[chain] = Tex(self.atlas[y:y + h, x:x + w], [(tp(B["S"]), tp(B["E"])), (tp(B["E"]), tp(B["W"])), (tp(B["W"]), tp(B["T"]))], 2.0)
        return self.cache[chain]


def nearest_bone(p, posed):
    best = None
    for k, (A, B) in enumerate(posed):
        ab = B - A
        L2 = float(ab @ ab) or 1.0
        t = float(np.clip((p - A) @ ab / L2, 0, 1))
        d = float(np.hypot(*(p - A - t * ab)))
        if best is None or d < best[0]:
            best = (d, k, t)
    return best[1], best[2]


def drawing_point(p, k, t, posed, tex):
    """Frame point p (1x px) on posed bone k at parameter t -> the drawing's texture px; also the bone turn."""
    A, B = posed[k]
    ab = B - A
    Lp = float(np.hypot(*ab)) or 1.0
    u = ab / Lp
    n = np.array([-u[1], u[0]])
    d = float((p - A - t * ab) @ n)
    tA, tB = tex.bones[k]
    tab = tB - tA
    Lt = float(np.hypot(*tab)) or 1.0
    tu = tab / Lt
    tn = np.array([-tu[1], tu[0]])
    q = tA + t * tab + d * tex.s * tn
    rot = np.arctan2(tu[1], tu[0]) - np.arctan2(u[1], u[0])
    return q, rot


def rotate(v, a):
    c, s = np.cos(a), np.sin(a)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1]])


def explained(p, nrm, step, side, posed, tex, line=False):
    """Is the frame step at p (1x px, across nrm, sign of step) in the drawing? See the module docstring."""
    k, t = nearest_bone(p, posed)
    q, rot = drawing_point(p, k, t, posed, tex)
    tn = rotate(nrm, rot)
    sd = side * tex.s
    best = 0.0
    outline = False
    for o in np.linspace(-1.5, 1.5, 7) * tex.s:
        c = q + tn * o
        ap, am = tex.at(tex.a, c + tn * sd), tex.at(tex.a, c - tn * sd)
        if ap is None or am is None:
            outline = True
            continue
        if min(ap, am) < 200:
            outline = True
            continue
        if line:   # a line: the centre against the mean of both sides
            s = tex.at(tex.L, c) - 0.5 * (tex.at(tex.L, c + tn * sd) + tex.at(tex.L, c - tn * sd))
        else:
            s = tex.at(tex.L, c + tn * sd) - tex.at(tex.L, c - tn * sd)
        if np.sign(s) == np.sign(step):
            best = max(best, abs(s))
    if best >= 0.5 * abs(step):
        return True
    if outline:
        # the side that falls outside the drawing, carried in through each bone: if any bone puts it inside the
        # drawing, the drawing lies over itself there (a fold: in a tight fold the forearm and the upper arm are both
        # near either bone, so the nearest bone alone would carry the hidden layer outside)
        for sg in (1, -1):
            qa = tex.at(tex.a, q + tn * sd * sg)
            if qa is None or qa >= 128:
                continue
            ps = p + nrm * side * 2 * sg
            inside = False
            for k2, (A, B) in enumerate(posed):
                ab = B - A
                t2 = float(np.clip((ps - A) @ ab / (float(ab @ ab) or 1.0), 0.02, 0.98))
                q2, _ = drawing_point(ps, k2, t2, posed, tex)
                a2 = tex.at(tex.a, q2)
                if a2 is not None and a2 >= 200 and k2 != k:
                    inside = True
            if not inside:
                return True
    return False


def cut_unexplained(img, bones, limb, tex, f, P):
    """img: frame at scale (f = 0.25 for 1x, 0.5 for 2x of the 4x render); bones 4x px. Returns (score 1x px, at)."""
    alpha = img[..., 3]
    sc = 4 * f                                  # frame px per 1x px
    posed = [(np.array(bones[b][0], float) / 4, np.array(bones[b][1], float) / 4) for b in LIMB_BONES[limb] if b in bones]
    if len(posed) < 3:
        return 0.0, None
    L = cv2.GaussianBlur(lab_L(img[..., :3]), (0, 0), 0.6)
    e = max(1, int(round(0.75 * sc)))
    inner = cv2.erode(((alpha == 255) & skin_of(img)).astype(np.uint8), np.ones((2 * e + 1, 2 * e + 1), np.uint8)).astype(bool)
    gx = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3) / 8
    G = np.hypot(gx, gy)
    names = LIMB_BONES[limb]
    strip = np.zeros(alpha.shape, np.uint8)
    for k, (A, B) in enumerate(posed):
        a, b = A * sc, B * sc
        if names[k].endswith("Thigh"):     # the skirt hem crosses the thigh top
            u = (b - a) / max(1e-6, np.hypot(*(b - a))); a = a + u * min(26 * sc, 0.9 * np.hypot(*(b - a)))
        if names[k].endswith("Hand"):      # the wrist only: the gaps between fingers are drawn edges
            b = a + 0.3 * (b - a)
        if names[k].endswith("Shoe"):
            continue
        if names[k].endswith("UpperArm"):  # the sleeve hem crosses the upper arm
            a = a + P["upperFrom"] * (b - a)
        cv2.line(strip, tuple(int(round(v)) for v in a), tuple(int(round(v)) for v in b), 1, max(1, int(round(P["half"] * 2 * sc))))
    E = (strip > 0) & inner & (G >= P["g"])
    if E.sum() < 3:
        return 0.0, None
    minlen = max(3, int(round(P["minlen"] * sc)))
    segs = cv2.HoughLinesP(E.astype(np.uint8) * 255, 1, np.pi / 90, threshold=max(3, minlen // 2), minLineLength=minlen, maxLineGap=1)
    if segs is None:
        return 0.0, None
    side = P["side"]
    worst, at = 0.0, None
    for x1, y1, x2, y2 in segs.reshape(-1, 4):
        ln = float(np.hypot(x2 - x1, y2 - y1))
        if ln / sc <= worst:
            continue
        tdir = np.array([x2 - x1, y2 - y1]) / ln
        nrm = np.array([-tdir[1], tdir[0]])
        steps, lines, pts = [], [], []
        for s in np.linspace(0.2, 0.8, 5):
            c = np.array([x1, y1], float) + tdir * ln * s
            pp, pm = c + nrm * side * sc, c - nrm * side * sc
            ip, im = [int(round(v)) for v in pp], [int(round(v)) for v in pm]
            if not (0 <= ip[1] < L.shape[0] and 0 <= ip[0] < L.shape[1] and 0 <= im[1] < L.shape[0] and 0 <= im[0] < L.shape[1]):
                continue
            if not (inner[ip[1], ip[0]] and inner[im[1], im[0]]):
                continue
            ic = [int(round(v)) for v in c]
            steps.append(L[ip[1], ip[0]] - L[im[1], im[0]]); lines.append(L[ic[1], ic[0]] - 0.5 * (L[ip[1], ip[0]] + L[im[1], im[0]])); pts.append(c / sc)
        if len(steps) < 3:
            continue
        # a step (one side lighter all along) or a line (the centre darker or lighter than both sides all along)
        st, li = np.array(steps), np.array(lines)
        is_line = np.median(np.abs(li)) > np.median(np.abs(st))
        st = li if is_line else st
        sg = np.sign(np.median(st))
        if (np.sign(st) == sg).sum() < len(st) - 1 or np.median(np.abs(st)) < STEP_L:
            continue
        bad = sum(not explained(pt, nrm, s, side, posed, tex, is_line) for pt, s in zip(pts, st) if abs(s) >= STEP_L)
        if bad > len(pts) / 2:
            worst, at = ln / sc, [int(x1), int(y1), int(x2), int(y2), round(float(np.median(np.abs(st))), 1)]
    return worst, at


CUT_P = {"1x": dict(g=1.0, minlen=3.0, side=0.75, half=4.0, upperFrom=0.6), "2x": dict(g=0.8, minlen=3.0, side=0.75, half=4.0, upperFrom=0.6)}


def run_width(alpha, c, n, R):
    """Opaque run through c across n (frame px): (left, right) extents, or None if it is not bounded by background
    on both sides within R."""
    H, W = alpha.shape
    def walk(sg):
        for r in np.arange(0, R + 0.01, 0.5):
            q = c + n * r * sg
            x, y = int(round(q[0])), int(round(q[1]))
            if not (0 <= y < H and 0 <= x < W) or alpha[y, x] < 128:
                return r
        return None
    a, b = walk(1), walk(-1)
    return None if a is None or b is None else a + b


def bulge(img, bones, limb, tex, f):
    """Largest frame width / drawing width over the upper arm and forearm (20-80 % of each), where both are bounded
    by background (a limb in front of the body is skipped)."""
    alpha = img[..., 3]
    sc = 4 * f
    names = LIMB_BONES[limb][:2]
    worst, at = 0.0, None
    for k, nm in enumerate(names):
        if nm not in bones:
            continue
        A, B = np.array(bones[nm][0], float) / 4, np.array(bones[nm][1], float) / 4
        ab = B - A
        Lp = float(np.hypot(*ab))
        if Lp < 6:
            continue
        u = ab / Lp; n = np.array([-u[1], u[0]])
        tA, tB = tex.bones[k]
        tab = tB - tA; Lt = float(np.hypot(*tab)) or 1.0
        tu = tab / Lt; tn = np.array([-tu[1], tu[0]])
        for t in np.linspace(0.2, 0.8, 7):
            wf = run_width(alpha, (A + t * ab) * sc, n, 16 * sc)
            wt = run_width(tex.a, tA + t * tab, tn, 16 * tex.s)
            if wf is None or wt is None or wt < 2 * tex.s:
                continue
            r = (wf / sc) / (wt / tex.s)
            if r > worst:
                worst, at = r, [nm, round(float(t), 2), round(wf / sc, 1), round(wt / tex.s, 1)]
    return worst, at


def jumps(joint_rows):
    """joint_rows: per frame {bone: [[x0,y0],[x1,y1]]} (4x px). Returns {frame: (step, neighbour)} for the left arm's
    elbow, wrist and hand tip moving in one frame more than JUMP_K times the larger move beside it."""
    pts = []
    for J in joint_rows:
        pts.append(np.array([J["leftUpperArm"][1], J["leftForearm"][1], J["leftHand"][1]], float) / 4 if "leftHand" in J else None)
    step = [0.0] + [float(np.abs(pts[i] - pts[i - 1]).max()) if pts[i] is not None and pts[i - 1] is not None else 0.0 for i in range(1, len(pts))]
    out = {}
    for k in range(1, len(step)):
        nb = max(step[k - 1] if k > 1 else 0.0, step[k + 1] if k + 1 < len(step) else 0.0)
        if step[k] >= JUMP_MIN and step[k] > JUMP_K * nb:
            out[k] = (round(step[k], 1), round(nb, 1))
    return out, step


# ---------------------------------------------------------------- cross-limb line
LINE_BONES = {"leftArm": [(0, 0.65, 0.95), (1, 0.08, 0.92)], "rightArm": [(0, 0.65, 0.95), (1, 0.08, 0.92)],
              "leftLeg": [(1, 0.08, 0.9)], "rightLeg": [(1, 0.08, 0.9)]}
LINE_OFFS = (-0.3, 0.0, 0.3)    # across the bone, in units of the half width (LINE_HALF 1x px)
LINE_HALF = 4.0


def _bilinear(img, x, y):
    H, W = img.shape
    x0, y0 = int(np.floor(x)), int(np.floor(y))
    if x0 < 0 or y0 < 0 or x0 + 1 >= W or y0 + 1 >= H:
        return None
    fx, fy = x - x0, y - y0
    return float((img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx) * (1 - fy) + (img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx) * fy)


def cross_line(img, bones, limb, tex, f, cache):
    """A thin line across a limb that its drawing does not have (the painted cut, a seam drawn across the forearm).
    Along each bone's axis, L* is sampled in the frame and at the same bone point of the drawing (drawing_point),
    on three lines across the bone (LINE_OFFS). The residual frame - drawing is high-passed with a median filter
    over MED 1x px along the bone: a step (another part in front, a shading change) survives a median, a line
    narrower than half the window does not. Score: the largest |high-pass| that all three lines share with one
    sign at the same bone parameter, in L*; only where frame and drawing are opaque skin."""
    sc = 4 * f
    names = LIMB_BONES[limb]
    if any(n not in bones for n in names):
        return 0.0, None
    posed = [(np.array(bones[n][0], float) / 4, np.array(bones[n][1], float) / 4) for n in names]
    key = ("L", id(img))
    if key not in cache:
        cache.clear()
        cache[key] = (cv2.GaussianBlur(lab_L(img[..., :3]), (0, 0), 0.5), (img[..., 3] >= 250) & skin_of(img))
    Lf, okf = cache[key]
    kl = ("tex", id(tex), sc)
    if kl not in cache:
        k = max(1, int(round(tex.s / sc)))
        cache[kl] = cv2.blur(tex.L, (k, k)) if k > 1 else tex.L
    Lt = cache[kl]
    worst, at = 0.0, None
    MED = 5
    for b, t0, t1 in LINE_BONES[limb]:
        A, B = posed[b]
        ab = B - A
        Lp = float(np.hypot(*ab))
        if Lp < 8:
            continue
        u = ab / Lp; n = np.array([-u[1], u[0]])
        ts = np.arange(t0 * Lp, t1 * Lp, 0.25 / max(1.0, sc / 2))
        if len(ts) < 4 * MED:
            continue
        R = np.full((len(LINE_OFFS), len(ts)), np.nan)
        for oi, o in enumerate(LINE_OFFS):
            for ti, tt in enumerate(ts):
                p = A + u * tt + n * o * LINE_HALF
                x, y = p * sc
                xi, yi = int(round(x)), int(round(y))
                if not (0 <= yi < okf.shape[0] and 0 <= xi < okf.shape[1]) or not okf[yi, xi]:
                    continue
                q, _ = drawing_point(p, b, tt / Lp, posed, tex)
                qi = [int(round(v)) for v in q]
                if not (0 <= qi[1] < tex.a.shape[0] and 0 <= qi[0] < tex.a.shape[1]) or tex.a[qi[1], qi[0]] < 250:
                    continue
                lf, lt = _bilinear(Lf, x, y), _bilinear(Lt, q[0], q[1])
                if lf is not None and lt is not None:
                    R[oi, ti] = lf - lt
        w = max(3, int(round(MED * sc / 0.25 / max(1.0, sc / 2) / sc)))   # MED 1x px in samples
        w += 1 - w % 2
        H = np.full_like(R, np.nan)
        for oi in range(R.shape[0]):
            r = R[oi]
            for ti in range(len(r)):
                if np.isnan(r[ti]):
                    continue
                win = r[max(0, ti - w // 2): ti + w // 2 + 1]
                win = win[~np.isnan(win)]
                if len(win) >= w * 0.7:
                    H[oi, ti] = r[ti] - np.median(win)
        good = ~np.isnan(H).any(0)
        if not good.any():
            continue
        Hg = H[:, good]
        same = (np.sign(Hg) == np.sign(Hg[1])).all(0)
        s = np.where(same, np.abs(Hg).min(0), 0.0)
        j = int(np.argmax(s))
        if s[j] > worst:
            worst, at = float(s[j]), [names[b], round(float(ts[good][j] / Lp), 2)]
    return worst, at


# ---------------------------------------------------------------- straight cut outline
OUTLINE_EPS = 0.8      # tex px: polygon fit of the alpha >= 128 outline
OUTLINE_TURN = 50.0    # deg: a corner at both ends of a straight run marks a cut, not a drawn contour
OUTLINE_SHOULDER = 0.45  # share of the upper arm from the shoulder: the sleeve cap is cut by design (under the torso)


def straight_outline(rgba, bones):
    """An arm drawing (texture px) cut out with straight edges: the longest straight run of its outline (polygon fit
    within OUTLINE_EPS) that has a corner of OUTLINE_TURN or more at both ends, away from the shoulder. Drawn arms
    bend smoothly into their straight stretches; a scissor cut (the hipfront fixture's waist slab) meets the drawn
    contour at corners. bones: {'S','E','W','T'} in texture px. Returns (length px, [x0, y0, x1, y1])."""
    m = (rgba[..., 3] >= 128).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return 0.0, None
    c = max(cs, key=cv2.contourArea)
    poly = cv2.approxPolyDP(c, OUTLINE_EPS, True).reshape(-1, 2).astype(float)
    n = len(poly)
    S, E = np.array(bones["S"], float), np.array(bones["E"], float)
    near_sh = lambda p: np.hypot(*(p - S)) < max(OUTLINE_SHOULDER * np.hypot(*(E - S)), 12) or p[1] < S[1] - 2
    def turn(i):
        a, b, d = poly[i - 1], poly[i], poly[(i + 1) % n]
        v1, v2 = b - a, d - b
        ang = np.degrees(np.arctan2(v1[0] * v2[1] - v1[1] * v2[0], v1 @ v2))
        return abs(ang)
    worst, at = 0.0, None
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = float(np.hypot(*(b - a)))
        if L <= worst or near_sh(a) or near_sh(b) or near_sh((a + b) / 2):
            continue
        if turn(i) >= OUTLINE_TURN and turn((i + 1) % n) >= OUTLINE_TURN:
            worst, at = L, [int(a[0]), int(a[1]), int(b[0]), int(b[1])]
    return worst, at

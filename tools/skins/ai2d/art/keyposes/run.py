"""Key-pose art: continuous limb textures for the rig's key poses, rebuilt from stored PNGs.

Inputs (no Codex call happens here; gen/codex_gen2.sh made them, logged in ../generations.log):
  src/wave_ul.png, wave_ur.png, drag.png, land.png        key-pose keys (Codex edits of ../src/master.png,
                                                         each made with a 3D pose guide from guide/run_guide.py)
  src/head_yawm12.png, head_yawp12.png, head_pitchm15.png head views of ../gen/face_hd_in.png, glasses kept
  ../src/wave.png, think.png, tuck.png, talk.png, happy.png  art keys whose whole arm passes the same gates
  joints.json   joint sites per key, read by eye off grid.py zooms (+-5 px), in each source's own pixels
  ../out/metrics.json   the art lever's grade parameters and face->master affine (run ../run.py first)
Outputs: out/parts/*.png (2x app scale), out/parts.json, out/gates.json, out/limbs_4x_*.png (every part),
  out/context_{1x,2x}_*.png (every key and head view assembled with the art rest parts, over light and dark),
  out/context_4x_*.png (the same over magenta, cyan = what the consistency checker's see-through/hole tests flag).
  head_yawp12.png is the second Codex call for that view (the first, gen/head_yawp12_try1/, grew the eyes and
  dropped the fringe onto the brows: harness eye width +0.072, fringe 0.084).
Usage: <tools/skins/ai2d/.venv python> run.py
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
ART = HERE.parent
OUT, PARTS, SRC, WORK = HERE / "out", HERE / "out" / "parts", HERE / "src", HERE / "work"
_spec = importlib.util.spec_from_file_location("art_run", ART / "run.py")
A = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(A)      # the art lever as a library (its main() does not run)
B = A.B
premul, unpremul, dilate, erode, save, over, lab = B.premul, B.unpremul, B.dilate, B.erode, B.save, B.over, B.lab
cv2.setNumThreads(1)
_cspec = importlib.util.spec_from_file_location("consistency", ART.parent / "consistency" / "consistency.py")
CONS = importlib.util.module_from_spec(_cspec)
_cspec.loader.exec_module(CONS)  # the frozen consistency checker, imported read-only for its frame tests

JOINTS = json.loads((HERE / "joints.json").read_text())
ARTJ = json.loads((ART / "gen" / "joints.json").read_text())
META = json.loads((ART / "out" / "metrics.json").read_text())
PARTS_ART = json.loads((ART / "out" / "parts.json").read_text())
AMAP = PARTS_ART["masterToApp1x"]
EXPORT = PARTS_ART["exportScale"]
GRADE = {k: tuple(v) for k, v in META["face"]["grade"]["params_kL_rotdeg_kC"].items()}
CUT_Y = META["hybrid"]["cut_y"]
A_FACE = np.array(META["hybrid"]["A_face_to_master"], float)
S_REST = ARTJ["rest"]["leftArm"]["S"]

# key -> source and which limbs it gives. reg: which body region the key is registered on (it must be the
# part the edit left alone): legs for an arm edit, head and shirt centre for an arms-and-legs edit.
KEYS = {
    "rest": {"src": ART / "src" / "master.png", "limbs": ["leftArm", "rightArm"], "reg": None},
    "wave_ul": {"src": SRC / "wave_ul.png", "limbs": ["leftArm"], "reg": "legs"},
    "wave_up": {"src": ART / "src" / "wave.png", "limbs": ["leftArm"], "reg": "legs"},
    "wave_ur": {"src": SRC / "wave_ur.png", "limbs": ["leftArm"], "reg": "legs"},
    "think": {"src": ART / "src" / "think.png", "limbs": ["leftArm"], "reg": "legs"},
    "tuck": {"src": ART / "src" / "tuck.png", "limbs": ["leftArm"], "reg": "legs"},
    "talk": {"src": ART / "src" / "talk.png", "limbs": ["leftArm"], "reg": "legs"},
    "happy": {"src": ART / "src" / "happy.png", "limbs": ["leftArm"], "reg": "legs"},
    "drag": {"src": SRC / "drag.png", "limbs": ["leftArm", "rightArm", "leftLeg", "rightLeg"], "reg": "core"},
    "land": {"src": SRC / "land.png", "limbs": ["leftArm", "leftLeg", "rightLeg"], "reg": "core"},
}
# draw order on the art parts' z scale: left arm over torso 9, legs under pelvis 8. A hand at the chin or in
# the hair is in front of the face but behind frontHair 17; the only layers between 13.5 and 16.5 are the
# old arm bones this piece replaces and the head (16), so the whole arm goes to 16.5 for those keys
Z_LIMB = {"_": {"leftArm": 13.5, "rightArm": 10.5, "leftLeg": 5.5, "rightLeg": 2.5},
          "think": {"leftArm": 16.5}, "tuck": {"leftArm": 16.5}}
# land's left hand reaches 0.3 px past the frame's right edge at 1x as drawn: the arm is turned in
ARM_ROT_DEG = {"land": {"leftArm": 4.0}}
ARM_R = {"upper": 60, "fore": 46, "hand": 62}
LEG_R = {"thigh": 80, "shin": 62, "foot": 75}
# face-mesh eye contours (MediaPipe indices)
EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
VIEWS = {"yawm12": {"src": "head_yawm12.png", "yaw": -12, "pitch": 0},
         "yawp12": {"src": "head_yawp12.png", "yaw": 12, "pitch": 0},
         "pitchm15": {"src": "head_pitchm15.png", "yaw": 0, "pitch": -15}}


def load(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert("RGB"))


def grade_body(k: np.ndarray) -> np.ndarray:
    return B.apply_grade(k, B.body_weights(k, CUT_Y + 120), {"skin": GRADE["skin"], "hair": GRADE["hair"]})


def register(key_rgb: np.ndarray, master_rgb: np.ndarray, region: str):
    """Key -> master affine by ECC on a region the edit left alone. Returns W (master -> key) and cc."""
    g = lambda a: cv2.GaussianBlur(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, (0, 0), 1.0)
    m, k = g(master_rgb), g(key_rgb)
    mask = np.zeros(m.shape, np.uint8)
    if region == "legs":
        mask[620:, :] = 1
    else:                       # head and shirt centre; the arms hang outside x 400..620 in every key
        mask[20:600, 400:620] = 1
    W = np.eye(2, 3, dtype=np.float32)
    cc, W = cv2.findTransformECC(m, k, W, cv2.MOTION_AFFINE,
                                 (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7), mask, 5)
    return W, float(cc)


def key_pt(W, p):
    Mx = np.vstack([W, [0, 0, 1]])
    q = np.linalg.solve(Mx, [p[0], p[1], 1.0])
    return [float(q[0]), float(q[1])]


def seg_dist(X, Y, p, q):
    return A.seg_dist(X, Y, p, q)


def limb_segments(limb: str, J: dict) -> dict:
    if limb.endswith("Arm"):
        S, E, W, T = (np.array(J[k], float) for k in "SEWT")
        return {"upper": (S, E, ARM_R["upper"]), "fore": (E, W, ARM_R["fore"]),
                "hand": (W, T + 0.25 * (T - W), ARM_R["hand"])}
    H, K, Aa, T = (np.array(J[k], float) for k in ("H", "K", "A", "T"))
    return {"thigh": (H, K, LEG_R["thigh"]), "shin": (K, Aa, LEG_R["shin"]), "foot": (Aa, T + 0.15 * (T - Aa), LEG_R["foot"])}


def capsules(shape, segs: dict) -> np.ndarray:
    Y, X = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    m = np.zeros(shape, bool)
    for p, q, r in segs.values():
        m |= seg_dist(X, Y, p, q) < r
    return m


RIGHT_SEAM = np.array([(366, 297), (374, 330), (379, 360), (382, 400), (385, 440), (388, 470)], float)
# rows above the armpit, where every key's sleeve cap covers the armhole: the torso runs on this far under
# the sleeve (master px; 14 = 6 px at 2x), so two soft edges never meet there
ARMHOLE = {"left": {"y_max": 455, "taper_from": 410, "reach": 14}, "right": {"y_max": 440, "reach": 14}}


def body_line(master: np.ndarray, side: str) -> np.ndarray:
    """Per row, the x of the torso's outer edge on one side of the MASTER. Below the armpit the master shows
    a green gap between torso and arm, so a scan out from the shirt centre stops at the torso edge; rows where
    it ran on into the arm (out of the plausible torso range) are interpolated, and above the armpit the
    line runs straight up to the shoulder top."""
    a = master[..., 3] > 127
    S = np.array(ARTJ["rest"]["leftArm" if side == "left" else "rightArm"]["S"], float)
    lo, hi = (575, 700) if side == "left" else (380, 450)
    xs = np.full(master.shape[0], np.nan)
    for y in range(int(S[1]) + 40, 640):
        row = a[y]
        x = 512
        step = 1 if side == "left" else -1
        while 20 < x < 1000 and row[x]:
            x += step
        if lo <= x <= hi:
            xs[y] = x
    ok = np.nonzero(~np.isnan(xs))[0]
    top = ok.min()
    rows = np.arange(master.shape[0])
    line = np.interp(rows, ok, ndi.median_filter(xs[ok], 9))
    # above the first gap row: straight up along the sleeve's shoulder seam, read off the master at 2.5x
    # (seam top at (625, 300) for S = (652, 355), armpit at (618, 410))
    tip = np.array([S[0] - 27 * (1 if side == "left" else -1), S[1] - 55])
    t = np.clip((rows - tip[1]) / max(top - tip[1], 1), 0, 1)
    line = np.where(rows < top, tip[0] + (line[top] - tip[0]) * t, line)
    if side == "right":
        # the right arm touches the flank below the armpit, so the scan has no gap rows up there; the sleeve's
        # inner seam is read off the master at 3.5x instead
        sy, sx = RIGHT_SEAM[:, 1], RIGHT_SEAM[:, 0]
        line = np.where(rows <= sy[-1], np.interp(rows, sy, sx), line)
    return line


def diff_mask(a: np.ndarray, b: np.ndarray, thr=11.0) -> np.ndarray:
    """Pixels where two registered RGBA images differ: CIE76 on 1.2 px blurred colour, or alpha disagreement."""
    blur = lambda x: cv2.GaussianBlur(x[..., :3], (0, 0), 1.2)
    d = np.linalg.norm(lab(blur(a)) - lab(blur(b)), axis=-1)
    return (d > thr) | ((a[..., 3] > 127) != (b[..., 3] > 127))


def shirt_white(img: np.ndarray) -> np.ndarray:
    Lb = lab(img[..., :3])
    return (img[..., 3] > 0) & (np.hypot(Lb[..., 1], Lb[..., 2]) < 6) & (Lb[..., 0] > 55)


def codex_mask(p: Path, master_raw: np.ndarray, region: str) -> np.ndarray:
    """Magenta silhouette from a Codex recolour of a key, registered to the master like the key itself."""
    raw = load(p)
    W, _ = register(raw, master_raw, region)
    f = raw.astype(np.float32)
    mag = ((f[..., 0] - f[..., 1] > 90) & (f[..., 2] - f[..., 1] > 90))            # magenta
    mag |= (f[..., 2] - f[..., 1] > 90) & (f[..., 2] - f[..., 0] > 90)            # or blue (second recipe)
    mag = mag.astype(np.float32)
    mm = cv2.warpAffine(mag, W, (master_raw.shape[1], master_raw.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP) > 0.5
    return ndi.binary_fill_holes(ndi.binary_opening(mm, np.ones((3, 3))))


def drop_islands(img: np.ndarray, max_px=300) -> np.ndarray:
    """A limb is one piece: opaque islands under max_px (a shirt corner, a hem speck) that hang on only by
    soft edge pixels go, with their soft fringe."""
    a = img[..., 3]
    lab_, n = ndi.label(a > 127)
    if n < 2:
        return img
    sz = ndi.sum(np.ones_like(lab_), lab_, range(1, n + 1))
    small = np.isin(lab_, 1 + np.nonzero(sz < max_px)[0])
    kill = small | (dilate(small, 2) & (a <= 127))
    out = img.copy()
    out[kill] = 0
    return out


def drop_white_specks(img: np.ndarray, max_px=400) -> np.ndarray:
    """Small detached white pieces (a collar point under a raised chin) go; detached hair strands stay."""
    lab_, n = ndi.label(img[..., 3] > 0)
    if n < 2:
        return img
    Lb = lab(img[..., :3])
    white = (np.hypot(Lb[..., 1], Lb[..., 2]) < 8) & (Lb[..., 0] > 70)
    out = img.copy()
    for k in range(1, n + 1):
        m = lab_ == k
        if m.sum() < max_px and white[m].mean() > 0.5:
            out[m] = 0
    return out


def keep_main(m: np.ndarray, anchor) -> np.ndarray:
    m = ndi.binary_closing(m, np.ones((5, 5)), iterations=1)
    m = ndi.binary_opening(m, np.ones((3, 3)), iterations=1)
    lab_, n = ndi.label(m)
    if n > 1:      # keep the piece that holds the anchor joint; specks elsewhere are dropped
        y, x = int(round(anchor[1])), int(round(anchor[0]))
        win = lab_[max(0, y - 6):y + 7, max(0, x - 6):x + 7]
        ks = win[win > 0]
        k = np.bincount(ks).argmax() if len(ks) else np.argmax(ndi.sum(m, lab_, range(1, n + 1))) + 1
        m = lab_ == k
    return ndi.binary_fill_holes(m)


def rest_arm_mask(master: np.ndarray, limb: str, lines, foil=None) -> np.ndarray:
    """The master's own arm: the sleeve (everything of the figure in the shoulder part of the upper capsule
    outside the torso line) plus, inside the rest capsules, what differs from `foil` (a key whose arm is away,
    so the waist and skirt under the hand are the same in both), or, with no foil, skin-like pixels."""
    J = ARTJ["rest"][limb]
    return arm_mask(master, J, limb, lines, changed=None if foil is None else diff_mask(master, foil))


def arm_mask(img, J, limb, lines, changed) -> np.ndarray:
    sh = img.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    segs = limb_segments(limb, J)
    fg = img[..., 3] > 0
    C = B.classes(img)
    Lb = lab(img[..., :3])
    Cr = np.hypot(Lb[..., 1], Lb[..., 2])
    hue = np.degrees(np.arctan2(Lb[..., 2], Lb[..., 1]))
    side = "left" if limb.startswith("left") else "right"
    bl = lines[side][np.clip(Y.astype(int), 0, sh[0] - 1)]
    # 4 px clear of the line: the master's sleeve seam runs along it and would ride on the arm as a dark
    # dashed edge (out/context_2x.png); the torso fill reaches 6 px past the line, under the sleeve
    outside = (X > bl + 4) if side == "left" else (X < bl - 4)
    S, E = segs["upper"][0], segs["upper"][1]
    # the sleeve: the shoulder 60 % of the upper capsule (its far end is past the cuff on every key)
    Sx = S + 0.6 * (E - S)
    sleeve = fg & (seg_dist(X, Y, S, Sx) < ARM_R["upper"] + 6) & outside & (Y > S[1] - 80)
    if E[1] < S[1] - 20:
        # a raised arm: the capsule's round end below the shoulder holds the flank of the shirt, which rode on
        # the arm as a light strip (out/context_2x zoom, wave keys); only what lies along the arm stays
        t = ((X - S[0]) * (E[0] - S[0]) + (Y - S[1]) * (E[1] - S[1])) / float(np.dot(E - S, E - S))
        sleeve &= t > -0.1
    cap = capsules(sh, segs)
    # skin down to its shadows (fist creases and the far side of the forearm fall below the class's L 40)
    skinlike = fg & (Cr >= 5) & (Lb[..., 0] >= 22) & (hue > 25) & (hue < 100) & ~C["plaid"]
    body = cap & fg & ~shirt_white(img) & ~C["plaid"] & (skinlike | ~C["hair"])
    if changed is None:          # the master's own arm: on the arm side of the torso line, or skin-like
        # (skin chroma 9+: a grey shirt shadow passes the hue test, and a chip of the flank rode on the right
        # arm beside the cuff)
        body &= outside | (skinlike & (Cr >= 9))
        body &= ~(C["hair"] & ~skinlike)
    else:                        # a key: only what differs from the master (the rest of the figure is locked)
        body &= changed
    return keep_main(body | sleeve, segs["fore"][1])


def cut_limb(img, foil, J, limb, lines, rest_masks=None) -> np.ndarray:
    """One continuous limb (sleeve to fingertips, or thigh to toe) out of a registered key `img`.
    foil: the master (what a key's locked figure looks like); rest_masks: the master's own limb masks, which a
    key's limb may overlap without differing from the master."""
    sh = img.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    segs = limb_segments(limb, J)
    fg = img[..., 3] > 0
    if limb.endswith("Arm"):
        if foil is None:
            m = rest_arm_mask(img, limb, lines)
        else:
            changed = diff_mask(img, foil) | dilate(rest_masks[limb], 2)
            m = arm_mask(img, J, limb, lines, changed)
    else:
        C = B.classes(img)
        cap = capsules(sh, segs)
        hem = hem_line(img)
        below = Y > hem[X.astype(int)] + 4
        near_hem = Y < hem[X.astype(int)] + 25
        # dark only at the shoes: the skirt's inner shadow between the thighs is dark too
        limbish = C["skin"] | C["white"] | (C["dark"] & (Y > np.array(J["A"])[1] - 60)) | (fg & ~C["plaid"] & ~C["dark"])
        # below the ankle everything of the figure in the capsule is shoe (its grey canvas reads as plaid)
        limbish |= fg & (Y > np.array(J["A"])[1] - 20)
        m = cap & fg & below & limbish & ~(C["white"] & near_hem)
        other = "rightLeg" if limb == "leftLeg" else "leftLeg"
        if other in J.get("_all", {}):     # dangling legs may touch: split by the nearer leg's bones
            so = limb_segments(other, J["_all"][other])
            dm = np.min([seg_dist(X, Y, p, q) for p, q, _ in segs.values()], 0)
            do = np.min([seg_dist(X, Y, p, q) for p, q, _ in so.values()], 0)
            m &= dm <= do
        # thin columns of skirt edge left above the hem: a 7 px opening takes them, a leg is 90+ px wide
        m = np.where(Y < segs["thigh"][1][1], ndi.binary_opening(m, np.ones((7, 7))), m)
        m = keep_main(m, segs["shin"][1])
    m &= fg
    out = img.copy()
    out[~m] = 0
    return out


def hem_line(img: np.ndarray) -> np.ndarray:
    """Per column, the lowest plaid row of the skirt (0 where there is no skirt): legs start below it."""
    C = B.classes(img)
    pl = ndi.binary_opening(C["plaid"], np.ones((5, 5)))
    pl[:600] = False
    pl[1100:] = False
    hem = np.zeros(img.shape[1], int)
    for x in range(img.shape[1]):
        ys = np.nonzero(pl[:, x])[0]
        hem[x] = ys.max() if len(ys) else 0
    xs = np.nonzero(hem)[0]
    hem[:] = np.interp(np.arange(len(hem)), xs, hem[xs]) if len(xs) else 900
    return hem.astype(int)


def extend_thigh_top(limb_img: np.ndarray, n=70) -> np.ndarray:
    """Each column of the thigh continues n px up from its top pixel, in that pixel's colour, so the limb
    tucks under the skirt (the hem covers the join; the hem line slants, so this is per column)."""
    out = limb_img.copy()
    a = limb_img[..., 3] > 200
    ys, xs = np.nonzero(a)
    if not len(ys):
        return out
    band = ys < ys.min() + 120
    for x in np.unique(xs[band]):
        col = np.nonzero(a[:, x])[0]
        t = col.min() + 2
        if t > ys.min() + 120:
            continue
        out[max(0, t - n):t, x] = limb_img[t:t + 12, x].mean(0)
    # the copied colours vary column to column; smooth them across so the hidden band reads as one surface
    band_rows = slice(max(0, ys.min() - n), ys.min() + 2)
    sm = out[band_rows].astype(np.float32)
    a_ = (sm[..., 3:4] > 0).astype(np.float32)
    num = cv2.GaussianBlur(sm[..., :3] * a_, (0, 0), 5)
    den = cv2.GaussianBlur(a_[..., 0], (0, 0), 5)[..., None]
    sm[..., :3] = np.where(a_ > 0, num / np.maximum(den, 1e-3), sm[..., :3])
    out[band_rows] = sm.round().astype(np.uint8)
    # one solid top: per row, gaps between the outer columns are filled from the nearest filled column (a
    # column whose top sat lower left a notch, leftLeg.drag), and the hidden band tapers to 70 % of its width
    # at the top with soft sides, so a swung thigh shows no square corner beside the skirt
    top0, top_new = int(ys.min()), max(0, int(ys.min()) - n)
    for y in range(top_new, top0 + 30):
        row = out[y]
        filled = np.nonzero(row[:, 3] > 200)[0]
        if len(filled) < 2:
            continue
        x0, x1 = filled.min(), filled.max()
        gap = np.arange(x0, x1 + 1)[row[x0:x1 + 1, 3] <= 200]
        if len(gap):
            j = np.searchsorted(filled, gap).clip(0, len(filled) - 1)
            row[gap] = row[filled[j]]
            row[gap, 3] = 255
        if y < top0 + 10:
            f = 0.7 + 0.3 * (y - top_new) / max(top0 + 10 - top_new, 1)
            cx, half = (x0 + x1) / 2, (x1 - x0) / 2 * f
            xs_ = np.arange(row.shape[0])
            row[:, 3] = (row[:, 3] * np.clip(half - np.abs(xs_ - cx) + 0.5, 0, 1)).round().astype(np.uint8)
    return out


def to_app_crop(img: np.ndarray, pts: dict, pad=3):
    """Crop a master-space RGBA to its alpha, scale to EXPORT x app scale; joints follow."""
    a = img[..., 3] > 0
    ys, xs = np.nonzero(a)
    x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), xs.max() + pad + 1, ys.max() + pad + 1
    crop = img[y0:y1, x0:x1]
    S = AMAP["scale"] * EXPORT
    w, h = max(1, round(crop.shape[1] * S)), max(1, round(crop.shape[0] * S))
    small = unpremul(cv2.resize(premul(crop), (w, h), interpolation=cv2.INTER_AREA))
    P = {k: [round((v[0] - x0) * S, 2), round((v[1] - y0) * S, 2)] for k, v in pts.items()}
    pos1x = [round(AMAP["ox"] + x0 * AMAP["scale"], 3), round(AMAP["oy"] + y0 * AMAP["scale"], 3)]
    return small, P, pos1x


def solid_interior(small: np.ndarray, fill: bool) -> tuple:
    """Partly transparent pixels 2+ px inside a 2x part's silhouette read as see-through over a dark desktop
    (consistency check 'see_through'). Inside a limb they are the soft cores of narrow finger gaps: under half
    alpha they open fully (unless the opening would be a dot under 8 px), the rest close. Inside hair (fill=True) they are gaps between strands: they close.
    The outline's own antialiasing is untouched. Returns the part and the number of pixels changed."""
    a = small[..., 3]
    # the checker's own test, on a 2x Lanczos upscale: 3 px inside alpha >= 16, and alpha under ~0.92
    h, w = a.shape
    a4 = cv2.resize(a.astype(np.float32), (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)
    inner4 = ndi.binary_erosion(a4 >= 16, iterations=3) & (a4 < 235)
    lab4, n4 = ndi.label(inner4, structure=np.ones((3, 3)))
    if n4:
        inner4 = np.isin(lab4, 1 + np.nonzero(ndi.sum(inner4, lab4, range(1, n4 + 1)) >= 36)[0])
    inner = (cv2.resize(inner4.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA) > 0) & (a < 255) & (a > 0)
    out = small.copy()
    if fill:
        out[..., 3][inner] = 255
    else:
        # a gap that would open to under 8 px at 2x reads as a punched dot, not as space between fingers:
        # those close instead
        op = inner & (a < 128)
        lab_, n = ndi.label(op, structure=np.ones((3, 3)))
        small_gap = np.isin(lab_, 1 + np.nonzero(ndi.sum(op, lab_, range(1, n + 1)) < 8)[0]) if n else op
        out[..., 3][op & ~small_gap] = 0
        out[..., 3][inner & ~(op & ~small_gap)] = 255
        out[out[..., 3] == 0] = 0
    return out, int(inner.sum())


def stats(img: np.ndarray) -> dict:
    a = img[..., 3] > 127
    _, n = ndi.label(a)
    holes = int((ndi.binary_fill_holes(a) & ~a).sum())
    C = B.classes(img)
    sk = lab(img[..., :3])[C["skin"] & a]
    wh = lab(img[..., :3])[C["white"] & a]
    return {"components": int(n), "hole_px": holes, "area_px": int(a.sum()),
            "skin_lab_median": np.median(sk, 0).round(1).tolist() if len(sk) else None,
            "white_lab_median": np.median(wh, 0).round(1).tolist() if len(wh) else None}


def outline_turns(img: np.ndarray, J: dict, r=40) -> dict:
    """Sharpest outline turn (deg) within r px of each mid-limb joint (elbow, wrist, knee, ankle): a notch or a
    step shows as a spike. Contour resampled every 6 px and smoothed, so pixel stairs do not count. Near the
    wrist the thumb crotch is a real sharp turn, so W is reported but read with the sheet."""
    a = (img[..., 3] > 127).astype(np.uint8)
    cs, _ = cv2.findContours(a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return {}
    c = max(cs, key=len)[:, 0, :].astype(np.float32)
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(c, axis=0).T))]
    t = np.arange(0, d[-1], 6.0)
    P = np.c_[np.interp(t, d, c[:, 0]), np.interp(t, d, c[:, 1])]
    P = ndi.uniform_filter1d(P, 3, axis=0, mode="wrap")
    v1, v2 = P - np.roll(P, 1, 0), np.roll(P, -1, 0) - P
    ang = np.degrees(np.abs(np.arctan2(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0], (v1 * v2).sum(1))))
    out = {}
    for k in ("E", "W", "K", "A"):
        if k in J:
            near = np.hypot(*(P - np.array(J[k])).T) < r
            out[k] = round(float(ang[near].max()), 1) if near.any() else None
    return out


def nose_mouth_ratio(kp: dict) -> float:
    """The harness's nose-to-mouth measure: mouth-corner midpoint below the nose base, over face height."""
    d = A.LK.derived(kp)
    return float((d["mouth"][1] - kp["nose_base"][1]) / d["h"])


def mouth_to_ratio(rgba: np.ndarray, L: np.ndarray, target: float) -> tuple:
    """Move the mouth vertically so nose-to-mouth / face height equals target. The shift fades over an ellipse
    centred on the mouth that reaches just short of the nose base and the chin."""
    kp = A.LK.keypoints_from_mesh(L)
    d = A.LK.derived(kp)
    shift = (target - nose_mouth_ratio(kp)) * d["h"]
    m = d["mouth"]
    up = (m[1] - kp["nose_base"][1]) * 0.9
    down = (kp["chin"][1] - m[1]) * 0.8
    rx = 0.75 * d["iod"]
    Y, X = np.mgrid[0:rgba.shape[0], 0:rgba.shape[1]].astype(np.float32)
    ry = np.where(Y < m[1], up, down)
    w = np.clip(1 - ((X - m[0]) / rx) ** 2 - ((Y - m[1]) / ry) ** 2, 0, 1)
    w = w * w * (3 - 2 * w)
    out = unpremul(B.remap(premul(rgba), X, Y - shift * w))
    return out, shift


def part_rgb_master(name: str, shape) -> np.ndarray:
    """An art part's colour (float RGB, 0..255, straight) placed at its restPos1x, in master pixels."""
    m = PARTS_ART["parts"][name]
    f = premul(np.array(Image.open(ART / "out" / m["file"]).convert("RGBA")))
    k = 1 / (EXPORT * AMAP["scale"])
    M = np.float32([[k, 0, (m["restPos1x"][0] - AMAP["ox"]) / AMAP["scale"]], [0, k, (m["restPos1x"][1] - AMAP["oy"]) / AMAP["scale"]]])
    w = cv2.warpAffine(f, M, (shape[1], shape[0]), flags=cv2.INTER_LINEAR)
    return w[..., :3] / np.maximum(w[..., 3:4], 1e-6) * 255


def part_alpha_master(name: str, shape) -> np.ndarray:
    """An art part's alpha (0..1) placed at its restPos1x, in master pixels."""
    m = PARTS_ART["parts"][name]
    a = np.array(Image.open(ART / "out" / m["file"]).convert("RGBA"))[..., 3].astype(np.float32) / 255
    k = 1 / (EXPORT * AMAP["scale"])
    M = np.float32([[k, 0, (m["restPos1x"][0] - AMAP["ox"]) / AMAP["scale"]], [0, k, (m["restPos1x"][1] - AMAP["oy"]) / AMAP["scale"]]])
    return cv2.warpAffine(a, M, (shape[1], shape[0]), flags=cv2.INTER_LINEAR)


def head_views(master_rgb):
    """Head views with their own (Codex-drawn) glasses: chroma key, jaw warp to the reference profile (as the
    art lever does for its views), per-region face grade, into master space by the face_hd -> master affine."""
    LK = A.LK
    Lref = B.mesh(np.array(Image.open(A.REF).convert("RGB")))
    A._jaw["ref_w"] = A.oval_profile(Lref, A.JAW_T)[0]
    face0 = B.chroma_key(load(ART / "gen" / "face_hd_in.png"))
    L0 = B.mesh(over(face0))
    kp0 = LK.keypoints_from_mesh(L0)
    out, info = {}, {}

    def lens_offset(rgba, L, kp):
        lz = B.lens_fit(rgba, kp)
        iod = float(np.linalg.norm(L[473] - L[468]))
        res = {}
        for q, ic in (("l", 468), ("r", 473)):
            c = lz[q]
            res[q] = [round((c["cx"] - L[ic][0]) / iod, 3), round((c["cy"] - L[ic][1]) / iod, 3)]
        return res, lz
    rest_off, _ = lens_offset(face0, L0, kp0)
    face_art = np.array(Image.open(ART / "out" / "face.png").convert("RGBA"))
    L_art = B.mesh(over(face_art))
    kp_art = LK.keypoints_from_mesh(L_art)
    rest_rim = B.rim_ratio(B.lens_fit(face_art, kp_art), kp_art)
    # where the shipped rest head's drawn lenses sit on its eyes (lens centre - iris, in IODs): every view's
    # drawn lenses go to the same place on that view's eyes
    rest_off_art, _ = lens_offset(face_art, L_art, kp_art)
    nm_rest = nose_mouth_ratio(kp_art)
    rgb_art = over(face_art)
    rest_cols, _ = LK.palette(rgb_art, LK.lab_of(rgb_art), kp_art)
    info["rest_shipped"] = {"lens_minus_iris_over_iod": rest_off_art}
    # below a view's chin its neck stub covers what the rest head part covers there (the rest head ends at the
    # collar and overlaps the neck part), plus any place neither the neck nor the torso part fills
    head_a = part_alpha_master("head", master_rgb.shape[:2])
    neck_a = part_alpha_master("neck", master_rgb.shape[:2])
    under = np.maximum(neck_a, part_alpha_master("torso", master_rgb.shape[:2]))
    neck_rgb = part_rgb_master("neck", master_rgb.shape[:2])
    head_rgb = part_rgb_master("head", master_rgb.shape[:2])
    info["rest_shipped_rim_over_face_width"] = round(float(rest_rim), 4)
    info["rest_face_hd"] = {"lens_minus_iris_over_iod": rest_off}
    sh = master_rgb.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    for name, v in VIEWS.items():
        p = SRC / v["src"]
        if not p.exists():
            info[name] = {"missing": str(p)}
            continue
        raw = load(p)
        if raw.shape[:2] != (1024, 1024):
            raw = np.array(Image.fromarray(raw).resize((1024, 1024), Image.LANCZOS))
        keyed = B.chroma_key(raw)
        Lv = B.mesh(over(keyed))
        if Lv is None:
            info[name] = {"error": "no face mesh"}
            continue
        kpv = LK.keypoints_from_mesh(Lv)
        lz0 = B.lens_fit(keyed, kpv)
        gmask, circles = B.glasses_mask(keyed, kpv, lz0)
        # the art lever's mask follows a circle fitted to each rim; where that fit is off (pitchm15's left lens)
        # the Codex rim stays as a ghost, so its metal is also taken in a band around the fitted lens ellipse
        Yk, Xk = np.mgrid[0:keyed.shape[0], 0:keyed.shape[1]]
        Lbk = lab(keyed[..., :3])
        metal = (np.hypot(Lbk[..., 1], Lbk[..., 2]) < 12) & (keyed[..., 3] > 128) & (Lbk[..., 0] > 50)
        ring = np.zeros(gmask.shape, bool)
        for q in "lr":
            rho = np.hypot((Xk - lz0[q]["cx"]) / lz0[q]["rx"], (Yk - lz0[q]["cy"]) / lz0[q]["ry"])
            ring |= (rho > 0.75) & (rho < 1.4)       # out to the hinges (one stayed on yawp12's temple at 1.25)
        # the wire's darker edge and its shadow are greyer and darker than the core (arcs of them stayed on
        # yawp12 and pitchm15, seen at full size)
        wire = (np.hypot(Lbk[..., 1], Lbk[..., 2]) < 16) & (keyed[..., 3] > 128) & (Lbk[..., 0] > 35)
        gmask |= dilate(wire & ring, 3)
        # where the lens fit itself is off (pitchm15 left, yawp12 right) an arc of the Codex rim lies outside
        # that band: wire pixels anywhere near the eyes go too, except the eyes themselves and the hair
        near = np.zeros(gmask.shape, bool)
        for q, ic in (("l", 468), ("r", 473)):
            near |= np.hypot(Xk - Lv[ic][0], Yk - Lv[ic][1]) < 1.45 * max(lz0[q]["rx"], lz0[q]["ry"])
        eyes = dilate(B.poly_mask(keyed.shape[:2], Lv[EYE_L]) | B.poly_mask(keyed.shape[:2], Lv[EYE_R]), 6)
        gmask |= dilate(wire & near & ~eyes & ~B.classes(keyed)["hair"], 3)
        skin_zone = dilate(B.poly_mask(keyed.shape[:2], Lv[LK.OVAL]), 4)
        bare = keyed.copy()          # Codex's glasses painted out, as the art lever does on face_hd
        bare[..., :3] = cv2.inpaint(np.ascontiguousarray(keyed[..., :3]), gmask.astype(np.uint8), 5, cv2.INPAINT_TELEA)
        hh = gmask & ~skin_zone
        bare[..., :3] = np.where(hh[..., None], A.column_fill(keyed[..., :3], hh), bare[..., :3])
        mx, my = A.jaw_maps(keyed.shape[:2], Lv, 1.0)
        jg = dict(A._jaw["gain"])
        variants = {}
        for var, src_img in (("codexGlasses", keyed), ("drawn", bare)):
            warped = unpremul(B.remap(premul(src_img), mx, my))
            Lw = B.mesh(over(warped))
            kpw = LK.keypoints_from_mesh(Lw)
            mouth_shift = 0.0
            if v["yaw"] != 0:
                # a turn does not change vertical face distances, so the mouth keeps the rest head's
                # nose-to-mouth / face height (yawp12 drew it high: harness -0.11, limit 0.08); the mouth
                # moves down, fading out before the nose and the chin
                warped, mouth_shift = mouth_to_ratio(warped, Lw, nm_rest)
                Lw = B.mesh(over(warped))
                kpw = LK.keypoints_from_mesh(Lw)
            if var == "drawn":
                # the rest head's wire (colours, widths, rim size) placed where Codex put the glasses in this
                # view: centre = Codex rim centre, radii = Codex rim radii x (rest rim / face_hd rim)
                # rim size: this view's Codex rim scaled so rim diameter / face width equals the rest head's
                # (each view's Codex rim differs: x1.15 on face_hd would over-size the raised-chin view by 18 %)
                # one rim template for both lenses: the same height (the lenses are one rigid frame), the
                # same width too on a pure pitch; on a turn each keeps the foreshortened Codex width. Centres
                # sit where the rest head's lenses sit on its eyes (rest_off_art), so the glasses cannot
                # drift off the eyes
                k = rest_rim / B.rim_ratio(lz0, kpv)
                iod_w = float(np.linalg.norm(Lw[473] - Lw[468]))
                ry = k * float(np.mean([lz0[q]["ry"] for q in "lr"]))
                rxs = {q: k * lz0[q]["rx"] for q in "lr"}
                if v["yaw"] == 0:
                    rxs = {q: float(np.mean(list(rxs.values()))) for q in "lr"}
                lenses = {q: (float(Lw[ic][0] + rest_off_art[q][0] * iod_w), float(Lw[ic][1] + rest_off_art[q][1] * iod_w), rxs[q], ry)
                          for q, ic in (("l", 468), ("r", 473))}
                warped = A.draw_glasses_e(warped, lenses, kpw)
                lens_gate = {}
                for q, ic in (("l", 468), ("r", 473)):
                    cx, cy, rx_, ry_ = lenses[q]
                    lens_gate[q] = {"iris_x_in_lens": round((float(Lw[ic][0]) - (cx - rx_)) / (2 * rx_), 3),
                                    "iris_y_in_lens": round((float(Lw[ic][1]) - (cy - ry_)) / (2 * ry_), 3),
                                    "drawn_px": [round(x, 1) for x in lenses[q]]}
                lens_gate["height_diff_frac"] = round(abs(lenses["l"][3] - lenses["r"][3]) / max(lenses["l"][3], lenses["r"][3]), 4)
                lens_gate["pass"] = bool(lens_gate["height_diff_frac"] <= 0.05 and all(
                    0.2 <= lens_gate[q][a] <= 0.8 for q in "lr" for a in ("iris_x_in_lens", "iris_y_in_lens")))
                # Codex rim left after the paint-out: metal in the band around the Codex lenses, away from the new rim
                newrim = np.zeros(gmask.shape, bool)
                for q in "lr":
                    cx, cy, rx_, ry_ = lenses[q]
                    newrim |= np.abs(np.hypot((Xk - cx) / rx_, (Yk - cy) / ry_) - 1) < 0.08
                Lbb = lab(bare[..., :3])
                metal_b = (np.hypot(Lbb[..., 1], Lbb[..., 2]) < 12) & (bare[..., 3] > 128) & (Lbb[..., 0] > 50)
                lens_gate["codex_rim_metal_px"] = {"before_paint_out": int((metal & ring & ~newrim).sum()),
                                                   "after_paint_out": int((metal_b & ring & ~newrim).sum())}
            Wf = B.face_weights(warped, Lw)
            graded = B.apply_grade(warped, Wf, GRADE)
            # then the hair alone, closed loop on the harness's palette sampler, toward the shipped rest head's
            # hair (a raised chin shows the lit top of the hair, which reads lighter and more yellow: pitchm15
            # failed palette.hair at dE00 7.2 with the shared grade alone)
            Wh = {"hair": B.face_weights(graded, Lw)["hair"]}
            hp, hlog = B.fit_grade(graded, Wh, kpw, rest_cols)
            graded = B.apply_grade(graded, Wh, hp)
            save(graded, WORK / f"view_{name}_{var}.png")
            off, lz = lens_offset(graded, Lw, kpw)
            full = B.warp_rgba(graded, A_FACE, (sh[1], sh[0]))
            Lm = B.apply_affine(A_FACE, Lw)
            chin_y = float(Lm[152][1])
            Cv = B.classes(full)
            hairish = dilate(Cv["hair"], 2) & (full[..., 3] > 0) & ~dilate(Cv["white"], 1)
            zone = (X >= A.HB["x"] - 20) & (X <= A.HB["x"] + A.HB["side"] + 20) & (Y < max(chin_y, CUT_Y) + 40)
            # white near the chin is the collar, except inside the face oval: a raised chin's highlight reads
            # as white too, and dropping it left a hole on the chin (pitchm15, seen on the sheet)
            oval_m = B.poly_mask((sh[0], sh[1]), Lm[LK.OVAL])
            # the neck stub (a raised chin sits above the rest neck's top: pitchm15 showed see-through slivers
            # beside the neck when the view stopped 4 px under its chin). Over the opaque neck/torso it ends as
            # the rest head ends (its alpha); elsewhere it keeps the view's own neck down to the collar
            notcollar = ~(Cv["white"] & (Y > chin_y - 30) & ~oval_m)
            stub = (Y >= chin_y + 4) & notcollar & ((head_a > 0.02) | (under < 0.98))
            # the view's own collar edge for 3 px beside its neck, so its neck edge and the torso's collar edge
            # (both soft) never meet in a see-through line
            stub |= (Y >= chin_y + 4) & dilate(stub & zone & (full[..., 3] > 0), 3) & (under >= 0.98) & (head_a > 0.02)
            m = zone & (full[..., 3] > 0) & (((Y < chin_y + 4) & notcollar) | hairish | stub)
            cutv = B.cut(full, m)
            # the fade ends at the rest head's edge but starts ~20 px inside it: the view's neck is a shade
            # lighter than the rest neck part, and a short fade left a line across the neck (out/context_2x zoom)
            head_soft = np.minimum(head_a, cv2.GaussianBlur(erode(head_a > 0.5, 14).astype(np.float32), (0, 0), 6))
            # and the view's neck takes the rest neck part's shading toward that edge (low frequency only): the
            # view's neck is lighter, and where a raised chin uncovers more neck a fade alone left a line
            ok = stub & ~hairish & (neck_a > 0.98) & (full[..., 3] > 230) & ~Cv["white"]
            okf = ok.astype(np.float32)
            den = cv2.GaussianBlur(okf, (0, 0), 8)
            diff = (cv2.GaussianBlur(neck_rgb * okf[..., None], (0, 0), 8) - cv2.GaussianBlur(cutv[..., :3].astype(np.float32) * okf[..., None], (0, 0), 8)) / np.maximum(den, 1e-3)[..., None]
            ramp = np.clip((Y - (chin_y + 4)) / 25.0, 0, 1) * (den > 0.05) * stub * ~hairish
            cutv[..., :3] = np.clip(cutv[..., :3] + diff * ramp[..., None], 0, 255).round().astype(np.uint8)
            fade = np.where(stub & ~hairish & (under >= 0.98), head_soft, 1.0)
            cutv[..., 3] = (cutv[..., 3] * fade).round().astype(np.uint8)
            # where neither the neck nor the torso part is opaque, at least as opaque as the rest head, with the
            # view's own pixels: the rest head is what covers the neck-collar join at rest, and a view with a
            # softer neck edge there left a see-through line along the collar
            dist = ndi.distance_transform_edt(full[..., 3] < 200)
            # the rest head's solid footprint grown 3 px onto the neck/torso, so the two overlap by a 2x pixel
            # (abutting soft edges composite to a see-through line after the downscale)
            grown = dilate(head_a > 0.5, 3) & ((head_a > 0.02) | (under > 0.3))
            force = (Y > chin_y - 10) & zone & grown & (dist < 8) & ~hairish & (under < 0.98)
            fa = np.maximum(cutv[..., 3], np.where(grown, 255, (head_a * 255).round())).astype(np.uint8)
            # where the view itself is not solid, the rest head's own pixels (what covers this spot at rest)
            cutv[force, :3] = np.where((full[..., 3] >= 200)[..., None], full[..., :3], head_rgb.clip(0, 255).round().astype(np.uint8))[force]
            cutv[..., 3] = np.where(force, fa, cutv[..., 3])
            solid = (cutv[..., 3] == 255) & (under >= 0.999)
            neck_overlap_rows = int(solid[:, int(A.HB["x"] + A.HB["side"] / 2)].sum())
            out[name if var == "drawn" else f"{name}.codexGlasses"] = drop_white_specks(cutv)
            variants[var] = {"hair_grade_kL_rot_kC": [round(float(x), 4) for x in hp["hair"]], "hair_grade_dE_by_round": hlog,
                             "neck_stub_opaque_over_opaque_neck_px_master_at_centre": neck_overlap_rows,
                             "mouth_moved_down_px_1024": round(float(mouth_shift), 2),
                             **({"lens_gate": lens_gate} if var == "drawn" else {}),
                             "lens_minus_iris_over_iod": off,
                             "lens_offset_change_vs_rest_iod": round(max(float(np.hypot(off[q][0] - rest_off_art[q][0], off[q][1] - rest_off_art[q][1])) for q in "lr"), 3),
                             "lenses_px": {q: [round(lz[q][k], 1) for k in ("cx", "cy", "rx", "ry")] for q in "lr"},
                             "holdout": A.holdout(over(graded), kpw), "chin_y_master": round(chin_y, 1),
                             "nose_shift_vs_rest_px_master": [round(float(x), 1) for x in (Lm[1] - B.apply_affine(A_FACE, L0)[1])]}
        info[name] = {"source": f"src/{v['src']}", "yaw": v["yaw"], "pitch": v["pitch"], "jaw_gain_by_t": jg,
                      "codex_rim_circles_px": {q: [round(float(x), 1) for x in circles[q]] for q in "lr"}, **variants}
    return out, info


def sheet(tiles, path, bg=(236, 236, 240), label_h=16, opaque=False):
    w = sum(t[1].shape[1] for t in tiles) + 6 * (len(tiles) + 1)
    h = max(t[1].shape[0] for t in tiles) + label_h + 12
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    x = 6
    for lab_, t in tiles:
        im.paste(Image.fromarray(t if opaque else over(t, bg)), (x, label_h + 6))
        d.text((x, 3), lab_, fill=(0, 0, 0))
        x += t.shape[1] + 6
    im.save(path)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    PARTS.mkdir(exist_ok=True)
    WORK.mkdir(exist_ok=True)
    for f in [*PARTS.glob("*.png"), *OUT.glob("context_*.png")]:
        f.unlink()
    master_raw = load(ART / "src" / "master.png")
    master = grade_body(B.chroma_key(master_raw))
    G = {"master": {"ecc": 1.0}}
    reg = {"rest": master}
    missing = []
    for name, k in KEYS.items():
        if name == "rest":
            continue
        if not k["src"].exists():
            missing.append(name)
            continue
        raw = load(k["src"])
        W, cc = register(raw, master_raw, k["reg"])
        reg[name] = A.to_master(grade_body(B.chroma_key(raw)), W)
        G[name] = {"ecc": round(cc, 4), "reg_on": k["reg"], "affine_master_to_key": W.round(5).tolist(),
                   "source": str(k["src"].relative_to(ART)).replace("\\", "/")}
        JOINTS.setdefault("_master", {})[name] = {limb: {j: key_pt(W, p) for j, p in JOINTS[name][limb].items()}
                                                 for limb in k["limbs"] if limb in JOINTS.get(name, {})}
        save(reg[name], WORK / f"reg_{name}.png")
    lines = {"left": body_line(master, "left"), "right": body_line(master, "right")}
    # left: against the wave key (arm up, waist under the hand visible); right: by colour (no key moves the
    # right arm clear of its rest place, so a foil would hide the overlap)
    rest_masks = {"leftArm": rest_arm_mask(master, "leftArm", lines, reg["wave_up"]),
                  "rightArm": rest_arm_mask(master, "rightArm", lines)}
    masks = {}
    for name in KEYS:
        mp = SRC / f"mask_{name}.png"
        if mp.exists() and name in reg:
            masks[name] = codex_mask(mp, master_raw, KEYS[name]["reg"])
            G[name]["mask"] = {"source": f"src/mask_{name}.png", "px": int(masks[name].sum())}
    G["body_line_x_at_y"] = {s: {str(y): int(lines[s][y]) for y in (360, 420, 480, 540, 600)} for s in lines}
    parts, gates = {}, {}
    guide = json.loads((HERE / "guide" / "out" / "joints3d.json").read_text())["poses"]
    GUIDE_NAME = {"leftArm": {"S": "lS", "E": "lE", "W": "lW", "T": "lT"}, "rightArm": {"S": "rS", "E": "rE", "W": "rW", "T": "rT"},
                  "leftLeg": {"H": "lH", "K": "lK", "A": "lA", "T": "lToe"}, "rightLeg": {"H": "rH", "K": "rK", "A": "rA", "T": "rToe"}}
    full_tiles = []
    for name, k in KEYS.items():
        if name not in reg:
            continue
        img = reg[name]
        Jm = JOINTS["_master"][name] if name != "rest" else {"leftArm": ARTJ["rest"]["leftArm"], "rightArm": ARTJ["rest"]["rightArm"]}
        for limb in k["limbs"]:
            if limb not in Jm:
                missing.append(f"{name}.{limb} joints")
                continue
            J = dict(Jm[limb])
            J["_all"] = Jm
            if limb == "leftArm":            # registered to the rest pivot: the shoulder is the same body point
                d = np.array(S_REST) - np.array(J["S"])
            else:
                d = np.zeros(2)
            if name == "rest":
                piece = img.copy()
                piece[~(rest_masks[limb] & (img[..., 3] > 0))] = 0
            elif name in masks and limb == "leftArm":
                # Codex painted this arm magenta on a copy of the key: its outline is the arm's edge where the
                # arm lies on the face, hair or shirt; on the green the key's own alpha gives the edge
                piece = img.copy()
                Ck = B.classes(img)
                Lk = lab(img[..., :3])
                skinlike = (np.hypot(Lk[..., 1], Lk[..., 2]) >= 5) & (Lk[..., 0] >= 22)
                # the silhouette's edge is a few px loose: hair it caught at the fingers stays with the head
                m = masks[name] & (img[..., 3] > 0) & ~(Ck["hair"] & ~(Ck["skin"]) & ~dilate(Ck["skin"], 1) & (Lk[..., 0] < 45))
                m = keep_main(m, limb_segments(limb, J)["fore"][1])
                piece[~m] = 0
            else:
                piece = cut_limb(img, master, J, limb, lines, rest_masks)
            if limb.endswith("Leg"):
                piece = extend_thigh_top(piece)
            if np.any(np.abs(d) > 0.01):
                T = np.float32([[1, 0, d[0]], [0, 1, d[1]]])
                piece = unpremul(cv2.warpAffine(premul(piece), T, (piece.shape[1], piece.shape[0]), flags=cv2.INTER_LINEAR))
            piece = drop_islands(piece)
            Jd = {j: [p[0] + d[0], p[1] + d[1]] for j, p in J.items() if j != "_all"}
            if limb.endswith("Leg"):
                # the pelvis is locked to the master in every key, so the hip joint is the art rig's thigh pivot;
                # the H read off the key is the thigh's middle at the hem, wider than the joint (the rig puts H on
                # its pivot, so that H would draw land and drag knock-kneed)
                Jd["_H_read_off_key"] = Jd["H"]
                Jd["H"] = ((art_hip_1x(limb) - [AMAP["ox"], AMAP["oy"]]) / AMAP["scale"]).tolist()
            rot = ARM_ROT_DEG.get(name, {}).get(limb)
            if rot:
                # the whole arm turns rigidly about the rest shoulder (bones with it), the same pose a little
                # further in; a rotation in image coordinates with y down, positive turns the hand toward x-
                R = cv2.getRotationMatrix2D((float(S_REST[0]), float(S_REST[1])), -rot, 1.0)
                piece = unpremul(cv2.warpAffine(premul(piece), R, (piece.shape[1], piece.shape[0]), flags=cv2.INTER_LINEAR))
                Jd = {j: (R @ np.array([p[0], p[1], 1.0])).tolist() for j, p in Jd.items()}
            st = stats(piece)
            st["outline_max_turn_deg_at"] = outline_turns(piece, Jd)
            st["shift_to_rest_pivot_px"] = [round(float(x), 2) for x in d]
            st["turned_about_shoulder_deg"] = rot or 0
            if name in guide:
                gp = guide[name]
                # bone directions, key art minus guide (deg): the guide's bones keep the model's lengths, so
                # joint positions would mix length differences into the comparison
                ch = list(GUIDE_NAME[limb])
                ang = lambda P, a, b: np.degrees(np.arctan2(P[b][1] - P[a][1], P[b][0] - P[a][0]))
                gpn = {j: gp[GUIDE_NAME[limb][j]] for j in ch if GUIDE_NAME[limb][j] in gp}
                st["bone_angle_minus_guide_deg"] = {f"{a}{b}": round(float((ang(Jd, a, b) - ang(gpn, a, b) + 180) % 360 - 180), 1)
                                                    for a, b in zip(ch, ch[1:]) if a in gpn and b in gpn}
            h_read = Jd.pop("_H_read_off_key", None)
            if h_read is not None:
                st["H_read_off_key_master"] = [round(float(x), 1) for x in h_read]
            small, P, pos1x = to_app_crop(piece, Jd)
            small, st["interior_alpha_px_fixed_2x"] = solid_interior(small, fill=False)
            a1 = small[..., 3] > 127
            ys, xs = np.nonzero(a1)
            # frame margin at 1x when the limb sits where the key drew it
            st["frame_margin_1x"] = {"left": round(pos1x[0] + xs.min() / EXPORT, 1), "top": round(pos1x[1] + ys.min() / EXPORT, 1),
                                     "right": round(139 - (pos1x[0] + (xs.max() + 1) / EXPORT), 1),
                                     "bottom": round(340 - (pos1x[1] + (ys.max() + 1) / EXPORT), 1)}
            pname = f"{limb}.{name}"
            fn = pname.replace(".", "__") + ".png"
            save(small, PARTS / fn)
            save(piece, WORK / f"limb_{pname}.png")
            parts[pname] = {"file": f"parts/{fn}", "limb": limb, "key": name, "size": [small.shape[1], small.shape[0]],
                            "bones": P, "restPos1x": pos1x,
                            "chain": ["S", "E", "W", "T"] if limb.endswith("Arm") else ["H", "K", "A", "T"],
                            "z": Z_LIMB[name].get(limb) if name in Z_LIMB else Z_LIMB["_"][limb],
                            "source": G.get(name, {}).get("source", "src/master.png (rest)")}
            gates[pname] = st
        full_tiles.append((name, cv2.resize(img[0:1536:1, 200:900], (350, 768), interpolation=cv2.INTER_AREA)))
    # torso without the left sleeve: the rest left arm area of the art's torso part, refilled from wave_up
    # (its arm is up, so the flank under the rest sleeve shows); the sleeve now belongs to the arm
    tparts = torso_no_sleeve(reg, lines, rest_masks)
    head, vinfo = head_views(master_raw)
    for vn, img in head.items():
        base = vn.split(".")[0]
        small, P, pos1x = to_app_crop(img, {"neck": [A.HB["x"] + A.HB["side"] / 2, CUT_Y]})
        small, nfix = solid_interior(small, fill=True)
        vinfo.setdefault(base, {}).setdefault("interior_alpha_px_fixed_2x", {})[vn] = nfix
        fn = f"head__{vn.replace('.', '__')}.png"
        save(small, PARTS / fn)
        parts[f"head.{vn}"] = {"file": f"parts/{fn}", "bone": "head", "size": [small.shape[1], small.shape[0]],
                               "bones": P, "restPos1x": pos1x, "z": 16, "yaw": VIEWS[base]["yaw"], "pitch": VIEWS[base]["pitch"],
                               "glasses": ("Codex's own glasses (smaller, greyer rim than the rest head: an alternate)"
                                           if vn.endswith("codexGlasses") else
                                           "the rest head's drawn wire and rim/face ratio; both lenses one template (same "
                                           "height; same width on the pitch view), centred where the rest lenses sit on the eyes"),
                               "source": f"src/{VIEWS[base]['src']}"}
    parts.update(tparts)
    doc = {"about": "Tieu Mai key-pose limbs. Each limb is ONE continuous texture: an arm from "
                    "the shoulder cap with its sleeve to the fingertips, a leg from above the hem (tucked under the "
                    "skirt) to the toe. bones are the chain joints in the PNG's own pixels (EXPORT x app scale); "
                    "restPos1x is the PNG's top-left in the 139x340 frame (1x) with the rig at the art's rest "
                    "placement. Left-arm keys are shifted so S equals the rest shoulder (the same body point); "
                    "leftArm.land is also turned 4 deg in about S so its hand stays 2+ px inside the frame. Leg H is "
                    "the art rig's thigh pivot (the pelvis is locked to the master in every key), so a leg drawn at "
                    "its restPos1x sits as the key drew it; land's feet sit higher than the rest feet because she "
                    "crouches: the rig lowers the whole body by the difference. A key with no rightArm part keeps "
                    "rightArm.rest (the agreed rule: the right arm stays inside the rest outline). "
                    "torso.noLeftSleeve replaces the art torso part with every part of this file: the left sleeve "
                    "belongs to the arm, and the shirt runs on under both armholes so no sleeve edge meets the torso "
                    "edge. z is the draw order on the art parts' z scale: left arm 13.5 over torso 9, legs under "
                    "pelvis 8; think and tuck draw the whole left arm at 16.5, over the head (16) and under frontHair "
                    "(17): nothing else lies between 13.5 and 16.5 except the old arm bones this arm replaces. Head "
                    "views (z 16) have no eyes-closed or mouth overlays: the motion unit holds blinks and speech "
                    "until a view has blended back to the front head (or starts a view only between them).",
           "headViewsBlinkTalk": "suppressed during a view: no registered eyes-closed or mouth overlay exists for yawm12, yawp12 or pitchm15",
           "exportScale": EXPORT, "masterToApp1x": AMAP, "licence": "CC0-1.0", "parts": parts}
    (OUT / "parts.json").write_text(json.dumps(doc, indent=1))
    import hashlib
    G["repro_sha256_16"] = {f.name: hashlib.sha256(f.read_bytes()).hexdigest()[:16] for f in sorted(PARTS.glob("*.png"))}
    G["missing"] = missing
    G["limbs"] = gates
    G["views"] = vinfo
    (OUT / "gates.json").write_text(json.dumps(G, indent=1))
    proofs(reg, parts)
    G["harness_views"] = harness_views()
    G["in_context"] = in_context(parts)
    (OUT / "gates.json").write_text(json.dumps(G, indent=1))
    print(json.dumps({"missing": missing, "limbs": {k: {kk: v[kk] for kk in ("components", "hole_px", "outline_max_turn_deg_at", "frame_margin_1x")}
                                                    for k, v in gates.items()},
                      "views": {k: {var: v[var]["lens_offset_change_vs_rest_iod"] for var in ("drawn", "codexGlasses") if var in v} for k, v in vinfo.items() if isinstance(v, dict) and "yaw" in v}}, indent=0))


def torso_shirt_rgb(img):
    """Median shirt colour on the chest beside the left armpit (master px x 560..605, y 380..470)."""
    win = img[380:470, 560:605]
    v = win[..., :3][(win[..., 3] > 200) & shirt_white(win)]
    return np.median(v, 0).astype(np.uint8) if len(v) else np.array([228, 226, 228], np.uint8)


def faint_islands(img: np.ndarray, max_px=32) -> list:
    """Components of any alpha (8-connected) under max_px: specks a soft cut leaves behind."""
    lab_, n = ndi.label(img[..., 3] > 0, structure=np.ones((3, 3)))
    if n < 2:
        return []
    sz = ndi.sum(np.ones_like(lab_), lab_, range(1, n + 1))
    return [{"px": int(sz[i]), "at": [round(float(v), 1) for v in ndi.center_of_mass(lab_ == i + 1)[::-1]],
             "alpha_max": int(img[..., 3][lab_ == i + 1].max())} for i in np.nonzero(sz < max_px)[0]]


def drop_faint_islands(img: np.ndarray, max_px=32) -> np.ndarray:
    lab_, n = ndi.label(img[..., 3] > 0, structure=np.ones((3, 3)))
    if n < 2:
        return img
    sz = ndi.sum(np.ones_like(lab_), lab_, range(1, n + 1))
    out = img.copy()
    out[np.isin(lab_, 1 + np.nonzero(sz < max_px)[0])] = 0
    return out


def torso_no_sleeve(reg, lines, rest_masks) -> dict:
    """The art torso part with the rest left arm's area (sleeve and the arm against the flank) replaced by the
    flank as the wave key draws it (arm up), and shirt inpainted where both arms covered it (the shoulder
    under the sleeve). The arm part now carries the sleeve, so nothing white is left behind when it moves."""
    tp = PARTS_ART["parts"]["torso"]
    torso = np.array(Image.open(ART / "out" / tp["file"]).convert("RGBA"))
    wave = reg["wave_up"]
    wave_arm = np.array(Image.open(WORK / "limb_leftArm.wave_up.png").convert("RGBA"))[..., 3] > 0
    sh = wave.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]]
    # the rest arm's area, and a band along the torso line from the shoulder top past the armpit: a key whose
    # sleeve hangs closer to the body (talk) leaves the strip between the line and the rest sleeve uncovered
    # full reach down to the armpit, then tapering to 6 at y_max (a step there showed as a notch in the flank)
    al = ARMHOLE["left"]
    reach = np.interp(Y, [al["taper_from"], al["y_max"]], [al["reach"], 6])
    band = (X > lines["left"][Y] - 8) & (X <= lines["left"][Y] + reach) & (Y > S_REST[1] - 60) & (Y < al["y_max"])
    region = (dilate(rest_masks["leftArm"], 3) | band) & (Y < 590)
    # past the torso line, so the shirt runs on under the sleeve's cut edge (two soft edges meeting near the
    # line leave a see-through slit at the armhole): ARMHOLE reach above the armpit, 6 below
    inside = X <= lines["left"][Y] + reach
    patch = wave.copy()
    patch[dilate(wave_arm, 2) | ~region] = 0
    Lb = lab(patch[..., :3])
    shirtish = (np.hypot(Lb[..., 1], Lb[..., 2]) < 10) & (Lb[..., 0] > 45)
    patch[~shirtish] = 0                   # the torso part is shirt only: waist skin and skirt belong to the pelvis
    # never above the shoulder line: above the shoulder joint, 4 px inside the figure (rest or wave), so every
    # sleeve cap covers it
    # (a fill out to the band's top corner showed as a square tab on the shoulder)
    figure = erode((reg["rest"][..., 3] > 127) | (wave[..., 3] > 127), 4) | (Y > S_REST[1])
    hole = region & inside & (patch[..., 3] < 128) & figure
    # the sleeve's shoulder seam runs along the torso line above the armpit; with the sleeve gone it would
    # stay on the shirt as a dark line, so a 5 px band inside the line is refilled too
    hole |= region & (X > lines["left"][Y] - 5) & inside & (Y < 425) & figure
    # every transparent pixel is in the inpaint mask, so none of their black RGB bleeds into the fill (a dark
    # line along the torso edge, seen in out/context_2x.png); only the hole gets alpha
    src_rgb = wave[..., :3].copy()        # the full wave body around the hole, not the zeroed patch
    # the fill is pulled toward each row's own shirt shade just inside the line (the flank is darker than the
    # chest; one light median for all rows left a flat light strip down the side, seen on out/context_2x)
    rows_rgb = np.zeros((sh[0], 3), np.float32)
    ref = torso_shirt_rgb(wave).astype(np.float32)
    for y in range(sh[0]):
        x0 = int(lines["left"][y])
        win = wave[y, max(0, x0 - 18):max(1, x0 - 9)]
        ok = (win[:, 3] > 200) & shirt_white(win[None])[0]
        rows_rgb[y] = np.median(win[ok, :3], 0) if ok.sum() >= 3 else ref
    rows_rgb = ndi.uniform_filter1d(rows_rgb, 9, axis=0)
    fillc = np.broadcast_to(rows_rgb[:, None, :], wave.shape[:2] + (3,)).round().astype(np.uint8)
    edge_fill = (region & ~inside) | dilate(wave_arm, 2)
    src_rgb[edge_fill] = fillc[edge_fill]
    rgb = cv2.inpaint(np.ascontiguousarray(src_rgb), (hole | ((wave[..., 3] < 128) & dilate(hole, 12))).astype(np.uint8), 7, cv2.INPAINT_TELEA)
    patch[..., :3] = np.where(hole[..., None], rgb, patch[..., :3])
    patch[..., 3] = np.where(hole, 255, patch[..., 3])
    S = AMAP["scale"] * EXPORT
    ox, oy = tp["restPos1x"]
    Mx = np.float32([[S, 0, (AMAP["ox"] - ox) * EXPORT], [0, S, (AMAP["oy"] - oy) * EXPORT]])
    size = (torso.shape[1], torso.shape[0])
    small = B.warp_rgba(patch, np.float64(Mx), size)
    reg_small = cv2.warpAffine(region.astype(np.float32), Mx, size, flags=cv2.INTER_AREA) > 0.5
    # inside the region the patch goes OVER the art torso: its edge is soft after the warp (the patch is
    # zeroed outside the region), and a plain copy left a see-through line along the band's inner edge
    # elsewhere in the region it replaces the torso (that removes the art torso's sleeve flap)
    ov = unpremul(premul(small) + premul(torso) * (1 - premul(small)[..., 3:4]))
    deep = cv2.warpAffine((region & (X < lines["left"][Y] - 2)).astype(np.float32), Mx, size, flags=cv2.INTER_AREA) > 0.5
    out = torso.copy()
    out[reg_small] = small[reg_small]
    out[deep] = ov[deep]
    # right armhole: the shirt runs ARMHOLE reach under the right sleeve too (rightArm.rest is cut 4 px clear
    # of the seam). The master's own pixels there, with a 2 px soft outer edge; the art torso stays on top
    mr = reg["rest"]
    lr = lines["right"][Y]
    band = (np.clip((X - (lr - ARMHOLE["right"]["reach"])) / 2.0, 0, 1) * np.clip((ARMHOLE["right"]["y_max"] - Y) / 6.0, 0, 1)
            * (X <= lr + 4) * (Y > 250))
    pr = mr.copy()
    pr[..., 3] = (mr[..., 3] * band).round().astype(np.uint8)
    under = premul(B.warp_rgba(pr, np.float64(Mx), size))
    top = premul(out)
    out = unpremul(top + under * (1 - top[..., 3:4]))
    # the art torso carries strips of skirt edge below the hem line, left over from its own cut; the shirt is
    # one piece, so only the largest component stays
    out = drop_islands(out, max_px=6000)
    islands_art = faint_islands(torso)
    out = drop_faint_islands(out)
    save(patch, WORK / "torso_patch_master.png")
    fn = "torso__noLeftSleeve.png"
    save(out, PARTS / fn)
    return {"torso.noLeftSleeve": {"file": f"parts/{fn}", "bone": "torso", "size": list(size), "pivot": tp["pivot"],
                                   "tip": tp["tip"], "restPos1x": tp["restPos1x"], "z": tp["z"],
                                   "source": "art torso part; the rest left arm's area refilled from the wave key (arm up, "
                                             "flank visible) and shirt-inpainted under the shoulder, out to 14 master px "
                                             "past the left armhole line; the master's own shirt 14 px under the right "
                                             "sleeve; specks under 32 px removed",
                                   "replaced_px_2x": int(reg_small.sum()), "inpainted_px_master": int(hole.sum()),
                                   "art_torso_islands_under_32px_removed": islands_art}}


ART_LIMB = {"leftArm": ("leftUpperArm", "leftForearm", "leftHand"), "rightArm": ("rightUpperArm", "rightForearm", "rightHand"),
            "leftLeg": ("leftThigh", "leftShin", "leftShoe"), "rightLeg": ("rightThigh", "rightShin", "rightShoe")}
# the rest variant of each art bone that has variants; the other dotted names are key poses of the old rigid arm
ART_REST_VARIANT = {"leftForearm": "leftForearm.f_rest", "leftHand": "leftHand.grip", "rightHand": "rightHand.relaxed"}
LIGHT_BG, DARK_BG = (0xF0, 0xF0, 0xF0), (0x10, 0x14, 0x1F)
# declared background gaps, 4x px: the ponytail/neck gap, the
# hand-on-hip loop of the rest arm, the gap between the right hand's fingers; each confirmed on the sheets
GAPS_4X = {"ponytail": [272, 180], "hip_loop": [353, 426], "right_fingers": [70, 714]}
# per-key background gaps that a pose encloses, each looked at on out/context_4x_*.png
GAPS_KEY_4X = {"tuck": {"between raised forearm, head and hanging strand": [290, 210],
                        "same gap above a hair strand (1x)": [293, 152]},
               "happy": {"between raised forearm and upper arm, closed by the fist": [349, 292]},
               # each view draws its own strands: the gap between the ponytail, a face-framing strand and the
               # jaw (the rest frame's 'ponytail' gap) moves with the turn
               "head.yawm12": {"ponytail gap": [266, 171], "ponytail gap, lower part": [271, 185],
                               "ponytail gap (1x)": [265, 168], "wisps over the ponytail gap": [280, 185]},
               "head.yawp12": {"ponytail gap": [272, 180], "ponytail gap (1x)": [268, 191],
                               "wisps over the ponytail gap": [280, 191]},
               "drag": {"between dangling left arm and flank": [320, 460]},
               "land": {"between the rest right arm, the skirt and the bent right thigh": [111, 556],
                        "same gap (1x)": [110, 556]}}


def art_hip_1x(limb: str) -> np.ndarray:
    """The art rig's thigh pivot in the 1x frame: where the rig puts a leg piece's H."""
    p = PARTS_ART["parts"]["leftThigh" if limb == "leftLeg" else "rightThigh"]
    return np.array(p["restPos1x"]) + np.array(p["pivot"]) / EXPORT


def compose(layers, size=(139, 340)) -> np.ndarray:
    """Premultiplied 'over' of (z, rgba_2x, pos1x) layers in z order on a transparent 2x canvas. Returns the
    premultiplied float canvas (0..1). pos1x is rounded to whole 2x pixels."""
    acc = np.zeros((size[1] * int(EXPORT), size[0] * int(EXPORT), 4), np.float32)
    for _, img, pos in sorted(layers, key=lambda t: t[0]):
        x, y = int(round(pos[0] * EXPORT)), int(round(pos[1] * EXPORT))
        h, w = img.shape[:2]
        x0, y0, x1, y1 = max(0, x), max(0, y), min(acc.shape[1], x + w), min(acc.shape[0], y + h)
        if x1 <= x0 or y1 <= y0:
            continue
        s = img[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32) / 255
        a = s[..., 3:4]
        d = acc[y0:y1, x0:x1]
        d[..., :3] = s[..., :3] * a + d[..., :3] * (1 - a)
        d[..., 3:4] = a + d[..., 3:4] * (1 - a)
    return acc


def from_premul(acc: np.ndarray) -> np.ndarray:
    a = acc[..., 3:4]
    rgb = np.where(a > 1e-6, acc[..., :3] / np.maximum(a, 1e-6), 0)
    return (np.concatenate([rgb, a], -1) * 255).round().clip(0, 255).astype(np.uint8)


def to_4x_1x(acc2: np.ndarray) -> tuple:
    """4x = Lanczos upscale of the premultiplied 2x canvas, 1x = its area downscale."""
    acc4 = cv2.resize(acc2, (556, 1360), interpolation=cv2.INTER_LANCZOS4).clip(0, 1)
    acc4[..., :3] = np.minimum(acc4[..., :3], acc4[..., 3:4])
    return from_premul(acc4), from_premul(cv2.resize(acc2, (139, 340), interpolation=cv2.INTER_AREA))


def frame_gates(acc2: np.ndarray, declared: dict, hands4: list, art_masks: dict | None) -> tuple:
    """The frozen consistency checker's own see-through and hole/island tests (imported read-only) on one
    assembled frame, plus the frame margin. declared: {why: [x, y]} background gaps in 4x px, each confirmed
    by eye. hands4: (W, T) of each hand in 4x px; a hole or see-through spot whose centre lies within 0.8 hand
    lengths of that bone (0.6) is listed as a finger gap (checked by eye on the 4x sheet). art_masks: the same tests
    on a frame made of the art lever's rest parts only; a spot that is half inside one of those is listed as
    inherited from the art parts (fixed in the art lever), not as a key-pose defect."""
    f4, f1 = to_4x_1x(acc2)

    def in_hand(pt):
        for w, t in hands4:
            w, t = np.asarray(w, float), np.asarray(t, float)
            L = max(np.linalg.norm(t - w), 1.0)
            u = np.clip(np.dot(np.asarray(pt) - w, t - w) / L ** 2, 0, 1.25)
            if np.linalg.norm(np.asarray(pt) - (w + u * (t - w))) < 0.6 * L:
                return True
        return False
    allowed = list(declared.values())
    st0, _ = CONS.see_through(f4, allowed)
    h40 = CONS.holes_islands(f4, "4x", allowed)
    res = {"declared_gaps_4x": declared, "finger_gaps_4x": [], "inherited_from_art_4x": []}
    for c in [c for c in st0 if not c["allowed"]] + [h for h in h40[0] if not h["allowed"]]:
        x, y = int(round(c["at"][0])), int(round(c["at"][1]))
        if art_masks is not None and art_masks["any"][min(y, 1359), min(x, 555)]:
            res["inherited_from_art_4x"].append(c)
            allowed.append(c["at"])
        elif in_hand(c["at"]):
            res["finger_gaps_4x"].append(c)
            allowed.append(c["at"])
    st, st_mask = CONS.see_through(f4, allowed)
    res["see_through_4x"] = [c for c in st if not c["allowed"]]
    marks = st_mask.copy()
    for sc, f in (("4x", f4), ("1x", f1)):
        holes, isl, hmask, imask, _ = CONS.holes_islands(f, sc, allowed)
        res[f"holes_{sc}"] = [h for h in holes if not h["allowed"]]
        res[f"islands_{sc}"] = isl
        if sc == "4x":
            marks |= hmask | imask
    a1 = f1[..., 3] > 0
    ys, xs = np.nonzero(a1)
    res["margin_px_1x"] = {"left": int(xs.min()), "right": int(138 - xs.max()), "top": int(ys.min()), "bottom": int(339 - ys.max())}
    # top margin is reported, not gated: the art rest frame's head top sits at row 1 and the rig moves the whole
    # skeleton 9 px down, so a view whose hair starts at row 0 here is not cut in the rig
    res["pass"] = not (res["see_through_4x"] or res["holes_4x"] or res["holes_1x"] or res["islands_4x"] or res["islands_1x"]
                       or min(res["margin_px_1x"]["left"], res["margin_px_1x"]["right"]) < 2)
    return res, f1, f4, marks


def art_masks_of(acc2: np.ndarray) -> dict:
    """See-through pixels of a frame built from the art lever's parts only, widened 4 px (4x). Its holes are
    not used: the rest hand-on-hip loop is one, and a key that moves the arm must close it."""
    f4, _ = to_4x_1x(acc2)
    _, st = CONS.see_through(f4, [])
    return {"any": ndi.binary_dilation(st, iterations=4), "see_through_px": int(st.sum())}


def art_layers(skip_bones=(), head=True, torso_part=None):
    """The art lever's rest parts (rest variants of the arm bones), minus the bones in skip_bones."""
    art = PARTS_ART["parts"]
    out = []
    for name, m in art.items():
        if "error" in m or m["bone"] in skip_bones or name.startswith("face") or name.startswith("head."):
            continue
        if m["bone"] in ART_REST_VARIANT:
            if name != ART_REST_VARIANT[m["bone"]]:
                continue
        elif "." in name:
            continue
        if m["bone"] in ("head", "frontHair") and not head:
            continue
        f = torso_part if (name == "torso" and torso_part is not None) else ART / "out" / m["file"]
        out.append((m["z"], np.array(Image.open(f).convert("RGBA")), m["restPos1x"]))
    if head:
        for name in ("face.eyes.open", "face.mouth.rest"):
            m = art[name]
            out.append((m["z"], np.array(Image.open(ART / "out" / m["file"]).convert("RGBA")), m["restPos1x"]))
    return out


def in_context(parts) -> dict:
    """Every key and every head view assembled with the art lever's rest parts the way the rig places them:
    art parts at their restPos1x in z order (rest variants of the old arm bones), torso.noLeftSleeve as the
    torso, rightArm.rest where a key draws no right arm, the continuous key-pose limbs in place of the art's
    arm and leg bones. Leg pieces go with H on the art rig's thigh pivot (the rig maps H there; the pelvis
    drop of land is the same as raising the legs by it). Each frame is gated with the consistency checker's
    see-through and hole/island tests and the frame margin; sheets over light and dark at 1x and 2x, and a 4x
    sheet over magenta with every flagged pixel in cyan."""
    tpart = OUT / parts["torso.noLeftSleeve"]["file"]
    rd = lambda n: np.array(Image.open(OUT / parts[n]["file"]).convert("RGBA"))
    keys = {}
    for pname, p in parts.items():
        if "key" in p:
            keys.setdefault(p["key"], []).append(pname)
    frames, frame_limbs, frame_pos = {}, {}, {}
    for key, pnames in keys.items():
        limbs = {parts[n]["limb"]: n for n in pnames}
        limbs.setdefault("rightArm", "rightArm.rest")
        frame_limbs[key], frame_pos[key] = limbs, {}
        layers = art_layers({b for l in limbs for b in ART_LIMB[l]}, torso_part=tpart)
        for l, n in limbs.items():
            pos = np.array(parts[n]["restPos1x"], float)
            if l.endswith("Leg"):
                pos = art_hip_1x(l) - np.array(parts[n]["bones"]["H"]) / EXPORT
            frame_pos[key][l] = pos.tolist()
            layers.append((parts[n]["z"], rd(n), pos.tolist()))
        frames[key] = layers
    for vn, p in parts.items():
        if vn.startswith("head.") and not vn.endswith("codexGlasses"):
            layers = art_layers(set(ART_LIMB["leftArm"] + ART_LIMB["rightArm"]), head=False, torso_part=tpart)
            layers += [(parts[n]["z"], rd(n), parts[n]["restPos1x"]) for n in ("leftArm.rest", "rightArm.rest")]
            frame_limbs[vn] = {"leftArm": "leftArm.rest", "rightArm": "rightArm.rest"}
            frame_pos[vn] = {l: parts[n]["restPos1x"] for l, n in frame_limbs[vn].items()}
            layers.append((p["z"], rd(vn), p["restPos1x"]))
            frames[vn] = layers
    art_rest = art_masks_of(compose(art_layers()))
    info, tiles = {"_art_rest_frame": {k: v for k, v in art_rest.items() if k != "any"}}, {"1x": [], "2x": [], "4x": []}
    for key, layers in frames.items():
        acc2 = compose(layers)
        declared = {k: v for k, v in GAPS_4X.items() if k in ("ponytail", "right_fingers")}
        if key == "rest" or key.startswith("head."):
            declared["hip_loop"] = GAPS_4X["hip_loop"]
        declared.update(GAPS_KEY_4X.get(key, {}))
        hands = []
        for l, n in (frame_limbs.get(key) or {}).items():
            if l.endswith("Arm"):
                pos, bo = np.array(frame_pos[key][l]), parts[n]["bones"]
                hands.append([(pos * 4 + np.array(bo[j]) * 4 / EXPORT).tolist() for j in ("W", "T")])
        # head views keep the art head's hair out of the comparison: their own hair belongs to the view
        res, f1, f4, marks = frame_gates(acc2, declared, hands, None if key.startswith("head.") else art_rest)
        info[key] = res
        c2 = from_premul(acc2)
        save(c2, WORK / f"context_{key}.png")
        for bg in (LIGHT_BG, DARK_BG):
            tiles["1x"].append((key, over(f1, bg)))
            tiles["2x"].append((key, over(c2, bg)))
        mk = over(f4, (255, 0, 255)).copy()
        mk[marks] = (0, 255, 255)
        tiles["4x"].append((key, mk))
    for k, per in (("1x", 14), ("2x", 14), ("4x", 6)):
        t = tiles[k]
        for i in range(0, len(t), per):
            sheet(t[i:i + per], OUT / f"context_{k}_{i // per}.png", opaque=True)
    info["_all_pass"] = all(v["pass"] for k, v in info.items() if not k.startswith("_"))
    return info


def harness_views() -> dict:
    """The frozen likeness harness on each view close-up (both glasses variants), run through its own
    CLI. A turned or raised head fails the frontal geometry ratios by construction; read palette and rim."""
    import subprocess
    res = {}
    for f in sorted(WORK.glob("view_*_*.png")):
        tag = f.stem
        outd = WORK / "harness" / tag
        r = subprocess.run([sys.executable, str(ART.parent / "harness" / "likeness.py"), "--ref", str(A.REF),
                            "--cand", str(f), "--out", str(outd)], capture_output=True)
        if r.returncode not in (0, 1):
            res[tag] = {"crashed": r.stderr[-300:].decode(errors="replace")}
            continue
        m = json.loads((outd / "metrics.json").read_text())
        res[tag] = {"ran": m["summary"]["metrics_ran"], "failed": m["summary"]["failed_ids"],
                    "values": {x["id"]: round(x["value"], 4) if isinstance(x.get("value"), float) else x.get("value")
                               for x in m["metrics"]}}
    return res


def proofs(reg, parts):
    """Sheets: each key's limbs on a grey card at 2x app scale, and full-res zooms of every limb."""
    tiles = []
    for pname, p in parts.items():
        im = np.array(Image.open(OUT / p["file"]).convert("RGBA"))
        im2 = cv2.resize(im, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        tiles.append((pname.replace("leftArm.", "L.").replace("rightArm.", "R.").replace("Leg.", "Lg."), im2))
    rows = [tiles[i:i + 8] for i in range(0, len(tiles), 8)]
    for i, r in enumerate(rows):
        sheet(r, OUT / f"limbs_4x_{i}.png")
    for pname in parts:
        f = WORK / f"limb_{pname}.png"
        if f.exists():
            im = np.array(Image.open(f).convert("RGBA"))
            a = im[..., 3] > 0
            ys, xs = np.nonzero(a)
            crop = im[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            Image.fromarray(over(crop, (60, 60, 64))).save(WORK / f"zoom_{pname}.png")


if __name__ == "__main__":
    main()

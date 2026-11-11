"""Rebuild the parts set for the layered2d rig from stored source PNGs.

Inputs:
  src/master.png, face_hd.png, face_{smile,blink,talk}.png, raise.png, wave.png   look B sources
  src/{tuck,think,talk,happy,sleep}.png    left-arm keys (edits of master)
  src/head_yaw12.png, head_pitch15.png     head views (edits of face_hd, glasses removed)
  gen/head_box.json, gen/joints.json       head box; joints read off zoomed grids (keyposes/grid.py)
Outputs: out/parts/*.png, out/parts.json, out/*.png proof sheets, out/metrics.json.
Usage: <tools/skins/ai2d/.venv python> run.py

b_r1.py is the look B pipeline, used as a library; its globals are pointed at this folder. Everything that
differs from it is in this file.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

# cv2's threaded remap/warpAffine gives the leg frames pixel differences between runs (up to 17/255 at the
# right knee); one thread makes every output byte-reproducible
cv2.setNumThreads(1)
from PIL import Image, ImageDraw
from skimage.color import deltaE_ciede2000

HERE = Path(__file__).resolve().parent
SRC, GEN, OUT, WORK = HERE / "src", HERE / "gen", HERE / "out", HERE / "work"
PARTS = OUT / "parts"
REF = HERE.parents[3] / "references" / "character" / "face-reference.png"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "harness"))
import b_r1 as B  # noqa: E402

LK = B.LK
B.HERE, B.SRC, B.GEN = WORK / "b", SRC, GEN
B.ART = WORK / "b" / "artifacts"
B.LAYERS, B.IDLE, B.WAVE_DIR = B.ART / "layers", B.ART / "idle", B.ART / "wave_seq"
B.REF = REF
B.HB = json.loads((GEN / "head_box.json").read_text())
HB = B.HB
JOINTS = json.loads((GEN / "joints.json").read_text()) if (GEN / "joints.json").exists() else {}

lab, from_lab, over, save, smooth = B.lab, B.from_lab, B.over, B.save, B.smooth
premul, unpremul, dilate, erode, feather = B.premul, B.unpremul, B.dilate, B.erode, B.feather

# Glasses wire: a 2.4 px light core over a 3.4 px mid-grey line. A darker or wider edge line
# (92/4.6+2.4, 92/5.2+1.8, 122/3.8+0.9, 108/4.0+2.4) breaks the frozen harness's rim fit on the shipped
# head (rim -18..+22 %), because its ridge filter locks onto the light core; only this setting passes.
GLASSES_DARK, GLASSES_LIGHT = (138, 140, 146), (228, 229, 234)
GLASSES_W = (3.4, 2.4)
# Temples: a light grey a little above b_r1's 138, alpha 0.9 / 0.45, so they never read as part of the rim.
GLASSES_TEMPLE = (150, 153, 160)
# Iris hold-out target: the iris moves slightly toward the reference chroma. On holdout() (brighter half of
# the harness iris annulus) the reference reads L 23.0 / C 7.3 / h 87 and the b_r1 face L 29.8 / C 4.1 / h 50:
# +6 L, half the chroma. Target: most of the way in hue, part of the way in L and C.
IRIS_TARGET = {"L": 25.5, "C": 6.3, "h": 82.0}


# ------------------------------------------------------------------ hold-out colour

def holdout(rgb: np.ndarray, kp: dict) -> dict:
    """Brighter half (L >= region median) of each harness region, median L / C / hue. The brighter half
    is a sample the harness grade does not aim at, so it shows colour the grade can hide."""
    Lb = LK.lab_of(rgb)
    _, regs = LK.palette(rgb, Lb, kp)
    out = {}
    for k in ("hair", "skin", "iris", "lips"):
        m = regs[k][0]
        v = Lb[m]
        if len(v) < 10:
            out[k] = None
            continue
        v = v[v[:, 0] >= np.median(v[:, 0])]
        med = np.median(v, 0)
        out[k] = {"L": round(float(med[0]), 2), "C": round(float(np.hypot(med[1], med[2])), 2),
                  "h": round(float(np.degrees(np.arctan2(med[2], med[1]))), 1)}
    return out


_fit_grade_r1 = B.fit_grade


def fit_grade(rgba, W, kp, ref_cols, rounds=4):
    """b_r1's closed loop on the harness medians, then the iris alone toward IRIS_TARGET on the hold-out
    sample (a sample the harness grade does not aim at). Hue rotation is allowed here because the target hue
    is the reference's brighter-half hue, not the near-neutral median that turns irises green."""
    params, log = _fit_grade_r1(rgba, W, kp, ref_cols, rounds)
    if "iris" in W:
        for _ in range(5):
            h = holdout(over(B.apply_grade(rgba, W, params)), kp)["iris"]
            params["iris"][0] *= IRIS_TARGET["L"] / h["L"]
            params["iris"][1] += (IRIS_TARGET["h"] - h["h"] + 180) % 360 - 180
            params["iris"][2] *= IRIS_TARGET["C"] / max(h["C"], 0.3)
        log.append({"iris_holdout": holdout(over(B.apply_grade(rgba, W, params)), kp)["iris"]})
    return params, log


B.fit_grade = fit_grade


# ------------------------------------------------------------------ fuller jaw (deterministic warp)

def oval_profile(L: np.ndarray, ts) -> tuple:
    kp = LK.keypoints_from_mesh(L)
    d = LK.derived(kp)
    w, mid = [], []
    for t in ts:
        l, r = LK.oval_edges_at(L, d["eye_y"] + t * d["h"])
        w.append((r - l) / d["fw"]); mid.append((l + r) / 2)
    return np.array(w), np.array(mid), d


JAW_T = np.array([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99])
_jaw = {}


def jaw_maps(shape, L: np.ndarray, k: float):
    """Replaces b_r1's eye_maps (which it called with k = 1, the identity). Inverse maps that push the
    lower face outline out to the reference's width profile (oval width over face width at heights
    t = (y - eye line) / (chin - eye line)). Only a band around the outline moves; the face centre, so
    the mouth and nose, stays put, and the chin keeps its height (face height feeds nose-to-mouth)."""
    ref_w = _jaw["ref_w"]
    our_w, mid, d = oval_profile(L, JAW_T)
    gain = np.clip(ref_w / our_w, 1.0, 1.25)
    Y, X = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    t = (Y - d["eye_y"]) / d["h"]
    tw = smooth((t - 0.30) / 0.2) * (1 - smooth((t - 1.0) / 0.12))
    tc = np.clip(t, JAW_T[0], JAW_T[-1])
    g = np.interp(tc, JAW_T, gain)
    hw = np.interp(tc, JAW_T, our_w) * d["fw"] / 2
    m = np.interp(tc, JAW_T, mid)

    def disp(x):
        u = np.abs(x - m) / np.maximum(hw, 1.0)
        prof = smooth((u - 0.45) / 0.5) * (1 - smooth((u - 1.35) / 0.55))
        return np.sign(x - m) * (g - 1) * hw * prof * tw
    xs = X - disp(X - disp(X))
    _jaw["gain"] = dict(zip([float(v) for v in JAW_T], [round(float(v), 4) for v in gain]))
    return xs, Y


B.eye_maps = jaw_maps


# ------------------------------------------------------------------ glasses

def column_fill(rgb: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """Fill hole pixels by interpolating each column between the nearest known pixels above and below.
    Hair strands here run roughly vertically, so this keeps their stripes; TELEA smears them into a
    smudge at the hinge."""
    out = rgb.astype(np.float32).copy()
    H = hole.shape[0]
    for x in np.nonzero(hole.any(0))[0]:
        col = hole[:, x]
        ys = np.nonzero(col)[0]
        runs = np.split(ys, np.nonzero(np.diff(ys) > 1)[0] + 1)
        for r in runs:
            a, b = r[0] - 1, r[-1] + 1
            if a < 0 or b >= H:
                continue
            t = ((r - a) / (b - a))[:, None]
            out[r, x] = out[a, x] * (1 - t) + out[b, x] * t
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def draw_glasses_e(rgba, lenses: dict, kp: dict, temples=True) -> np.ndarray:
    """Thin clear-silver frame, 4x supersampled: a dark edge line under a light core on each rim (ellipse
    per lens, so turned head views foreshorten them), a bridge arc, short temples into the hair."""
    S = 4
    sh = rgba.shape[:2]
    acc = np.zeros((sh[0] * S, sh[1] * S, 4), np.float32)

    def stroke(draw, col, width, alpha=1.0):
        m = np.zeros(acc.shape[:2], np.uint8)
        draw(m, max(1, int(round(width * S))))
        f = (m.astype(np.float32) / 255 * alpha)[..., None]
        acc[...] = np.concatenate([np.array(col, np.float32) / 255 * f, f], -1) + acc * (1 - f)

    d = LK.derived(kp)
    (lx, ly, lrx, lry), (rx_, ry_, rrx, rry) = lenses["l"], lenses["r"]
    bridge_y = (ly + ry_) / 2 - 0.30 * (lry + rry) / 2
    ends = {}
    for q, (cx, cy, rx, ry) in lenses.items():
        dx = rx * float(np.sqrt(max(1 - ((bridge_y - cy) / ry) ** 2, 0.01)))
        ends[q] = (cx + dx, cx - dx) if q == "l" else (cx - dx, cx + dx)
    xl, xr = ends["l"][0], ends["r"][0]
    rr = (lry + rry) / 2
    arc = np.array([(xl + (xr - xl) * t, bridge_y - 0.06 * rr * np.sin(np.pi * t)) for t in np.linspace(0, 1, 24)])
    ip = lambda a: np.round(np.asarray(a) * S).astype(np.int32)
    for col, wid in ((GLASSES_DARK, GLASSES_W[0]), (GLASSES_LIGHT, GLASSES_W[1])):
        for cx, cy, rx, ry in lenses.values():
            stroke(lambda m, w, c=(cx, cy), a=(rx, ry): cv2.ellipse(m, tuple(ip(c)), tuple(ip(a)), 0, 0, 360, 255, w,
                                                                   cv2.LINE_AA), col, wid)
        stroke(lambda m, w: cv2.polylines(m, [ip(arc)], False, 255, w, cv2.LINE_AA), col, wid * 0.9)
    if temples:
        for q, edge in (("l", kp["face_l"][0] + 0.01 * d["fw"]), ("r", kp["face_r"][0] - 0.01 * d["fw"])):
            x0 = ends[q][1]
            for a, b, al in ((0, 0.6, 0.9), (0.55, 1.0, 0.45)):
                t_ = np.array([(x0 + (edge - x0) * a, bridge_y - 0.04 * rr * a), (x0 + (edge - x0) * b, bridge_y - 0.04 * rr * b)])
                stroke(lambda m, w, t_=t_: cv2.polylines(m, [ip(t_)], False, 255, w, cv2.LINE_AA), GLASSES_TEMPLE, 2.4, al)
    for cx, cy, rx, ry in lenses.values():
        c, a = tuple(ip((cx, cy))), tuple(ip((rx, ry)))
        stroke(lambda m, w, c=c, a=a: cv2.ellipse(m, c, a, 0, 25, 155, 255, w, cv2.LINE_AA), (170, 173, 180), 2.0, 0.55)
        stroke(lambda m, w, c=c, a=a: cv2.ellipse(m, c, a, 0, 200, 275, 255, w, cv2.LINE_AA), (252, 252, 253), 0.9, 0.8)
    lay = cv2.resize(acc, (sh[1], sh[0]), interpolation=cv2.INTER_AREA)
    lay *= feather(rgba[..., 3] > 250, 1.0)[..., None]
    return unpremul(lay + premul(rgba) * (1 - lay[..., 3:4]))


def draw_glasses(rgba, circles, r_new, kp, colours):
    """b_r1's signature, round lenses of radius r_new on the fitted centres."""
    return draw_glasses_e(rgba, {q: (c[0], c[1], r_new, r_new) for q, c in circles.items()}, kp)


B.draw_glasses = draw_glasses


# ------------------------------------------------------------------ step 0: new stance (legs)

# The new stance is built from the one leg the master already draws standing straight and planted (her left, image right):
# that leg, and its mirror about the skirt's centre line for her right leg. Each leg is sheared outward
# about its thigh top so the ankles sit about hip width apart; the shear stops at the ankle, so the shoe
# moves rigidly and its sole stays level. Above the skirt hem every master pixel is kept.
LEG_SPLAY_DEG = {"left": 2.6, "right": 2.9}    # outward lean per leg; unequal so the pair is not a mirror
# toes slightly out: seen from the front a toe turned out swings the shoe's front end outward and
# keeps its sole on the floor, so the shoe's lower half is sheared sideways (rows from its middle down, more
# toward the toe) rather than rotated in the picture plane
TOE_OUT_DEG = {"left": 7.0, "right": 6.0}


def hem_line(k: np.ndarray) -> np.ndarray:
    """Skirt bottom per column (first row of the leg or background below it), 10000 where there is no skirt.
    From the column's first plaid row in 600..960, but not above row 760, the hem is where 12 rows in a row are skin or background (warm plaid pixels class as skin in shorter runs).
    The simpler rule (the lowest plaid-classed pixel) lets shadow in the thigh gap, which classes as plaid,
    push some columns down, so they keep old leg pixels as vertical streaks."""
    C = B.classes(k)
    plaid = C["plaid"] | C["dark"]
    off = C["skin"] | (k[..., 3] < 128)
    hem = np.full(k.shape[1], 10_000)
    for x in range(355, 720):
        col = np.nonzero(plaid[600:960, x])[0]
        if not col.size:
            continue
        y0 = max(600 + int(col[0]), 760)        # below the hand on the hip (skin at y 560..650)
        run = np.convolve(off[y0:1000, x].astype(int), np.ones(12, int), "valid")
        hit = np.nonzero(run == 12)[0]
        hem[x] = y0 + int(hit[0]) if hit.size else 600 + int(col[-1]) + 1
    xs = np.nonzero(hem < 10_000)[0]
    med = hem.copy()
    med[xs] = [np.median(hem[xs][max(0, i - 4):i + 5]) for i in range(len(xs))]     # 9-column median
    return med


def leg_shift(y, y0: float, ya: float, yt: float, deg: float, toe: float):
    """Sideways shift of leg row y: grows linearly from the thigh top y0 to the ankle ya, holds over the
    sock and the shoe's top half, then grows again from yt toward the toe (toe turned out)."""
    return ((np.clip(y, y0, ya) - y0) * np.tan(np.radians(deg)) +
            np.clip(np.asarray(y, np.float32) - yt, 0, None) * np.tan(np.radians(toe)))


def shear_leg(leg: np.ndarray, y0: float, ya: float, yt: float, deg: float, toe: float) -> np.ndarray:
    """leg(x - s(y), y) with s = leg_shift(y)."""
    sh = leg.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    return unpremul(B.remap(premul(leg), X - leg_shift(Y, y0, ya, yt, deg, toe), Y))


def step_legs(M: dict) -> np.ndarray:
    """Writes the new stance into JOINTS["rest"] (legs) and returns the master with it (raw RGB on green)."""
    raw = B.load_rgb("master.png")
    k = B.chroma_key(raw)
    sh = k.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    bg = np.median(raw[k[..., 3] == 0], 0)
    hem = hem_line(k)
    skirt_x = np.nonzero(hem < 10_000)[0]
    # columns beside the skirt take the nearest skirt column's hem (the corner rule below clips what that misses)
    hem_y = np.interp(np.arange(sh[1]), skirt_x, hem[skirt_x])[None, :]
    zone = (k[..., 3] > 0) & (Y >= np.maximum(hem_y, 800)) & ((X > 368) | (Y > 905))
    # below the hem the two old legs are separate blobs (the thigh gap opens at the hem): the straight one
    # is the blob under its ankle
    n, lbl = cv2.connectedComponents(zone.astype(np.uint8), connectivity=4)
    ax, ay = JOINTS["rest_r1"]["leftLeg"]["A"]
    leg = B.cut(k, lbl == lbl[int(ay), int(ax)])
    c = float(skirt_x.min() + skirt_x.max()) / 2
    y0 = float(np.median(hem[skirt_x]))
    ya = float(ay)
    yt = ya + 0.5 * (JOINTS["rest_r1"]["leftLeg"]["T"][1] - ya)      # the shoe's middle row
    new_l = shear_leg(leg, y0, ya, yt, LEG_SPLAY_DEG["left"], TOE_OUT_DEG["left"])
    mx = (2 * c - X).astype(np.float32)
    mirrored = unpremul(B.remap(premul(leg), mx, Y))
    new_r = shear_leg(mirrored, y0, ya, yt, -LEG_SPLAY_DEG["right"], -TOE_OUT_DEG["right"])
    fl, fr = premul(new_l), premul(new_r)
    acc = fl + fr * (1 - fl[..., 3:4])
    # Beside a slanted side seam the hem interpolated into columns outside the skirt sits above the skirt's
    # lowest corner, and the splayed thigh shows there as a skin tab beside the skirt (rows 820..840,
    # x 367..377). Above each side's corner row new leg pixels are kept only inside the master's own
    # silhouette (skirt plus old legs).
    C_ = B.classes(k)
    pl = C_["plaid"] | C_["dark"]
    # (a row counts with 6+ plaid pixels: low-chroma skin classes as plaid in single pixels)
    corner = {"l": max(y for y in range(760, 900) if pl[y, 360:400].sum() >= 6),
              "r": max(y for y in range(760, 900) if pl[y, 640:700].sum() >= 6)}
    corner_y = np.where(X < c, corner["l"], corner["r"])
    allowed = (Y >= hem_y) & ((k[..., 3] > 0) | (Y > corner_y))
    acc *= allowed[..., None].astype(np.float32)
    # canvas: master with everything below the hem set to the background colour (not only the keyed legs:
    # the shadow in the old thigh gap is half green and keyed into thin streaks), except her right hand
    canvas = raw.astype(np.float32) / 255
    erase = (Y >= hem_y) & ((X > 368) | (Y > 905))
    canvas[erase] = bg / 255
    out = acc[..., :3] + canvas * (1 - acc[..., 3:4])
    out = np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)
    keep = Y < hem_y
    assert (out[keep] == raw[keep]).all()
    Cn = B.classes(B.chroma_key(out))
    beside = (Y < corner_y) & (k[..., 3] == 0) & Cn["skin"] & (X > 362) & (Y > 760) & ((X < 400) | (X > 640))
    assert not beside.any(), f"leg skin beside the skirt above its corner: {int(beside.sum())} px"
    save(out, WORK / "master_stance.png")
    # the leg joints go through the same maps: shift leg_shift(y), mirror x -> 2c - x
    sx = lambda y, side: float(leg_shift(y, y0, ya, yt, LEG_SPLAY_DEG[side], TOE_OUT_DEG[side]))
    old = JOINTS["rest_r1"]["leftLeg"]
    JOINTS["rest"]["leftLeg"] = {j: [round(p[0] + sx(p[1], "left"), 1), p[1]] for j, p in old.items()}
    JOINTS["rest"]["rightLeg"] = {j: [round(2 * c - p[0] - sx(p[1], "right"), 1), p[1]] for j, p in old.items()}
    M["stance"] = {"method": "straight left leg + its mirror about the skirt centre, sheared outward to the ankle, "
                             "shoe's lower half sheared outward (toes out)",
                   "mirror_x": round(c, 1), "thigh_top_y": y0, "ankle_y": ya, "toe_shear_from_y": yt,
                   "splay_deg": LEG_SPLAY_DEG, "toe_out_deg": TOE_OUT_DEG, "skirt_corner_y": corner,
                   "beside_skirt_skin_px": int(beside.sum()),
                   "bg_rgb": bg.round(1).tolist(), "erased_px": int(erase.sum()),
                   "px_changed_above_hem": int((out[keep] != raw[keep]).any(-1).sum()),
                   "rest_leg_joints": {k: JOINTS["rest"][k] for k in ("rightLeg", "leftLeg")}}
    return out


# ------------------------------------------------------------------ step 1: face (b_r1's step_face + fixes)

def step_face(M: dict) -> dict:
    ref_info = LK.analyse_face(REF, None, "ref")
    rr = LK.ratios(ref_info)
    ref_ratio, ref_open = rr["glasses_rim_diameter_over_face_width"], rr["eye_opening_over_eye_width"]
    Lref = B.mesh(np.array(Image.open(REF).convert("RGB")))
    _jaw["ref_w"] = oval_profile(Lref, JAW_T)[0]
    raw = B.load_rgb("face_hd.png")
    keyed = B.chroma_key(raw)
    L0 = B.mesh(over(keyed))
    assert L0 is not None, "face mesh failed on face_hd.png"
    kp0 = LK.keypoints_from_mesh(L0)
    lenses0 = B.lens_fit(keyed, kp0)
    gmask, circles = B.glasses_mask(keyed, kp0, lenses0)
    sh = keyed.shape[:2]
    skin_zone = dilate(B.poly_mask(sh, L0[LK.OVAL]), 4)

    def bare_of(k_rgba):
        out = k_rgba.copy()
        out[..., :3] = cv2.inpaint(np.ascontiguousarray(k_rgba[..., :3]), gmask.astype(np.uint8), 5, cv2.INPAINT_TELEA)
        hair_hole = gmask & ~skin_zone
        out[..., :3] = np.where(hair_hole[..., None], column_fill(k_rgba[..., :3], hair_hole), out[..., :3])
        return out
    bare = bare_of(keyed)
    mx, my = B.eye_maps(sh, L0, 1.0)
    squashed = unpremul(B.remap(premul(bare), mx, my))
    d0 = LK.derived(kp0)
    r_new = ref_ratio * d0["fw"] / 2
    hist = [{"r_px": round(float(np.mean([c[2] for c in circles.values()])), 2), "note": "generated frame, circle fit"}]
    for _ in range(2):
        drawn = draw_glasses(squashed, circles, r_new, kp0, None)
        Ld = B.mesh(over(drawn)); kpd = LK.keypoints_from_mesh(Ld)
        pd, _ = fit_grade(drawn, B.face_weights(drawn, Ld), kpd, ref_info["cols"], rounds=3)
        graded = B.apply_grade(drawn, B.face_weights(drawn, Ld), pd)
        kpg = LK.keypoints_from_mesh(B.mesh(over(graded)))
        info = LK.ratios({"kp": kpg, "lenses": {q: dict(v, source="image") for q, v in B.lens_fit(graded, kpg).items()},
                          "fringe_y": None})
        hist.append({"r_px": round(r_new, 2), "rim_rel": round(info["glasses_rim_diameter_over_face_width"] / ref_ratio - 1, 4),
                     "open_rel": round(info["eye_opening_over_eye_width"] / ref_open - 1, 4)})
        r_new *= ref_ratio / info["glasses_rim_diameter_over_face_width"]
    best = min(hist[1:], key=lambda h: abs(h["rim_rel"]))
    r_new = best["r_px"]
    warped = draw_glasses(squashed, circles, r_new, kp0, None)
    save(np.dstack([np.where(gmask[..., None], [255, 0, 255], over(keyed)).astype(np.uint8), keyed[..., 3]]),
         WORK / "glasses_mask.png")
    L = B.mesh(over(warped))
    kp = LK.keypoints_from_mesh(L)
    W = B.face_weights(warped, L)
    params, glog = fit_grade(warped, W, kp, ref_info["cols"])
    face = B.apply_grade(warped, W, params)
    save(face, OUT / "face.png")
    M["face"] = {"source": "src/face_hd.png keyed, glasses painted out (hair by column fill) and redrawn with an edge "
                           "line, lower face warped to the reference width profile, LAB grade + iris hold-out grade",
                 "jaw_gain_by_t": dict(_jaw["gain"]), "ref_width_profile": dict(zip(map(float, JAW_T), _jaw["ref_w"].round(3).tolist())),
                 "glasses": {"radius_iterations": hist, "chosen": best, "dark_light_rgb": [GLASSES_DARK, GLASSES_LIGHT],
                             "widths_px": GLASSES_W},
                 "grade": {"params_kL_rotdeg_kC": {k: [round(x, 4) for x in v] for k, v in params.items()}, "log": glog},
                 "holdout": holdout(over(face), kp),
                 "holdout_ref": holdout(np.array(Image.open(REF).convert("RGB")), LK.keypoints_from_mesh(Lref))}

    def finish(raw_rgb):
        k = unpremul(B.remap(premul(bare_of(B.chroma_key(raw_rgb))), mx, my))
        drawn_v = draw_glasses(k, circles, r_new, kp0, None)
        return B.apply_grade(drawn_v, B.face_weights(drawn_v, L), params)

    regs = B.face_regions(L0, raw.shape[:2])
    out = {"base": face}
    for name in ("smile", "blink", "talk"):
        var = B.load_rgb(f"face_{name}.png")
        patched, shift = B.patch_variant(raw, var, regs[name], 6.0)
        out[name] = finish(patched)
        save(out[name], OUT / f"face_{name}.png")
    return {"L": L, "L0": L0, "kp": kp, "faces": out, "params": params, "ref": ref_info, "regs": regs,
            "lenses": B.lens_fit(face, kp), "r_new": r_new, "circles": circles}


def harness(cand: Path, tag: str, probe: Path | None = None, bodies=()) -> dict:
    """Frozen harness, run as a subprocess with its own CLI."""
    import subprocess
    outd = WORK / "harness" / tag
    cmd = [sys.executable, str(HERE.parent / "harness" / "likeness.py"), "--ref", str(REF), "--cand", str(cand),
           "--out", str(outd)]
    if probe:
        cmd += ["--probe", str(probe)]
    if bodies:
        cmd += ["--body", *map(str, bodies)]
    r = subprocess.run(cmd, capture_output=True)
    assert r.returncode in (0, 1), f"harness crashed on {cand}: {r.stderr[-400:]}"   # 1 = a metric failed
    m = json.loads((outd / "metrics.json").read_text())
    s = m["summary"]
    return {"ran": s["metrics_ran"], "failed": s["failed_ids"],
            "values": {x["id"]: round(x["value"], 4) if isinstance(x.get("value"), float) else x.get("value")
                       for x in m["metrics"]}}


# ------------------------------------------------------------------ geometry helpers

def seg_dist(X, Y, p, q):
    p, q = np.asarray(p, np.float32), np.asarray(q, np.float32)
    v = q - p
    t = np.clip(((X - p[0]) * v[0] + (Y - p[1]) * v[1]) / max(float(v @ v), 1e-6), 0, 1)
    return np.hypot(X - p[0] - t * v[0], Y - p[1] - t * v[1])


def nearest_split(alpha_m: np.ndarray, segs: dict, discs: dict) -> dict:
    """Assign each pixel of alpha_m to its nearest bone segment; a disc at each named joint goes to both
    neighbours, so a bend opens onto drawn skin, never onto a notch."""
    sh = alpha_m.shape
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    D = {k: seg_dist(X, Y, *v) for k, v in segs.items()}
    stack = np.stack(list(D.values()))
    near = np.argmin(stack, 0)
    out = {}
    for i, k in enumerate(D):
        m = alpha_m & (near == i)
        for (c, r, owners) in discs.values():
            if k in owners:
                m |= alpha_m & (np.hypot(X - c[0], Y - c[1]) < r)
        out[k] = m
    return out, D


def register(key_rgb: np.ndarray, master_rgb: np.ndarray):
    """Key -> master affine by ECC on the skirt and legs (rows 620+), which an arm edit leaves alone."""
    g = lambda a: cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    m, k = g(master_rgb), g(key_rgb)
    mask = np.zeros(m.shape, np.uint8); mask[620:, :] = 1
    W = np.eye(2, 3, dtype=np.float32)
    cc, W = cv2.findTransformECC(m, k, W, cv2.MOTION_AFFINE,
                                 (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), mask, 5)
    return W, float(cc)   # maps master coords -> key coords (warp with WARP_INVERSE_MAP)


def to_master(rgba: np.ndarray, W: np.ndarray) -> np.ndarray:
    f = premul(rgba)
    out = cv2.warpAffine(f, W, (f.shape[1], f.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return unpremul(out)


def key_pt(W: np.ndarray, p) -> list:
    """A point read off the key image, in master coordinates."""
    A = np.vstack([W, [0, 0, 1]])
    q = np.linalg.solve(A, [p[0], p[1], 1.0])
    return [float(q[0]), float(q[1])]


def med_lab(rgba, m):
    v = lab(rgba[..., :3])[m]
    return np.median(v, 0) if len(v) else None


# ------------------------------------------------------------------ step 2: source keys (registered, graded)

ARM_KEYS = ["sleep", "tuck", "think", "talk", "happy", "raise", "wave"]
# What each key may contribute. Only parts whose outline sits on background or on a different colour class
# are cut; the rest are covered by other keys (the think fist touches the chin, so the fist comes from happy).
KEY_USE = {"sleep": {"fore": "f_sleep", "hand": "relaxed"}, "tuck": {"fore": "f_tuck", "hand": "tuck"},
           "think": {"fore": "f_think"}, "talk": {"fore": "f_talk", "hand": "open"},
           "happy": {"fore": "f_happy", "hand": "fist"}, "raise": {"fore": "f_raise", "hand": "open_up"},
           "wave": {"fore": "f_wave", "hand": "wave"}}
ARM_R = {"upper": 50, "fore": 36, "hand": 46}


def arm_segments(J):
    S, E, W, T = (np.array(J[k], float) for k in "SEWT")
    Tx = T + 0.22 * (T - W)            # past the fingertip so the nail ends are inside the capsule
    return {"upper": (S, E), "fore": (E, W), "hand": (W, Tx)}, \
           {"elbow": (E, 22, ("upper", "fore")), "wrist": (W, 14, ("fore", "hand"))}


def cut_key_arm(img: np.ndarray, J: dict) -> dict:
    """Forearm and hand of a key: skin-class pixels inside the arm capsules, split by nearest bone."""
    sh = img.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    segs, discs = arm_segments(J)
    a = img[..., 3] > 0
    C = B.classes(img)
    cap = np.zeros(sh, bool)
    for k, (p, q) in segs.items():
        cap |= seg_dist(X, Y, p, q) < ARM_R[k]
    # 1 px of the skin's own edge (mixed with shirt, skirt or background) comes along, no more
    skin = (C["skin"] & cap) | (dilate(C["skin"] & cap, 1) & a & cap & ~C["white"] & ~C["dark"])
    parts, _ = nearest_split(skin, segs, discs)
    return parts


def step_keys(M: dict, H: dict) -> dict:
    master = B.load_rgb_src("master.png")       # the keys are edits of the master: register on its legs
    K = {}
    for name in ARM_KEYS:
        raw = B.load_rgb(f"{name}.png")
        W, cc = register(raw, master)
        img = to_master(H["grade_body"](B.chroma_key(raw)), W)
        J = {k: key_pt(W, v) for k, v in JOINTS[name]["leftArm"].items()}
        K[name] = {"img": img, "J": J, "parts": cut_key_arm(img, J), "ecc": round(cc, 4),
                   "affine_master_to_key": W.round(5).tolist()}
    M["keys"] = {k: {"ecc": v["ecc"], "affine_master_to_key": v["affine_master_to_key"]} for k, v in K.items()}
    return K


# ------------------------------------------------------------------ step 3: rest parts

THIGH_EXT = 45        # master px of skin added above the hem on each thigh (about 20 px at 2x)


def clean_thigh_top(img: np.ndarray, hem_s: np.ndarray, skirt: np.ndarray) -> np.ndarray:
    """Above the hem a raw thigh part holds skirt-shadow and plaid-coloured streaks and a box-cut tab (hidden
    at rest, shown as a striped, jagged thigh top once the leg swings). Rows from the first skin row under the
    hem down are kept as drawn. Above them, where the rest figure covers it, the thigh goes on THIGH_EXT
    rows in the colour of the row 40 below the hem (clear of the skirt's shadow band, which also classes as
    skin), blurred sideways so the columns do not streak, with a soft top edge."""
    sh = img.shape[:2]
    a = img[..., 3]
    cols = np.nonzero((a > 0).any(0))[0]
    out = img.copy()
    y1 = np.minimum(hem_s, sh[0] - 50).astype(int) + 3
    src = np.zeros((sh[1], 4), np.float32)
    for x in cols:
        y = y1[x] + 37
        src[x] = np.r_[img[y, x, :3].astype(np.float32) * (a[y, x] / 255), a[y, x] / 255]
    src = cv2.GaussianBlur(src[None], (0, 0), sigmaX=4, sigmaY=0.01)[0]
    ok = np.nonzero(src[:, 3] >= 0.5)[0]
    if not ok.size:
        return out
    clean = src[ok[np.abs(np.arange(sh[1])[:, None] - ok[None, :]).argmin(1)]]      # edge columns: nearest full one
    clean = clean[:, :3] / clean[:, 3:4]
    sk = B.classes(img)["skin"] & (a > 127)
    for x in cols:
        # the drawn thigh starts at its first skin row within 40 rows of the hem (beside the thigh gap the
        # rows above it are skirt-shadow streaks)
        hit = np.nonzero(sk[y1[x]:y1[x] + 40, x])[0]
        if not hit.size:
            out[:y1[x], x] = 0
            continue
        top = y1[x] + int(hit[0])
        out[:top, x] = 0
        if not skirt[max(0, y1[x] - THIGH_EXT):y1[x] - 3, x].all():
            continue
        ys = np.arange(max(0, y1[x] - THIGH_EXT), top)
        t = smooth((top - ys) / 12.0)[:, None]
        out[ys, x, :3] = np.clip((1 - t) * img[top, x, :3] + t * clean[x] + 0.5, 0, 255).astype(np.uint8)
        out[ys, x, 3] = (a[top:top + 6, x].max() * smooth((ys - (y1[x] - THIGH_EXT)) / 12.0) + 0.5).astype(np.uint8)
    return out


def step_rest_parts(M: dict, F: dict, H: dict, Ly: dict, K: dict) -> dict:
    rest = H["rest"]
    sh = rest.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    L = {k: v.copy() for k, v in Ly["L"].items()}
    C = B.classes(rest)
    JR = JOINTS["rest"]
    P = {}
    # b_r1's layer split ends the skirt at the lowest plaid-classed pixel per column, so thin columns of
    # thigh below the real hem stay on the torso layer and hang as streaks once the legs move: they go
    # back to the legs (hem_line, the same rule step_legs uses)
    hem = hem_line(rest)
    sk = np.nonzero(hem < 10_000)[0]
    hy = np.interp(np.arange(sh[1]), sk, hem[sk])[None, :]
    # The per-column hem dips 10..20 rows at both edges of the thigh gap (its shadow classes as plaid): the
    # pelvis and thigh tops use a hem that ignores dips: no lower than 2 rows under the 41-column median
    # (a low percentile instead cut the skirt's real corner, where the hem steps down by 30 rows).
    hem_s = hy[0].copy()
    hem_s[sk] = np.minimum(hem[sk], [np.median(hem[sk][max(0, i - 20):i + 21]) + 2 for i in range(len(sk))])
    back = (Y >= hy) & (L["torso"][..., 3] > 0) & ((X > 368) | (Y > 905)) & (Y < 1000)
    # (b_r1's extend_up also copies half-transparent edge pixels into those legs columns: the torso
    # pixel wins wherever it is the more opaque one)
    take_t = back & (L["torso"][..., 3] >= L["legs"][..., 3])
    L["legs"][take_t] = L["torso"][take_t]
    L["torso"][back] = 0
    M["legs_from_torso_px"] = int(back.sum())

    # left arm of rest: b_r1's arm_l layer split by bone
    segs, discs = arm_segments(JR["leftArm"])
    sp, _ = nearest_split(L["arm_l"][..., 3] > 0, segs, discs)
    # the sleeve's shoulder end stays with the shirt: farther than 1.15 arm half-widths from the bone in the
    # upper 35 % of the arm, or past the shoulder joint outside a disc of one half-width, the pixels move to
    # the torso layer (identical at rest). Turned down 45 deg for
    # sleep or wave, the whole sleeve corner would otherwise rise above the shoulder as a white triangle.
    S_, E_ = (np.array(JR["leftArm"][k], np.float32) for k in "SE")
    Lb = float(np.linalg.norm(E_ - S_)); v_ = (E_ - S_) / Lb
    t_ = (X - S_[0]) * v_[0] + (Y - S_[1]) * v_[1]
    n_ = np.abs(-(X - S_[0]) * v_[1] + (Y - S_[1]) * v_[0])
    mid = sp["upper"] & (np.abs(t_ - 0.6 * Lb) < 6) & (L["arm_l"][..., 3] > 127)
    r_arm = float(np.percentile(n_[mid], 95)) if mid.any() else 40.0
    shoulder = sp["upper"] & (((t_ < 0.35 * Lb) & (n_ > 1.15 * r_arm)) |
                              ((t_ < 0) & (np.hypot(X - S_[0], Y - S_[1]) > r_arm)))      # sleeve point past the shoulder
    L["torso"][shoulder] = L["arm_l"][shoulder]
    sp["upper"] = sp["upper"] & ~shoulder
    M["shoulder_to_torso_px"] = int(shoulder.sum())
    P["leftUpperArm"] = B.cut(L["arm_l"], sp["upper"])
    P["leftForearm.f_rest"] = B.cut(L["arm_l"], sp["fore"])
    P["leftHand.grip"] = B.cut(L["arm_l"], sp["hand"])
    # right arm
    segs_r, discs_r = arm_segments(JR["rightArm"])
    sp, _ = nearest_split(L["arm_r"][..., 3] > 0, segs_r, discs_r)
    P["rightUpperArm"] = B.cut(L["arm_r"], sp["upper"])
    P["rightForearm"] = B.cut(L["arm_r"], sp["fore"])
    P["rightHand.relaxed"] = B.cut(L["arm_r"], sp["hand"])
    # legs: per side, thigh / shin / shoe by projection on each bone, overlapping by the leg's full width
    # at knee and ankle (round_ends trims the overlaps to round caps). A nearest-bone split with a 30 px
    # knee disc leaves flat ledges beside the disc and straight shin sides, seen as ticks at the knee once
    # the leg bends.
    legs_a = L["legs"][..., 3] > 0
    jj = {s: {k: np.array(v, float) for k, v in JR[f"{s}Leg"].items()} for s in ("right", "left")}
    near = {s: np.minimum.reduce([seg_dist(X, Y, j["H"], j["K"]), seg_dist(X, Y, j["K"], j["A"]), seg_dist(X, Y, j["A"], j["T"])])
            for s, j in jj.items()}
    leg_info = {}
    skirt_m = rest[..., 3] > 127        # the extension only goes where the skirt (or the body) covers it
    for side, j in jj.items():
        on = legs_a & ((near[side] < near["left"]) if side == "right" else (near[side] <= near["right"]))

        def along(p, q):
            v = (q - p) / np.linalg.norm(q - p)
            return (X - p[0]) * v[0] + (Y - p[1]) * v[1], float(np.linalg.norm(q - p))

        def half_w(y):
            xs = np.nonzero(on[int(round(y))])[0]
            return (xs.max() - xs.min() + 1) / 2 if xs.size else 20.0
        t_th, l_th = along(j["H"], j["K"])
        t_sh, l_sh = along(j["K"], j["A"])
        t_sf, _ = along(j["A"], j["T"])
        r_k, r_a = half_w(j["K"][1]) + 2, half_w(j["A"][1]) + 2
        P[f"{side}Thigh"] = clean_thigh_top(B.cut(L["legs"], on & (t_th <= l_th + r_k)), hem_s, skirt_m)
        P[f"{side}Shin"] = B.cut(L["legs"], on & (t_sh >= -r_k) & (t_sh <= l_sh + r_a))
        P[f"{side}Shoe"] = B.cut(L["legs"], on & (t_sf >= -r_a))
        leg_info[side] = {"knee_overlap_r": round(r_k, 1), "ankle_overlap_r": round(r_a, 1)}
    M["leg_split"] = leg_info

    # torso under the resting left arm, below the sleeve: the sleep key shows waist, hip and skirt side with
    # the arm hanging away, but its relaxed hip is narrower than the master's (up to 20 px at the hand's
    # lower edge), which leaves a notch where the two outlines meet. Each fill row is therefore taken from the
    # key stretched sideways so its body edge lands on the master's edge, measured on the rows the hand
    # leaves visible and interpolated across the rows it covers.
    sl = K["sleep"]
    # 8 px past the arm: the fingers cast a soft shadow on the skirt that would otherwise stay as a ghost hand
    arm_m = dilate(L["arm_l"][..., 3] > 0, 8)
    fill = arm_m & (Y >= 440)
    sleep_arm = dilate(np.logical_or.reduce(list(sl["parts"].values())), 3)
    torso = L["torso"].copy()
    torso[fill] = 0
    key = sl["img"].copy()
    key[sleep_arm] = 0
    body_k = key[..., 3] > 127

    def edge(m, y, x0):
        """End of the opaque run that contains x0 in row y (None if x0 is not inside the body)."""
        if not m[y, x0]:
            return None
        gap = np.nonzero(~m[y, x0:])[0]
        return x0 + int(gap[0]) if gap.size else None
    rows = np.nonzero(fill.any(1))[0]
    x_a = {int(y): int(np.nonzero(fill[y])[0].min()) for y in rows}
    e_k = {y: edge(body_k, y, x_a[y]) for y in rows}
    # rows just above and below the fill bracket the hand: the master edge is visible there
    # (a row counts when the master's run from x = 560, inside waist and skirt, ends on background, not on fill)
    d_known, near_fill = {}, dilate(fill, 2)
    for y in range(int(rows.min()) - 30, int(rows.max()) + 30):
        ek, em = edge(body_k, y, 560), edge(torso[..., 3] > 127, y, 560)
        if ek is not None and em is not None and not near_fill[y, em]:
            d_known[y] = em - ek
    ky = np.array(sorted(d_known)); kd = np.array([d_known[y] for y in ky], float)
    mx_, my_ = np.tile(np.arange(sh[1], dtype=np.float32), (sh[0], 1)), Y.copy()
    stretched_rows = 0
    for y in rows:
        if e_k[y] is None:
            continue
        d = float(np.interp(y, ky, kd)) if ky.size else 0.0
        xa, ek = x_a[y], e_k[y]
        et = ek + d
        if et - xa < 4:
            continue
        xs = np.arange(xa, sh[1], dtype=np.float32)
        mx_[y, xa:] = xa + (xs - xa) * (ek - xa) / (et - xa)
        stretched_rows += 1
    warped = unpremul(B.remap(premul(key), mx_, my_))
    take = fill & (warped[..., 3] > 0)
    torso[take] = warped[take]
    ring = dilate(fill, 8) & ~fill & (L["torso"][..., 3] == 255) & (sl["img"][..., 3] == 255)
    a_, b_ = med_lab(L["torso"], ring), med_lab(sl["img"], ring)
    M["torso_fill"] = {"source": "sleep key, each row stretched so its body edge meets the master's",
                       "fill_px": int(fill.sum()), "from_key_px": int(take.sum()), "rows_stretched": stretched_rows,
                       "edge_offset_px_known_rows": {"n": int(ky.size), "min": float(kd.min()) if ky.size else None,
                                                     "max": float(kd.max()) if ky.size else None},
                       "ring_dE_rest_vs_sleep": round(float(deltaE_ciede2000(a_[None], b_[None])[0]), 2)}

    # neck: skin of the torso layer between jaw and collar, moved to its own part (drawn behind torso)
    kpm, d = Ly["kpm"], Ly["d"]
    cx = float(d["mid"][0])
    neck_zone = (np.abs(X - cx) < 0.32 * d["fw"]) & (Y < H["cut_y"] + 60) & (Y > kpm["chin"][1] - 0.6 * d["h"])
    neck = neck_zone & (torso[..., 3] > 0) & dilate(C["skin"], 1) & ~C["white"]
    # collar opening below: the neck continues behind the collar by 25 px
    # The skin class misses highlights and the neck's soft edges, which leaves holes that a head tilt or a
    # head view uncovers (white patches at the collar): the neck is made
    # solid row by row and its gaps inpainted, then continued up behind the jaw so a turned head never
    # opens onto background.
    solid = np.zeros(sh, bool)
    for y in np.nonzero(neck.any(1))[0]:
        xs = np.nonzero(neck[y])[0]
        solid[y, xs.min():xs.max() + 1] = True
    solid = cv2.morphologyEx(solid.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)).astype(bool) & neck_zone
    neck_part = B.inpaint(B.cut(torso, neck), solid & ~neck)
    neck_part = B.extend_up(neck_part[::-1], (np.abs(X - cx) < 0.18 * d["fw"])[::-1] & (Y < H["cut_y"] + 85)[::-1], 25)[::-1]
    neck_part = B.extend_up(neck_part, (np.abs(X - cx) < 0.2 * d["fw"]) & (Y > kpm["chin"][1] - 0.35 * d["h"]), 90)
    torso[neck] = 0
    P["neck"] = neck_part
    # torso / pelvis split at the skirt's top edge; the pelvis keeps 24 px of midriff above it as overlap
    plaid = C["plaid"] & (Y > 520) & (Y < 700)
    top = np.full(sh[1], -1)
    for x in range(sh[1]):
        ys = np.nonzero(plaid[:, x])[0]
        if ys.size > 8:
            top[x] = ys.min()
    xs = np.nonzero(top >= 0)[0]
    top = np.interp(np.arange(sh[1]), xs, cv2.GaussianBlur(top[xs].astype(np.float32)[None], (0, 0), 6)[0])
    waist_y = top[None, :]
    pelvis = B.cut(torso, (torso[..., 3] > 0) & (Y >= waist_y - 24))
    # the dips hang under the hem as a comb once the legs move: the pelvis is clipped to hem_s with a 2 px
    # feather, and small pieces left detached below it (a sliver beside the side seam) are dropped
    # (hem_s alone still leaves teeth 6..8 rows long: the pelvis's own bottom edge is the finer guide, so it is
    # also capped at 2 rows under its 41-column median)
    pa_ = pelvis[..., 3] > 127
    low = np.array([np.nonzero(pa_[:, x])[0].max() if pa_[:, x].any() else -1 for x in range(sh[1])], float)
    lx = np.nonzero((low >= 0) & (np.arange(sh[1]) > 368))[0]
    cap = hem_s.copy()
    cap[lx] = np.minimum(cap[lx], [np.median(low[lx][max(0, i - 20):i + 21]) + 2 for i in range(len(lx))])
    in_skirt = (X >= sk.min()) & (X <= sk.max())
    w = np.where(in_skirt & ((X > 368) | (Y > 905)), 1 - smooth((Y - cap[None, :] + 1) / 2), 1.0)
    pelvis[..., 3] = (pelvis[..., 3] * w + 0.5).astype(np.uint8)
    n_, lbl_, st_, _ = cv2.connectedComponentsWithStats((pelvis[..., 3] > 0).astype(np.uint8), connectivity=8)
    small = np.isin(lbl_, [i for i in range(1, n_) if st_[i, cv2.CC_STAT_AREA] < 400])
    pelvis[small] = 0
    M["pelvis_hem_clip"] = {"px_dropped_below_hem": int(((torso[..., 3] > 0) & (Y >= waist_y - 24) & (w < 0.5)).sum()),
                            "detached_px_dropped": int(small.sum())}
    P["pelvis"] = pelvis
    up = B.cut(torso, (torso[..., 3] > 0) & (Y < waist_y + 2))
    f = premul(up)
    f *= (1 - smooth((Y - (waist_y - 2)) / 4))[..., None]        # soft lower edge over the overlap
    P["torso"] = unpremul(f)
    P["backHair"] = L["back_hair"]
    P["head"] = L["head"]
    P["frontHair"] = L["front_hair"]
    P["head.closed"] = Ly["head_closed"]
    M["split"] = {"waist_y_at_x500": round(float(top[500]), 1), "neck_px": int(neck.sum())}
    return {"P": P, "waist_y": top}


# ------------------------------------------------------------------ step 4: head views and face patches

VIEWS = {"yaw12": "head_yaw12.png", "pitch15": "head_pitch15.png", "pitch15.closed": "head_pitch15_closed.png"}


def view_lenses(F: dict, Lv: np.ndarray) -> dict:
    """Place the rest lenses on a view: each lens keeps its offset from its iris centre (scaled by the
    interocular distance); its width follows that eye's corner-to-corner width and its height the
    eye-to-mouth distance, so a turn or a bow foreshortens the rim as it does the eye."""
    L0 = F["L0"]
    iod0, iodv = np.linalg.norm(L0[473] - L0[468]), np.linalg.norm(Lv[473] - Lv[468])
    vy = lambda L: float(np.linalg.norm((L[13] + L[14]) / 2 - (L[468] + L[473]) / 2))
    ky = vy(Lv) / vy(L0) / (iodv / iod0)
    out = {}
    for q, ic, (a, b) in (("l", 468, (33, 133)), ("r", 473, (362, 263))):
        kx = np.linalg.norm(Lv[a] - Lv[b]) / np.linalg.norm(L0[a] - L0[b])
        s = iodv / iod0
        off = (np.array(F["circles"][q][:2]) - L0[ic]) * s
        kx_rel = kx / s
        out[q] = (float(Lv[ic][0] + off[0] * kx_rel), float(Lv[ic][1] + off[1] * ky),
                  float(F["r_new"] * kx), float(F["r_new"] * s * ky))
    return out


def step_views(M: dict, F: dict, H: dict, Ly: dict) -> dict:
    out, info = {}, {}
    sh = H["rest"].shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    lens_cache = {}
    for name, fn in VIEWS.items():
        keyed = B.chroma_key(B.load_rgb(fn))
        base = name.split(".")[0]
        Lv = B.mesh(over(keyed))
        assert Lv is not None, f"face mesh failed on {fn}"
        mx, my = jaw_maps(keyed.shape[:2], Lv, 1.0)
        warped = unpremul(B.remap(premul(keyed), mx, my))
        Lw = B.mesh(over(warped))
        if base not in lens_cache:          # the closed-eye edit keeps the open view's glasses
            lens_cache[base] = view_lenses(F, Lw)
        drawn = draw_glasses_e(warped, lens_cache[base], LK.keypoints_from_mesh(Lw))
        graded = B.apply_grade(drawn, B.face_weights(drawn, Lw), F["params"])
        save(graded, WORK / f"view_{name}.png")
        # into master space with the face_hd -> master similarity (the views are edits of face_hd on the
        # same canvas; the prompt kept neck and collar fixed), then cut above the neck like the rest head
        full = B.warp_rgba(graded, H["A"], (sh[1], sh[0]))
        Lm = B.apply_affine(H["A"], Lw)
        chin_y = float(Lm[152][1])
        Cv = B.classes(full)
        hairish = dilate(Cv["hair"], 2) & (full[..., 3] > 0) & ~dilate(Cv["white"], 1)
        zone = (X >= HB["x"] - 20) & (X <= HB["x"] + HB["side"] + 20) & (Y < max(chin_y, H["cut_y"]) + 40)
        # white is dropped only near the chin (the collar): above it the white pixels are the glasses rim,
        # and cutting them out leaves the views' rims as see-through dotted rings
        m = zone & (full[..., 3] > 0) & (((Y < chin_y + 4) & ~(Cv["white"] & (Y > chin_y - 30))) | hairish)
        out[name] = B.cut(full, m)
        kpv = LK.keypoints_from_mesh(Lw)
        info[name] = {"source": f"src/{fn}", "lenses_px": {q: [round(v, 1) for v in t] for q, t in lens_cache[base].items()},
                      "jaw_gain_by_t": dict(_jaw["gain"]), "holdout": holdout(over(graded), kpv),
                      "chin_y_master": round(chin_y, 1),
                      "nose_shift_vs_rest_px_master": [round(float(v), 1) for v in
                                                       (Lm[1] - B.apply_affine(H["A"], F["L"])[1])]}
    M["views"] = info
    return out


def step_face_patches(M: dict, F: dict, H: dict, Ly: dict) -> dict:
    """Eyes and mouth as small patches for the rest view: the rig lays them over the head part (blink,
    smile, talk); a half blink is the closed patch at half alpha."""
    regs = F["regs"]
    sh = H["rest"].shape[:2]
    out = {}
    head_a = Ly["L"]["head"][..., 3] > 0
    for pname, (variant, reg) in {"eyes.open": ("base", "blink"), "eyes.closed": ("blink", "blink"),
                                  "mouth.rest": ("base", "talk"), "mouth.smile": ("smile", "smile"),
                                  "mouth.talk": ("talk", "talk")}.items():
        full = H["hybrid"](F["faces"][variant])
        r = B.warp_rgba(np.dstack([np.zeros(regs[reg].shape + (3,), np.uint8),
                                   (feather(dilate(regs[reg], 10), 5) * 255).astype(np.uint8)]), H["A"], (sh[1], sh[0]))
        f = premul(full)
        f *= (r[..., 3:4].astype(np.float32) / 255) * head_a[..., None]
        out[pname] = unpremul(f)
    return out


# ------------------------------------------------------------------ step 5: assemble, export, prove

# each shin under its thigh (the thigh's round knee cap covers the shin's top) and under its shoe (the shoe's
# collar covers the sock's end)
Z = {"backHair": 0, "rightShin": 1, "rightThigh": 2, "rightShoe": 3, "leftShin": 4, "leftThigh": 5, "leftShoe": 6,
     "neck": 7, "pelvis": 8, "torso": 9, "rightUpperArm": 10, "rightForearm": 11, "rightHand": 12,
     "leftUpperArm": 13, "leftForearm": 14, "leftHand": 15, "head": 16, "frontHair": 17, "face": 18}
HAND_AT_HEAD_Z = Z["head"] + 0.5
SPEC_FILL_PX = 0.955 * 340            # motion spec: rest fills 95.5 % of the 139x340 frame (MOTION_SPEC.md §6)
EXPORT = 2.0                          # parts are stored at 2x app scale (the spec's limb check is at 2x)
LADDER = [1.0, 0.64, 0.41, 0.26]


def bone_of(name: str) -> str:
    return name.split(".")[0]


# Joint ends drawn as round caps (centre at the joint, radius the limb's half-width there): the nearest-bone
# split leaves a straight cut at elbow, wrist, knee and ankle that shows as a square stump once the joint
# bends (wave in-betweens). A cap turns with its part about the joint centre, so a bend never shows a cut.
ROUND_ENDS = {"UpperArm": "q", "Forearm": "pq", "Hand": "p", "Thigh": "q", "Shin": "pq", "Shoe": "p"}


def round_ends(img: np.ndarray, p, q, ends: str) -> np.ndarray:
    a = img[..., 3] > 127
    if not a.any():
        return img
    ys, xs = np.nonzero(img[..., 3] > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    p, q = np.asarray(p, np.float32), np.asarray(q, np.float32)
    L = float(np.linalg.norm(q - p)); v = (q - p) / max(L, 1e-6)
    t = (X - p[0]) * v[0] + (Y - p[1]) * v[1]
    n = np.abs(-(X - p[0]) * v[1] + (Y - p[1]) * v[0])
    w = np.ones(t.shape, np.float32)
    aa = a[y0:y1, x0:x1]
    for e in ends:
        # radius: the limb's half-width 15 % in from the joint (the joint itself is bulky where it was bent)
        c, tc, beyond = (p, 0.15 * L, t < 0) if e == "p" else (q, 0.85 * L, t > L)
        band = aa & (np.abs(t - tc) < 4)
        if not band.any():
            continue
        R = float(np.percentile(n[band], 95))
        dist = np.hypot(X - c[0], Y - c[1])
        w *= np.where(beyond, 1 - smooth((dist - R) / 1.5), 1.0).astype(np.float32)
    out = img.copy()
    out[y0:y1, x0:x1, 3] = (out[y0:y1, x0:x1, 3] * w + 0.5).astype(np.uint8)
    return out


def defringe(img: np.ndarray) -> np.ndarray:
    """Limb part borders carry dark, half-transparent pixels (the key's soft dark edge and resampled cut
    lines), seen as dotted dark lines and ticks once a part moves over skin. Each border pixel
    (0 < alpha < 230) takes the colour of the nearest solid pixel and keeps its alpha; alpha under 20 goes.
    Alpha is left as cut: a 0.7 px alpha blur against the stepped key edges opens see-through seams wherever
    two parts abut."""
    from scipy.ndimage import distance_transform_edt
    a = img[..., 3]
    if not (a >= 230).any():
        return img
    ys, xs = np.nonzero(a > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = img[y0:y1, x0:x1].copy()
    sa = sub[..., 3]
    _, (iy, ix) = distance_transform_edt(sa < 230, return_indices=True)
    edge = (sa > 0) & (sa < 230)
    sub[edge, :3] = sub[iy[edge], ix[edge], :3]
    sub[sa < 20] = 0
    out = img.copy()
    out[y0:y1, x0:x1] = sub
    return out


def assemble(Rp: dict, K: dict, V: dict, FP: dict, H: dict, Ly: dict) -> dict:
    """Every part with its bone joints in master px: {name: (rgba, pivot, tip, source)}."""
    JR = JOINTS["rest"]
    la, ra = JR["leftArm"], JR["rightArm"]
    kpm, d = Ly["kpm"], Ly["d"]
    cx = float(d["mid"][0])
    head_pivot = (cx, float(kpm["chin"][1] + 4))
    neck_base = (cx, float(H["cut_y"] + 45))
    waist = (cx, float(Rp["waist_y"][int(cx)]))
    hips = tuple(np.mean([JR["rightLeg"]["H"], JR["leftLeg"]["H"]], 0).tolist())
    P = Rp["P"]
    parts = {
        "leftUpperArm": (P["leftUpperArm"], la["S"], la["E"], "rest"),
        "leftForearm.f_rest": (P["leftForearm.f_rest"], la["E"], la["W"], "rest"),
        "leftHand.grip": (P["leftHand.grip"], la["W"], la["T"], "rest"),
        "rightUpperArm": (P["rightUpperArm"], ra["S"], ra["E"], "rest"),
        "rightForearm": (P["rightForearm"], ra["E"], ra["W"], "rest"),
        "rightHand.relaxed": (P["rightHand.relaxed"], ra["W"], ra["T"], "rest"),
        "torso": (P["torso"], waist, neck_base, "rest"),
        "pelvis": (P["pelvis"], hips, waist, "rest + sleep key under the left arm"),
        "neck": (P["neck"], neck_base, head_pivot, "rest"),
        "head": (P["head"], head_pivot, (cx, HB["y"]), "rest (face.png registered into master)"),
        "head.closed": (P["head.closed"], head_pivot, (cx, HB["y"]), "rest, blink edit"),
        "frontHair": (P["frontHair"], head_pivot, (cx, HB["y"]), "rest"),
        "backHair": (P["backHair"], head_pivot, (cx, HB["y"]), "rest"),
    }
    for side in ("right", "left"):
        j = JR[f"{side}Leg"]
        parts[f"{side}Thigh"] = (P[f"{side}Thigh"], j["H"], j["K"], "rest")
        parts[f"{side}Shin"] = (P[f"{side}Shin"], j["K"], j["A"], "rest")
        parts[f"{side}Shoe"] = (P[f"{side}Shoe"], j["A"], j["T"], "rest")
    for name, use in KEY_USE.items():
        k = K[name]
        if "fore" in use:
            parts[f"leftForearm.{use['fore']}"] = (B.cut(k["img"], k["parts"]["fore"]), k["J"]["E"], k["J"]["W"], f"key {name}")
        if "hand" in use:
            parts[f"leftHand.{use['hand']}"] = (B.cut(k["img"], k["parts"]["hand"]), k["J"]["W"], k["J"]["T"], f"key {name}")
    for name, (img, p, q, src) in list(parts.items()):
        kind = next((k for k in ROUND_ENDS if bone_of(name).endswith(k)), None)
        if kind:
            parts[name] = (defringe(round_ends(img, p, q, ROUND_ENDS[kind])), p, q, src)
    for name, img in V.items():
        parts[f"head.{name}"] = (img, head_pivot, (cx, HB["y"]), f"view {name}")
    for name, img in FP.items():
        parts[f"face.{name}"] = (img, head_pivot, (cx, HB["y"]), "rest face variant patch")
    return parts


def app_map(H: dict, Ly: dict) -> dict:
    """master px -> app frame 1x. Scale: the rest silhouette's height maps to the spec's rest fill.
    Anchors: the rest silhouette's bottom on the spec ground line, the neck centre on the spec neck x."""
    a = H["rest"][..., 3] > 0
    ys = np.nonzero(a.any(1))[0]
    spec = json.loads((WORK / "spec_rest.json").read_text())
    s = SPEC_FILL_PX / float(ys[-1] + 1 - ys[0])
    cx = float(Ly["d"]["mid"][0])
    return {"scale": s, "ox": spec["neck"][0] - cx * s, "oy": 325.8 - (ys[-1] + 1) * s,
            "note": "x_app = ox + x_master * scale, y_app = oy + y_master * scale (139x340 frame, 1x)"}


def export(parts: dict, amap: dict) -> dict:
    PARTS.mkdir(parents=True, exist_ok=True)
    for f in PARTS.glob("*.png"):
        f.unlink()
    S = amap["scale"] * EXPORT
    true_len = {}
    for name, (img, p, q, _) in parts.items():
        b = bone_of(name)
        true_len[b] = max(true_len.get(b, 0), float(np.hypot(q[0] - p[0], q[1] - p[1])))
    meta = {}
    for name, (img, p, q, src) in parts.items():
        a = img[..., 3] > 0
        if not a.any():
            meta[name] = {"error": "empty"}
            continue
        ys, xs = np.nonzero(a)
        x0, y0, x1, y1 = xs.min() - 3, ys.min() - 3, xs.max() + 4, ys.max() + 4
        crop = img[max(0, y0):y1, max(0, x0):x1]
        x0, y0 = max(0, x0), max(0, y0)
        w, h = max(1, round(crop.shape[1] * S)), max(1, round(crop.shape[0] * S))
        small = unpremul(cv2.resize(premul(crop), (w, h), interpolation=cv2.INTER_AREA))
        fn = name.replace(".", "__") + ".png"
        save(small, PARTS / fn)
        b = bone_of(name)
        L = float(np.hypot(q[0] - p[0], q[1] - p[1]))
        sx = lambda v: round((v[0] - x0) * S, 2)
        sy = lambda v: round((v[1] - y0) * S, 2)
        ratio = L / true_len[b] if true_len[b] else 1.0
        meta[name] = {"file": f"parts/{fn}", "bone": b, "variant": name.split(".", 1)[1] if "." in name else "",
                      "size": [w, h], "pivot": [sx(p), sy(p)], "tip": [sx(q), sy(q)],
                      "boneLenPx2x": round(L * S, 2), "angleDeg": round(float(np.degrees(np.arctan2(q[1] - p[1], q[0] - p[0]))), 2),
                      "artRatio": round(ratio, 3),
                      "rung": min(LADDER, key=lambda n: abs(ratio / n - 1)) if b.startswith(("left", "right")) and "Hand" not in b else None,
                      "z": Z[b],
                      "restPos1x": [round(amap["ox"] + x0 * amap["scale"], 3), round(amap["oy"] + y0 * amap["scale"], 3)],
                      "source": src}
    return meta


def place(img, p, q, a2, b2) -> np.ndarray:
    """2x3 map taking a part's bone p->q onto a2->b2: rotate, stretch along the bone only (the rig's rule)."""
    p, q, a2, b2 = (np.asarray(v, float) for v in (p, q, a2, b2))
    t1, t2 = np.arctan2(*(q - p)[::-1]), np.arctan2(*(b2 - a2)[::-1])
    sx = np.linalg.norm(b2 - a2) / max(np.linalg.norm(q - p), 1e-6)
    R = lambda t: np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    A = R(t2) @ np.diag([sx, 1.0]) @ R(-t1)
    return np.hstack([A, (a2 - A @ p)[:, None]])


def render(parts: dict, pose: dict, size) -> np.ndarray:
    """pose: {slot: (part_name, a2, b2)} for moved parts, plus rest for the others. Slots are bones;
    painter's order by z."""
    order = []
    for b in sorted(set(Z) - {"face"}, key=lambda k: Z[k]):
        z = Z[b]
        if b in pose:
            name, a2, b2, *zz = pose[b]
            z = zz[0] if zz else z
        else:
            name = {"leftForearm": "leftForearm.f_rest", "leftHand": "leftHand.grip", "rightHand": "rightHand.relaxed"}.get(b, b)
            a2 = b2 = None
        if name is None:
            continue
        img, p, q, _ = parts[name]
        M = np.hstack([np.eye(2), np.zeros((2, 1))]) if a2 is None else place(img, p, q, a2, b2)
        order.append((z, img, M))
    for extra in pose.get("_over", []):
        order.append((Z["face"], parts[extra][0], np.hstack([np.eye(2), np.zeros((2, 1))])))
    order.sort(key=lambda o: o[0])
    order = [(i, m) for _, i, m in order]
    acc = np.zeros((size[1], size[0], 4), np.float32)
    for img, M in order:
        f = cv2.warpAffine(premul(img), M, size, flags=cv2.INTER_LINEAR, borderValue=0)
        acc = f + acc * (1 - f[..., 3:4])
    return unpremul(acc)


def holes(rgba: np.ndarray) -> int:
    """Alpha holes inside the silhouette: pixels below alpha 250 that a 9 px closing of the silhouette
    fills and that sit 3 px inside it (see-through seams between parts)."""
    a = rgba[..., 3] > 127
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    closed = cv2.morphologyEx(a.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool)
    inner = erode(closed, 3)
    return int((inner & (rgba[..., 3] < 250)).sum())


def to_app(rgba: np.ndarray, amap: dict, scale=1) -> np.ndarray:
    s = amap["scale"] * scale
    M = np.array([[s, 0, amap["ox"] * scale], [0, s, amap["oy"] * scale]])
    f = premul(rgba)
    f = cv2.resize(f, None, fx=s * 2, fy=s * 2, interpolation=cv2.INTER_AREA)   # area first, then a half-step
    M2 = np.array([[0.5, 0, amap["ox"] * scale], [0, 0.5, amap["oy"] * scale]])
    return unpremul(cv2.warpAffine(f, M2, (139 * scale, 340 * scale), flags=cv2.INTER_LINEAR, borderValue=0))


def sheet(frames, labels, path, bg, scale=2):
    W = sum(f.shape[1] for f in frames) + 6 * len(frames)
    Hh = max(f.shape[0] for f in frames) + 16
    im = Image.new("RGB", (W, Hh), bg)
    dr = ImageDraw.Draw(im)
    x = 0
    for f, l in zip(frames, labels):
        im.paste(Image.fromarray(over(f, bg)), (x, 16)); dr.text((x + 3, 2), l, fill=(255, 0, 0)); x += f.shape[1] + 6
    im.save(path)


def lerp_ang(a, b, t, turn=None):
    d = (b - a + 180) % 360 - 180 if turn is None else ((b - a) % 360 if turn > 0 else (b - a) % 360 - 360)
    return a + t * d


def chain(Ja, Jb, t, fore_turn=None):
    """Joint sites between two arm keys: each bone's angle and length interpolated (S fixed)."""
    S = np.array(Ja["S"], float)
    out = {"S": S}
    prev = S
    for (u, v), turn in ((("S", "E"), None), (("E", "W"), fore_turn), (("W", "T"), fore_turn)):
        va, vb = np.subtract(Ja[v], Ja[u]), np.subtract(Jb[v], Jb[u])
        ang = np.deg2rad(lerp_ang(np.degrees(np.arctan2(va[1], va[0])), np.degrees(np.arctan2(vb[1], vb[0])), t, turn))
        ln = (1 - t) * np.hypot(*va) + t * np.hypot(*vb)
        prev = prev + ln * np.array([np.cos(ang), np.sin(ang)])
        out[v] = prev
    return out


def arm_pose(J, fore, hand, hz=None):
    p = {"leftUpperArm": ("leftUpperArm", J["S"], J["E"]), "leftForearm": (fore, J["E"], J["W"]),
         "leftHand": (hand, J["W"], J["T"])}
    if hz is not None:
        p["leftHand"] = p["leftHand"] + (hz,)
    return p


def rot_about(c, v, deg):
    r = np.deg2rad(deg)
    return (c[0] + np.cos(r) * (v[0] - c[0]) - np.sin(r) * (v[1] - c[1]),
            c[1] + np.sin(r) * (v[0] - c[0]) + np.cos(r) * (v[1] - c[1]))


FRAMES: dict = {}       # clip -> [(master-px RGBA frame, {bone: (p, q)} in master px)], for the consistency run
SHIFTS: dict = {}       # clip -> [(dx, dy) master px of the whole upper body per frame], where the body moves
HAND_BOX: dict = {}     # clip -> [box of the posed left hand part, master px] (the checker's change_zones)


def hand_box(parts: dict, pz: dict) -> list:
    """Bounding box of the left hand part as posed: the thumb of the open and waving hands stands outside the
    checker's hand capsule (drawn along the fingers), so it reads as new content unless declared."""
    name, a2, b2 = pz["leftHand"][:3]
    img, p, q, _ = parts[name]
    ys, xs = np.nonzero(img[..., 3] > 0)
    c = np.array([[xs.min(), ys.min(), 1], [xs.max(), ys.min(), 1], [xs.min(), ys.max(), 1], [xs.max(), ys.max(), 1]], float)
    w = c @ place(img, p, q, a2, b2).T
    return [float(w[:, 0].min()), float(w[:, 1].min()), float(w[:, 0].max()), float(w[:, 1].max())]


def bones_of(arm_l: dict, legs: dict | None = None, shift=(0.0, 0.0)) -> dict:
    """Every declared bone of a frame: the left arm as posed, the rest right arm, the legs as posed."""
    JR = JOINTS["rest"]
    d = np.asarray(shift, float)
    ra = JR["rightArm"]
    out = {"leftUpperArm": (arm_l["S"], arm_l["E"]), "leftForearm": (arm_l["E"], arm_l["W"]), "leftHand": (arm_l["W"], arm_l["T"]),
           "rightUpperArm": (np.add(ra["S"], d), np.add(ra["E"], d)), "rightForearm": (np.add(ra["E"], d), np.add(ra["W"], d)),
           "rightHand": (np.add(ra["W"], d), np.add(ra["T"], d))}
    for side in ("right", "left"):
        j = (legs or {}).get(side, JR[f"{side}Leg"])
        out[f"{side}Thigh"] = (j["H"], j["K"]); out[f"{side}Shin"] = (j["K"], j["A"]); out[f"{side}Shoe"] = (j["A"], j["T"])
    return out


def app_diff(a, b, amap) -> int:
    return int((np.abs(to_app(a, amap).astype(int) - to_app(b, amap).astype(int)).max(-1) > 40).sum())


def step_proofs(M: dict, parts: dict, H: dict, K: dict, amap: dict) -> None:
    size = (H["rest"].shape[1], H["rest"].shape[0])
    Y, X = np.mgrid[0:size[1], 0:size[0]].astype(np.float32)
    rest = render(parts, {}, size)
    d = np.abs(rest.astype(int) - H["rest"].astype(int)).max(-1)
    M["rest_recomposite"] = {"px_diff_gt8_vs_hybrid": int((d > 8).sum()), "holes": holes(rest), "holes_hybrid": holes(H["rest"])}
    save(rest, OUT / "rest_parts.png")
    save(to_app(rest, amap, 1), OUT / "rest_139x340.png")
    save(to_app(rest, amap, 2), OUT / "rest_278x680.png")
    J = {k: K[k]["J"] for k in K}
    J["rest"] = JOINTS["rest"]["leftArm"]
    # drag has no key (the generation was refused by the image service's filter): composed from the think
    # forearm and the open hand, hand toward the collarbone
    J["drag"] = {"S": J["rest"]["S"], "E": [648, 505], "W": [590, 372], "T": [548, 312]}
    poses = {
        "sleep": arm_pose(J["sleep"], "leftForearm.f_sleep", "leftHand.relaxed"),
        "tuck": arm_pose(J["tuck"], "leftForearm.f_tuck", "leftHand.tuck", HAND_AT_HEAD_Z),
        "think": arm_pose(J["think"], "leftForearm.f_think", "leftHand.fist", HAND_AT_HEAD_Z),
        "talk": arm_pose(J["talk"], "leftForearm.f_talk", "leftHand.open"),
        "happy": arm_pose(J["happy"], "leftForearm.f_happy", "leftHand.fist"),
        "wave": arm_pose(J["wave"], "leftForearm.f_wave", "leftHand.wave"),
        "drag": arm_pose(J["drag"], "leftForearm.f_think", "leftHand.open"),
    }
    frames, labels, info = [rest], ["rest"], {}
    (WORK / "poses").mkdir(parents=True, exist_ok=True)
    FRAMES["poses"] = [(rest, bones_of(J["rest"]))]
    HAND_BOX["poses"] = [None]
    for k, pz in poses.items():
        fr = render(parts, pz, size)
        HAND_BOX["poses"].append(hand_box(parts, pz))
        frames.append(fr); labels.append(k)
        FRAMES["poses"].append((fr, bones_of({j: pz[b][i] for b, i, j in (("leftUpperArm", 1, "S"), ("leftUpperArm", 2, "E"),
                                                                          ("leftForearm", 2, "W"), ("leftHand", 2, "T"))})))
        info[k] = {"holes": holes(fr)}
        if k in K:   # the key itself against its rebuild from parts, inside the arm capsules
            segs, _ = arm_segments(K[k]["J"])
            cap = np.logical_or.reduce([seg_dist(X, Y, *v) < ARM_R[n] for n, v in segs.items()]) & (K[k]["img"][..., 3] > 0)
            de = deltaE_ciede2000(lab(over(fr)), lab(over(K[k]["img"])))[cap]
            info[k]["arm_dE_vs_key"] = B.stat(de)
        save(fr, WORK / "poses" / f"{k}.png")
    M["poses"] = info
    for bg, tag in (((240, 240, 240), "light"), ((16, 20, 31), "dark")):
        sheet([to_app(f, amap, 2) for f in frames], labels, OUT / f"poses_2x_{tag}.png", bg)
    sheet([to_app(f, amap, 1) for f in frames], labels, OUT / "poses_1x.png", (128, 128, 128))
    crops = []
    for k in poses:
        if k in K:
            crops.append(np.hstack([over(K[k]["img"], (128, 128, 128))[80:900, 420:960],
                                    over(render(parts, poses[k], size), (128, 128, 128))[80:900, 420:960]]))
    big = np.vstack([np.hstack(crops[:3]), np.hstack(crops[3:6])])
    Image.fromarray(big).resize((big.shape[1] // 2, big.shape[0] // 2), Image.LANCZOS).save(OUT / "keys_vs_parts.png")

    # wave from parts: rest -> sleep (arm down) -> raise -> wave over 9 eased poses, then a swing. Each leg
    # runs between two keys, so every drawing is shown within about half a leg's turn of the pose it was
    # drawn in; whole drawings only, swapped at the half-way point of each leg (never cross-faded). The
    # forearm turns clockwise throughout (hand off the hip, down beside the body, out, up): rest -> raise
    # directly would sweep it 100 deg off its art and across the chest.
    legs_ = [("rest", "leftForearm.f_rest", "leftHand.grip"), ("sleep", "leftForearm.f_sleep", "leftHand.relaxed"),
             ("raise", "leftForearm.f_raise", "leftHand.open_up"), ("wave", "leftForearm.f_wave", "leftHand.wave")]
    seq, lab_ = [], []
    n_in = 9
    for i in range(n_in):
        u = smooth(i / (n_in - 1)) * (len(legs_) - 1)
        g = min(int(u), len(legs_) - 2)
        t = u - g
        (ka, fa, ha), (kb, fb, hb) = legs_[g], legs_[g + 1]
        Jt = chain(J[ka], J[kb], t, -1)
        pz = arm_pose(Jt, fa if t < 0.5 else fb, ha if t < 0.5 else hb)
        seq.append(render(parts, pz, size)); lab_.append(f"{i}")
        FRAMES.setdefault("wave", []).append((seq[-1], bones_of(Jt)))
        HAND_BOX.setdefault("wave", []).append(hand_box(parts, pz))
    for a in (12, -12, 12, 0):
        Jw = {k: np.array(v, float) for k, v in J["wave"].items()}
        Jw["W"] = np.array(rot_about(Jw["E"], Jw["W"], a)); Jw["T"] = np.array(rot_about(Jw["E"], J["wave"]["T"], a))
        pz = arm_pose(Jw, "leftForearm.f_wave", "leftHand.wave")
        seq.append(render(parts, pz, size)); lab_.append(f"sw{a}")
        FRAMES["wave"].append((seq[-1], bones_of(Jw)))
        HAND_BOX["wave"].append(hand_box(parts, pz))
    M["wave_parts"] = {"frames": len(seq), "holes": [holes(f) for f in seq],
                       "consecutive_app_px_gt40": [app_diff(seq[i + 1], seq[i], amap) for i in range(len(seq) - 1)]}
    strip = np.hstack([over(f, (128, 128, 128))[100:900, 520:940] for f in seq[:n_in]])
    Image.fromarray(strip).save(OUT / "wave_inbetweens_fullres.png")
    sheet([to_app(f, amap, 2) for f in seq], lab_, OUT / "wave_parts_2x.png", (128, 128, 128))

    # head: tilt about the neck pivot (the neck follows half) and the generated views
    hp, top = parts["head"][1], parts["head"][2]
    nb, nt = parts["neck"][1], parts["neck"][2]
    hv = []
    for name, deg in (("tilt-6", -6), ("rest", 0), ("tilt+6", 6), ("yaw12", 0), ("pitch15", 0), ("pitch15.closed", 0)):
        view = name in ("yaw12", "pitch15", "pitch15.closed")
        pz = {b: (b, hp, rot_about(hp, top, deg)) for b in ("head", "frontHair", "backHair")}
        if view:
            pz["head"] = (f"head.{name}", hp, top)
            pz["frontHair"] = (None, None, None)
        pz["neck"] = ("neck", nb, rot_about(nb, nt, deg / 2))
        hv.append((name, render(parts, pz, size)))
    M["head_poses"] = {n: {"holes": holes(f)} for n, f in hv}
    x0, y0, s = HB["x"] - 40, HB["y"], HB["side"] + 80
    for bg, tag in (((240, 240, 240), "light"), ((16, 20, 31), "dark")):
        Image.fromarray(np.hstack([over(f, bg)[y0:y0 + s + 100, x0:x0 + s] for _, f in hv])).save(OUT / f"heads_{tag}.png")
    sheet([to_app(f, amap, 2) for _, f in hv], [n for n, _ in hv], OUT / "heads_2x.png", (128, 128, 128))
    step_leg_proofs(M, parts, size, amap)


def leg_pose(JL: dict, hip_dx=0.0, hip_dy=0.0, swing=0.0, knee=0.0, planted=True) -> dict:
    """Joint sites for one leg. planted: the ankle and toe stay put, the hip moves by (hip_dx, hip_dy) and
    the knee stays on the hip-ankle line, so a bend seen from the front shortens thigh and shin along the
    bone (the rig's stretch), never bows the leg sideways. Not planted: the whole leg turns about the hip
    by swing and the shin and foot by a further knee degrees (a dangle with follow-through)."""
    H, K, A, T = (np.array(JL[j], float) for j in "HKAT")
    if planted:
        H2 = H + [hip_dx, hip_dy]
        t = np.linalg.norm(K - H) / (np.linalg.norm(K - H) + np.linalg.norm(A - K))
        return {"H": H2, "K": K + (1 - t) * (H2 - H), "A": A, "T": T}
    K2 = np.array(rot_about(H, K, swing)); A2 = np.array(rot_about(H, A, swing)); T2 = np.array(rot_about(H, T, swing))
    A3 = np.array(rot_about(K2, A2, knee)); T3 = np.array(rot_about(K2, T2, knee))
    return {"H": H + [hip_dx, hip_dy], "K": K2 + [hip_dx, hip_dy], "A": A3 + [hip_dx, hip_dy], "T": T3 + [hip_dx, hip_dy]}


def legs_into(pz: dict, side: str, J: dict) -> dict:
    pz[f"{side}Thigh"] = (f"{side}Thigh", J["H"], J["K"])
    pz[f"{side}Shin"] = (f"{side}Shin", J["K"], J["A"])
    pz[f"{side}Shoe"] = (f"{side}Shoe", J["A"], J["T"])
    return pz


def step_leg_proofs(M: dict, parts: dict, size, amap: dict) -> None:
    """The leg parts under the leg moves (sway, bounce, land, dangle), posed from the parts alone. The pelvis and
    everything above follow the hips (whole upper body shifted with them); planted feet must not move."""
    JR = JOINTS["rest"]
    def frame(dx, dy, legs):
        pz = {}
        for side, J in legs.items():
            legs_into(pz, side, J)
        up = np.array([[1, 0, dx], [0, 1, dy]], float)
        for b in set(Z) - {"face"} - set(pz):
            name = {"leftForearm": "leftForearm.f_rest", "leftHand": "leftHand.grip", "rightHand": "rightHand.relaxed"}.get(b, b)
            img, p, q, _ = parts[name]
            pz[b] = (name, np.array(p) + [dx, dy], np.array(q) + [dx, dy])
        return render(parts, pz, size)
    seq = {
        "rest": (0, 0, {s: leg_pose(JR[f"{s}Leg"]) for s in ("right", "left")}),
        "sway_l": (5, 1, {s: leg_pose(JR[f"{s}Leg"], 5, 1) for s in ("right", "left")}),
        "sway_r": (-5, 1, {s: leg_pose(JR[f"{s}Leg"], -5, 1) for s in ("right", "left")}),
        "bounce": (0, 14, {s: leg_pose(JR[f"{s}Leg"], 0, 14) for s in ("right", "left")}),
        "land": (0, 30, {s: leg_pose(JR[f"{s}Leg"], 0, 30) for s in ("right", "left")}),
        "dangle+": (0, -60, {s: leg_pose(JR[f"{s}Leg"], 0, -60, 7, -5, False) for s in ("right", "left")}),
        "dangle-": (0, -60, {s: leg_pose(JR[f"{s}Leg"], 0, -60, -7, 5, False) for s in ("right", "left")}),
    }
    frames, info = [], {}
    for k, (dx, dy, legs) in seq.items():
        fr = frame(dx, dy, legs)
        # in-process repro check: the same pose rendered twice must match to the byte (cv2 threads)
        assert (fr == frame(dx, dy, legs)).all(), f"leg frame {k} not reproducible"
        frames.append(fr)
        SHIFTS.setdefault("legs", []).append((dx, dy))
        la = {j: np.add(v, [dx, dy]) for j, v in JR["leftArm"].items()}
        FRAMES.setdefault("legs", []).append((fr, bones_of(la, legs, (dx, dy))))
        info[k] = {"holes": holes(fr),
                   "toe_px_master": {s: [round(float(v), 1) for v in legs[s]["T"]] for s in legs},
                   "thigh_shin_len_ratio": {s: round(float((np.linalg.norm(legs[s]["K"] - legs[s]["H"]) + np.linalg.norm(legs[s]["A"] - legs[s]["K"]))
                                                   / (np.linalg.norm(np.subtract(JR[f"{s}Leg"]["K"], JR[f"{s}Leg"]["H"])) +
                                                      np.linalg.norm(np.subtract(JR[f"{s}Leg"]["A"], JR[f"{s}Leg"]["K"])))), 3) for s in legs}}
    M["leg_poses"] = info
    for bg, tag in (((240, 240, 240), "light"), ((16, 20, 31), "dark")):
        sheet([to_app(f, amap, 2) for f in frames], list(seq), OUT / f"legs_2x_{tag}.png", bg)
    crops = [over(f, (128, 128, 128))[700:1536, 250:800] for f in frames]
    big = np.hstack(crops)
    Image.fromarray(big).resize((big.shape[1] // 2, big.shape[0] // 2), Image.LANCZOS).save(OUT / "legs_fullres.png")


def step_harness(M: dict, H: dict, amap: dict) -> None:
    """Frozen harness on face.png (auto) and on the head cut out of the parts-built rest frame."""
    M["harness"] = {"face_auto": harness(OUT / "face.png", "face_auto", bodies=[OUT / "rest_139x340.png"])}
    rest = np.array(Image.open(OUT / "rest_parts.png"))
    x, y, s = HB["x"], HB["y"], HB["side"]
    up = Image.fromarray(over(rest)[y:y + s, x:x + s]).resize((1024, 1024), Image.LANCZOS)
    up.save(WORK / "shipped_head_1024.png")
    M["harness"]["shipped_head"] = harness(WORK / "shipped_head_1024.png", "shipped_head")
    for v in ("yaw12", "pitch15"):
        M["harness"][f"view_{v}"] = harness(WORK / f"view_{v}.png", f"view_{v}")


def step_consistency(M: dict, amap: dict) -> None:
    """Rest and every proof frame at 4x (rendered from master px, area-resized) and 1x, with the posed bones,
    through the frozen consistency checker with its own CLI."""
    import shutil
    import subprocess
    fd = WORK / "frames"
    shutil.rmtree(fd, ignore_errors=True)
    to4 = lambda p: [round((amap["ox"] + float(p[0]) * amap["scale"]) * 4, 1), round((amap["oy"] + float(p[1]) * amap["scale"]) * 4, 1)]
    bj = lambda b: {k: [to4(p), to4(q)] for k, (p, q) in b.items()}
    # background gaps the rest art really has, read off the checker's own evidence/rest_0000.png (4x px):
    # the ponytail/neck gap, the loop between the hand-on-hip arm and the waist, the right hand's finger gap
    rest_gaps = [[272, 180], [353, 426], [71, 713]]
    man = {"scale": 4, "rest_joints": bj(FRAMES["poses"][0][1]), "allowed_holes": {"rest": {"0": rest_gaps}}, "clips": {}}
    # where the whole upper body moves (legs clip: sway, bounce, land, dangle), the same three gaps move with it
    for clip, sh_ in SHIFTS.items():
        man["allowed_holes"][clip] = {str(i): [[round(x + dx * amap["scale"] * 4, 1), round(y + dy * amap["scale"] * 4, 1)]
                                               for x, y in rest_gaps] for i, (dx, dy) in enumerate(sh_)}
    # dangle+ (legs 5): the right thigh swung out 7 deg closes the bottom of the gap between the hanging right
    # arm and the skirt, so that real background gap becomes an enclosed 1x hole (checked by eye on
    # evidence/legs_0005.png and the 1x frame over magenta)
    man["allowed_holes"]["legs"]["5"].append([108.7, 521.9])
    def put(clip, i, img):
        for sc, sub in ((4, "4x"), (1, "1x")):
            (fd / clip / sub).mkdir(parents=True, exist_ok=True)
            save(to_app(img, amap, sc), fd / clip / sub / f"{i:04d}.png")
    put("rest", 0, FRAMES["poses"][0][0])
    for clip, fr in FRAMES.items():
        for i, (img, b) in enumerate(fr):
            put(clip, i, img)
        man["clips"][clip] = {"peak": 0, "head_views": [], "joints": {str(i): bj(b) for i, (_, b) in enumerate(fr)}}
        if clip in HAND_BOX:
            man["clips"][clip]["change_zones"] = {str(i): [to4(bx[:2]) + to4(bx[2:])] for i, bx in enumerate(HAND_BOX[clip]) if bx}
    (fd / "manifest.json").write_text(json.dumps(man, indent=1))
    root = HERE.parents[0] / "consistency"
    py = Path(sys.executable)
    outd = WORK / "consistency"
    r = subprocess.run([str(py), "-I", str(root / "consistency.py"), "--frames", str(fd), "--out", str(outd)], capture_output=True, text=True)
    (outd / "stdout.txt").parent.mkdir(parents=True, exist_ok=True)
    (outd / "stdout.txt").write_text(r.stdout + r.stderr)
    M["consistency"] = {"exit": r.returncode, "report": str(outd / "report.json")}


def hash_outputs() -> dict:
    """sha256 of every file in out/ and work/frames/ (metrics.json and the hash list itself excluded), compared
    with the list the previous run left: a rerun of the lever must reproduce every byte."""
    import hashlib
    hp = OUT / "hashes.json"
    files = sorted(p for d in (OUT, WORK / "frames") for p in d.rglob("*") if p.is_file() and p.name not in ("metrics.json", "hashes.json"))
    now = {str(p.relative_to(HERE)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    prev = json.loads(hp.read_text()) if hp.exists() else None
    hp.write_text(json.dumps(now, indent=0))
    if prev is None:
        return {"files": len(now), "vs_previous_run": "no previous run"}
    diff = sorted(k for k in set(now) | set(prev) if now.get(k) != prev.get(k))
    return {"files": len(now), "vs_previous_run": {"differ": len(diff), "paths": diff[:50]}}


def main() -> None:
    for d_ in (OUT, WORK / "b" / "artifacts", WORK / "b" / "work"):
        d_.mkdir(parents=True, exist_ok=True)
    import subprocess
    # the motion spec's rest-pose joint sites in the app frame (work/spec_rest.json), read by app_map
    subprocess.run(["node", str(HERE / "spec_rest.mjs")], check=True, capture_output=True)
    M: dict = {"inputs": {p.name: list(Image.open(p).size) for p in sorted(SRC.glob("*.png"))}}
    stance = step_legs(M)
    B.load_rgb_src = B.load_rgb
    B.load_rgb = lambda name: stance.copy() if name == "master.png" else B.load_rgb_src(name)
    F = step_face(M)
    H = B.step_hybrid(M, F)
    Ly = B.step_layers(M, F, H)
    K = step_keys(M, H)
    Rp = step_rest_parts(M, F, H, Ly, K)
    V = step_views(M, F, H, Ly)
    FP = step_face_patches(M, F, H, Ly)
    parts = assemble(Rp, K, V, FP, H, Ly)
    amap = app_map(H, Ly)
    meta = export(parts, amap)
    spec = json.loads((WORK / "spec_rest.json").read_text())
    JR = JOINTS["rest"]
    pairs = {"leftShoulder/leftUpperArm": (JR["leftArm"]["S"], spec["leftUpperArm"]), "leftElbow": (JR["leftArm"]["E"], spec["leftLowerArm"]),
             "leftWrist": (JR["leftArm"]["W"], spec["leftHand"]), "rightShoulder": (JR["rightArm"]["S"], spec["rightUpperArm"]),
             "rightElbow": (JR["rightArm"]["E"], spec["rightLowerArm"]), "rightWrist": (JR["rightArm"]["W"], spec["rightHand"]),
             "rightHip": (JR["rightLeg"]["H"], spec["rightUpperLeg"]), "rightKnee": (JR["rightLeg"]["K"], spec["rightLowerLeg"]),
             "rightAnkle": (JR["rightLeg"]["A"], spec["rightFoot"]), "leftHip": (JR["leftLeg"]["H"], spec["leftUpperLeg"]),
             "leftKnee": (JR["leftLeg"]["K"], spec["leftLowerLeg"]), "leftAnkle": (JR["leftLeg"]["A"], spec["leftFoot"])}
    art_vs_spec = {k: {"art_app": [round(amap["ox"] + a[0] * amap["scale"], 1), round(amap["oy"] + a[1] * amap["scale"], 1)],
                       "spec_app": s} for k, (a, s) in pairs.items()}
    for v in art_vs_spec.values():
        v["dx_dy"] = [round(v["art_app"][0] - v["spec_app"][0], 1), round(v["art_app"][1] - v["spec_app"][1], 1)]
    doc = {"about": "Tieu Mai layered2d parts. Every PNG is premultiplied-free RGBA at "
                    f"{EXPORT}x app scale. pivot/tip are the part's bone joints in its own pixels; the rig pins pivot "
                    "at the projected joint, turns pivot->tip to the projected bone angle and stretches along it. "
                    "restPos1x is the PNG's top-left in the 139x340 frame at 1x when the rig is at the art's rest. "
                    "z is the rest draw order (back to front); the spec sorts by camera depth per frame, and the "
                    "hand-at-head poses (tuck, think) need the hand between head (16) and frontHair (17).",
           "exportScale": EXPORT, "masterToApp1x": amap, "licence": "CC0-1.0",
           "artVsSpecRestJoints": art_vs_spec, "parts": meta}
    (OUT / "parts.json").write_text(json.dumps(doc, indent=1))
    step_proofs(M, parts, H, K, amap)
    step_harness(M, H, amap)
    step_consistency(M, amap)
    M["repro"] = hash_outputs()
    M["parts_count"] = len(meta)
    M["parts_px_2x"] = int(sum(v["size"][0] * v["size"][1] for v in meta.values() if "size" in v))
    (OUT / "metrics.json").write_text(json.dumps(M, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else float(o)))
    print(json.dumps({k: M[k] for k in ("harness", "rest_recomposite", "wave_parts", "head_poses", "torso_fill", "parts_count", "parts_px_2x")}, indent=0, default=str))
    # the key-pose limbs, head views and torso.noLeftSleeve, rebuilt from keyposes/src and this
    # grade (out/metrics.json); its own outputs go to keyposes/out
    import subprocess
    subprocess.run([sys.executable, str(HERE / "keyposes" / "run.py")], check=True)


if __name__ == "__main__":
    main()

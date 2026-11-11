"""Look B pipeline: rebuild every artifact after the image-generation step. run.py imports this module
as a library and points its globals at its own folders.

Inputs: src/*.png and gen/head_box.json
(the master's head box; the upscaled head crop is the face_hd input).
  src/master.png      1024x1536, full body on flat chroma green, rest pose
  src/face_hd.png     1024x1024, HD re-render of the master head box
  src/face_{smile,blink,talk}.png   edits of face_hd
  src/raise.png, src/wave.png       edits of master: left arm half raised / waving
Outputs: artifacts/.

Pipeline: key -> lens warp (face) -> per-region LAB grade toward the reference -> register the HD face
into the master head (similarity from face-mesh landmarks) -> cut layers -> idle and wave from the layers.
The frozen harness module is imported read-only to measure lenses and palette with the grader's own code.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from skimage.color import deltaE_ciede2000, lab2rgb, rgb2lab
from skimage.metrics import structural_similarity

HERE = Path(__file__).resolve().parent
SRC, ART, GEN = HERE / "src", HERE / "artifacts", HERE / "gen"
LAYERS, IDLE, WAVE_DIR = ART / "layers", ART / "idle", ART / "wave_seq"
HARNESS = HERE.parent / "harness"
sys.path.insert(0, str(HARNESS))
import likeness as LK  # noqa: E402  (frozen harness, read-only)

REF = GEN / "face-reference.png"
HB = json.loads((GEN / "head_box.json").read_text())
APP_W, APP_H, APP_PAD = 139, 340, 6
SHOULDER_Y, WAIST_Y = 330.0, 560.0   # breathing warp: full rise above SHOULDER_Y, none below WAIST_Y
# Clear-silver wire: a bright core with a thin darker edge. A mid-grey rim averages to the skin's
# luminance once shrunk, and then the face outline out-scores it as a "ring" (measured: left rx 121).
GLASSES_RGB = ((138, 140, 146), (228, 229, 234))

# Left arm (image right) joints in master px, read off a 20 px grid of the master (+-5 px).
# Forearm world angle: rest 130 deg -> raise 298 deg -> wave 261 deg. rest->raise turns +168 deg, so the
# hand rises beside the chest (the outward way, through "down" and "out", needs ~680 px of width and would
# shrink the whole figure in the 139 px frame); raise->wave turns back -37 deg.
JOINTS = {"rest": {"S": (652, 355), "E": (781, 480), "W": (668, 613)},
          "raise": {"S": (652, 355), "E": (735, 488), "W": (810, 347)},
          "wave": {"S": (652, 355), "E": (770, 422), "W": (745, 259)}}
FORE_DIR = {"rest->raise": +1, "raise->wave": -1}
ARM_ZONE = [(625, 60), (1000, 60), (1000, 720), (560, 720), (560, 585), (610, 575), (612, 450), (645, 440),
            (625, 285)]
HAND_POLY = [(578, 574), (584, 564), (605, 559), (621, 570), (636, 579), (657, 592), (700, 560), (722, 552), (722, 584),
             (682, 624), (666, 636), (642, 629), (606, 639), (586, 632), (577, 616), (580, 598), (584, 582)]
ARM_R_POLY = [(270, 280), (365, 285), (389, 440), (388, 560), (372, 640), (368, 840), (362, 905), (270, 905)]


# ------------------------------------------------------------------ basics

def load_rgb(name: str) -> np.ndarray:
    return np.array(Image.open(SRC / name).convert("RGB"))


def save(arr: np.ndarray, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path)
    return path


def lab(rgb: np.ndarray) -> np.ndarray:
    return rgb2lab(rgb.astype(np.float64) / 255.0)


def from_lab(L: np.ndarray) -> np.ndarray:
    return np.clip(lab2rgb(L) * 255 + 0.5, 0, 255).astype(np.uint8)


def over(rgba: np.ndarray, bg=(255, 255, 255)) -> np.ndarray:
    a = rgba[..., 3:4].astype(np.float32) / 255
    return np.clip(rgba[..., :3] * a + np.array(bg, np.float32) * (1 - a) + 0.5, 0, 255).astype(np.uint8)


def chroma_key(rgb: np.ndarray) -> np.ndarray:
    """Alpha from greenness g = G - max(R, B) (flat background g ~ 100); edge colours un-mixed from the
    measured background, green spill clamped, then low-alpha colours pulled to the local opaque colour
    (un-mixing amplifies noise as alpha -> 0, which showed as olive/magenta fringe on thin strands)."""
    f = rgb.astype(np.float32)
    g = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    a = np.clip((75.0 - g) / 55.0, 0.0, 1.0)
    a[a < 0.12] = 0.0
    bg_mask = a == 0
    bg = np.median(f[bg_mask], axis=0) if bg_mask.any() else np.array([2, 166, 64], np.float32)
    aa = np.maximum(a, 1e-3)[..., None]
    fg = np.where(a[..., None] > 0.02, (f - (1 - a[..., None]) * bg) / aa, f)
    fg[..., 1] = np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]) + 8)
    fg[..., 1] = np.minimum(fg[..., 1], (fg[..., 0] + fg[..., 2]) / 2 + 6)
    fg = np.clip(fg, 0, 255)
    op = (a >= 0.9).astype(np.float32)
    den = cv2.GaussianBlur(op, (0, 0), 3)
    num = cv2.GaussianBlur(fg * op[..., None], (0, 0), 3)
    local = num / np.maximum(den, 1e-4)[..., None]
    t = np.clip(a / 0.7, 0, 1)[..., None]
    fix = (den > 0.01) & (a < 0.7)
    fg = np.where(fix[..., None], local * (1 - t) + fg * t, fg)
    out = np.dstack([np.clip(fg, 0, 255), a * 255]).round().astype(np.uint8)
    out[a == 0, :3] = 0
    return out


def premul(rgba: np.ndarray) -> np.ndarray:
    f = rgba.astype(np.float32) / 255
    f[..., :3] *= f[..., 3:4]
    return f


def unpremul(f: np.ndarray) -> np.ndarray:
    a = f[..., 3:4]
    c = np.where(a > 0, f[..., :3] / np.maximum(a, 1e-6), 0)
    return (np.dstack([c, a]) * 255).round().clip(0, 255).astype(np.uint8)


def remap(f: np.ndarray, mx: np.ndarray, my: np.ndarray) -> np.ndarray:
    return cv2.remap(f, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def poly_mask(shape, pts) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(pts)).astype(np.int32)], 1)
    return m.astype(bool)


def ellipse_mask(shape, c, rx, ry) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.ellipse(m, (int(round(c[0])), int(round(c[1]))), (int(round(rx)), int(round(ry))), 0, 0, 360, 1, -1)
    return m.astype(bool)


def dilate(m: np.ndarray, r: int) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(m.astype(np.uint8), k).astype(bool)


def erode(m: np.ndarray, r: int) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode(m.astype(np.uint8), k).astype(bool)


def feather(m: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def stat(v: np.ndarray) -> dict:
    v = np.asarray(v, float)
    if v.size == 0:
        return {"n": 0}
    return {"n": int(v.size), "mean": round(float(v.mean()), 3), "p95": round(float(np.percentile(v, 95)), 3),
            "p99": round(float(np.percentile(v, 99)), 3), "frac_gt_5": round(float((v > 5).mean()), 5)}


def mesh(rgb: np.ndarray) -> np.ndarray | None:
    return LK.detect_mesh(np.ascontiguousarray(rgb))


def apply_affine(A: np.ndarray, p) -> np.ndarray:
    p = np.atleast_2d(np.asarray(p, float))
    return p @ A[:, :2].T + A[:, 2]


def warp_rgba(rgba: np.ndarray, A: np.ndarray, size) -> np.ndarray:
    """Similarity warp; a downscale is done first by area averaging (warpAffine alone would alias)."""
    f, A = premul(rgba), A.copy()
    s = float(np.sqrt(abs(np.linalg.det(A[:, :2]))))
    if s < 1:
        f = cv2.resize(f, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        A[:, :2] /= s
    return unpremul(cv2.warpAffine(f, A, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0))


def similarity(p1, p2, q1, q2) -> np.ndarray:
    """2x3 matrix of the similarity that maps p1->q1 and p2->q2."""
    p1, p2, q1, q2 = (complex(*map(float, v)) for v in (p1, p2, q1, q2))
    a = (q2 - q1) / (p2 - p1)
    b = q1 - a * p1
    return np.array([[a.real, -a.imag, b.real], [a.imag, a.real, b.imag]])


def ang(v) -> float:
    return float(np.degrees(np.arctan2(v[1], v[0])))


# ------------------------------------------------------------------ glasses repaint and colour grade

def fit_circle(pts: np.ndarray):
    """Algebraic least-squares circle (Kasa) through pixel coordinates (x, y)."""
    x, y = pts[:, 0].astype(float), pts[:, 1].astype(float)
    A = np.column_stack([x, y, np.ones_like(x)])
    c, *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    cx, cy = c[0] / 2, c[1] / 2
    return float(cx), float(cy), float(np.sqrt(c[2] + cx * cx + cy * cy))


def glasses_mask(rgba: np.ndarray, kp: dict, lenses: dict):
    """The painted glasses on the face close-up: rims, bridge with nose pads, hinges and temples.
    The metal is the only near-neutral thing there (C* < 12; skin ~25, hair ~15 before grading), so
    the mask is chroma-gated inside zones placed from a circle fitted to each rim's own pixels."""
    sh = rgba.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]]
    Lb = lab(rgba[..., :3])
    C = np.hypot(Lb[..., 1], Lb[..., 2])
    metal = (C < 12) & (rgba[..., 3] > 128)
    d = LK.derived(kp)
    circles, m = {}, np.zeros(sh, bool)
    for q, g in lenses.items():
        rho = np.hypot(X - g["cx"], Y - g["cy"]) / g["rx"]
        ring = metal & (rho > 0.82) & (rho < 1.3)
        circles[q] = fit_circle(np.column_stack(np.nonzero(ring.T)))
        cx, cy, r = circles[q]
        dist = np.abs(np.hypot(X - cx, Y - cy) - r)
        # the rim's own soft shadow is not neutral, so a narrow band goes regardless of colour
        m |= (metal & (dist <= 9)) | ((dist <= 6) & (rgba[..., 3] > 128))
    (lx, ly, lr), (rx_, ry_, rr_) = circles["l"], circles["r"]
    cy = (ly + ry_) / 2
    for px in (lx + 1.02 * lr, rx_ - 1.02 * rr_):          # nose pads and their arms (measured at x = cx +- 1.05 r)
        m |= (np.hypot(X - px, Y - (cy + 0.12 * lr)) < 0.22 * lr) & (rgba[..., 3] > 128)
    m |= metal & (X > lx + 0.55 * lr) & (X < rx_ - 0.55 * rr_) & (Y > cy - 0.5 * lr) & (Y < cy + 0.5 * lr)
    for (cx, _, r), sgn in ((circles["l"], -1), (circles["r"], 1)):
        x_in, x_out = cx + sgn * 0.8 * r, cx + sgn * (r + 0.2 * d["fw"])
        m |= metal & (X >= min(x_in, x_out)) & (X <= max(x_in, x_out)) & (Y > cy - 0.62 * r) & (Y < cy - 0.15 * r)
    return dilate(m, 2), circles


def draw_glasses(rgba: np.ndarray, circles: dict, r_new: float, kp: dict, colours) -> np.ndarray:
    """Thin round silver wire frame, drawn 4x supersampled: dark edge line, light core, a highlight on the
    upper-left of each rim; bridge arc between the rims; short temples running out past the face edge."""
    S = 4
    sh = rgba.shape[:2]
    dark, light = colours
    acc = np.zeros((sh[0] * S, sh[1] * S, 4), np.float32)

    def stroke(draw, col, width, alpha=1.0):
        m = np.zeros(acc.shape[:2], np.uint8)
        draw(m, max(1, int(round(width * S))))
        f = (m.astype(np.float32) / 255 * alpha)[..., None]
        acc[...] = np.concatenate([np.array(col, np.float32) / 255 * f, f], -1) + acc * (1 - f)

    d = LK.derived(kp)
    bridge_y = (circles["l"][1] + circles["r"][1]) / 2 - 0.30 * r_new
    ends = {}
    for q, (cx, cyq, _) in circles.items():
        dx = float(np.sqrt(max(r_new ** 2 - (bridge_y - cyq) ** 2, 1.0)))
        ends[q] = (cx + dx, cx - dx) if q == "l" else (cx - dx, cx + dx)     # (inner x, outer x)
    xl, xr = ends["l"][0], ends["r"][0]
    arc = np.array([(xl + (xr - xl) * t, bridge_y - 0.06 * r_new * np.sin(np.pi * t)) for t in np.linspace(0, 1, 24)])
    # temples run back into the hair: grey (seen edge-on), fading out just past the face edge
    temples = []
    for q, edge in (("l", kp["face_l"][0] + 0.01 * d["fw"]), ("r", kp["face_r"][0] - 0.01 * d["fw"])):
        x0 = ends[q][1]
        temples += [(np.array([(x0 + (edge - x0) * a, bridge_y - 0.04 * r_new * a), (x0 + (edge - x0) * b, bridge_y - 0.04 * r_new * b)]),
                     al) for a, b, al in ((0, 0.6, 0.9), (0.55, 1.0, 0.45))]
    ip = lambda a: np.round(np.asarray(a) * S).astype(np.int32)
    rad = int(round(r_new * S))
    for col, wid in ((dark, 3.4), (light, 2.4)):
        for cx, cyq, _ in circles.values():
            stroke(lambda m, w, c=(cx, cyq): cv2.circle(m, tuple(ip(c)), rad, 255, w, cv2.LINE_AA), col, wid)
        stroke(lambda m, w: cv2.polylines(m, [ip(arc)], False, 255, w, cv2.LINE_AA), col, wid * 0.9)
    for t_, al in temples:
        stroke(lambda m, w, t_=t_: cv2.polylines(m, [ip(t_)], False, 255, w, cv2.LINE_AA), dark, 2.4, al)
    for cx, cyq, _ in circles.values():
        c = tuple(ip((cx, cyq)))
        # metal shading: the lower arc a little darker, a highlight on the upper left
        stroke(lambda m, w, c=c: cv2.ellipse(m, c, (rad, rad), 0, 25, 155, 255, w, cv2.LINE_AA), (176, 178, 184), 2.0, 0.55)
        stroke(lambda m, w, c=c: cv2.ellipse(m, c, (rad, rad), 0, 200, 275, 255, w, cv2.LINE_AA), (250, 250, 252), 0.9, 0.8)
    lay = cv2.resize(acc, (sh[1], sh[0]), interpolation=cv2.INTER_AREA)
    lay *= feather(rgba[..., 3] > 250, 1.0)[..., None]  # temples end in opaque hair, never over wisps or background
    return unpremul(lay + premul(rgba) * (1 - lay[..., 3:4]))


def eye_maps(shape, L: np.ndarray, k: float):
    """Inverse maps that scale each eye vertically by k about the iris centre, fading out smoothly over an
    ellipse 0.45 x 0.28 interocular distances (lids and lashes inside, brows and rims outside)."""
    Y, X = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    iod = float(np.linalg.norm(L[473] - L[468]))
    my = Y.copy()
    for c in (L[468], L[473]):
        dx, dy = X - c[0], Y - c[1]
        w = smooth(1 - np.sqrt((dx / (0.45 * iod)) ** 2 + (dy / (0.28 * iod)) ** 2))
        my += dy * (1 / (1 - (1 - k) * w) - 1)
    return X, my


def lens_fit(rgba: np.ndarray, kp: dict) -> dict:
    return LK.find_lenses(over(rgba), kp)


def rim_ratio(lenses: dict, kp: dict) -> float:
    d = LK.derived(kp)
    return float(np.mean([2 * lenses[s]["rx"] for s in ("l", "r")])) / d["fw"]


def face_weights(rgba: np.ndarray, L: np.ndarray) -> dict:
    """Soft region weights on a face close-up (sum <= 1 per pixel)."""
    sh = rgba.shape[:2]
    Lb = lab(rgba[..., :3])
    Lc, C = Lb[..., 0], np.hypot(Lb[..., 1], Lb[..., 2])
    hue = np.degrees(np.arctan2(Lb[..., 2], Lb[..., 1]))
    fg = (rgba[..., 3] > 0).astype(np.float32)      # weights ignore alpha: edge pixels get the same grade
    kp = LK.keypoints_from_mesh(L)
    d = LK.derived(kp)
    Y, X = np.mgrid[0:sh[0], 0:sh[1]]
    lips = feather(dilate(poly_mask(sh, L[LK.LIP_OUT]) & ~poly_mask(sh, L[LK.LIP_IN]), 2), 2)
    ir = kp["iris_radius"]
    # dark pixels only: on a closed-eye variant the same disc holds lid skin, which must get the skin grade
    iris = feather(ellipse_mask(sh, d["el"], ir, ir) | ellipse_mask(sh, d["er"], ir, ir), 1.5) * smooth((48 - Lc) / 10)
    white = feather((C < 8) & (Lc > 72), 1)
    oval = poly_mask(sh, L[LK.OVAL])
    # where skin may be dark (shadowed cheek, under the chin, neck): the face oval and the neck below it;
    # elsewhere only bright skin-coloured pixels (ears) count, so mid-tone hair is never taken for skin
    neck = (Y > kp["chin"][1] - 0.1 * d["h"]) & (X > kp["face_l"][0] + 0.12 * d["fw"]) & (X < kp["face_r"][0] - 0.12 * d["fw"])
    zone = feather(dilate(oval, int(0.02 * d["fw"])) | neck, 3)
    l_min = 36 * zone + 58 * (1 - zone)
    skinlike = smooth((C - 5) / 5) * smooth((Lc - l_min) / 8) * smooth((hue - 25) / 10) * smooth((95 - hue) / 10)
    skin = skinlike * (1 - lips) * (1 - iris) * (1 - white) * fg
    core = feather(erode(oval, int(0.04 * d["fw"])) & (Y > kp["brow_y"] - 0.02 * d["h"]), 3)
    gate = np.maximum(smooth((C - 3) / 3), smooth((50 - Lc) / 8))
    hair = (1 - skin).clip(0, 1) * (1 - white) * (1 - core) * (1 - lips) * (1 - iris) * gate * fg
    return {"hair": hair.astype(np.float32), "skin": skin.astype(np.float32),
            "iris": (iris * fg).astype(np.float32), "lips": (lips * fg).astype(np.float32)}


def body_weights(rgba: np.ndarray, head_top_band: float) -> dict:
    """Colour-only region weights on the full body: skin anywhere; hair only above head_top_band (y)."""
    Lb = lab(rgba[..., :3])
    Lc, C = Lb[..., 0], np.hypot(Lb[..., 1], Lb[..., 2])
    hue = np.degrees(np.arctan2(Lb[..., 2], Lb[..., 1]))
    fg = rgba[..., 3] > 0
    Y = np.mgrid[0:rgba.shape[0], 0:rgba.shape[1]][0]
    # skin down to its shadows (L* 30+); hue from 30 deg keeps the plaid's red pinstripes (hue ~25) out
    skin = smooth((C - 5) / 5) * smooth((Lc - 30) / 8) * smooth((hue - 30) / 8) * smooth((95 - hue) / 10) * fg
    white = (C < 8) & (Lc > 72)
    hair = (1 - skin).clip(0, 1) * ~white * smooth((C - 3) / 3) * smooth((62 - Lc) / 6) * (Y < head_top_band) * fg
    return {"skin": skin.astype(np.float32), "hair": hair.astype(np.float32)}


def apply_grade(rgba: np.ndarray, W: dict, params: dict) -> np.ndarray:
    """Per region: L *= kL; (a, b) rotated by rot deg and scaled by kC; blended by the region weight."""
    Lb = lab(rgba[..., :3])
    out = Lb.copy()
    for name, w in W.items():
        kL, rot, kC = params[name]
        t = np.deg2rad(rot)
        if name == "hair":
            # the reference's hair median is a night-lit, almost neutral dark; turn only the dark mass toward
            # its hue and leave the highlights warm (turned too, they read olive)
            t = t * smooth((52 - Lb[..., 0]) / 22)
        a2 = (Lb[..., 1] * np.cos(t) - Lb[..., 2] * np.sin(t)) * kC
        b2 = (Lb[..., 1] * np.sin(t) + Lb[..., 2] * np.cos(t)) * kC
        new = np.dstack([np.clip(Lb[..., 0] * kL, 0, 100), a2, b2])
        out += (new - Lb) * w[..., None]
    res = rgba.copy()
    res[..., :3] = from_lab(out)
    return res


def fit_grade(rgba: np.ndarray, W: dict, kp: dict, ref_cols: dict, rounds: int = 4):
    """Closed loop on the harness's own palette sampler: update each region's (kL, rot, kC) by the
    ratio / angle still left between reference and graded medians."""
    params = {k: [1.0, 0.0, 1.0] for k in W}
    log = []
    for r in range(rounds):
        g = apply_grade(rgba, W, params)
        rgb = over(g)
        cols, _ = LK.palette(rgb, LK.lab_of(rgb), kp)
        row = {}
        for k in W:
            a, b = ref_cols[k][0], cols[k][0]
            de = float(deltaE_ciede2000(a, b))
            row[k] = round(de, 2)
            ca, cb = np.hypot(a[1], a[2]), np.hypot(b[1], b[2])
            params[k][0] *= a[0] / b[0]
            dh = float((np.degrees(np.arctan2(a[2], a[1]) - np.arctan2(b[2], b[1])) + 180) % 360 - 180)
            if ca >= LK.HUE_MIN_CHROMA:
                params[k][1] += dh
                params[k][2] *= ca / max(cb, 1e-3)
            else:
                # the reference is near-neutral (iris C* 5): rotating hue would turn brown irises green, so
                # keep our hue and take the chroma closest to the reference along it, C_ref * cos(dhue)
                params[k][2] *= max(0.05, ca * np.cos(np.deg2rad(dh))) / max(cb, 1e-3)
        log.append(row)
    return params, log


# ------------------------------------------------------------------ face variants

def face_regions(L: np.ndarray, shape) -> dict:
    el, er = L[468], L[473]
    iod = float(np.linalg.norm(er - el))
    mouth = (L[61] + L[291]) / 2
    lids = ellipse_mask(shape, el, 0.30 * iod, 0.17 * iod) | ellipse_mask(shape, er, 0.30 * iod, 0.17 * iod)
    return {"iod": iod, "blink": lids,
            "talk": ellipse_mask(shape, mouth + [0, 0.05 * iod], 0.55 * iod, 0.27 * iod),
            "smile": ellipse_mask(shape, mouth, 0.70 * iod, 0.33 * iod)}


def variant_drift(base: np.ndarray, var: np.ndarray, region: np.ndarray) -> dict:
    """CIEDE2000 per pixel between base and edit, inside the intended region and outside it
    (a 12 px band around the region is excluded so its edge is not counted)."""
    de = deltaE_ciede2000(lab(base), lab(var))
    outside = ~dilate(region, 12)
    g0, g1 = cv2.cvtColor(base, cv2.COLOR_RGB2GRAY), cv2.cvtColor(var, cv2.COLOR_RGB2GRAY)
    _, ssim_map = structural_similarity(g0, g1, data_range=255, full=True)
    return {"inside": stat(de[region]), "outside": stat(de[outside]),
            "ssim_outside": round(float(ssim_map[outside].mean()), 4),
            "region_px": int(region.sum()), "outside_px": int(outside.sum()), "_de": de}


def patch_variant(base: np.ndarray, var: np.ndarray, region: np.ndarray, sigma: float):
    """Paste the edit inside region only. The edit's colour is first matched to the base on a ring just
    outside the region (where the edit should be a no-op), so the patch carries no global shift."""
    ring = dilate(region, 28) & ~dilate(region, 10)
    Lb, Lv = lab(base), lab(var)
    shift = np.median(Lb[ring], 0) - np.median(Lv[ring], 0)
    var_c = from_lab(Lv + shift)
    w = feather(dilate(region, int(sigma)), sigma)[..., None]
    return np.clip(base * (1 - w) + var_c * w + 0.5, 0, 255).astype(np.uint8), shift


# ------------------------------------------------------------------ step 1: face

def step_face(M: dict) -> dict:
    ref_info = LK.analyse_face(REF, None, "ref")
    rr = LK.ratios(ref_info)
    ref_ratio, ref_open = rr["glasses_rim_diameter_over_face_width"], rr["eye_opening_over_eye_width"]
    raw = load_rgb("face_hd.png")
    keyed = chroma_key(raw)
    L0 = mesh(over(keyed))
    assert L0 is not None, "face mesh failed on face_hd.png"
    kp0 = LK.keypoints_from_mesh(L0)

    # glasses: paint out the generated frame and redraw a clean round one at the reference's rim/face-width
    # ratio; the radius is corrected once by the harness's own lens finder on the graded result
    lenses0 = lens_fit(keyed, kp0)
    gmask, circles = glasses_mask(keyed, kp0, lenses0)
    colours = GLASSES_RGB

    def bare_of(k_rgba):
        out = k_rgba.copy()
        out[..., :3] = cv2.inpaint(np.ascontiguousarray(k_rgba[..., :3]), gmask.astype(np.uint8), 5, cv2.INPAINT_TELEA)
        return out
    bare = bare_of(keyed)
    k_eye = 1.0
    mx, my = eye_maps(keyed.shape[:2], L0, k_eye)
    squashed = unpremul(remap(premul(bare), mx, my))
    d0 = LK.derived(kp0)
    r_new = ref_ratio * d0["fw"] / 2
    hist = [{"r_px": round(float(np.mean([c[2] for c in circles.values()])), 2), "note": "generated frame, circle fit"}]
    for _ in range(2):
        drawn = draw_glasses(squashed, circles, r_new, kp0, colours)
        Ld = mesh(over(drawn)); kpd = LK.keypoints_from_mesh(Ld)
        Wd = face_weights(drawn, Ld)
        pd, _ = fit_grade(drawn, Wd, kpd, ref_info["cols"], rounds=3)
        graded = apply_grade(drawn, Wd, pd)
        kpg = LK.keypoints_from_mesh(mesh(over(graded)))
        info = LK.ratios({"kp": kpg, "lenses": {q: dict(v, source="image") for q, v in lens_fit(graded, kpg).items()},
                          "fringe_y": None})
        hist.append({"r_px": round(r_new, 2),
                     "rim_rel": round(info["glasses_rim_diameter_over_face_width"] / ref_ratio - 1, 4),
                     "open_rel": round(info["eye_opening_over_eye_width"] / ref_open - 1, 4)})
        r_new *= ref_ratio / info["glasses_rim_diameter_over_face_width"]
    best = min(hist[1:], key=lambda h: abs(h["rim_rel"]))
    r_new = best["r_px"]
    warped = draw_glasses(squashed, circles, r_new, kp0, colours)
    save(np.dstack([np.where(gmask[..., None], [255, 0, 255], over(keyed)).astype(np.uint8), keyed[..., 3]]),
         HERE / "work" / "glasses_mask.png")
    save(bare, HERE / "work" / "glasses_removed.png")
    L = mesh(over(warped))
    kp = LK.keypoints_from_mesh(L)

    W = face_weights(warped, L)
    params, glog = fit_grade(warped, W, kp, ref_info["cols"])
    face = apply_grade(warped, W, params)
    save(face, ART / "face.png")
    M["face"] = {"size": list(raw.shape[1::-1]),
                 "source": "src/face_hd.png keyed, generated glasses painted out and redrawn, LAB grade",
                 "glasses": {"ref_rim_ratio": round(ref_ratio, 4), "ref_eye_opening": round(ref_open, 4),
                             "old_circles_px": {q: [round(v, 1) for v in c] for q, c in circles.items()},
                             "mask_px": int(gmask.sum()), "colours_dark_light": [[float(x) for x in c] for c in colours],
                             "radius_iterations": hist, "chosen": best, "eye_squash_k": k_eye},
                 "grade": {"params_kL_rotdeg_kC": {k: [round(x, 4) for x in v] for k, v in params.items()},
                           "dE_per_round": glog}}

    def finish(raw_rgb):
        k = unpremul(remap(premul(bare_of(chroma_key(raw_rgb))), mx, my))
        drawn_v = draw_glasses(k, circles, r_new, kp0, colours)
        return apply_grade(drawn_v, face_weights(drawn_v, L), params)   # colour gates from the variant itself

    # variants: patch only the intended region of the edit, then the same key, warp and grade
    regs = face_regions(L0, raw.shape[:2])
    out, sheet = {"base": face}, [Image.fromarray(over(face)).resize((384, 384), Image.LANCZOS)]
    info = {}
    for name in ("smile", "blink", "talk"):
        var = load_rgb(f"face_{name}.png")
        d = variant_drift(raw, var, regs[name])
        de = d.pop("_de")
        patched, shift = patch_variant(raw, var, regs[name], 6.0)
        dc = variant_drift(raw, patched, regs[name]); dc.pop("_de")
        Lv = mesh(var)
        info[name] = {"raw_edit": d, "after_patch": {"inside": dc["inside"], "outside": dc["outside"],
                                                     "ssim_outside": dc["ssim_outside"]},
                      "ring_lab_shift": [round(float(x), 2) for x in shift]}
        if Lv is not None:
            info[name]["mesh"] = {"lid_gap_px": round(float(np.mean([Lv[145][1] - Lv[159][1], Lv[374][1] - Lv[386][1]])), 1),
                                  "lip_gap_px": round(float(Lv[14][1] - Lv[13][1]), 1)}
        fv = finish(patched)
        out[name] = fv
        save(fv, ART / f"face_{name}.png")
        heat = np.clip(de / 10.0, 0, 1)
        hm = (np.dstack([heat, heat * 0.3, 1 - heat]) * 255).astype(np.uint8)
        cs, _ = cv2.findContours(regs[name].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(hm, cs, -1, (255, 255, 255), 3)
        sheet += [Image.fromarray(over(fv)).resize((384, 384), Image.LANCZOS),
                  Image.fromarray(hm).resize((384, 384), Image.NEAREST)]
    info["base_mesh"] = {"lid_gap_px": round(float(np.mean([L0[145][1] - L0[159][1], L0[374][1] - L0[386][1]])), 1),
                         "lip_gap_px": round(float(L0[14][1] - L0[13][1]), 1)}
    M["face_variants"] = info
    canvas = Image.new("RGB", (384 * len(sheet), 384), "white")
    for i, im in enumerate(sheet):
        canvas.paste(im, (384 * i, 0))
    canvas.save(ART / "face_variants_sheet.png")
    return {"L": L, "L0": L0, "kp": kp, "faces": out, "params": params, "ref": ref_info,
            "lenses": lens_fit(face, kp)}


# ------------------------------------------------------------------ step 2: hybrid master (HD head ships)

def step_hybrid(M: dict, F: dict) -> dict:
    master = load_rgb("master.png")
    shutil.copyfile(SRC / "master.png", ART / "master.png")
    x, y, s = HB["x"], HB["y"], HB["side"]
    up = np.array(Image.fromarray(master[y:y + s, x:x + s]).resize((1024, 1024), Image.LANCZOS))
    Lm = mesh(up)
    assert Lm is not None, "face mesh failed on the master head box"
    Lm = Lm * (s / 1024.0) + [x, y]
    stable = LK.OVAL + [33, 133, 362, 263, 1, 2, 61, 291, 152, 168]
    A, _ = cv2.estimateAffinePartial2D(F["L0"][stable].astype(np.float32), Lm[stable].astype(np.float32),
                                       method=cv2.LMEDS)
    res = np.linalg.norm(apply_affine(A, F["L0"][stable]) - Lm[stable], axis=1)
    sh = master.shape[:2]
    chin = apply_affine(A, F["L0"][152])[0]
    cut_y = float(chin[1] + 6)
    Y = np.mgrid[0:sh[0], 0:sh[1]][0].astype(np.float32)
    w_head = (1 - smooth((Y - (cut_y - 4)) / 8))[..., None]
    w_head[:, :x - 10] = 0
    w_head[:, x + s + 10:] = 0

    body_k = chroma_key(master)
    BW = body_weights(body_k, cut_y + 120)
    P = F["params"]
    body_g = apply_grade(body_k, BW, {"skin": P["skin"], "hair": P["hair"]})

    def hybrid(face_rgba, body_rgba=body_g):
        fw = premul(warp_rgba(face_rgba, A, (sh[1], sh[0])))
        return unpremul(fw * w_head + premul(body_rgba) * (1 - w_head))

    rest = hybrid(F["faces"]["base"])
    M["hybrid"] = {"head_box": HB, "A_face_to_master": A.round(5).tolist(), "scale": round(float(np.sqrt(np.linalg.det(A[:, :2]))), 5),
                   "register_residual_px": stat(res), "cut_y": round(cut_y, 1)}
    return {"master": master, "body_g": body_g, "rest": rest, "A": A, "cut_y": cut_y, "hybrid": hybrid,
            "grade_body": lambda k: apply_grade(k, body_weights(k, cut_y + 120), {"skin": P["skin"], "hair": P["hair"]})}


# ------------------------------------------------------------------ step 3: layers

def classes(rgba: np.ndarray) -> dict:
    hsv = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2HSV).astype(int)
    S, V = hsv[..., 1], hsv[..., 2]
    Lb = lab(rgba[..., :3])
    C = np.hypot(Lb[..., 1], Lb[..., 2])
    hue = np.degrees(np.arctan2(Lb[..., 2], Lb[..., 1]))
    skin_hue = (hue > 30) & (hue < 95)
    fg = rgba[..., 3] > 127
    return {"fg": fg, "white": fg & (S < 40) & (V > 170), "dark": fg & (V < 70),
            "skin": fg & (C >= 7) & (Lb[..., 0] >= 40) & skin_hue,
            "hair": fg & (Lb[..., 0] < 55) & (C >= 3),
            # grey plaid with navy and red lines: neutral, or off the skin hues (graded skin is low-chroma
            # too, so saturation alone no longer separates skirt from thigh)
            "plaid": fg & (Lb[..., 0] > 20) & (Lb[..., 0] < 80) & ((C < 6) | ~skin_hue)}


def cut(rgba: np.ndarray, m: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    out[~m] = 0
    return out


def extend_up(layer: np.ndarray, where: np.ndarray, rows: int) -> np.ndarray:
    out = layer.copy()
    for _ in range(rows):
        below = np.zeros_like(out); below[:-1] = out[1:]
        fill = where & (out[..., 3] == 0) & (below[..., 3] > 0)
        out[fill] = below[fill]
    return out


def inpaint(layer: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """Fill hole from the layer's own opaque pixels: transparent neighbours are marked unknown too, or
    TELEA would pull their black RGB into the fill (seen as a dark bar under the moved sleeve)."""
    out = layer.copy()
    unknown = hole | ((layer[..., 3] == 0) & dilate(hole, 12))
    rgb = cv2.inpaint(layer[..., :3].copy(), unknown.astype(np.uint8), 7, cv2.INPAINT_TELEA)
    out[hole, :3] = rgb[hole]
    out[hole, 3] = 255
    return out


ORDER = ["back_hair", "legs", "torso", "arm_r", "arm_l", "head", "front_hair"]


def composite_layers(layers: dict, order) -> np.ndarray:
    h, w = next(iter(layers.values())).shape[:2]
    acc = np.zeros((h, w, 4), np.float32)
    for k in order:
        f = premul(layers[k])
        acc = f + acc * (1 - f[..., 3:4])
    return unpremul(acc)


def step_layers(M: dict, F: dict, H: dict) -> dict:
    rest = H["rest"]
    sh = rest.shape[:2]
    C = classes(rest)
    soft = rest[..., 3] > 0
    Y, X = np.mgrid[0:sh[0], 0:sh[1]]
    A = H["A"]
    Lm = apply_affine(A, F["L"])
    kpm = LK.keypoints_from_mesh(Lm)
    d = LK.derived(kpm)
    ov_m = Lm[LK.OVAL]
    oval = poly_mask(sh, ov_m)
    eye_y, brow_y, cut_y = d["eye_y"], kpm["brow_y"], H["cut_y"]
    hx0, hx1 = HB["x"], HB["x"] + HB["side"]
    arc = ov_m[ov_m[:, 1] > eye_y]
    jaw = poly_mask(sh, np.vstack([[[hx0, 0], [hx1, 0], [hx1, arc[0, 1]]], arc, [[hx0, arc[-1, 1]]]]))
    head_zone = (X >= hx0) & (X <= hx1) & (Y < cut_y + 40)
    hairish = dilate(C["hair"], 2) & soft & ~dilate(C["white"], 1)
    head_m = head_zone & soft & (jaw | oval | hairish | ((Y < cut_y - 2) & ~C["white"]))
    head_m &= ~((Y > cut_y - 2) & ~hairish)                # neck and collar below the cut stay on the torso
    fl, fr = kpm["face_l"][0], kpm["face_r"][0]
    # back hair: the low tie and everything hair-coloured behind the head below the jaw line
    back = hairish & head_m & ~dilate(oval, 3) & (Y > d["mouth"][1]) & (X > d["mid"][0] + 0.25 * d["fw"])
    fringe = hairish & head_m & (X >= fl) & (X <= fr) & (Y <= brow_y - 2) & (Y >= brow_y - 0.9 * d["h"])
    strands = hairish & head_m & ((X < fl + 0.10 * d["fw"]) | (X > fr - 0.10 * d["fw"])) & (Y > brow_y) & ~back
    front_hair = fringe | strands
    head_only = head_m & ~back & ~front_hair

    arm_r = poly_mask(sh, ARM_R_POLY) & soft & ~head_m
    in_l = poly_mask(sh, ARM_ZONE)
    # below the shirt hem: the hand on the hip inside a polygon read off a grid of the master (skin plus 3 px
    # of its shadow, so the skirt between the fingers stays on the torso), and the forearm right of the hip
    raise_k = H["grade_body"](chroma_key(load_rgb("raise.png")))
    hand_poly = poly_mask(sh, HAND_POLY)
    hand = hand_poly & soft & dilate(C["skin"] & hand_poly, 3)
    fore = in_l & soft & (X >= 668) & (Y >= 540) & (Y <= 630)
    arm_l = (in_l & soft & ~head_m & (Y < 540)) | hand | fore
    plaid = C["plaid"] | C["dark"]
    hem = np.full(sh[1], 10_000)
    for x in range(355, 720):
        col = np.nonzero(plaid[600:960, x])[0]
        if col.size:
            hem[x] = 600 + col.max() + 1
    hem_y = np.where(hem < 10_000, hem, 0)
    legs = soft & ~arm_r & ~arm_l & (Y >= np.maximum(hem_y[None, :], 800)) & ((X > 368) | (Y > 905))
    torso = soft & ~head_m & ~arm_r & ~arm_l & ~legs

    L = {k: cut(rest, v) for k, v in dict(back_hair=back, legs=legs, torso=torso, arm_r=arm_r, arm_l=arm_l,
                                           head=head_only, front_hair=front_hair).items()}
    opaque = rest[..., 3] == 255
    L["legs"] = extend_up(L["legs"], (Y > 760) & (Y < 960) & torso & opaque, 40)
    neck_zone = (X >= d["mid"][0] - 0.25 * d["fw"]) & (X <= d["mid"][0] + 0.25 * d["fw"]) & \
                (Y > kpm["chin"][1] - 0.25 * d["h"]) & (Y < cut_y + 8) & head_m & opaque
    L["torso"] = extend_up(L["torso"], neck_zone, 60)
    # hidden hip and waist under the hand come from the raise edit
    borrow = dilate(hand, 3) & (Y >= 540) & ~fore
    L["torso"][borrow] = raise_k[borrow]
    under_arms = (arm_r | (arm_l & (Y < 440))) & dilate(torso, 8)
    L["torso"] = inpaint(L["torso"], under_arms & opaque & (L["torso"][..., 3] == 0))
    # under the front hair: forehead skin (inpainted) inside the face oval, a copy of the hair itself outside
    # it, so a swaying strand uncovers hair, not a skin-coloured seam
    face_skin_zone = dilate(oval, 6)
    hair_under = front_hair & ~face_skin_zone & opaque
    L["head"] = inpaint(L["head"], front_hair & face_skin_zone & opaque & (L["head"][..., 3] == 0))
    L["head"][hair_under] = rest[hair_under]
    loose = soft & ~(back | legs | torso | arm_r | arm_l | head_only | front_hair)
    L["torso"][loose & ~head_zone] = rest[loose & ~head_zone]
    L["head"][loose & head_zone] = rest[loose & head_zone]

    # closed-eye head: the same cut on the hybrid built from the blink face
    rest_closed = H["hybrid"](F["faces"]["blink"])
    head_closed = cut(rest_closed, head_only)
    head_closed = inpaint(head_closed, front_hair & face_skin_zone & (rest_closed[..., 3] == 255) &
                          (head_closed[..., 3] == 0))
    head_closed[hair_under] = rest_closed[hair_under]
    head_closed[loose & head_zone] = rest_closed[loose & head_zone]
    for k, v in L.items():
        save(v, LAYERS / f"{k}.png")
    save(head_closed, LAYERS / "head_closed.png")

    tint = {"back_hair": (160, 60, 200), "legs": (60, 160, 230), "torso": (240, 200, 60), "arm_r": (60, 200, 90),
            "arm_l": (230, 90, 60), "head": (250, 150, 190), "front_hair": (120, 70, 20)}
    ov = np.full(sh + (3,), 255, np.uint8)
    for k in ORDER:
        m = L[k][..., 3] > 127
        ov[m] = (0.45 * rest[m, :3] + 0.55 * np.array(tint[k])).astype(np.uint8)
    hidden_any = np.zeros(sh, bool)
    for k in ("torso", "legs", "head"):
        orig = {"torso": torso | loose, "legs": legs, "head": head_only | loose}[k]
        hidden_any |= (L[k][..., 3] > 0) & ~orig
    lay = Image.fromarray(np.hstack([over(rest), ov, over(np.dstack([
        np.where(hidden_any[..., None], [255, 0, 255], rest[..., :3]).astype(np.uint8),
        np.where(hidden_any, 255, rest[..., 3]).astype(np.uint8)]))]))
    lay.resize((lay.width // 2, lay.height // 2), Image.LANCZOS).save(ART / "layers_sheet.png")
    comp = composite_layers(L, ORDER)
    diff = np.abs(comp.astype(int) - rest.astype(int)).max(-1)
    M["layers"] = {"method": "face-mesh polygons (oval, jaw, brow line) + LAB/HSV colour classes on the keyed "
                             "hybrid + hand-placed arm polygons; hidden hip from the raise edit, rest TELEA inpaint",
                   "px": {k: int((v[..., 3] > 0).sum()) for k, v in L.items()},
                   "hidden_px_filled": int(hidden_any.sum()), "hip_px_from_raise_edit": int(borrow.sum()),
                   "recomposite_vs_rest_maxabs_rgba": int(diff.max()),
                   "recomposite_px_diff_gt_8": int((diff > 8).sum())}
    return {"L": L, "head_closed": head_closed, "kpm": kpm, "d": d, "torso_m": torso, "arm_l_m": arm_l}


# ------------------------------------------------------------------ app framing

def fixed_box(*alphas) -> tuple:
    ys, xs = np.nonzero(np.logical_or.reduce([a > 0 for a in alphas]))
    l, t, r, b = xs.min() - APP_PAD, ys.min() - APP_PAD, xs.max() + 1 + APP_PAD, ys.max() + 1 + APP_PAD
    sc = min(APP_W / (r - l), APP_H / (b - t))
    return int(l), int(t), int(r), int(b), sc


def to_app(rgba: np.ndarray, box, scale: int = 1) -> np.ndarray:
    l, t, r, b, sc = box
    pad = np.zeros((max(0, b) + 1, max(0, r) + 1, 4), np.uint8)
    hh, ww = min(rgba.shape[0], pad.shape[0]), min(rgba.shape[1], pad.shape[1])
    pad[:hh, :ww] = rgba[:hh, :ww]
    crop = Image.fromarray(pad[max(0, t):b, max(0, l):r], "RGBA").convert("RGBa")
    nw, nh = max(1, round((r - l) * sc)), max(1, round((b - t) * sc))
    small = crop.resize((nw, nh), Image.LANCZOS).convert("RGBA")
    cell = Image.new("RGBA", (APP_W, APP_H))
    cell.alpha_composite(small, ((APP_W - nw) // 2, APP_H - nh))
    if scale > 1:
        cell = cell.resize((APP_W * scale, APP_H * scale), Image.NEAREST)
    return np.array(cell)


def strip_png(frames: list, labels: list, path: Path, bg=(128, 128, 128)):
    strip = Image.new("RGB", (len(frames) * APP_W * 2, APP_H * 2 + 16), bg)
    dr = ImageDraw.Draw(strip)
    for j, (a, lab_) in enumerate(zip(frames, labels)):
        cell = Image.fromarray(over(a, bg)).resize((APP_W * 2, APP_H * 2), Image.NEAREST)
        strip.paste(cell, (j * APP_W * 2, 16))
        dr.text((j * APP_W * 2 + 4, 2), lab_, fill=(255, 255, 255))
    strip.save(path)


# ------------------------------------------------------------------ step 4: idle

def rot_maps(X, Y, pivot, deg, dy=0.0):
    t = np.deg2rad(deg)
    px, py = pivot
    xs, ys = X - px, Y - dy - py
    return px + np.cos(t) * xs + np.sin(t) * ys, py - np.sin(t) * xs + np.cos(t) * ys


def breathe_s(Y):
    return np.clip((WAIST_Y - Y) / (WAIST_Y - SHOULDER_Y), 0, 1)


def make_renderer(Ly: dict, sh, neck_pivot, w_hair_rows):
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    P = {k: premul(v) for k, v in Ly["L"].items()}
    P_closed = premul(Ly["head_closed"])
    w_hair = smooth((Y - w_hair_rows[0]) / (w_hair_rows[1] - w_hair_rows[0]))

    def render(rise=0.0, tilt=0.0, sway=0.0, bw=0.0, arm_l=None):
        out = np.zeros(sh + (4,), np.float32)

        def put(f):
            nonlocal out
            out = f + out * (1 - f[..., 3:4])

        by = Y + rise * breathe_s(Y)
        rx, ry = rot_maps(X, Y, neck_pivot, tilt, dy=-rise)
        put(remap(P["back_hair"], rx, ry))
        put(P["legs"])
        put(remap(P["torso"], X, by))
        put(remap(P["arm_r"], X, Y + rise))
        put(remap(P["arm_l"], X, by) if arm_l is None else remap(arm_l, X, Y + rise))
        put(remap(P["head"] * (1 - bw) + P_closed * bw, rx, ry))
        put(remap(remap(P["front_hair"], X - sway * w_hair, Y), rx, ry))
        return unpremul(out)
    return render


def step_idle(M: dict, H: dict, Ly: dict, box, render) -> None:
    rest = H["rest"]
    N, FPS = 48, 12
    R_BREATH, TILT, SWAY = 4.0, 1.4, 4.0
    blink_w = {40: 0.5, 41: 1.0, 42: 1.0, 43: 0.5}
    frames, params = [], []
    for i in range(N):
        ph = 2 * np.pi * i / N
        rise = R_BREATH * (1 - np.cos(ph)) / 2
        tilt = TILT * np.sin(ph + 0.6)
        sway = SWAY * np.sin(ph - 0.2) + 0.8 * TILT * np.cos(ph + 0.6)
        bw = blink_w.get(i, 0.0)
        frames.append(render(rise, tilt, sway, bw))
        params.append({"i": i, "rise_px": round(rise, 2), "tilt_deg": round(tilt, 2), "hair_tip_px": round(sway, 2),
                       "blink": bw})
    if IDLE.exists():
        shutil.rmtree(IDLE)
    IDLE.mkdir(parents=True)
    small = []
    for i, fr in enumerate(frames):
        a = to_app(fr, box)
        save(a, IDLE / f"idle_{i:02d}.png")
        small.append(a)
    f0 = to_app(rest, box).astype(int)
    d0 = np.abs(to_app(render(), box).astype(int) - f0).max(-1)
    motion = [int((np.abs(s_.astype(int) - small[0].astype(int))[..., :3].max(-1) > 16).sum()) for s_ in small]
    pick = sorted(set(list(range(0, N, 4)) + [41]))
    strip_png([small[i] for i in pick], [f"{i:02d}" + (" blink" if blink_w.get(i) else "") for i in pick],
              ART / "idle_strip_2x.png")
    gif = [Image.fromarray(over(s_, (128, 128, 128))).resize((APP_W * 2, APP_H * 2), Image.NEAREST) for s_ in small]
    gif[0].save(ART / "idle_2x.webp", save_all=True, append_images=gif[1:], duration=1000 // FPS, loop=0, lossless=True)
    ext = [int(np.argmax([p["tilt_deg"] for p in params])), int(np.argmin([p["tilt_deg"] for p in params])), 41]
    x0, y0, s = HB["x"], HB["y"], HB["side"]
    Image.fromarray(np.hstack([over(frames[e])[y0:y0 + s, x0:x0 + s] for e in [0] + ext])).resize(
        (4 * 2 * s, 2 * s), Image.LANCZOS).save(ART / "idle_heads_fullres_2x.png")
    M["idle"] = {"frames": N, "fps": FPS, "loop_ms": N * 1000 // FPS,
                 "amplitudes": {"breath_rise_px_master": R_BREATH, "head_tilt_deg": TILT, "hair_tip_px_master": SWAY},
                 "neutral_vs_rest_app_maxabs": int(d0.max()), "neutral_vs_rest_app_px_gt8": int((d0 > 8).sum()),
                 "loop_close_px_gt16_last_vs_first": int((np.abs(small[-1].astype(int) - small[0].astype(int))[..., :3]
                                                          .max(-1) > 16).sum()),
                 "changed_px_vs_frame0_gt16": motion, "extremes_frames": ext, "params": params}


# ------------------------------------------------------------------ step 5: wave from three arm keys

def split_arm(rgba: np.ndarray, J: dict):
    """Upper arm (sleeve) and forearm+hand by nearest bone segment; both keep a disc at the elbow so a
    bend opens onto skin, never onto a notch."""
    sh = rgba.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)

    def seg_dist(p, q):
        p, q = np.asarray(p, np.float32), np.asarray(q, np.float32)
        v = q - p
        t = np.clip(((X - p[0]) * v[0] + (Y - p[1]) * v[1]) / float(v @ v), 0, 1)
        return np.hypot(X - p[0] - t * v[0], Y - p[1] - t * v[1])

    du, df = seg_dist(J["S"], J["E"]), seg_dist(J["E"], J["W"])
    disc = np.hypot(X - J["E"][0], Y - J["E"][1]) < 20
    a = rgba[..., 3] > 0
    up, fo = rgba.copy(), rgba.copy()
    up[~(a & ((du <= df) | disc))] = 0
    fo[~(a & ((df < du) | disc))] = 0
    return premul(up), premul(fo)


def pose_arm(parts, J: dict, T: dict, size) -> np.ndarray:
    up, fo = parts
    Mu = similarity(J["S"], J["E"], T["S"], T["E"])
    Mf = similarity(J["E"], J["W"], T["E"], T["W"])
    wu = cv2.warpAffine(up, Mu, size, flags=cv2.INTER_LINEAR, borderValue=0)
    wf = cv2.warpAffine(fo, Mf, size, flags=cv2.INTER_LINEAR, borderValue=0)
    return wu + wf * (1 - wu[..., 3:4])


def skeleton(Ja: dict, Jb: dict, t: float, fore_dir: int) -> dict:
    S = np.array(Ja["S"], float)
    ua, ub = np.subtract(Ja["E"], S), np.subtract(Jb["E"], S)
    au, bu = ang(ua), ang(ub)
    du = (bu - au + 180) % 360 - 180
    lu = (1 - t) * np.hypot(*ua) + t * np.hypot(*ub)
    E = S + lu * np.array([np.cos(np.deg2rad(au + t * du)), np.sin(np.deg2rad(au + t * du))])
    fa, fb = np.subtract(Ja["W"], Ja["E"]), np.subtract(Jb["W"], Jb["E"])
    lf = (1 - t) * np.hypot(*fa) + t * np.hypot(*fb)
    turn = (ang(fb) - ang(fa)) % 360
    turn = turn if fore_dir > 0 else turn - 360
    af = ang(fa) + t * turn
    W = E + lf * np.array([np.cos(np.deg2rad(af)), np.sin(np.deg2rad(af))])
    return {"S": tuple(S), "E": tuple(E), "W": tuple(W)}


def wave_frames(M: dict, H: dict, Ly: dict, render) -> list:
    sh = H["rest"].shape[:2]
    size = (sh[1], sh[0])
    Y = np.mgrid[0:sh[0], 0:sh[1]][0]
    zone = poly_mask(sh, ARM_ZONE)
    arms = {"rest": Ly["L"]["arm_l"]}
    for k in ("raise", "wave"):
        key = H["grade_body"](chroma_key(load_rgb(f"{k}.png")))
        arms[k] = cut(key, zone & (Y < 520) & (key[..., 3] > 0))
    # colour drift of the edits' arms against the rest arm, in LAB medians of sleeve and skin
    drift = {}
    for k in ("raise", "wave"):
        row = {}
        for cls in ("white", "skin"):
            m0, m1 = classes(arms["rest"])[cls], classes(arms[k])[cls]
            a, b = np.median(lab(arms["rest"][..., :3])[m0], 0), np.median(lab(arms[k][..., :3])[m1], 0)
            row[cls] = round(float(deltaE_ciede2000(a[None], b[None])[0]), 2)
        drift[k] = row
    parts = {k: split_arm(v, JOINTS[k]) for k, v in arms.items()}

    u_steps = [smooth(i / 6) for i in range(7)]                 # 7 eased poses rest -> raise -> wave
    seq, meta = [], []
    for u in u_steps:
        if u <= 0.5:
            a_, b_, t, turn = "rest", "raise", u / 0.5, FORE_DIR["rest->raise"]
        else:
            a_, b_, t, turn = "raise", "wave", (u - 0.5) / 0.5, FORE_DIR["raise->wave"]
        T = skeleton(JOINTS[a_], JOINTS[b_], t, turn)
        wb = 1.0 if t >= 0.5 else 0.0      # swap keys mid-move; a crossfade double-exposes the hand
        arm = pose_arm(parts[a_], JOINTS[a_], T, size) * (1 - wb) + pose_arm(parts[b_], JOINTS[b_], T, size) * wb
        seq.append(arm)
        meta.append({"u": round(float(u), 3), "keys": f"{a_}->{b_}", "t": round(float(t), 3), "blend_b": round(wb, 3),
                     "E": [round(v, 1) for v in T["E"]], "W": [round(v, 1) for v in T["W"]]})
    # wave: forearm swings +-12 deg about the elbow on the wave key, 8 frames
    Jw = JOINTS["wave"]
    osc = []
    for i in range(8):
        a = 12 * np.sin(2 * np.pi * i / 8)
        fa = np.subtract(Jw["W"], Jw["E"])
        r = np.deg2rad(ang(fa) + a)
        T = {"S": Jw["S"], "E": Jw["E"], "W": tuple(np.array(Jw["E"]) + np.hypot(*fa) * np.array([np.cos(r), np.sin(r)]))}
        osc.append(pose_arm(parts["wave"], Jw, T, size))
        meta.append({"osc_deg": round(float(a), 1)})
    arms_seq = seq + osc + seq[::-1][1:]
    frames = [render(arm_l=a) for a in arms_seq]
    M["wave"] = {"frames": len(frames), "joints": JOINTS, "fore_dir": FORE_DIR, "poses": meta,
                 "key_arm_colour_dE_vs_rest": drift}
    return frames


def finish_wave(M: dict, H: dict, frames: list, box) -> None:
    save(frames[6], ART / "wave.png")
    save(to_app(frames[6], box), ART / "wave_139x340.png")
    if WAVE_DIR.exists():
        shutil.rmtree(WAVE_DIR)
    WAVE_DIR.mkdir(parents=True)
    small = []
    for i, f in enumerate(frames):
        a = to_app(f, box)
        save(a, WAVE_DIR / f"wave_{i:02d}.png")
        small.append(a)
    labels = [f"{i:02d}" for i in range(len(small))]
    strip_png(small[:15], labels[:15], ART / "wave_strip_2x.png")
    ms = [120, 90, 80, 80, 80, 90, 110] + [90] * 8 + [110, 90, 80, 80, 80, 120]
    gif = [Image.fromarray(over(s_, (128, 128, 128))).resize((APP_W * 2, APP_H * 2), Image.NEAREST) for s_ in small]
    gif[0].save(ART / "wave_2x.webp", save_all=True, append_images=gif[1:], duration=ms, loop=0, lossless=True)
    # full-res arm close-ups of the in-betweens (seams at elbow and shoulder)
    crops = [over(f, (128, 128, 128))[100:700, 540:920] for f in frames[:7]]
    Image.fromarray(np.hstack(crops)).save(ART / "wave_inbetweens_fullres.png")
    # what changes between rest and the wave key outside the arm zone, at app size
    r0, w6 = to_app(H["rest"], box).astype(int), small[6].astype(int)
    l, t_, r_, b_, sc = box
    zone_app = np.zeros((APP_H, APP_W), bool)
    zx0 = int((ARM_ZONE[-1][0] - 20 - l) * sc + (APP_W - round((r_ - l) * sc)) // 2)
    zone_app[:, max(0, zx0):] = True
    dd = np.abs(r0 - w6).max(-1)
    step = [int((np.abs(small[i + 1].astype(int) - small[i].astype(int)).max(-1) > 40).sum()) for i in range(6)]
    M["wave"].update({"ms": ms,
                 "rest_vs_wave_app_px_gt40_outside_arm_side": int(((dd > 40) & ~zone_app).sum()),
                 "rest_vs_wave_app_px_gt40_total": int((dd > 40).sum()),
                 "consecutive_app_px_gt40_first7": step})


# ------------------------------------------------------------------ probe, checks, compare sheet

def step_probe(M: dict, F: dict, H: dict, box) -> None:
    kp = {k: v for k, v in F["kp"].items() if not k.startswith("_")}
    kp["glasses"] = {s: {k: float(F["lenses"][s][k]) for k in ("cx", "cy", "rx", "ry")} for s in ("l", "r")}
    A = H["A"]
    l, t, r, b, sc = box
    ox, oy = (APP_W - round((r - l) * sc)) // 2, APP_H - round((b - t) * sc)

    def to_frame(p):
        q = apply_affine(A, p)[0]
        return [float((q[0] - l) * sc + ox), float((q[1] - t) * sc + oy)]
    k = float(np.sqrt(np.linalg.det(A[:, :2]))) * sc
    d = LK.derived(F["kp"])
    body = {"source": "probe: face.png mesh mapped through the face->master similarity and the app box",
            "eye_l": to_frame(kp["eye_l"]), "eye_r": to_frame(kp["eye_r"]),
            "iris_radius": kp["iris_radius"] * k, "face_w": d["fw"] * k,
            "glasses": {s: {"cx": to_frame((g["cx"], g["cy"]))[0], "cy": to_frame((g["cx"], g["cy"]))[1],
                            "rx": g["rx"] * k, "ry": g["ry"] * k} for s, g in kp["glasses"].items()}}
    kp["body"] = {"rest_139x340.png": body, "idle_00.png": body, "wave_139x340.png": body}
    kp["_about"] = ("Keypoints of artifacts/face.png in its own pixels (harness keypoints_from_mesh on face.png "
                    "over white; glasses from the harness find_lenses). body.* are the same points mapped into "
                    "the 139x340 frames through the registration used to composite face.png into rest.png.")
    (ART / "probe.json").write_text(json.dumps(kp, indent=1))

    # the head that ships vs face.png: face.png warped into master space against rest.png's head box
    x0, y0, s = HB["x"], HB["y"], HB["side"]
    sh = H["rest"].shape[:2]
    fw = warp_rgba(F["faces"]["base"], A, (sh[1], sh[0]))
    m = np.zeros(sh, bool); m[y0:int(H["cut_y"]) - 6, x0:x0 + s] = True
    m &= fw[..., 3] > 250
    g0 = cv2.cvtColor(over(fw)[y0:y0 + s, x0:x0 + s], cv2.COLOR_RGB2GRAY)
    g1 = cv2.cvtColor(over(H["rest"])[y0:y0 + s, x0:x0 + s], cv2.COLOR_RGB2GRAY)
    de = deltaE_ciede2000(lab(over(fw)), lab(over(H["rest"])))[m]
    M["shipped_head_vs_face_png"] = {"ssim_gray_headbox": round(float(structural_similarity(g0, g1, data_range=255)), 4),
                                     "deltaE_above_cut": stat(de)}
    up = Image.fromarray(H["rest"][y0:y0 + s, x0:x0 + s]).resize((1024, 1024), Image.LANCZOS)
    up.save(HERE / "work" / "shipped_head_1024.png")

    ref = Image.open(REF).convert("RGB")
    cells = [ref.resize((340 * ref.width // ref.height, 340), Image.LANCZOS),
             Image.fromarray(over(F["faces"]["base"])).resize((340, 340), Image.LANCZOS)]
    for n in ("rest_139x340.png", "wave_139x340.png"):
        cells.append(Image.fromarray(over(np.array(Image.open(ART / n)), (128, 128, 128))))
    for n in ("rest_139x340.png", "wave_139x340.png"):
        cells.append(Image.fromarray(over(np.array(Image.open(ART / n)), (128, 128, 128))).resize(
            (APP_W * 2, APP_H * 2), Image.NEAREST))
    W = sum(c.width for c in cells) + 10 * len(cells)
    sheet = Image.new("RGB", (W, 680), (235, 235, 235))
    x = 0
    for c in cells:
        sheet.paste(c, (x, 0)); x += c.width + 10
    sheet.save(ART / "compare_sheet.png")
    # dark-background check for key fringe
    hb = H["rest"][y0:y0 + s + 60, x0 - 30:x0 + s + 30]
    Image.fromarray(over(hb, (20, 24, 32))).resize((hb.shape[1] * 3, hb.shape[0] * 3), Image.LANCZOS).save(
        ART / "head_on_dark_3x.png")


def main() -> None:
    ART.mkdir(exist_ok=True)
    (HERE / "work").mkdir(exist_ok=True)
    M: dict = {"inputs": {p.name: {"size": list(Image.open(p).size)} for p in sorted(SRC.glob("*.png"))}}
    F = step_face(M)
    H = step_hybrid(M, F)
    Ly = step_layers(M, F, H)
    d, kpm = Ly["d"], Ly["kpm"]
    neck = (float(d["mid"][0]), float(kpm["chin"][1] + 4))
    render = make_renderer(Ly, H["rest"].shape[:2], neck, (kpm["brow_y"] - 0.6 * d["h"], kpm["chin"][1] + 10))
    # rest.png is the rig's own neutral frame, so rest, idle and wave all come from the same layers
    # (it differs from the hybrid only under the resting hand, where the torso borrows the raise edit)
    neutral = render()
    dn = np.abs(neutral.astype(int) - H["rest"].astype(int)).max(-1)
    M["rest_neutral_vs_hybrid"] = {"px_diff_gt8": int((dn > 8).sum()), "maxabs": int(dn.max())}
    H["rest"] = neutral
    save(neutral, ART / "rest.png")
    wf = wave_frames(M, H, Ly, render)
    box = fixed_box(H["rest"][..., 3], *[f[..., 3] for f in wf])      # one box for every frame
    save(to_app(H["rest"], box), ART / "rest_139x340.png")
    M["app_box"] = {"l_t_r_b": list(box[:4]), "scale": round(box[4], 5)}
    step_idle(M, H, Ly, box, render)
    finish_wave(M, H, wf, box)
    step_probe(M, F, H, box)
    (ART / "metrics.json").write_text(json.dumps(M, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else float(o)))
    print("glasses:", M["face"]["glasses"]["radius_iterations"])
    print("grade dE per round:", M["face"]["grade"]["dE_per_round"])
    print("variants outside dE mean after patch:", {k: M["face_variants"][k]["after_patch"]["outside"]["mean"]
                                                     for k in ("smile", "blink", "talk")})
    print("hybrid:", M["hybrid"]["register_residual_px"], "shipped head:", M["shipped_head_vs_face_png"])
    print("layers:", M["layers"]["recomposite_vs_rest_maxabs_rgba"], M["layers"]["recomposite_px_diff_gt_8"],
          "idle neutral:", M["idle"]["neutral_vs_rest_app_maxabs"])
    print("wave:", {k: M["wave"][k] for k in ("key_arm_colour_dE_vs_rest", "rest_vs_wave_app_px_gt40_outside_arm_side",
                                             "consecutive_app_px_gt40_first7")})


if __name__ == "__main__":
    main()

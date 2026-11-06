"""Frozen likeness harness for Tieu Mai. It measures how closely a candidate face and body frames match the
reference: palette colours, face geometry ratios, and legibility of the eyes and glasses at app size.

Usage:
  tools/skins/ai2d/.venv/Scripts/python.exe tools/skins/ai2d/harness/likeness.py --ref REF.png --cand FACE.png
      [--probe probe.json] [--body FRAME.png ...] --out DIR

Writes DIR/metrics.json and DIR/compare.png, prints a one-line summary.
Exit code 0 when every metric that ran passed, 1 when any failed, 2 on bad input.
RUBRIC.md maps each metric to the trait it backs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.color import deltaE_ciede2000, rgb2lab
from skimage.feature import hessian_matrix
from skimage.filters import sato

HERE = Path(__file__).resolve().parent
MODEL = HERE / "models" / "face_landmarker.task"
HARNESS_VERSION = "r1-1"
APP_W, APP_H, APP_PAD = 139, 340, 6

# Thresholds. Each sits above the reference's own noise floor and below the shift the matching
# perturbation in run_sensitivity.py produces.
DE_MAX = 6.0                 # CIEDE2000 per palette region
HUE_MAX = 12.0               # hue-angle difference, degrees, applied when both chromas >= HUE_MIN_CHROMA
HUE_MIN_CHROMA = 6.0
GEOM_TOL = {                 # |cand/ref - 1| per ratio metric
    "interocular_over_face_width": 0.06,
    "eye_width_over_face_width": 0.06,
    "eye_opening_over_eye_width": 0.13,
    "nose_to_mouth_over_face_height": 0.08,
    "glasses_rim_diameter_over_face_width": 0.06,
}
FRINGE_ABS_TOL = 0.06        # fringe-minus-brow offset, in eye-to-chin heights
RIM_SNR_MIN = 5.0            # glasses ring must stand out of the ridge background
EYE_CONTRAST_MIN = 3.0       # WCAG 2.1 SC 1.4.11 non-text contrast
RIM_DE_MIN = 5.0             # rim vs adjacent skin at app size, CIEDE2000

# MediaPipe face mesh indices (image-left = subject's right).
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
        148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
LIP_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
LIP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
BROWS = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55, 336, 296, 334, 293, 300, 285, 295, 282, 283, 276]

_landmarker = None


# ---------------------------------------------------------------- image io

def load_rgba(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"))


def over(rgba: np.ndarray, bg=(255, 255, 255)) -> np.ndarray:
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    out = rgba[..., :3].astype(np.float32) * a + np.array(bg, np.float32) * (1 - a)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def lab_of(rgb: np.ndarray) -> np.ndarray:
    return rgb2lab(rgb.astype(np.float64) / 255.0)


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ---------------------------------------------------------------- keypoints

def detect_mesh(rgb: np.ndarray):
    global _landmarker
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    if _landmarker is None:
        _landmarker = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL)), num_faces=1))
    res = _landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not res.face_landmarks:
        return None
    h, w = rgb.shape[:2]
    return np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]], np.float64)


def oval_edges_at(L: np.ndarray, y: float):
    poly = L[OVAL]
    xs = []
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        if (y0 - y) * (y1 - y) <= 0 and y0 != y1:
            xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    return (min(xs), max(xs)) if len(xs) >= 2 else (L[234][0], L[454][0])


def keypoints_from_mesh(L: np.ndarray) -> dict:
    eye_l, eye_r = L[468], L[473]
    iris_r = float(np.mean([np.linalg.norm(L[i] - L[468]) for i in (469, 470, 471, 472)] +
                           [np.linalg.norm(L[i] - L[473]) for i in (474, 475, 476, 477)]))
    eye_y = (eye_l[1] + eye_r[1]) / 2
    fl, fr = oval_edges_at(L, eye_y)
    return {
        "eye_l": eye_l.tolist(), "eye_r": eye_r.tolist(), "iris_radius": iris_r,
        "eye_l_corners": [L[33].tolist(), L[133].tolist()], "eye_r_corners": [L[362].tolist(), L[263].tolist()],
        "eye_l_lids": [L[159].tolist(), L[145].tolist()], "eye_r_lids": [L[386].tolist(), L[374].tolist()],
        "mouth_l": L[61].tolist(), "mouth_r": L[291].tolist(),
        "lip_upper": ((L[0] + L[13]) / 2).tolist(), "lip_lower": ((L[14] + L[17]) / 2).tolist(),
        "nose_base": L[2].tolist(), "chin": L[152].tolist(),
        "face_l": [fl, eye_y], "face_r": [fr, eye_y],
        "brow_y": float(np.mean(L[BROWS][:, 1])),
        "_lip_out": L[LIP_OUT].tolist(), "_lip_in": L[LIP_IN].tolist(),
    }


PROBE_REQUIRED = ["eye_l", "eye_r", "iris_radius", "mouth_l", "mouth_r", "face_l", "face_r", "chin"]


def keypoints_from_probe(probe: dict) -> dict:
    missing = [k for k in PROBE_REQUIRED if k not in probe]
    if missing:
        raise ValueError(f"probe.json missing required fields: {missing}")
    return {k: v for k, v in probe.items() if k != "body"}


def derived(kp: dict) -> dict:
    """Quantities every metric uses, computed the same way in mesh and probe mode."""
    el, er = np.array(kp["eye_l"], float), np.array(kp["eye_r"], float)
    eye_y = (el[1] + er[1]) / 2
    fw = float(kp["face_r"][0] - kp["face_l"][0])
    h = float(kp["chin"][1] - eye_y)
    ml, mr = np.array(kp["mouth_l"], float), np.array(kp["mouth_r"], float)
    return {"el": el, "er": er, "eye_y": eye_y, "fw": fw, "h": h, "ml": ml, "mr": mr,
            "iod": float(np.linalg.norm(er - el)), "mid": (el + er) / 2, "mouth": (ml + mr) / 2}


def sanity(kp: dict, shape) -> list[str]:
    d = derived(kp)
    probs = []
    if not d["el"][0] < d["er"][0]:
        probs.append("eye_l is not left of eye_r")
    if not (kp["face_l"][0] < d["el"][0] and d["er"][0] < kp["face_r"][0]):
        probs.append("eyes not inside face edges")
    if not d["eye_y"] < d["mouth"][1] < kp["chin"][1]:
        probs.append("vertical order eyes < mouth < chin broken")
    if d["fw"] < 0.25 * min(shape[:2]):
        probs.append(f"face width {d['fw']:.0f}px is under a quarter of the image; send a close-up")
    return probs


# ---------------------------------------------------------------- region sampling

def disk_mask(shape, c, r) -> np.ndarray:
    yy, xx = np.ogrid[:shape[0], :shape[1]]
    return (xx - c[0]) ** 2 + (yy - c[1]) ** 2 <= r * r


def robust_median(lab: np.ndarray, mask: np.ndarray):
    px = lab[mask]
    if len(px) < 5:
        return None, 0
    med = np.median(px, axis=0)
    keep = deltaE_ciede2000(px, np.broadcast_to(med, px.shape)) < 15
    if keep.sum() >= 5:
        med = np.median(px[keep], axis=0)
    return med, int(keep.sum())


def regions(rgb: np.ndarray, lab: np.ndarray, kp: dict) -> dict:
    d = derived(kp)
    shape = rgb.shape
    fw, h, r = d["fw"], d["h"], float(kp["iris_radius"])
    out = {}
    # Hair: temple patches high on the head plus the fringe above each eye, or the probe's points.
    brow = kp.get("brow_y", d["eye_y"] - 0.25 * h)
    hair_pts = kp.get("hair_points") or [[kp["face_l"][0] + 0.12 * fw, d["eye_y"] - 0.75 * h],
                                          [kp["face_r"][0] - 0.12 * fw, d["eye_y"] - 0.75 * h],
                                          [d["el"][0], brow - 0.25 * h], [d["er"][0], brow - 0.25 * h]]
    m = np.zeros(shape[:2], bool)
    for p in hair_pts:
        m |= disk_mask(shape, p, 0.05 * h)
    out["hair"] = (m, hair_pts)
    # Skin: cheeks under each eye and the chin pad, same rule in both modes.
    skin_pts = kp.get("skin_points") or [[d["el"][0], (d["eye_y"] + d["mouth"][1]) / 2 + 0.05 * h],
                                          [d["er"][0], (d["eye_y"] + d["mouth"][1]) / 2 + 0.05 * h],
                                          [d["mouth"][0], (d["mouth"][1] + kp["chin"][1]) / 2]]
    m = np.zeros(shape[:2], bool)
    for p in skin_pts:
        m |= disk_mask(shape, p, 0.05 * fw)
    out["skin"] = (m, skin_pts)
    # Iris: annulus without pupil and rim, inside the eye opening, highlights dropped later.
    m = np.zeros(shape[:2], bool)
    yy = np.arange(shape[0])[:, None]
    for c, lids in ((d["el"], kp.get("eye_l_lids")), (d["er"], kp.get("eye_r_lids"))):
        ring = disk_mask(shape, c, 0.85 * r) & ~disk_mask(shape, c, 0.35 * r)
        if lids:
            ring &= (yy > lids[0][1] + 1) & (yy < lids[1][1] - 1)
        m |= ring
    out["iris"] = (m, [d["el"].tolist(), d["er"].tolist()])
    # Sclera (plausibility only): beside the iris toward each corner.
    m = np.zeros(shape[:2], bool)
    for c, side in ((d["el"], -1), (d["el"], 1), (d["er"], -1), (d["er"], 1)):
        m |= disk_mask(shape, (c[0] + side * 1.55 * r, c[1]), 0.3 * r)
    out["sclera"] = (m, [])
    # Lips: mesh polygon ring, else ellipses on the probe's lip points.
    m = np.zeros(shape[:2], np.uint8)
    if "_lip_out" in kp:
        cv2.fillPoly(m, [np.round(np.array(kp["_lip_out"])).astype(np.int32)], 1)
        cv2.fillPoly(m, [np.round(np.array(kp["_lip_in"])).astype(np.int32)], 0)
        lip_pts = [kp["lip_upper"], kp["lip_lower"]]
    else:
        mw = float(np.linalg.norm(d["mr"] - d["ml"]))
        lip_pts = [kp.get("lip_upper") or [d["mouth"][0], d["mouth"][1] - 0.12 * mw],
                   kp.get("lip_lower") or [d["mouth"][0], d["mouth"][1] + 0.14 * mw]]
        for p in lip_pts:
            cv2.ellipse(m, (int(round(p[0])), int(round(p[1]))), (max(1, int(0.22 * mw)), max(1, int(0.05 * mw))),
                        0, 0, 360, 1, -1)
    out["lips"] = (m.astype(bool), lip_pts)
    return out


def palette(rgb, lab, kp) -> tuple[dict, dict]:
    regs = regions(rgb, lab, kp)
    cols = {}
    for name, (m, _) in regs.items():
        if name == "iris":
            px_l = lab[..., 0][m]
            if len(px_l) >= 10:
                m = m & (lab[..., 0] <= np.percentile(px_l, 85))   # drop specular highlights
        cols[name] = robust_median(lab, m)
    return cols, regs


def plausibility(cols: dict) -> dict:
    """Points that sit on the features they name. Margins: the reference has iris L* 28 below the
    sclera samples and 46 below skin; the reference-v4 render 26 and 66. A point on hair or skin gives ~0."""
    res = {}
    iris, sclera, lips, skin, hair = (cols[k][0] for k in ("iris", "sclera", "lips", "skin", "hair"))
    res["iris_darker_than_sclera"] = bool(iris is not None and sclera is not None and iris[0] < sclera[0] - 12)
    res["iris_darker_than_skin"] = bool(iris is not None and skin is not None and iris[0] < skin[0] - 25)
    res["lips_redder_than_skin"] = bool(lips is not None and skin is not None and lips[1] > skin[1] + 2)
    res["hair_differs_from_skin"] = bool(hair is not None and skin is not None and
                                         float(deltaE_ciede2000(hair, skin)) > 10)
    return res


# ---------------------------------------------------------------- glasses and fringe

def oriented_ridge(gray: np.ndarray, sigma: float, k: float = 1.0):
    """Thin-line strength split by line orientation, so a ring score can demand that the line runs
    along the ellipse. A = R*cos^2(phi), B = R*sin^2(phi), C = R*sin*cos(phi) with phi the line normal.
    sigma blurs the three maps: wide for the coarse grid (tolerates a 2 px misfit), narrow to refine.
    k widens the line scale when the image was upsampled, since a 1 px rim then spans k px."""
    g = gray.astype(np.float64) / 255.0
    R = np.maximum(sato(g, sigmas=[1.0 * k, 1.5 * k], black_ridges=True),
                   sato(g, sigmas=[1.0 * k, 1.5 * k], black_ridges=False))
    Hrr, Hrc, Hcc = hessian_matrix(g, sigma=1.5 * k, order="rc", use_gaussian_derivatives=False)
    # Eigenvector of the larger-|lambda| Hessian eigenvalue is the line normal, for bright and dark lines.
    phi = 0.5 * np.arctan2(2 * Hrc, Hcc - Hrr)        # eigenvector of the algebraically larger eigenvalue
    mean, rad = (Hcc + Hrr) / 2, np.hypot((Hcc - Hrr) / 2, Hrc)
    phi = np.where(np.abs(mean + rad) >= np.abs(mean - rad), phi, phi + np.pi / 2)
    c, s = np.cos(phi), np.sin(phi)
    blur = lambda m: cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma)
    return blur(R * c * c), blur(R * s * s), blur(R * s * c)


def ring_scores(ABC, CX, CY, rx, ry, th, corners, eye):
    A, B, C = ABC
    H, W = A.shape
    xs = np.rint(CX[:, None] + rx * np.cos(th)[None]).astype(int)
    ys = np.rint(CY[:, None] + ry * np.sin(th)[None]).astype(int)
    ok = (xs >= 0) & (xs < W) & (ys >= 0) & (ys < H)
    xs, ys = np.clip(xs, 0, W - 1), np.clip(ys, 0, H - 1)
    psi = np.arctan2(np.sin(th) / ry, np.cos(th) / rx)[None]
    v = A[ys, xs] * np.cos(psi) ** 2 + B[ys, xs] * np.sin(psi) ** 2 + 2 * C[ys, xs] * np.sin(psi) * np.cos(psi)
    sc = np.percentile(np.where(ok, v, 0.0), 30, axis=1)
    # A lens rim runs outside the eye: no sample may fall inside the eye's own ellipse.
    ex, ey, ew, eh = eye
    inside = (((CX[:, None] + rx * np.cos(th)[None]) - ex) / ew) ** 2 +              (((CY[:, None] + ry * np.sin(th)[None]) - ey) / eh) ** 2 < 1
    sc = np.where(inside.any(axis=1), 0.0, sc)
    # A lens covers the eye: both eye corners must sit well inside it (an eyelid contour has them on it).
    for p in corners:
        sc = np.where(((p[0] - CX) / rx) ** 2 + ((p[1] - CY) / ry) ** 2 < 0.9 ** 2, sc, 0.0)
    return sc


def find_lenses(rgb: np.ndarray, kp: dict) -> dict:
    """Search an ellipse per eye that a thin rim follows over most of its length.

    Work at a scale where the interocular distance is 100 px. Each of 96 ring samples scores the
    thin-line strength whose direction runs along the ellipse; the ring score is the 30th
    percentile, so at least 70 % of the ring must sit on a line running its way. Eyelids, brows
    and vertical fringe strands cover only arcs or cross the ring, so they cannot win alone, and
    the ring must hold both eye corners inside 0.9 of its radius and stay outside the eye's own
    ellipse (1.15x half the corner distance wide, 0.6x tall). Radii start at 34 px or 1.3x
    the eye half-width, whichever is larger; aspect ry/rx spans 0.70 to 1.10. SNR = best score over the
    median score of every ellipse tried on the coarse grid.
    """
    d = derived(kp)
    s = 100.0 / d["iod"]
    small = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    k = max(1.0, s)
    coarse, fine = oriented_ridge(gray, 2.0, k), oriented_ridge(gray, 1.0, k)
    th = np.linspace(0, 2 * np.pi, 96, endpoint=False)
    lenses = {}
    for side, e, ck in (("l", d["el"] * s, "eye_l_corners"), ("r", d["er"] * s, "eye_r_corners")):
        r = kp["iris_radius"] * s
        corners = (np.array(kp[ck], float) * s if ck in kp
                   else np.array([[e[0] - 2.2 * r, e[1]], [e[0] + 2.2 * r, e[1]]]))
        half = float(np.linalg.norm(corners[1] - corners[0])) / 2
        rx_min = max(34.0, 1.3 * half)
        eye = ((corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2, 1.15 * half, 0.6 * half)
        CX, CY = np.meshgrid(np.arange(e[0] - 30, e[0] + 31, 2.0), np.arange(e[1] - 15, e[1] + 41, 2.0))
        CX, CY = CX.ravel(), CY.ravel()
        best, allsc = (-1.0, None), []
        for rx in np.arange(rx_min, 86, 2):
            for q in np.arange(0.70, 1.1001, 0.05):
                sc = ring_scores(coarse, CX, CY, rx, rx * q, th, corners, eye)
                allsc.append(sc)
                i = int(np.argmax(sc))
                if sc[i] > best[0]:
                    best = (float(sc[i]), (CX[i], CY[i], float(rx), float(q)))
        bg = float(np.median(np.concatenate(allsc)))
        snr = best[0] / max(bg, 1e-9)
        cx0, cy0, rx0, q0 = best[1]
        best = (-1.0, best[1])
        for rx in np.arange(max(rx_min, rx0 - 3), rx0 + 3.01, 0.5):
            for q in np.arange(q0 - 0.05, q0 + 0.0501, 0.0125):
                CX, CY = np.meshgrid(np.arange(cx0 - 3, cx0 + 3.01, 0.5), np.arange(cy0 - 3, cy0 + 3.01, 0.5))
                CX, CY = CX.ravel(), CY.ravel()
                sc = ring_scores(fine, CX, CY, rx, rx * q, th, corners, eye)
                i = int(np.argmax(sc))
                if sc[i] > best[0]:
                    best = (float(sc[i]), (CX[i], CY[i], float(rx), float(q)))
        cx, cy, rx, q = best[1]
        lenses[side] = {"cx": cx / s, "cy": cy / s, "rx": rx / s, "ry": rx * q / s,
                        "score": best[0], "bg": bg, "snr": snr}
    return lenses


def fringe_lower_edge(lab: np.ndarray, kp: dict, skin_lab, lenses: dict) -> dict:
    """Lowest point of the not-skin run that hangs from the top of the head, per column above
    each eye, median over columns.

    Columns: each iris centre +- 2.5 iris radii. A column is scanned down from 1.2 eye-to-chin
    heights above the eye line to 1.2 iris radii above it. A pixel is not-skin when its CIEDE2000
    to the cheek skin colour exceeds 8. The edge is the mean over columns: see-through strands
    make the column ends bimodal (strand tips vs brows), and a median would jump between modes. A skin gap taller than 3 % of the face height ends the run.
    Pixels on the detected glasses rim (+-4 % of the interocular distance) are skipped, so the rim
    neither extends nor breaks the run. A brow that touches the fringe joins it; a brow that
    shows forehead above it does not.
    """
    d = derived(kp)
    h, r = d["h"], float(kp["iris_radius"])
    if skin_lab is None:
        return {"y": None, "reason": "no skin colour"}
    blur = cv2.GaussianBlur(lab.astype(np.float32), (0, 0), max(0.6, 0.004 * h))
    y0, y1 = int(max(0, d["eye_y"] - 1.2 * h)), int(d["eye_y"] - 1.2 * r)
    Hh, Ww = lab.shape[:2]
    yy = np.arange(y0, y1)
    band = 0.04 * d["iod"]
    gap = max(2, int(0.03 * h))
    ends, columns = [], 0
    for e in (d["el"], d["er"]):
        for x in range(int(e[0] - 2.5 * r), int(e[0] + 2.5 * r) + 1):
            if not 0 <= x < Ww:
                continue
            columns += 1
            on_rim = np.zeros(len(yy), bool)
            for g in lenses.values():
                t = ((x - g["cx"]) / g["rx"]) ** 2 + ((yy - g["cy"]) / g["ry"]) ** 2
                on_rim |= np.abs(np.sqrt(t) - 1) * min(g["rx"], g["ry"]) < band
            col = blur[y0:y1, x]
            hairy = deltaE_ciede2000(col, np.broadcast_to(skin_lab, col.shape)) > 8
            keep = np.flatnonzero(~on_rim)
            idx = keep[hairy[keep]]
            if len(idx) == 0 or idx[0] > 0.3 * len(col):
                continue
            last = idx[0]
            for i in idx[1:]:
                if i - last - np.count_nonzero(on_rim[last:i]) > gap:
                    break
                last = i
            ends.append(y0 + last)
    if len(ends) < 0.3 * max(columns, 1):
        return {"y": None, "columns": len(ends), "of": columns}
    ends = np.array(ends)
    return {"y": float(np.mean(ends)), "median": float(np.median(ends)), "q25": float(np.percentile(ends, 25)),
            "q75": float(np.percentile(ends, 75)), "columns": int(len(ends)), "of": columns,
            # share of columns whose run reached the scan floor: the fringe joined the brows/lashes there
            "at_floor": float(np.mean(ends >= y1 - 2)), "floor_y": float(y1)}


# ---------------------------------------------------------------- analysis of one face

def analyse_face(path: Path, probe: dict | None, label: str, mode_req: str = "auto") -> dict:
    rgba = load_rgba(path)
    rgb = over(rgba)
    lab = lab_of(rgb)
    info = {"path": str(path), "size": list(rgb.shape[1::-1]), "rgb": rgb, "lab": lab}
    L = detect_mesh(rgb)
    attempts = []
    candidates = []
    if L is not None and mode_req != "probe":
        candidates.append(("mesh", keypoints_from_mesh(L)))
    elif L is None:
        attempts.append("mesh: no face detected")
    if probe is not None and mode_req != "mesh":
        candidates.append(("probe", keypoints_from_probe(probe)))
    chosen = None
    for mode, kp in candidates:
        probs = sanity(kp, rgb.shape)
        cols, regs = palette(rgb, lab, kp)
        pl = plausibility(cols)
        failed = [k for k, v in pl.items() if not v] + probs
        attempts.append(f"{mode}: " + ("ok" if not failed else "failed " + ", ".join(failed)))
        if not failed:
            chosen = (mode, kp, cols, regs, pl)
            break
        if chosen is None:
            chosen = (mode, kp, cols, regs, pl)   # keep first as fallback so the report shows it
    if chosen is None:
        raise SystemExit(f"[{label}] no keypoints: mesh detection failed and no probe.json given")
    mode, kp, cols, regs, pl = chosen
    valid = all(pl.values()) and not sanity(kp, rgb.shape)
    info.update(mode=mode if valid else f"{mode} (UNVALIDATED)", valid=valid, attempts=attempts,
                kp=kp, cols=cols, regs=regs, plausibility=pl)
    if L is not None and probe is not None:
        kpp, kpm = keypoints_from_probe(probe), keypoints_from_mesh(L)
        dd = derived(kpm)
        info["probe_vs_mesh_px_over_iod"] = {
            k: float(np.linalg.norm(np.array(kpp[k], float) - np.array(kpm[k], float)) / dd["iod"])
            for k in ("eye_l", "eye_r", "mouth_l", "mouth_r", "chin") if k in kpp}
    det = find_lenses(rgb, kp)
    info["lenses_detected"] = det
    if mode == "probe" and "glasses" in kp:
        info["lenses"] = {s: dict(kp["glasses"][s], snr=None, source="probe") for s in ("l", "r")}
    else:
        info["lenses"] = {s: dict(det[s], source="image") for s in ("l", "r")}
    fr = fringe_lower_edge(lab, kp, cols["skin"][0], info["lenses"])
    info["fringe_detected"] = fr
    info["fringe_y"] = kp["fringe_y"] if (mode == "probe" and "fringe_y" in kp) else fr.get("y")
    return info


def ratios(info: dict) -> dict:
    kp, d = info["kp"], derived(info["kp"])
    out = {"interocular_over_face_width": d["iod"] / d["fw"]}
    if "eye_l_corners" in kp and "eye_r_corners" in kp:
        ew = [np.linalg.norm(np.subtract(kp[k][1], kp[k][0])) for k in ("eye_l_corners", "eye_r_corners")]
        out["eye_width_over_face_width"] = float(np.mean(ew)) / d["fw"]
        if "eye_l_lids" in kp and "eye_r_lids" in kp:
            eo = [np.linalg.norm(np.subtract(kp[k][1], kp[k][0])) for k in ("eye_l_lids", "eye_r_lids")]
            out["eye_opening_over_eye_width"] = float(np.mean(eo)) / float(np.mean(ew))
    if "nose_base" in kp:
        out["nose_to_mouth_over_face_height"] = (d["mouth"][1] - kp["nose_base"][1]) / d["h"]
    if info.get("fringe_y") is not None and "brow_y" in kp:
        out["fringe_minus_brow_over_face_height"] = (info["fringe_y"] - kp["brow_y"]) / d["h"]
    ln = info["lenses"]
    present = all(ln[s].get("snr") is None or ln[s]["snr"] >= RIM_SNR_MIN for s in ("l", "r"))
    out["glasses_present"] = present
    if present:
        out["glasses_rim_diameter_over_face_width"] = float(np.mean([2 * ln[s]["rx"] for s in ("l", "r")])) / d["fw"]
    return out


# ---------------------------------------------------------------- app-size legibility

def app_cell(rgba: np.ndarray):
    """Crop to content + pad and fit into 139x340 the way tools/skins/pack.py does (height-led)."""
    h, w = rgba.shape[:2]
    if (w, h) == (APP_W, APP_H):
        return rgba.copy(), (0.0, 0.0, 1.0, 0.0, 0.0)
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    l, t = max(0, xs.min() - APP_PAD), max(0, ys.min() - APP_PAD)
    r, b = min(w, xs.max() + 1 + APP_PAD), min(h, ys.max() + 1 + APP_PAD)
    sc = min(APP_W / (r - l), APP_H / (b - t))
    nw, nh = max(1, round((r - l) * sc)), max(1, round((b - t) * sc))
    small = Image.fromarray(rgba[t:b, l:r]).resize((nw, nh), Image.LANCZOS)
    cell = Image.new("RGBA", (APP_W, APP_H))
    ox, oy = (APP_W - nw) // 2, APP_H - nh
    cell.alpha_composite(small, (ox, oy))
    return np.array(cell), (float(l), float(t), sc, float(ox), float(oy))


def lens_model(info: dict) -> dict:
    """Each lens relative to its eye, in interocular units, from the candidate close-up."""
    d = derived(info["kp"])
    return {s: {"dx": (g["cx"] - e[0]) / d["iod"], "dy": (g["cy"] - e[1]) / d["iod"],
                "rx": g["rx"] / d["iod"], "ry": g["ry"] / d["iod"]}
            for s, e, g in (("l", d["el"], info["lenses"]["l"]), ("r", d["er"], info["lenses"]["r"]))}


def body_face(rgba: np.ndarray, body_probe: dict | None, lenses_rel: dict | None):
    """Eye centres, iris radius, face width and lenses in full-frame pixels, or None.

    The mesh needs a large face, so the head is cropped and upscaled before detection. A lens
    rim is about 1 px at this size, too thin to search for, so lenses are placed from the
    candidate close-up's lens-to-eye geometry scaled by this frame's interocular distance.
    """
    if body_probe:
        return dict(body_probe, source="probe")
    a = rgba[..., 3] > 0
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max()
    side = int(0.16 * (bot - top))
    rows = a[top:top + max(2, side // 2)]
    cx = int(np.mean(np.nonzero(rows)[1]))
    x0, y0 = max(0, cx - side // 2), max(0, top - side // 8)
    crop = rgba[y0:y0 + side, x0:x0 + side]
    up = 640.0 / crop.shape[0]
    big = cv2.resize(over(crop), None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    L = detect_mesh(big)
    if L is None:
        return None
    kp = keypoints_from_mesh(L)
    f = lambda p: [p[0] / up + x0, p[1] / up + y0]
    d = derived(kp)
    iod = d["iod"] / up
    out = {"source": "mesh", "eye_l": f(kp["eye_l"]), "eye_r": f(kp["eye_r"]),
           "iris_radius": kp["iris_radius"] / up, "face_w": d["fw"] / up}
    if lenses_rel:
        out["glasses"] = {s: {"cx": out[f"eye_{s}"][0] + g["dx"] * iod, "cy": out[f"eye_{s}"][1] + g["dy"] * iod,
                              "rx": g["rx"] * iod, "ry": g["ry"] * iod} for s, g in lenses_rel.items()}
    return out


def bilinear(img: np.ndarray, x, y):
    return cv2.remap(img.astype(np.float32), np.float32(np.atleast_2d(x)), np.float32(np.atleast_2d(y)),
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)[0]


def rel_lum(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c @ np.array([0.2126, 0.7152, 0.0722])


def glasses_out(rgb: np.ndarray, lenses: dict, iod: float, band_frac: float = 0.05):
    """Inpaint a band around each lens rim, the bridge between them, and the hinges.

    Used to build the glasses-free twin of a frame, so rim visibility is measured as the change
    the glasses make, and by run_sensitivity.py to paint the glasses out of the reference."""
    H, W = rgb.shape[:2]
    m = np.zeros((H, W), np.uint8)
    band = max(1, int(round(band_frac * iod)))
    for g in lenses.values():
        cv2.ellipse(m, (int(round(g["cx"])), int(round(g["cy"]))), (int(round(g["rx"])), int(round(g["ry"]))),
                    0, 0, 360, 1, 2 * band + 1)
    gl, gr = lenses["l"], lenses["r"]
    x0, x1 = int(gl["cx"] + 0.7 * gl["rx"]), int(gr["cx"] - 0.7 * gr["rx"])
    y0, y1 = int(min(gl["cy"], gr["cy"]) - 0.75 * max(gl["ry"], gr["ry"])), int(max(gl["cy"], gr["cy"]))
    m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1
    for g, sgn in ((gl, -1), (gr, 1)):
        xa, xb = sorted((int(g["cx"] + sgn * 0.85 * g["rx"]), int(g["cx"] + sgn * (g["rx"] + 0.35 * iod))))
        m[max(0, int(g["cy"] - 0.75 * g["ry"])):max(0, int(g["cy"] + 0.1 * g["ry"])), max(0, xa):max(0, xb)] = 1
    return cv2.inpaint(np.ascontiguousarray(rgb), m * 255, max(3, band * 2), cv2.INPAINT_TELEA), m


def legibility_at(rgb_app: np.ndarray, rgb_app_bare: np.ndarray | None, eyes, lenses) -> dict:
    """On an app-size image (coordinates already app-size):
    eye contrast = WCAG ratio between cheek skin under the eye and the darkest pixel of the 3x3 at the eye;
    rim visibility = CIEDE2000 between the frame and its glasses-free twin along each rim, the
    max over a +-1 px radial window (placement tolerance), median over 48 angles, mean of two lenses."""
    Y = rel_lum(rgb_app)
    iod = float(np.linalg.norm(np.subtract(eyes[1], eyes[0])))
    eye_cr = []
    for e in eyes:
        x, y = int(round(e[0])), int(round(e[1]))
        dark = float(Y[max(0, y - 1):y + 2, max(0, x - 1):x + 2].min())
        sy = int(round(e[1] + 0.45 * iod))
        skin = float(np.median(Y[max(0, sy - 1):sy + 2, max(0, x - 1):x + 2]))
        eye_cr.append((skin + 0.05) / (dark + 0.05))
    out = {"eye_contrast_ratio": float(min(eye_cr)), "eye_contrast_each": eye_cr}
    if lenses and rgb_app_bare is not None:
        D = deltaE_ciede2000(lab_of(rgb_app), lab_of(rgb_app_bare)).astype(np.float32)
        th = np.linspace(0, 2 * np.pi, 48, endpoint=False)
        per = []
        for g in lenses.values():
            prof = [bilinear(D, g["cx"] + (g["rx"] + k) * np.cos(th), g["cy"] + (g["ry"] + k) * np.sin(th))
                    for k in (-1.0, -0.5, 0.0, 0.5, 1.0)]
            per.append(float(np.median(np.max(prof, axis=0))))
        out["rim_visibility_de"] = float(np.mean(per))
        out["rim_visibility_each"] = per
    return out


def body_legibility(path: Path, body_probe: dict | None, lenses_rel: dict | None) -> dict:
    rgba = load_rgba(path)
    cell, (l, t, sc, ox, oy) = app_cell(rgba)
    face = body_face(rgba, body_probe, lenses_rel)
    res = {"path": str(path), "cell": cell}
    if face is None:
        res["error"] = "no face found in body frame (mesh failed, no body probe)"
        return res
    m = lambda p: [(p[0] - l) * sc + ox, (p[1] - t) * sc + oy]
    eyes = [m(face["eye_l"]), m(face["eye_r"])]
    lenses, bare = None, None
    gl = face.get("glasses")
    if gl:
        lenses = {s: {"cx": m((gl[s]["cx"], gl[s]["cy"]))[0], "cy": m((gl[s]["cx"], gl[s]["cy"]))[1],
                      "rx": gl[s]["rx"] * sc, "ry": gl[s]["ry"] * sc} for s in ("l", "r")}
        iod = float(np.linalg.norm(np.subtract(face["eye_r"], face["eye_l"])))
        bare_rgb, _ = glasses_out(rgba[..., :3], gl, iod, band_frac=0.06)
        bare_cell, _ = app_cell(np.dstack([bare_rgb, rgba[..., 3]]))
        bare = over(bare_cell, (128, 128, 128))
        res["cell_bare"] = bare_cell
    res.update(source=face["source"], eyes_app=eyes, lenses_app=lenses, face_w_app=face.get("face_w", 0) * sc)
    res["x1"] = legibility_at(over(cell, (128, 128, 128)), bare, eyes, lenses)
    return res


def ref_at_app_scale(ref: dict, face_w_app: float) -> dict:
    """The reference face shrunk so its face width equals the candidate's at app size: context
    for what the reference itself would show at that size."""
    d = derived(ref["kp"])
    sc = face_w_app / d["fw"]
    bare, _ = glasses_out(ref["rgb"], ref["lenses"], d["iod"])
    small = cv2.resize(ref["rgb"], None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
    small_bare = cv2.resize(bare, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
    ln = ref["lenses"]
    lenses = {s: {"cx": ln[s]["cx"] * sc, "cy": ln[s]["cy"] * sc, "rx": ln[s]["rx"] * sc, "ry": ln[s]["ry"] * sc}
              for s in ("l", "r")}
    return legibility_at(small, small_bare, [(d["el"] * sc).tolist(), (d["er"] * sc).tolist()], lenses)


# ---------------------------------------------------------------- compare.png

def face_crop(info: dict, size: int, annotate: bool) -> Image.Image:
    d = derived(info["kp"])
    side = 2.1 * d["fw"]
    cx, cy = d["mid"][0], d["eye_y"] + 0.15 * d["h"]
    box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
    ib = tuple(int(round(v)) for v in box)
    im = Image.new("RGB", (ib[2] - ib[0], ib[3] - ib[1]), (128, 128, 128))   # grey where the crop leaves the image
    im.paste(Image.fromarray(info["rgb"]), (-ib[0], -ib[1]))
    im = im.resize((size, size), Image.LANCZOS)
    if not annotate:
        return im
    k = size / side
    P = lambda p: ((p[0] - box[0]) * k, (p[1] - box[1]) * k)
    dr = ImageDraw.Draw(im)
    for name, (m, pts) in info["regs"].items():
        col = {"hair": (255, 140, 0), "skin": (0, 200, 255), "iris": (255, 0, 255), "lips": (255, 0, 0),
               "sclera": (0, 255, 0)}[name]
        ys, xs = np.nonzero(m)
        if len(xs):
            sel = np.linspace(0, len(xs) - 1, min(400, len(xs))).astype(int)
            for x, y in zip(xs[sel], ys[sel]):
                px, py = P((x, y))
                dr.point((px, py), fill=col)
    kp = info["kp"]
    for key in ("eye_l", "eye_r", "mouth_l", "mouth_r", "chin", "face_l", "face_r", "nose_base"):
        if key in kp:
            x, y = P(kp[key])
            dr.ellipse((x - 3, y - 3, x + 3, y + 3), outline=(0, 255, 0), width=2)
    for key in ("eye_l_corners", "eye_r_corners", "eye_l_lids", "eye_r_lids"):
        if key in kp:
            for p in kp[key]:
                x, y = P(p)
                dr.rectangle((x - 2, y - 2, x + 2, y + 2), outline=(255, 255, 0))
    for s in ("l", "r"):
        g = info["lenses"][s]
        x0, y0 = P((g["cx"] - g["rx"], g["cy"] - g["ry"]))
        x1, y1 = P((g["cx"] + g["rx"], g["cy"] + g["ry"]))
        found = g.get("snr") is None or g["snr"] >= RIM_SNR_MIN
        dr.ellipse((x0, y0, x1, y1), outline=(0, 160, 255) if found else (255, 0, 0), width=2)   # red: below SNR
    if "brow_y" in kp:
        y = P((0, kp["brow_y"]))[1]
        dr.line((0, y, size, y), fill=(255, 255, 0), width=1)
    if info.get("fringe_y") is not None:
        y = P((0, info["fringe_y"]))[1]
        dr.line((0, y, size, y), fill=(255, 0, 128), width=2)
    return im


def compare_png(ref: dict, cand: dict, body: dict | None, path: Path):
    S = 400
    font = ImageFont.load_default(size=15)
    lab_h = 22
    W = 3 * 10 + S * 2 + APP_W + 2 * APP_W + 20
    H = max(lab_h * 2 + S * 2 + 20, lab_h + APP_H + 30 + 2 * 23 * 6 + 20)
    canvas = Image.new("RGB", (W, H), (236, 236, 236))
    dr = ImageDraw.Draw(canvas)
    x = 10
    for title, info in (("reference face", ref), ("candidate face", cand)):
        dr.text((x, 3), f"{title} [{info['mode']}]", fill=(0, 0, 0), font=font)
        canvas.paste(face_crop(info, S, False), (x, lab_h))
        dr.text((x, lab_h + S + 1), f"{title}: sample regions + points", fill=(0, 0, 0), font=font)
        canvas.paste(face_crop(info, S, True), (x, lab_h * 2 + S))
        x += S + 10
    dr.text((x, 3), "body 139x340", fill=(0, 0, 0), font=font)
    if body is not None:
        cell = Image.fromarray(body["cell"])
        bg = Image.new("RGBA", cell.size, (200, 200, 200, 255))
        bg.alpha_composite(cell)
        canvas.paste(bg.convert("RGB"), (x, lab_h))
        x2 = x + APP_W + 10
        dr.text((x2, 3), "body 2x", fill=(0, 0, 0), font=font)
        canvas.paste(bg.convert("RGB").resize((APP_W * 2, APP_H * 2), Image.NEAREST), (x2, lab_h))
        if "eyes_app" in body:
            # The pixels the legibility metric measured (cell over grey 128), 6x, with its sample points.
            grey = Image.fromarray(over(body["cell"], (128, 128, 128)))
            (exl, eyl), (exr, eyr) = body["eyes_app"]
            cx, cy, half = (exl + exr) / 2, (eyl + eyr) / 2 + 2, 11.5
            z = 6
            box = (round(cx - half), round(cy - half), round(cx - half) + 23, round(cy - half) + 23)
            clean = grey.crop(box).resize((23 * z, 23 * z), Image.NEAREST)
            zoom = clean.copy()
            zd = ImageDraw.Draw(zoom)
            P = lambda px, py: ((px - round(cx - half)) * z, (py - round(cy - half)) * z)
            for e in body["eyes_app"]:
                ex, ey = P(*e)
                zd.ellipse((ex - 3, ey - 3, ex + 3, ey + 3), outline=(0, 255, 0))
            for g in (body.get("lenses_app") or {}).values():
                a0, b0 = P(g["cx"] - g["rx"], g["cy"] - g["ry"])
                a1, b1 = P(g["cx"] + g["rx"], g["cy"] + g["ry"])
                zd.ellipse((a0, b0, a1, b1), outline=(0, 160, 255))
            yz = lab_h + APP_H + 30
            dr.text((x, yz - 20), "measured face 6x", fill=(0, 0, 0), font=font)
            canvas.paste(zoom, (x, yz))
            canvas.paste(clean, (x, yz + 23 * z + 6))
    else:
        dr.text((x, lab_h + 10), "no body frame", fill=(120, 0, 0), font=font)
    canvas.save(path)


# ---------------------------------------------------------------- main

def metric(group, mid, value, ok, ran=True, **extra):
    return dict(group=group, id=mid, value=value, pass_=ok, ran=ran, **extra)


def jsonable(o):
    if isinstance(o, dict):
        return {("pass" if k == "pass_" else k): jsonable(v) for k, v in o.items()
                if k not in ("rgb", "lab", "regs", "cell") and not k.startswith("_")}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def run(ref_path: Path, cand_path: Path, probe_path: Path | None, bodies: list[Path], out: Path,
        mode_req: str = "auto") -> dict:
    out.mkdir(parents=True, exist_ok=True)
    probe = json.loads(probe_path.read_text(encoding="utf-8")) if probe_path else None
    cand_size = Image.open(cand_path).size
    if min(cand_size) < 512:
        raise SystemExit(f"candidate face close-up must be >= 512 px on its short side, got {cand_size}")
    ref = analyse_face(ref_path, None, "ref")
    cand = analyse_face(cand_path, probe, "cand", mode_req)
    metrics = []
    # 1. palette
    for name in ("hair", "skin", "iris", "lips"):
        a, b = ref["cols"][name][0], cand["cols"][name][0]
        if a is None or b is None:
            metrics.append(metric("palette", f"palette.{name}", None, False, ran=False, reason="region empty"))
            continue
        de = float(deltaE_ciede2000(a, b))
        ca, cb = float(np.hypot(a[1], a[2])), float(np.hypot(b[1], b[2]))
        hue = float((np.degrees(np.arctan2(b[2], b[1])) - np.degrees(np.arctan2(a[2], a[1])) + 180) % 360 - 180)
        hue_applies = min(ca, cb) >= HUE_MIN_CHROMA
        ok = de <= DE_MAX and (not hue_applies or abs(hue) <= HUE_MAX)
        metrics.append(metric("palette", f"palette.{name}", de, ok,
                              threshold=f"dE00 <= {DE_MAX}" + (f" and |dhue| <= {HUE_MAX} deg" if hue_applies else ""),
                              ref_lab=a, cand_lab=b, dL=float(b[0] - a[0]), dC=cb - ca, dhue_deg=hue,
                              hue_checked=hue_applies))
    # 2. geometry
    rr, rc = ratios(ref), ratios(cand)
    for key in ("interocular_over_face_width", "eye_width_over_face_width", "eye_opening_over_eye_width",
                "nose_to_mouth_over_face_height", "glasses_rim_diameter_over_face_width"):
        if key not in rr or key not in rc:
            why = "reference lacks it" if key not in rr else "candidate lacks it"
            if key.startswith("glasses") and not rc.get("glasses_present"):
                metrics.append(metric("geometry", f"geometry.{key}", None, False, ref=rr.get(key),
                                      reason="no glasses rim found on candidate",
                                      snr={s: cand["lenses"][s].get("snr") for s in ("l", "r")}))
            else:
                metrics.append(metric("geometry", f"geometry.{key}", None, False, ran=False, reason=why))
            continue
        rel = rc[key] / rr[key] - 1
        metrics.append(metric("geometry", f"geometry.{key}", rel, abs(rel) <= GEOM_TOL[key],
                              threshold=f"|cand/ref-1| <= {GEOM_TOL[key]}", ref=rr[key], cand=rc[key]))
    key = "fringe_minus_brow_over_face_height"
    if key in rr and key in rc:
        dv = rc[key] - rr[key]
        metrics.append(metric("geometry", f"geometry.{key}", dv, abs(dv) <= FRINGE_ABS_TOL,
                              threshold=f"|cand-ref| <= {FRINGE_ABS_TOL}", ref=rr[key], cand=rc[key]))
    else:
        metrics.append(metric("geometry", f"geometry.{key}", None, False, ran=False,
                              reason="fringe edge not found", ref_fringe=ref["fringe_detected"],
                              cand_fringe=cand["fringe_detected"]))
    # 3. legibility
    body_results = []
    bprobe = (probe or {}).get("body", {})
    for bp in bodies:
        br = body_legibility(bp, bprobe.get(bp.name), lens_model(cand) if rc.get("glasses_present") else None)
        body_results.append(br)
        tag = bp.stem
        if "error" in br:
            for mid in ("eyes", "glasses"):
                metrics.append(metric("legibility", f"legibility.{mid}.{tag}", None, False, ran=False, reason=br["error"]))
            continue
        x1 = br["x1"]
        refapp = ref_at_app_scale(ref, br["face_w_app"]) if br.get("face_w_app") else {}
        br["ref_same_scale"] = refapp
        metrics.append(metric("legibility", f"legibility.eyes.{tag}", x1["eye_contrast_ratio"],
                              x1["eye_contrast_ratio"] >= EYE_CONTRAST_MIN, threshold=f">= {EYE_CONTRAST_MIN}",
                              ref_same_scale=refapp.get("eye_contrast_ratio")))
        if "rim_visibility_de" in x1:
            metrics.append(metric("legibility", f"legibility.glasses.{tag}", x1["rim_visibility_de"],
                                  x1["rim_visibility_de"] >= RIM_DE_MIN, threshold=f">= {RIM_DE_MIN}",
                                  ref_same_scale=refapp.get("rim_visibility_de")))
        else:
            metrics.append(metric("legibility", f"legibility.glasses.{tag}", None, False,
                                  reason="no glasses on the candidate close-up, so none to place in the body frame"))
    ran = [m for m in metrics if m["ran"]]
    failed = [m["id"] for m in ran if not m["pass_"]]
    summary = {"metrics_total": len(metrics), "metrics_ran": len(ran), "failed": len(failed),
               "failed_ids": failed, "not_run": [m["id"] for m in metrics if not m["ran"]],
               "ref_mode": ref["mode"], "cand_mode": cand["mode"],
               "pass": not failed and cand["valid"] and ref["valid"]}
    result = {
        "harness_version": HARNESS_VERSION,
        "inputs": {"ref": str(ref_path), "ref_sha256": sha256(ref_path), "cand": str(cand_path),
                   "cand_sha256": sha256(cand_path), "probe": str(probe_path) if probe_path else None, "mode_requested": mode_req,
                   "body": [str(b) for b in bodies]},
        "summary": summary,
        "metrics": metrics,
        "ref": {k: ref[k] for k in ("mode", "valid", "attempts", "plausibility", "kp", "lenses", "lenses_detected",
                                    "fringe_detected", "fringe_y", "size")} | {"ratios": rr},
        "cand": {k: cand[k] for k in ("mode", "valid", "attempts", "plausibility", "kp", "lenses", "lenses_detected",
                                      "fringe_detected", "fringe_y", "size")} | {"ratios": rc,
                 "probe_vs_mesh_px_over_iod": cand.get("probe_vs_mesh_px_over_iod")},
        "body": body_results,
    }
    (out / "metrics.json").write_text(json.dumps(jsonable(result), indent=1), encoding="utf-8")
    compare_png(ref, cand, body_results[0] if body_results and "cell" in body_results[0] else None,
                out / "compare.png")
    print(f"likeness {HARNESS_VERSION}: ref={ref['mode']} cand={cand['mode']} | metrics ran {len(ran)}/{len(metrics)}"
          f" | failed {len(failed)}: {', '.join(failed) or '-'} | -> {out / 'metrics.json'}")
    return jsonable(result)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", type=Path, required=True)
    ap.add_argument("--cand", type=Path, required=True)
    ap.add_argument("--probe", type=Path)
    ap.add_argument("--body", type=Path, nargs="*", default=[])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--mode", choices=["auto", "mesh", "probe"], default="auto",
                    help="candidate keypoints: auto = mesh if detected and plausible, else probe")
    a = ap.parse_args(argv)
    for p in [a.ref, a.cand] + ([a.probe] if a.probe else []) + a.body:
        if not p.is_file():
            print(f"missing input: {p}", file=sys.stderr)
            return 2
    res = run(a.ref, a.cand, a.probe, a.body, a.out, a.mode)
    return 0 if res["summary"]["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())

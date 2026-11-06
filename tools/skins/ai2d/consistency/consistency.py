"""Consistency checker for Tieu Mai rendered frames (frozen; see README.txt and FROZEN).

Usage:
  tools/skins/ai2d/.venv/Scripts/python.exe -I consistency.py --frames DIR --out OUT [--ref face-reference.png]
                                             [--spec motion-spec.json] [--no-likeness]

DIR layout (PNG RGBA; 4x = 556x1360 rendered natively, 1x = 139x340):
  DIR/manifest.json                      see README.txt
  DIR/rest/4x/0000.png, DIR/rest/1x/0000.png
  DIR/<clip>/4x/NNNN.png, DIR/<clip>/1x/NNNN.png      one pair per frame, same names

Writes OUT/report.json, OUT/sheets/<clip>.png, OUT/evidence/*.png, OUT/likeness/<run>/ (likeness harness output).
Exit 0 when every required check ran and passed, 1 when any failed or could not run, 2 on bad input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.color import deltaE_ciede2000, rgb2lab
from skimage.metrics import structural_similarity

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
R1_HARNESS = HERE.parent / "harness"
HARNESS_PY = Path(sys.executable)   # the venv this checker runs in
DEFAULT_REF = ROOT / "references" / "character" / "face-reference.png"
DEFAULT_SPEC = HERE.parent / "motion-v1" / "motion-spec.json"
VERSION = "r2-1"

sys.dont_write_bytecode = True          # importing the frozen harness must not write into its folder
sys.path.insert(0, str(R1_HARNESS))
import likeness as LK  # noqa: E402  frozen likeness harness, read-only

APP_W, APP_H, S4 = 139, 340, 4
LIGHT_BG, DARK_BG, GREY_BG = (0xF0, 0xF0, 0xF0), (0x10, 0x14, 0x1F), (128, 128, 128)

# ---- thresholds (each justified in README.txt with its clean-frame value and its seeded-defect value)
HOLD = {"dL": 4.0, "dC": 3.0, "dh": 10.0, "hue_min_chroma": 6.0}
SSIM_MIN = 0.97
SSIM_BLUR = 1.0              # Gaussian sigma (4x px) on both heads before SSIM: evens out resampling blur
SEE_THROUGH_DL = 8.0         # |L(over light) - L(over dark)| of an interior pixel (alpha below ~0.9)
SEE_THROUGH_MIN_PX = 36      # 4x px per connected see-through component
LINE_DL = 12.0               # thin-line contrast |L - median7x7(L)| that counts as a line pixel
SEAM_NEW_MAX = 40            # 4x line px per band that no rest line within 2 px explains
HALO_OVERSHOOT = 10.0        # L units an edge pixel may pass both its interior and the background
HALO_MAX_FRAC = 0.10         # share of silhouette edge pixels that may overshoot (absolute)
HALO_REL = 0.02              # ... and at most this much above the rest frame's share
HOLE_MIN_PX = {"4x": 24, "1x": 4}
ISLAND_MIN_PX = {"4x": 24, "1x": 2}   # counted on alpha >= 128 pixels only
LADDER = [1.0, 0.64, 0.41, 0.26]
LADDER_TOL = 0.25            # motion-spec ladder: each rung +-25 %
END_ON_MAX = 0.21
COVER_DE = 10.0              # Lab distance (dE76) from the nearest rest-limb sample that still counts as covered
COVER_MIN = 0.85             # covered share of the bone
COVER_DISTAL_MIN = 0.5       # covered share of the distal 20 % of the bone
GHOST_WIN = 8                # 4x px search window for "same content as rest nearby"
GHOST_DIFF = 24              # max-channel premultiplied difference that no nearby rest pixel explains
GHOST_MIN_PX = 150           # 4x px per unexplained component
AGREE_MAX = 6.0              # mean |4x box-downsampled - 1x| over premultiplied RGBA, 0-255


# ---------------------------------------------------------------- io

def load(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert("RGBA"))


def over(rgba: np.ndarray, bg) -> np.ndarray:
    return LK.over(rgba, bg)


def lab_of(rgb: np.ndarray) -> np.ndarray:
    return rgb2lab(rgb.astype(np.float64) / 255.0)


def sha256(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def premul(rgba: np.ndarray) -> np.ndarray:
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    return np.concatenate([rgba[..., :3].astype(np.float32) * a, rgba[..., 3:4].astype(np.float32)], -1)


def rint(v):
    return int(round(float(v)))


# ---------------------------------------------------------------- rest geometry (face mesh on the rest head)

def silhouette_bbox(a: np.ndarray, thr=16):
    ys, xs = np.nonzero(a > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def rest_face(rest4: np.ndarray) -> dict:
    """Face keypoints of the rest frame in 4x pixels: mesh on the top quarter of the silhouette, upscaled."""
    l, t, r, b = silhouette_bbox(rest4[..., 3])
    y1 = t + (b - t) // 4
    crop = over(rest4[t:y1, l:r], (255, 255, 255))
    k = 1024.0 / crop.shape[1]
    up = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_LANCZOS4)
    L = LK.detect_mesh(up)
    if L is None:
        raise SystemExit("rest frame: no face found by the mesh")
    L = L / k + np.array([l, t])
    kp = LK.keypoints_from_mesh(L)
    d = LK.derived(kp)
    oval = L[LK.OVAL]
    ox0, oy0 = oval.min(0)
    ox1, oy1 = oval.max(0)
    fw, h = d["fw"], d["h"]

    def box(pts, padx, pady):
        pts = np.array(pts, float)
        return [float(pts[:, 0].min() - padx), float(pts[:, 1].min() - pady),
                float(pts[:, 0].max() + padx), float(pts[:, 1].max() + pady)]
    eyes = [box(kp["eye_l_corners"] + kp["eye_l_lids"], 0.06 * fw, 0.08 * h),
            box(kp["eye_r_corners"] + kp["eye_r_lids"], 0.06 * fw, 0.08 * h)]
    mouth = box(kp["_lip_out"], 0.06 * fw, 0.06 * h)
    head = [float(ox0 - 0.08 * fw), float(oy0 - 0.05 * h), float(ox1 + 0.08 * fw), float(kp["chin"][1] + 0.04 * h)]
    # likeness crop: a square from the top of the hair, as wide as 2x the face oval
    side = 2.0 * (ox1 - ox0)
    cx = (ox0 + ox1) / 2
    cols = rest4[:, int(cx - side / 2):int(cx + side / 2), 3] > 16
    top = int(np.argmax(cols.any(1)))
    crop_box = [float(cx - side / 2), float(top - 0.03 * side), float(cx + side / 2), float(top + 0.97 * side)]
    # neck and collar join: from the chin to 0.55 face heights below it, one face width wide
    neck = [float(cx - 0.5 * fw), float(kp["chin"][1] - 0.05 * h), float(cx + 0.5 * fw), float(kp["chin"][1] + 0.55 * h)]
    return {"kp": {k_: v for k_, v in kp.items() if not k_.startswith("_")}, "fw": fw, "h": h,
            "eyes": eyes, "mouth": mouth, "head": head, "crop": crop_box, "neck": neck}


def crop_square(img4: np.ndarray, box, size=1024) -> Image.Image:
    x0, y0, x1, y1 = (rint(v) for v in box)
    canvas = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    canvas.paste(Image.fromarray(img4), (-x0, -y0))
    return canvas.resize((size, size), Image.LANCZOS)


def box_mask(shape, box, pad=0):
    m = np.zeros(shape[:2], bool)
    x0, y0, x1, y1 = box
    m[max(0, rint(y0 - pad)):max(0, rint(y1 + pad)), max(0, rint(x0 - pad)):max(0, rint(x1 + pad))] = True
    return m


# ---------------------------------------------------------------- head alignment and identity (check 3)

def gray_of(rgba):
    return cv2.cvtColor(over(rgba, GREY_BG), cv2.COLOR_RGB2GRAY).astype(np.float32)


def align_head(rest4, frame4, face) -> dict:
    """Euclidean transform that maps rest head pixels onto the frame head (ECC on the head box)."""
    x0, y0, x1, y1 = face["head"]
    pad = 0.3 * face["fw"]
    H, W = rest4.shape[:2]
    cx0, cy0 = max(0, rint(x0 - pad)), max(0, rint(y0 - pad))
    cx1, cy1 = min(W, rint(x1 + pad)), min(H, rint(y1 + pad))
    gr, gf = gray_of(rest4)[cy0:cy1, cx0:cx1], gray_of(frame4)[cy0:cy1, cx0:cx1]
    mask = np.zeros_like(gr, np.uint8)
    mask[rint(y0) - cy0:rint(y1) - cy0, rint(x0) - cx0:rint(x1) - cx0] = 1
    (sx, sy), _ = cv2.phaseCorrelate(gr, gf)
    Wm = np.array([[1, 0, sx], [0, 1, sy]], np.float32)
    ok = True
    try:
        _, Wm = cv2.findTransformECC(gr, gf, Wm, cv2.MOTION_EUCLIDEAN,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), mask, 5)
    except cv2.error:
        ok = False
    R, t = Wm[:, :2].astype(np.float64), Wm[:, 2].astype(np.float64)
    o = np.array([cx0, cy0], float)
    full = np.concatenate([R, (t + o - R @ o)[:, None]], 1)
    return {"M": full, "ecc_ok": ok, "rot_deg":
            float(np.degrees(np.arctan2(R[1, 0], R[0, 0])))}


def warp_to_rest(frame4, M):
    h, w = frame4.shape[:2]
    return cv2.warpAffine(frame4, M, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def head_ssim(rest4, aligned4, face) -> float:
    x0, y0, x1, y1 = (rint(v) for v in face["head"])
    ga = cv2.GaussianBlur(gray_of(rest4), (0, 0), SSIM_BLUR)
    gb = cv2.GaussianBlur(gray_of(aligned4), (0, 0), SSIM_BLUR)
    a, b = ga[y0:y1, x0:x1], gb[y0:y1, x0:x1]
    _, S = structural_similarity(a, b, data_range=255, full=True, gaussian_weights=True, sigma=1.5,
                                 use_sample_covariance=False)
    # only pixels opaque in both heads: strands swaying over the background are motion, not identity
    keep = ndi.binary_erosion((rest4[..., 3] >= 250) & (aligned4[..., 3] >= 250), iterations=3)[y0:y1, x0:x1]
    for bx in face["eyes"] + [face["mouth"]]:
        keep &= ~box_mask(rest4.shape, bx, pad=4)[y0:y1, x0:x1]
    return float(S[keep].mean())


def head_point(M, p):
    return (M[:, :2] @ np.asarray(p, float) + M[:, 2]).tolist()


# ---------------------------------------------------------------- 1. hold-out colour

def holdout_masks(rgb: np.ndarray, lab: np.ndarray, kp: dict) -> dict:
    """Pixel sets the art grade cannot have aimed at.

    The look-B art grade (fit_grade) moves each region's robust median, measured on the harness's own
    sample masks (LK.regions), onto the reference. Two hold-outs:
      bright: the pixels of the harness mask at or above its median L* (a statistic the grade does not fit),
              for hair, skin, iris, lips;
      place:  hair and skin pixels at places the harness never samples (dilated harness masks removed):
              hair at the crown and beside each temple patch, skin on the lower cheeks beside the mouth
              corners and on the nose bridge.
    """
    regs = LK.regions(rgb, lab, kp)
    d = LK.derived(kp)
    fw, h = d["fw"], d["h"]
    shape = rgb.shape
    out = {}
    for name in ("hair", "skin", "iris", "lips"):
        m = regs[name][0].copy()
        if name == "iris" and m.sum() >= 10:
            m &= lab[..., 0] <= np.percentile(lab[..., 0][m], 85)        # the harness drops highlights too
        if m.sum() >= 10:
            m &= lab[..., 0] >= np.median(lab[..., 0][m])
        out[f"{name}.bright"] = m
    used = np.zeros(shape[:2], bool)
    for name in ("hair", "skin"):
        used |= regs[name][0]
    used = ndi.binary_dilation(used, iterations=max(2, int(0.02 * h)))
    mid_x = d["mid"][0]
    hair_pts = [[mid_x, d["eye_y"] - 0.95 * h],
                [kp["face_l"][0] + 0.02 * fw, d["eye_y"] - 0.45 * h],
                [kp["face_r"][0] - 0.02 * fw, d["eye_y"] - 0.45 * h]]
    skin_pts = [[d["ml"][0] - 0.07 * fw, d["mouth"][1] - 0.04 * h],
                [d["mr"][0] + 0.07 * fw, d["mouth"][1] - 0.04 * h],
                [mid_x, d["eye_y"] + 0.12 * h]]
    for name, pts, r in (("hair", hair_pts, 0.06 * h), ("skin", skin_pts, 0.035 * fw)):
        m = np.zeros(shape[:2], bool)
        for p in pts:
            m |= LK.disk_mask(shape, p, r)
        out[f"{name}.place"] = m & ~used
    return out


def lch(lab_px: np.ndarray):
    med = np.median(lab_px, axis=0)
    return float(med[0]), float(np.hypot(med[1], med[2])), float(np.degrees(np.arctan2(med[2], med[1])) % 360)


def face_info(rgb: np.ndarray) -> dict | None:
    L = LK.detect_mesh(rgb)
    if L is None:
        return None
    kp = LK.keypoints_from_mesh(L)
    lab = lab_of(rgb)
    return {"kp": kp, "lab": lab, "masks": holdout_masks(rgb, lab, kp)}


HOLD_KEYS = ("hair.bright", "hair.place", "skin.bright", "skin.place", "iris.bright", "lips.bright")


def holdout_compare(ref: dict, cand: dict) -> list:
    rows = []
    for key in HOLD_KEYS:
        mr, mc = ref["masks"][key], cand["masks"][key]
        if mr.sum() < 20 or mc.sum() < 20:
            rows.append({"id": f"holdout.{key}", "ran": False, "pass": False, "reason": "fewer than 20 px",
                         "px": [int(mr.sum()), int(mc.sum())]})
            continue
        a, b = lch(ref["lab"][mr]), lch(cand["lab"][mc])
        dL, dC = b[0] - a[0], b[1] - a[1]
        dh = (b[2] - a[2] + 180) % 360 - 180
        hue_on = min(a[1], b[1]) >= HOLD["hue_min_chroma"]
        ok = abs(dL) <= HOLD["dL"] and abs(dC) <= HOLD["dC"] and (not hue_on or abs(dh) <= HOLD["dh"])
        rows.append({"id": f"holdout.{key}", "ran": True, "pass": bool(ok), "ref_LCh": [round(v, 1) for v in a],
                     "cand_LCh": [round(v, 1) for v in b], "dL": round(dL, 2), "dC": round(dC, 2),
                     "dh": round(dh, 1), "hue_checked": hue_on, "px": [int(mr.sum()), int(mc.sum())]})
    return rows


# ---------------------------------------------------------------- 2. seams and halos

def L_of(rgba, bg):
    return cv2.cvtColor(over(rgba, bg), cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32) * (100 / 255)


def line_map(Lc: np.ndarray) -> np.ndarray:
    return np.abs(Lc - ndi.median_filter(Lc, size=7)) > LINE_DL


def see_through(f4, allowed_pts=()) -> tuple[list, np.ndarray]:
    a = f4[..., 3]
    interior = ndi.binary_erosion(a >= 16, iterations=3)
    dl = np.abs(L_of(f4, LIGHT_BG) - L_of(f4, DARK_BG))
    m = interior & (dl > SEE_THROUGH_DL)
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    sizes = ndi.sum(m, lab, range(1, n + 1)) if n else []
    big = [i + 1 for i, s in enumerate(sizes) if s >= SEE_THROUGH_MIN_PX]
    near = {int(v) for p in allowed_pts for v in np.unique(lab[LK.disk_mask(lab.shape, p, 3)])} - {0}
    comps = [{"px": int(sizes[i - 1]), "at": [round(float(v), 1) for v in ndi.center_of_mass(m, lab, i)[::-1]],
              "allowed": i in near} for i in big]
    return comps, np.isin(lab, [i for i in big if i not in near])


def halo(f4) -> dict:
    a = f4[..., 3]
    solid = a >= 250
    edge = (a >= 16) & ~ndi.binary_erosion(a >= 16, iterations=2)
    inner = ndi.binary_erosion(solid, iterations=1) & ~ndi.binary_erosion(solid, iterations=4)
    _, idx = ndi.distance_transform_edt(~inner, return_indices=True)
    out = {"edge_px": int(edge.sum())}
    for name, bg, sign in (("light_on_dark", DARK_BG, 1), ("dark_on_light", LIGHT_BG, -1)):
        Lc = L_of(f4, bg)
        Lbg = float(L_of(np.zeros((1, 1, 4), np.uint8), bg)[0, 0])
        Lin = Lc[idx[0], idx[1]]
        if sign > 0:
            over_ = Lc - np.maximum(Lin, Lbg)
        else:
            over_ = np.minimum(Lin, Lbg) - Lc
        hit = edge & (over_ > HALO_OVERSHOOT)
        out[name] = {"px": int(hit.sum()), "frac": round(float(hit.sum()) / max(1, edge.sum()), 4)}
        out[f"_{name}_mask"] = hit
    return out


def warp_mask(m: np.ndarray, M) -> np.ndarray:
    h, w = m.shape
    return cv2.warpAffine(m.astype(np.uint8), M, (w, h), flags=cv2.INTER_NEAREST) > 0


def bone_transform(rest_bone, bone):
    """Rigid transform (2x3) that carries the rest bone onto the frame bone (rotation about p0, then shift)."""
    (a0, a1), (b0, b1) = np.asarray(rest_bone, float), np.asarray(bone, float)
    ang = np.arctan2(*(b1 - b0)[::-1]) - np.arctan2(*(a1 - a0)[::-1])
    c, s = np.cos(ang), np.sin(ang)
    R = np.array([[c, -s], [s, c]])
    return np.concatenate([R, (b0 - R @ a0)[:, None]], 1)


def seams(rest4, f4, face, man_rest_bones, bones, head_M, rest_cache) -> dict:
    """New thin lines at part joins: the neck band and a disk at every declared joint, over both backgrounds."""
    out = {"bands": []}
    shape = f4.shape[:2]
    solid_f = f4[..., 3] >= 250
    masks = []
    for bgname, bg in (("light", LIGHT_BG), ("dark", DARK_BG)):
        lf = line_map(L_of(f4, bg)) & solid_f
        if f"line_{bgname}" not in rest_cache:
            lr = line_map(L_of(rest4, bg)) & (rest4[..., 3] >= 250)
            rest_cache[f"line_{bgname}"] = ndi.binary_dilation(lr, iterations=2)
        lr_d = rest_cache[f"line_{bgname}"]
        # a rest line (widened 2 px) explains a frame line when the torso (identity), the head, half the head
        # motion (the neck between them) or the bone the line sits on carries it there
        half = np.array(head_M, float).copy()
        half[:, 2] *= 0.5
        expl = lr_d | warp_mask(lr_d, head_M) | warp_mask(lr_d, half)
        bands = [("neck", box_mask(shape, face["neck"]) & ~box_mask(shape, face["mouth"], pad=6))]
        for name, bone in bones.items():
            if name not in man_rest_bones:
                continue
            T = bone_transform(man_rest_bones[name], bone)
            expl = expl | warp_mask(lr_d, T)
            for end in bone:
                bands.append((f"{name}@{round(end[0])},{round(end[1])}", LK.disk_mask(shape, end, 28)))
        new = lf & ~expl
        masks.append(new)
        for name, bm in bands:
            out["bands"].append({"band": name, "bg": bgname, "new_line_px": int((new & bm).sum())})
    worst = {}
    for b in out["bands"]:
        worst[b["band"]] = max(worst.get(b["band"], 0), b["new_line_px"])
    out["worst_new_line_px"] = max(worst.values()) if worst else 0
    out["fail_bands"] = [k for k, v in worst.items() if v > SEAM_NEW_MAX]
    out["_mask"] = masks[0] | masks[1]
    return out


# ---------------------------------------------------------------- 5. silhouette integrity

def holes_islands(f, scale, allowed_pts, rest_holes=None):
    a = f[..., 3]
    bg = a < 16
    lab, n = ndi.label(bg)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    holes = []
    hole_mask = np.zeros(a.shape, bool)
    k = 1 if scale == "4x" else 0.25
    for i in range(1, n + 1):
        if i in border:
            continue
        m = lab == i
        px = int(m.sum())
        if px < HOLE_MIN_PX[scale]:
            continue
        ys, xs = np.nonzero(m)
        allowed = any(m[min(a.shape[0] - 1, max(0, rint(p[1] * k))), min(a.shape[1] - 1, max(0, rint(p[0] * k)))]
                      for p in allowed_pts)
        if not allowed and rest_holes is not None:
            allowed = (m & rest_holes).sum() >= 0.5 * px
        holes.append({"px": px, "at": [round(float(xs.mean()) / k, 1), round(float(ys.mean()) / k, 1)],
                      "allowed": bool(allowed)})
        if not allowed:
            hole_mask |= m
    fg = a >= 16
    lab2, n2 = ndi.label(fg, structure=np.ones((3, 3)))
    sizes = ndi.sum(fg, lab2, range(1, n2 + 1)) if n2 else np.array([])
    islands = []
    isl_mask = np.zeros(a.shape, bool)
    if n2:
        main = int(np.argmax(sizes)) + 1
        for i, s in enumerate(sizes, 1):
            if i != main and (a[lab2 == i] >= 128).sum() >= ISLAND_MIN_PX[scale]:
                ys, xs = np.nonzero(lab2 == i)
                islands.append({"px": int(s), "at": [round(float(xs.mean()) / k, 1), round(float(ys.mean()) / k, 1)]})
                isl_mask |= lab2 == i
    return holes, islands, hole_mask, isl_mask, (lab != 0) & ~np.isin(lab, list(border) + [0])


def part_of(name, spec):
    parts = (spec or {}).get("twoD", {}).get("parts", {})
    return parts.get(name)


def rungs_for(name, spec):
    p = part_of(name, spec)
    if not p:
        return LADDER, True
    rs = [v["nominal"] for v in p.get("variants", []) if "nominal" in v]
    end_on = any(v.get("endOn") for v in p.get("variants", []))
    return rs or LADDER, end_on


def limb_check(rest4, f4, name, rest_bone, bone, spec, cache) -> dict:
    (a0, a1), (b0, b1) = np.asarray(rest_bone, float), np.asarray(bone, float)
    Lr, Lf = float(np.linalg.norm(a1 - a0)), float(np.linalg.norm(b1 - b0))
    ratio = Lf / Lr if Lr > 0 else 0.0
    rs, end_on = rungs_for(name, spec)
    rung = next((r for r in rs if abs(ratio / r - 1) <= LADDER_TOL), None)
    in_ladder = rung is not None or (end_on and ratio <= END_ON_MAX)
    out = {"ratio": round(ratio, 3), "rung": rung, "in_ladder": bool(in_ladder), "rungs": rs, "end_on": end_on}
    if ratio <= END_ON_MAX:            # an end-on limb has no length to cover
        out.update(cover=None, cover_distal=None, pass_=bool(in_ladder))
        return out
    # the joint ends (first and last 10 %) overlap the neighbouring parts, so they are not sampled
    ts = np.linspace(0.1, 0.9, 24)
    if "limb_lab" not in cache:
        cache["limb_lab"] = lab_of(cv2.medianBlur(over(rest4, LIGHT_BG), 5))
    if cache.get("limb_lab_frame_id") != id(f4):
        cache["limb_lab_frame"], cache["limb_lab_frame_id"] = lab_of(cv2.medianBlur(over(f4, LIGHT_BG), 5)), id(f4)
    rl, fl = cache["limb_lab"], cache["limb_lab_frame"]

    def at(lab, p):
        return lab[min(lab.shape[0] - 1, max(0, rint(p[1]))), min(lab.shape[1] - 1, max(0, rint(p[0])))]
    rest_s = np.array([at(rl, a0 + t * (a1 - a0)) for t in ts])
    cov = []
    for t in ts:
        pf = b0 + t * (b1 - b0)
        yf, xf = min(f4.shape[0] - 1, max(0, rint(pf[1]))), min(f4.shape[1] - 1, max(0, rint(pf[0])))
        near = float(np.linalg.norm(rest_s - at(fl, pf), axis=1).min())
        cov.append(f4[yf, xf, 3] >= 128 and near <= COVER_DE)
    cov = np.array(cov)
    out["cover"] = round(float(cov.mean()), 3)
    out["cover_distal"] = round(float(cov[ts >= 0.8].mean()), 3)
    out["_samples"] = [(b0 + t * (b1 - b0)).tolist() for t in ts]
    out["_cov"] = cov.tolist()
    out["pass_"] = bool(in_ladder and out["cover"] >= COVER_MIN and out["cover_distal"] >= COVER_DISTAL_MIN)
    return out


def capsule(shape, p0, p1, r):
    m = np.zeros(shape[:2], np.uint8)
    cv2.line(m, (rint(p0[0]), rint(p0[1])), (rint(p1[0]), rint(p1[1])), 1, thickness=max(1, rint(2 * r)))
    return m > 0


def limb_zone(shape, bones: dict) -> np.ndarray:
    """Where declared limbs may legitimately carry new content: each bone, plus a hand past each forearm."""
    m = np.zeros(shape[:2], bool)
    for name, (p0, p1) in bones.items():
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        L = float(np.linalg.norm(p1 - p0))
        m |= capsule(shape, p0, p1, 0.25 * L + 10)
        if name.endswith("Forearm") and name.replace("Forearm", "Hand") not in bones:
            u = (p1 - p0) / max(L, 1e-6)
            m |= capsule(shape, p1, p1 + u * 0.75 * L, 0.4 * L + 10)
    return m


def ghosts(rest4, f4, exclude) -> tuple[list, np.ndarray]:
    """Content that no rest pixel within GHOST_WIN explains, outside the zones where change is declared."""
    pr = cv2.resize(premul(rest4), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    pf = cv2.resize(premul(f4), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    w = GHOST_WIN // 2
    H, W = pf.shape[:2]
    padded = np.pad(pr, ((w, w), (w, w), (0, 0)), mode="edge")
    dmin = np.full((H, W), np.inf, np.float32)
    for dy in range(-w, w + 1):
        for dx in range(-w, w + 1):
            sh = padded[w + dy:w + dy + H, w + dx:w + dx + W]
            dmin = np.minimum(dmin, np.abs(pf - sh).max(-1))
    ex = cv2.resize(exclude.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0
    m = (dmin > GHOST_DIFF) & ~ex
    m = ndi.binary_opening(m, iterations=1)
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    sizes = ndi.sum(m, lab, range(1, n + 1)) if n else []
    comps, keep = [], []
    for i, s in enumerate(sizes, 1):
        if s * 4 >= GHOST_MIN_PX:
            cy, cx = ndi.center_of_mass(m, lab, i)
            comps.append({"px_4x": int(s * 4), "at": [round(cx * 2, 1), round(cy * 2, 1)]})
            keep.append(i)
    mask = cv2.resize(np.isin(lab, keep).astype(np.uint8), (f4.shape[1], f4.shape[0]),
                      interpolation=cv2.INTER_NEAREST) > 0
    return comps, mask


def agree(f4, f1) -> float:
    d = cv2.resize(premul(f4), (f1.shape[1], f1.shape[0]), interpolation=cv2.INTER_AREA)
    return float(np.abs(d - premul(f1)).mean())


# ---------------------------------------------------------------- 4. likeness harness

def run_likeness(head_png: Path, body_png: Path, ref: Path, out: Path) -> dict:
    cmd = [str(HARNESS_PY), str(R1_HARNESS / "likeness.py"), "--ref", str(ref), "--cand", str(head_png),
           "--body", str(body_png), "--out", str(out)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    (out / "stdout.txt").parent.mkdir(parents=True, exist_ok=True)
    (out / "stdout.txt").write_text(p.stdout + "\n--- stderr\n" + p.stderr, encoding="utf-8")
    mj = out / "metrics.json"
    if not mj.is_file():
        return {"ran": False, "pass": False, "exit": p.returncode, "reason": p.stdout[-400:] + p.stderr[-400:]}
    s = json.loads(mj.read_text(encoding="utf-8"))["summary"]
    return {"ran": True, "pass": bool(s["pass"]) and p.returncode == 0, "exit": p.returncode,
            "metrics_ran": s["metrics_ran"], "failed_ids": s["failed_ids"], "not_run": s["not_run"],
            "cand_mode": s["cand_mode"], "metrics": str(mj)}


# ---------------------------------------------------------------- 6. sheets and evidence

def evidence_png(f4, path: Path, layers: dict, bones: dict, limbs: dict):
    base = over(f4, DARK_BG).astype(np.float32)
    colours = {"hole": (255, 0, 0), "island": (255, 0, 255), "ghost": (255, 220, 0), "see_through": (0, 255, 255),
               "seam": (255, 128, 0), "halo": (120, 255, 120)}
    for k, m in layers.items():
        if m is not None and m.any():
            md = ndi.binary_dilation(m, iterations=1)
            base[md] = 0.25 * base[md] + 0.75 * np.array(colours[k], np.float32)
    im = Image.fromarray(base.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    for name, lc in limbs.items():
        for p, c in zip(lc.get("_samples", []), lc.get("_cov", [])):
            dr.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], outline=(0, 255, 0) if c else (255, 0, 0), width=2)
    im.save(path)


HOLD_COLOURS = {"hair.bright": (255, 0, 0), "hair.place": (255, 255, 0), "skin.bright": (0, 255, 0),
                "skin.place": (0, 255, 255), "iris.bright": (255, 0, 255), "lips.bright": (0, 0, 255)}


def holdout_overlay(rgb, fi, path: Path):
    im = rgb.astype(np.float32)
    for k, c in HOLD_COLOURS.items():
        m = fi["masks"][k]
        im[m] = 0.4 * im[m] + 0.6 * np.array(c, np.float32)
    Image.fromarray(im.astype(np.uint8)).save(path)


def contact_sheet(clip: str, frames1: list, results: list, path: Path, cols=12):
    cw, ch = APP_W * 2, APP_H + 18
    rows = (len(frames1) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch), (60, 60, 60))
    dr = ImageDraw.Draw(sheet)
    for i, (f1, res) in enumerate(zip(frames1, results)):
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.paste(Image.fromarray(over(f1, LIGHT_BG)), (x, y))
        sheet.paste(Image.fromarray(over(f1, DARK_BG)), (x + APP_W, y))
        fails = res["fails"]
        colour = (230, 60, 60) if fails else (90, 200, 90)
        dr.rectangle([x, y, x + cw - 1, y + APP_H - 1], outline=colour, width=2)
        dr.text((x + 3, y + APP_H + 2), f"{clip} {res['frame']:04d} " + (",".join(fails) if fails else "ok"),
                fill=colour)
    sheet.save(path)


# ---------------------------------------------------------------- driver

def frame_pairs(d: Path):
    names = sorted(p.name for p in (d / "4x").glob("*.png"))
    if not names:
        raise SystemExit(f"bad input: no frames in {d / '4x'}")
    for n in names:
        if not (d / "1x" / n).is_file():
            raise SystemExit(f"bad input: {d / '1x' / n} missing")
    return names


def check_frame(ctx, clip, idx, f4, f1, cinfo) -> dict:
    rest4, face, spec = ctx["rest4"], ctx["face"], ctx["spec"]
    res = {"frame": idx, "checks": {}, "fails": []}
    head_view = idx in cinfo.get("head_views", [])
    is_rest = clip == "rest"
    # 0. input agreement
    if f4.shape[:2] != (APP_H * S4, APP_W * S4) or f1.shape[:2] != (APP_H, APP_W):
        raise SystemExit(f"bad input: {clip}/{idx:04d} sizes {f4.shape[:2]} / {f1.shape[:2]}")
    ag = agree(f4, f1)
    res["checks"]["agree_4x_1x"] = {"mean_abs": round(ag, 2), "pass": ag <= AGREE_MAX}
    # 3. head alignment and identity
    al = align_head(rest4, f4, face)
    aligned = warp_to_rest(f4, al["M"])
    s = head_ssim(rest4, aligned, face)
    res["checks"]["head_ssim"] = {"ssim": round(s, 4), "rot_deg": round(al["rot_deg"], 2),
                                  "shift": [round(float(al["M"][0, 2]), 1), round(float(al["M"][1, 2]), 1)],
                                  "ecc_ok": al["ecc_ok"], "head_view": head_view,
                                  "pass": True if head_view else bool(s >= SSIM_MIN and al["ecc_ok"])}
    # 1. hold-out colour on the head carried back to rest coordinates. The head is aligned, so the rest
    # head's keypoints are reused (a fresh mesh per frame moves the samples by itself); a declared head
    # view is not aligned to rest and gets its own mesh.
    crop = np.array(crop_square(aligned, face["crop"]))
    crop_rgb = over(crop, (255, 255, 255))
    if head_view or "rest_kp" not in ctx:
        fi = face_info(crop_rgb)
        if is_rest and fi is not None:
            ctx["rest_kp"] = fi["kp"]
    else:
        lab = lab_of(crop_rgb)
        fi = {"kp": ctx["rest_kp"], "lab": lab, "masks": holdout_masks(crop_rgb, lab, ctx["rest_kp"])}
    if fi is None:
        res["checks"]["holdout"] = {"ran": False, "pass": head_view, "reason": "no face found by the mesh"}
    else:
        rows = holdout_compare(ctx["ref_info"], fi)
        res["checks"]["holdout"] = {"rows": rows, "pass": all(r["pass"] for r in rows)}
    res["_crop"] = crop
    res["_fi"] = fi
    # 2. seams and halos
    bones = cinfo.get("joints", {}).get(str(idx), ctx["rest_bones"]) if not is_rest else ctx["rest_bones"]
    allowed = ctx["allowed_holes"].get(clip, {}).get(str(idx), []) + ctx["allowed_holes"].get("rest", {}).get("0", [])
    st, st_mask = see_through(f4, allowed)
    hl = halo(f4)
    sm = seams(rest4, f4, face, ctx["rest_bones"], bones, al["M"], ctx["cache"])
    res["checks"]["see_through"] = {"components": st, "pass": not any(not c["allowed"] for c in st)}
    res["checks"]["halo"] = {k: v for k, v in hl.items() if not k.startswith("_")}
    worst = max(hl["light_on_dark"]["frac"], hl["dark_on_light"]["frac"])
    if is_rest:
        ctx["rest_halo"] = worst
    res["checks"]["halo"]["worst_frac"] = worst
    res["checks"]["halo"]["pass"] = worst <= HALO_MAX_FRAC and worst <= ctx["rest_halo"] + HALO_REL
    res["checks"]["seam"] = {"worst_new_line_px": sm["worst_new_line_px"], "fail_bands": sm["fail_bands"],
                             "bands": sm["bands"], "pass": not sm["fail_bands"]}
    # 5. silhouette integrity
    h4, i4, hm4, im4, holes_all4 = holes_islands(f4, "4x", allowed, None if is_rest else ctx["rest_holes4"])
    h1, i1, _, _, _ = holes_islands(f1, "1x", allowed, None if is_rest else ctx["rest_holes1"])
    if is_rest:
        ctx["rest_holes4"] = holes_all4 & ~hm4
        ctx["rest_holes1"] = holes_islands(f1, "1x", allowed)[4]
    bad_h = [h for h in h4 + h1 if not h["allowed"]]
    res["checks"]["holes"] = {"4x": h4, "1x": h1, "pass": not bad_h}
    res["checks"]["islands"] = {"4x": i4, "1x": i1, "pass": not i4 and not i1}
    limbs = {}
    for name, bone in bones.items():
        if name in ctx["rest_bones"]:
            limbs[name] = limb_check(rest4, f4, name, ctx["rest_bones"][name], bone, spec, ctx["cache"])
    res["checks"]["limbs"] = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in limbs.items()}
    res["checks"]["limbs"]["pass"] = all(v["pass_"] for v in limbs.values())
    zone = limb_zone(f4.shape, bones) | limb_zone(f4.shape, ctx["rest_bones"])
    zone |= box_mask(f4.shape, face["head"], pad=0.15 * face["fw"])
    zone |= warp_mask(box_mask(f4.shape, face["head"], pad=0.15 * face["fw"]), al["M"])
    for extra in cinfo.get("change_zones", {}).get(str(idx), []):
        zone |= box_mask(f4.shape, extra)
    gh, gm = ghosts(rest4, f4, zone)
    res["checks"]["ghost"] = {"components": gh, "pass": not gh}
    res["fails"] = [k for k, v in res["checks"].items() if not v["pass"]]
    if res["fails"]:
        ev = ctx["out"] / "evidence" / f"{clip}_{idx:04d}.png"
        evidence_png(f4, ev, {"hole": hm4, "island": im4, "ghost": gm, "see_through": st_mask, "seam": sm["_mask"],
                              "halo": hl["_light_on_dark_mask"] | hl["_dark_on_light_mask"]}, bones, limbs)
        res["evidence"] = str(ev)
    return res


def summarise(frames):
    keys = list(frames[0]["checks"].keys()) if frames else []
    per = {k: [f["frame"] for f in frames if not f["checks"][k]["pass"]] for k in keys}
    ss = [f["checks"]["head_ssim"]["ssim"] for f in frames if not f["checks"]["head_ssim"]["head_view"]]
    hold = {}
    for key in HOLD_KEYS:
        vals = [r for f in frames for r in f["checks"]["holdout"].get("rows", []) if r["id"] == f"holdout.{key}" and r["ran"]]
        if vals:
            hold[key] = {"median_dL": round(float(np.median([v["dL"] for v in vals])), 2),
                         "median_dC": round(float(np.median([v["dC"] for v in vals])), 2),
                         "median_dh": round(float(np.median([v["dh"] for v in vals])), 1),
                         "frames_failed": sum(not v["pass"] for v in vals)}
    return {"frames": len(frames), "frames_failed": sum(bool(f["fails"]) for f in frames),
            "failed_frames_by_check": {k: v for k, v in per.items() if v},
            "head_ssim_min": round(min(ss), 4) if ss else None, "holdout": hold}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--ref", type=Path, default=DEFAULT_REF)
    ap.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    ap.add_argument("--no-likeness", action="store_true", help="skip check 4 (the r1 harness); the run then cannot pass")
    a = ap.parse_args(argv)
    mf = a.frames / "manifest.json"
    for p in (mf, a.ref, a.frames / "rest" / "4x" / "0000.png", a.frames / "rest" / "1x" / "0000.png"):
        if not p.is_file():
            print(f"bad input: missing {p}", file=sys.stderr)
            return 2
    man = json.loads(mf.read_text(encoding="utf-8"))
    spec = json.loads(a.spec.read_text(encoding="utf-8")) if a.spec.is_file() else None
    a.out.mkdir(parents=True, exist_ok=True)
    for sub in ("sheets", "evidence", "heads", "likeness"):
        (a.out / sub).mkdir(exist_ok=True)

    rest4 = load(a.frames / "rest" / "4x" / "0000.png")
    face = rest_face(rest4)
    ref_rgb = over(LK.load_rgba(a.ref), (255, 255, 255))
    ref_info = face_info(ref_rgb)
    if ref_info is None:
        print("bad input: no face in the reference", file=sys.stderr)
        return 2
    ctx = {"rest4": rest4, "face": face, "spec": spec, "ref_info": ref_info, "out": a.out,
           "rest_bones": man.get("rest_joints", {}), "allowed_holes": man.get("allowed_holes", {}), "cache": {}}

    holdout_overlay(ref_rgb, ref_info, a.out / "heads" / "reference_holdout.png")
    clips = {"rest": {"peak": 0, "head_views": []}} | man.get("clips", {})
    report = {"checker": VERSION, "checker_sha256": sha256(Path(__file__)), "frames_dir": str(a.frames),
              "ref_sha256": sha256(a.ref), "rest_face": {k: face[k] for k in ("eyes", "mouth", "head", "crop", "neck")},
              "thresholds": {k: v for k, v in globals().items() if k.isupper() and isinstance(v, (int, float, dict, list))
                             and k not in ("APP_W", "APP_H", "S4")},
              "clips": {}}
    all_ok = True
    for clip, cinfo in clips.items():
        d = a.frames / clip
        names = frame_pairs(d)
        frames, f1s = [], []
        for n in names:
            idx = int(Path(n).stem)
            f4, f1 = load(d / "4x" / n), load(d / "1x" / n)
            r = check_frame(ctx, clip, idx, f4, f1, cinfo)
            crop, fi = r.pop("_crop"), r.pop("_fi")
            if idx == cinfo.get("peak", 0):
                head_png = a.out / "heads" / f"{clip}_{idx:04d}.png"
                Image.fromarray(crop).save(head_png)
                if fi is not None:
                    holdout_overlay(over(crop, (255, 255, 255)), fi, a.out / "heads" / f"{clip}_{idx:04d}_holdout.png")
                r["_peak"] = (head_png, d / "1x" / n)
            frames.append(r)
            f1s.append(f1)
            print(f"{clip} {idx:04d}: " + (", ".join(r["fails"]) if r["fails"] else "ok"), flush=True)
        peak = next((f for f in frames if "_peak" in f), None)
        lk = {"ran": False, "pass": False, "reason": "skipped (--no-likeness)"}
        if peak is None:
            lk = {"ran": False, "pass": False, "reason": f"peak frame {cinfo.get('peak')} not found"}
        elif not a.no_likeness:
            head_png, body_png = peak.pop("_peak")
            lk = run_likeness(head_png, body_png, a.ref, a.out / "likeness" / f"{clip}_{peak['frame']:04d}")
            print(f"{clip} likeness on frame {peak['frame']}: {'pass' if lk['pass'] else 'FAIL'} {lk.get('failed_ids', '')}")
        for f in frames:
            f.pop("_peak", None)
        contact_sheet(clip, f1s, frames, a.out / "sheets" / f"{clip}.png")
        summ = summarise(frames)
        summ["likeness_peak"] = lk
        summ["pass"] = summ["frames_failed"] == 0 and lk["pass"]
        all_ok &= summ["pass"]
        report["clips"][clip] = {"summary": summ, "frames": frames}
    report["pass"] = bool(all_ok)
    report["summary"] = {c: {"pass": v["summary"]["pass"], "frames_failed": v["summary"]["frames_failed"],
                             "by_check": v["summary"]["failed_frames_by_check"],
                             "likeness": v["summary"]["likeness_peak"].get("pass")} for c, v in report["clips"].items()}
    (a.out / "report.json").write_text(json.dumps(report, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)),
                                       encoding="utf-8")
    print(json.dumps(report["summary"], indent=1))
    print(f"consistency {VERSION}: {'PASS' if all_ok else 'FAIL'} -> {a.out / 'report.json'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())

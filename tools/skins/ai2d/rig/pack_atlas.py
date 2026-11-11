"""Packs the parts the rig draws into one 1024x1024 atlas: the body, head, face and leg parts (art/out) and
the whole-arm key drawings and sleeveless torso (art/keyposes/out), all at 2x app scale. The arms are whole
drawings (upper arm, sleeve, forearm and hand in one piece). There is one head drawing (no turned head views,
no sourceGlasses alternates); out/atlas-id.png is the checker's ID atlas.

Writes out/atlas.png (lossless), out/atlas.webp (lossless WebP, what ships) and out/atlas-rects.json
(name -> [x, y, w, h] in atlas px). Deterministic: parts are placed largest-height first by a skyline
packer, names break ties, 2 px transparent gutter around each part (bilinear sampling at the 2x->1x
draw never reads a neighbour). Run with tools/skins/ai2d/.venv python, -I.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ART = HERE.parent / "art" / "out"
KEY = HERE.parent / "art" / "keyposes" / "out"
INB = HERE / "inbetween" / "out"   # in-between arm drawings (inbetween/run.py)
INB_PARTS = ["leftArm.front", "leftArm.tuckmid", "leftArm.hipfront", "leftArm.hipoff"]
OFFSET_Y = 9   # build_rig.mjs OFFSET_Y
# what ships, by source; the other entries in the two parts.json files are not packed
ART_PARTS = ["pelvis", "neck", "head", "head.closed", "frontHair", "backHair",
             "face.mouth.smile", "face.mouth.talk", "rightThigh", "rightShin", "rightShoe", "leftThigh", "leftShin", "leftShoe"]
KEY_PARTS = ["torso.noLeftSleeve", "rightArm.rest", "leftArm.rest", "leftArm.wave_up",
             "leftArm.think", "leftArm.tuck", "leftArm.talk", "leftArm.happy", "leftArm.drag", "leftArm.land"]
OUT = HERE / "out"
SIZE = 1024
GUTTER = 2
SPECK_PX = 200   # alpha islands smaller than this (2x px), apart from the part's main body, are cut leftovers


def despeckle(im):
    """Keeps only the part's main body: the largest component of alpha >= 64, grown by 2 px to keep its
    soft edge. Detached specks and faint chains (the f_sleep forearm carries a fringe of skirt-edge specks
    from its key) are cleared. Returns the cleaned image and the pixels removed."""
    a = np.array(im)
    lab, n = ndimage.label(a[..., 3] >= 64, structure=np.ones((3, 3)))
    if n == 0:
        return im, 0
    sizes = ndimage.sum(np.ones_like(lab), lab, index=range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= SPECK_PX
    keep[1 + int(np.argmax(sizes))] = True
    body = ndimage.binary_dilation(keep[lab] & (lab > 0), iterations=2)
    drop = (a[..., 3] > 0) & ~body
    a[drop] = 0
    return Image.fromarray(a), int(drop.sum())


def widen_neck(im, px=3, right_px=7):
    """The neck drawing sits under the head's soft neck edge and the collar. When the head tilts, two soft edges
    stop overlapping and a pale see-through line opens beside the neck. Its opaque body is grown by px (2x px),
    each new pixel taking the colour of the nearest opaque one, so a firm neck stays under both edges.
    On the image-right side, where the ponytail hangs beside the neck, it grows by right_px: the soft ponytail
    edge and the soft neck edge leave a pale see-through line there otherwise (rest frame 2x dips at about
    (126-131, 117-131))."""
    a = np.array(im)
    solid = a[..., 3] >= 200
    dist, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    cx = np.nonzero(solid.any(0))[0].mean()
    lim = np.where(np.arange(a.shape[1])[None, :] > cx, right_px, px)
    grow = (dist > 0) & (dist <= lim)
    out = a.copy()
    out[grow, :3] = a[iy[grow], ix[grow], :3]
    # the nearest opaque pixel on the image-right edge is the master's light rim, so copying it makes the 7 px
    # band read as a pale seam wherever the ponytail swings off it (drag_loop, sleep_loop). That band
    # takes the mean colour 6-12 px inside the neck along the same row (past the rim), a little darkened: the
    # neck's side in the ponytail's shadow
    right = grow & (np.arange(a.shape[1])[None, :] > cx)
    ys, xs = np.nonzero(right)
    acc = np.zeros((len(ys), 3), np.float32)
    for k in range(6, 13):
        acc += a[iy[right], np.clip(ix[right] - k, 0, a.shape[1] - 1), :3].astype(np.float32)
    out[ys, xs, :3] = (acc / 7 * 0.94 + 0.5).astype(np.uint8)
    out[grow, 3] = np.maximum(a[grow, 3], 255)
    return Image.fromarray(out), int(grow.sum())


def smooth_hem(im):
    """The skirt's hem (the pelvis part's bottom edge) is hard alpha in integer steps: a staircase at 4x, with a
    12 px notch at the outer left corner. Per column the bottom edge is refitted as a straight line
    (least squares over the inner columns; the hem is straight in the art) and redrawn with coverage alpha
    clamp(e + 1 - y, 0, 1); the two outer columns at each end round the corner. Rows that become covered take
    the colour of the lowest opaque pixel above. Returns the image and the pixels changed."""
    a = np.array(im).astype(np.float32)
    al = a[..., 3]
    H, W = al.shape
    has = (al >= 128).any(0)
    bot = np.array([H - 1 - int(np.argmax(al[::-1, x] >= 128)) if has[x] else -1 for x in range(W)])
    xs = np.nonzero(has)[0]
    x0, x1 = xs[0], xs[-1]
    inner = np.arange(x0 + 2, x1 - 4)
    k, c = np.polyfit(inner, bot[inner], 1)
    out = a.copy()
    for x in range(x0, x1 - 3):   # the right end keeps its own rounded corner (bottom rises 8-9 px per column)
        e = k * x + c - (3.0 * (x0 + 2 - x) if x < x0 + 2 else 0.0)
        top = int(np.floor(e)) - 3
        src = out[min(top, bot[x]) - 1, x].copy() if bot[x] > 0 else None
        for y in range(max(0, top), H):
            cov = float(np.clip(e + 1 - y, 0, 1))
            if y > bot[x]:             # under the old edge: new hem pixels
                if cov > 0 and src is not None:
                    out[y, x, :3] = src[:3]
                out[y, x, 3] = 255 * cov
            else:                      # the old hem: trimmed to the line
                out[y, x, 3] = min(out[y, x, 3], 255 * cov)
    changed = int((np.abs(out - a).max(2) > 0.5).sum())
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)), changed


def fill_enclosed(im, max_px=400):
    """rightArm.rest: the gap between the curled thumb and fingers is a see-through hole with
    hard edges, a white square in the palm at app size. Enclosed see-through components (alpha < 128, not
    touching the part's border) under max_px 2x px are filled opaque with the inpainted colour of the hand
    around them, darkened to a crease. Returns image, px filled."""
    a = np.array(im)
    solid = a[..., 3] >= 128
    holes = ndimage.binary_fill_holes(solid) & ~solid
    lab, n = ndimage.label(holes)
    if n:
        sizes = ndimage.sum(holes, lab, range(1, n + 1))
        holes = np.isin(lab, 1 + np.nonzero(sizes < max_px)[0])
    if not holes.any():
        return im, 0
    grow = ndimage.binary_dilation(holes, iterations=1) & ~solid   # the hole's soft rim too
    rgb = np.ascontiguousarray(a[..., :3])
    filled = cv2.inpaint(rgb, grow.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    a[..., :3][grow] = (filled[grow].astype(np.float32) * 0.88 + 0.5).astype(np.uint8)
    a[..., 3][grow] = 255
    return Image.fromarray(a), int(grow.sum())


def close_slits(im):
    """Arm drawings: see-through slits up to 2 px wide (2x) inside the drawing, between fingers that touch (white
    slits in the raised hand). A 3x3 closing of alpha >= 128 finds them; they are filled opaque
    with the darkened colour of their opaque neighbours (a crease, not background). Returns image, px filled."""
    a = np.array(im).astype(np.float32)
    solid = a[..., 3] >= 128
    closed = ndimage.binary_closing(solid, structure=np.ones((3, 3)), iterations=1)
    fill = closed & ~solid
    if fill.any():
        w = solid.astype(np.float32)
        nb = ndimage.uniform_filter(w, 3)
        for ch in range(3):
            v = ndimage.uniform_filter(a[..., ch] * w, 3) / np.maximum(nb, 1e-6)
            a[..., ch][fill] = v[fill] * 0.85
        a[..., 3][fill] = 255
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)), int(fill.sum())


def fix_specks(im):
    """Arm drawings: colour outliers left by the key cut-outs. A pixel whose luminance is
    40+ above (a white speck on the forearm, a torn white fringe at the inner elbow) or 45+ below (a dark notch
    on the wrist) the median of its opaque 5x5 neighbourhood, in a component under 12 px, takes that median.
    The sleeve is white throughout, so its pixels are no outliers there; finger gaps are background, not dark
    pixels. Then every partly transparent edge pixel takes the colour of the nearest opaque pixel (alpha bleed:
    no light or dark halo where the edge is drawn over another part). Returns image, px changed."""
    a = np.array(im).astype(np.float32)
    op = a[..., 3] >= 250
    lum = a[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    big = np.where(op, lum, np.nan)
    pad = np.pad(big, 2, constant_values=np.nan)
    win = np.lib.stride_tricks.sliding_window_view(pad, (5, 5)).reshape(*lum.shape, 25)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            med = np.nanmedian(win, axis=-1)
    out = (a[..., 3] > 0) & np.isfinite(med) & (((lum - med) > 40) | ((med - lum) > 45))
    lab, n = ndimage.label(out, structure=np.ones((3, 3)))
    if n:
        sizes = ndimage.sum(out, lab, range(1, n + 1))
        out = np.isin(lab, 1 + np.nonzero(sizes < 12)[0])
    changed = int(out.sum())
    if changed:
        # the median colour: average of the opaque neighbours whose luminance is within 20 of the median
        for ch in range(3):
            pc = np.pad(np.where(op, a[..., ch], np.nan), 2, constant_values=np.nan)
            wc = np.lib.stride_tricks.sliding_window_view(pc, (5, 5)).reshape(*lum.shape, 25)
            ok = np.abs(win - med[..., None]) <= 20
            with np.errstate(all="ignore"):
                v = np.nansum(np.where(ok, wc, 0), -1) / np.maximum(np.sum(ok & np.isfinite(wc), -1), 1)
            a[..., ch][out] = v[out]
    edge = (a[..., 3] > 0) & (a[..., 3] < 250)
    if edge.any() and op.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~op, return_indices=True)
        for ch in range(3):
            a[..., ch][edge] = a[..., ch][iy[edge], ix[edge]]
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)), changed


def smooth_flank(im):
    """The sleeveless torso's left flank (image right, under the left arm) steps in whole pixels; where a hanging
    arm drawing comes close it leaves a jagged see-through slit (dips in talk, happy, think). Below
    the widest row (the shoulder), each row's right edge (last alpha >= 128) is smoothed (median over 5 rows,
    then a Gaussian, sigma 2 rows) and redrawn with coverage alpha clamp(e + 1 - x, 0, 1); new pixels take the
    colour of the last opaque pixel of the row. Returns the image and the pixels changed."""
    a = np.array(im).astype(np.float32)
    al = a[..., 3]
    H, W = al.shape
    rows = np.nonzero((al >= 128).any(1))[0]
    right = np.full(H, -1.0)
    for y in rows:
        right[y] = W - 1 - int(np.argmax(al[y, ::-1] >= 128))
    y0 = int(rows[np.argmax(right[rows])])
    ys = np.array([y for y in rows if y > y0 + 2])
    e = ndimage.gaussian_filter1d(ndimage.median_filter(right[ys], size=5), 2)
    out = a.copy()
    for y, ey in zip(ys, e):
        r = int(right[y])
        for x in range(max(0, int(np.floor(ey)) - 2), min(W, int(np.ceil(ey)) + 3)):
            cov = float(np.clip(ey + 1 - x, 0, 1))
            if x > r:
                if cov > 0:
                    out[y, x, :3] = a[y, r, :3]
                out[y, x, 3] = 255 * cov
            else:
                out[y, x, 3] = min(out[y, x, 3], 255 * cov) if cov < 1 else out[y, x, 3]
    changed = int((np.abs(out - a).max(2) > 0.5).sum())
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)), changed


def find_rims(im, part, lm):
    """The drawn lens rims of the front head, as circles in part px (2x). From each lens's rough centre
    (head-landmarks.json: its ellipse fit runs about 20 % large), 96 radial lines; on each, the light rim is the
    largest lift of L* over a 13-sample running median between 6 and 17 px. A least-squares circle is fitted,
    dropping points more than 1.2 px off it, three times. Checked by eye on an 8x overlay (both lenses, r 10.9)."""
    import cv2
    a = np.array(im).astype(np.float32)
    L = cv2.cvtColor(np.clip(a[..., :3], 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32)
    ox, oy = part["restPos1x"][0], part["restPos1x"][1] + OFFSET_Y
    out = []
    for lens in lm["lenses"]:
        cx, cy = (lens["cx"] - ox) * 2, (lens["cy"] - oy) * 2
        pts = []
        for th in np.linspace(0, 2 * np.pi, 96, endpoint=False):
            rs = np.arange(6, 17, 0.25)
            xs, ys = cx + rs * np.cos(th), cy + rs * np.sin(th)
            v = ndimage.map_coordinates(L, [ys, xs], order=1)
            lift = v - ndimage.median_filter(v, size=13)
            k = int(np.argmax(lift))
            if lift[k] > 4:
                pts.append((xs[k], ys[k]))
        pts = np.array(pts, np.float64)
        for _ in range(3):
            c = np.linalg.lstsq(np.c_[2 * pts, np.ones(len(pts))], (pts ** 2).sum(1), rcond=None)[0]
            cx, cy = c[0], c[1]
            r = float(np.sqrt(c[2] + cx * cx + cy * cy))
            res = np.abs(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - r)
            pts = pts[res <= max(1.2, np.percentile(res, 70))]
        out.append({"cx": round(float(cx), 3), "cy": round(float(cy), 3), "r": round(r, 3), "points": len(pts)})
    return out


RIM_SCALE = 0.89   # the drawn rims measure 12-14 % over the reference's rim/face ratio


def shrink_rims(im, rims, k=RIM_SCALE, bridge_deg=-20.0):
    """Unscaled, the rest head fails the frozen likeness harness on glasses_rim_diameter_over_face_width (the
    drawn rims are 12-14 % larger than the reference's; tolerance 6 %). Each rim's ring (within 2.2 px of its circle,
    2x px) is painted out by inpainting from the face around it and drawn again scaled by k about its own centre
    (each new pixel samples the old ring at the same angle, radius / k). The bridge and the temples met the old
    rims; the bridge is drawn again as a 1.2 px line in the rim's colour between the new rims at bridge_deg, and
    each temple is joined to its new rim by a short line. Returns (image, new rims)."""
    import cv2
    a = np.array(im).astype(np.float32)
    H, W = a.shape[:2]
    Y, X = np.mgrid[0:H, 0:W] + 0.5
    ring = np.zeros((H, W), bool)
    for c in rims:
        ring |= np.abs(np.hypot(X - c["cx"], Y - c["cy"]) - c["r"]) <= 2.2
    rgb8 = np.ascontiguousarray(np.clip(a[..., :3] + 0.5, 0, 255).astype(np.uint8))
    filled = cv2.inpaint(rgb8, ring.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA).astype(np.float32)
    out = a.copy(); out[..., :3] = filled
    core_cols = []
    for c in rims:
        d = np.hypot(X - c["cx"], Y - c["cy"])
        nr = c["r"] * k
        band = np.abs(d - nr) <= 2.2 * k
        mx = (c["cx"] + (X - c["cx"]) / k - 0.5).astype(np.float32)
        my = (c["cy"] + (Y - c["cy"]) / k - 0.5).astype(np.float32)
        src = cv2.remap(a, mx, my, cv2.INTER_LINEAR)
        # weight: the old ring's own shape at the sampled point (soft at its edges), so the face shows through
        wgt = np.clip(1 - (np.abs(d / k - c["r"]) - 1.2) / 1.0, 0, 1)[..., None] * band[..., None]
        out[..., :3] = out[..., :3] * (1 - wgt) + src[..., :3] * wgt
        core = np.abs(d - c["r"]) <= 0.6
        core_cols.append(np.median(a[..., :3][core], axis=0))
    col = tuple(float(v) for v in np.mean(core_cols, axis=0))
    th = np.radians(bridge_deg)
    L, R = sorted(rims, key=lambda c: c["cx"])
    pt = lambda c, ang, rr: (c["cx"] + rr * np.cos(ang), c["cy"] + rr * np.sin(ang))
    lines = [(pt(L, th, L["r"] * k), pt(R, np.pi - th, R["r"] * k)),           # bridge
             (pt(L, np.pi + th, L["r"] * k), pt(L, np.pi + th, L["r"] + 0.8)),  # temples back to where they met
             (pt(R, -th, R["r"] * k), pt(R, -th, R["r"] + 0.8))]
    sc = 8
    canvas = np.zeros((H * sc, W * sc), np.uint8)
    for p0, p1 in lines:
        cv2.line(canvas, (int(p0[0] * sc), int(p0[1] * sc)), (int(p1[0] * sc), int(p1[1] * sc)), 255, int(1.2 * sc), cv2.LINE_AA)
    lw = cv2.resize(canvas.astype(np.float32) / 255, (W, H), interpolation=cv2.INTER_AREA)[..., None]
    out[..., :3] = out[..., :3] * (1 - lw) + np.array(col, np.float32) * lw
    new = [dict(c, r=round(c["r"] * k, 3)) for c in rims]
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)), new


def rim_contrast(im, rims, core_k=0.5, out_k=0.35, in_k=0.0):
    """The glasses must read clearly; the drawn rims are a faint light pink line on pink skin.
    The rim core (within 0.9 px of the circle, 2x px) is moved core_k of the way to a neutral silver grey (0.86 of
    its own mean), with a faint darker edge 1.3 px outside (out_k) and inside (in_k), the way a thin metal rim
    shows. Core 0.5, outer edge 0.35, no inner edge (an inner edge reads as a second ring at 4x); with the rims
    shrunk by RIM_SCALE the frozen likeness harness passes the rest frame (rim/face ratio +0.036, glasses
    legibility 9.26), where core 0.8 / 0.12 / 0.06 leaves the right rim under the SNR bar."""
    a = np.array(im).astype(np.float32)
    H, W = a.shape[:2]
    Y, X = np.mgrid[0:H, 0:W] + 0.5
    core = np.zeros((H, W), np.float32); outer = core.copy(); inner = core.copy()
    for c in rims:
        d = np.hypot(X - c["cx"], Y - c["cy"]) - c["r"]
        core = np.maximum(core, np.clip(1 - np.abs(d) / 0.9, 0, 1))
        outer = np.maximum(outer, np.clip(1 - np.abs(d - 1.3) / 0.7, 0, 1))
        inner = np.maximum(inner, np.clip(1 - np.abs(d + 1.3) / 0.7, 0, 1))
    rgb = a[..., :3]
    rgb += (rgb.mean(2, keepdims=True) * 0.86 - rgb) * (core_k * core)[..., None]
    rgb *= (1 - out_k * outer - in_k * inner)[..., None]
    a[..., :3] = rgb
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)), int(((core + outer + inner) > 0).sum())


SEED_DRIFT_2X = (6.0, 3.0)   # 2x part px: about 0.23 iod right and down (iod 28.8 px between the rim centres)


def seed_glasses_head(im, rims, drift=SEED_DRIFT_2X):
    """Seed only: the head drawing with its lens rims drawn off the eyes, in COLOUR. Each rim's
    ring (within 1.6 px of its circle) is painted out by inpainting from the face around it, then the same ring
    pixels are pasted back moved by drift. The colour glasses rule must fail on frames drawn from this head."""
    import cv2
    a = np.array(im)
    H, W = a.shape[:2]
    Y, X = np.mgrid[0:H, 0:W] + 0.5
    ring = np.zeros((H, W), bool)
    for c in rims:
        ring |= np.abs(np.hypot(X - c["cx"], Y - c["cy"]) - c["r"]) <= 1.6   # the rims sit close to the eyes; a wider band inpainted the eyes away
    rgb = np.ascontiguousarray(a[..., :3])
    filled = cv2.inpaint(rgb, ring.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    out = a.copy(); out[..., :3] = filled
    M = np.float32([[1, 0, drift[0]], [0, 1, drift[1]]])
    moved = cv2.warpAffine(a, M, (W, H), flags=cv2.INTER_LINEAR)
    # only the rim line itself moves (the 2.2 px band also holds skin, which pasted over the eyes erased them)
    core = np.zeros((H, W), np.float32)
    for c in rims:
        core = np.maximum(core, np.clip(1 - (np.abs(np.hypot(X - c["cx"], Y - c["cy"]) - c["r"]) - 1.0) / 0.8, 0, 1))
    mring = cv2.warpAffine(core, M, (W, H), flags=cv2.INTER_LINEAR)[..., None]
    out[..., :3] = np.clip(out[..., :3] * (1 - mring) + moved[..., :3] * mring + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def id_atlas(imgs, rects, rims, marks, art):
    """Checker-only ID atlas (out/atlas-id.png, never shipped), same layout as the atlas. Inside each part it
    carries A = 255 and: on the front head, R = the lens rims (find_rims circles, a 1.2 px wide core at 2x
    with a 0.5 px soft edge) and G = the irises (discs of 0.17 iod); on every left-arm drawing, B = 100/255 of its alpha (a fold of one mesh may add to 200; the
    checker clips B at 100 and reads a second drawing from its own pass). The
    player's ID pass draws these with the same meshes and transforms as the colour frame, additively."""
    A = np.zeros((SIZE, SIZE, 4), np.uint8)
    lm = marks["head"]
    for name in ("head", "head.closed"):
        x, y, w, h = rects[name]
        al = np.array(imgs[name])[..., 3].astype(np.float32) / 255
        px = art[name]["restPos1x"][0] + (np.arange(w) + 0.5) / 2
        py = art[name]["restPos1x"][1] + OFFSET_Y + (np.arange(h) + 0.5) / 2
        X, Y = np.meshgrid(px, py)
        rim = np.zeros((h, w), np.float32)
        Xp, Yp = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
        for c in rims:
            d = np.abs(np.hypot(Xp - c["cx"], Yp - c["cy"]) - c["r"])
            rim = np.maximum(rim, np.clip(1.1 - d, 0, 0.5) / 0.5)
        iris = np.zeros((h, w), np.float32)
        if name == "head":
            for e in lm["eyes"]:
                iris = np.maximum(iris, np.clip(0.17 * lm["iod"] + 0.25 - np.hypot(X - e[0], Y - e[1]), 0, 0.25) / 0.25)
        A[y:y + h, x:x + w, 0] = np.round(255 * rim * al)
        A[y:y + h, x:x + w, 1] = np.round(255 * iris * al)
        A[y:y + h, x:x + w, 3] = 255
    for name in rects:
        if name.startswith("leftArm."):
            x, y, w, h = rects[name]
            A[y:y + h, x:x + w, 2] = np.round(np.array(imgs[name])[..., 3].astype(np.float32) * 100 / 255)
            A[y:y + h, x:x + w, 3] = 255
    Image.fromarray(A).save(OUT / "atlas-id.png")


import re
CLEAN = re.compile(r"^(left|right)Arm\.")


def skyline_pack(items, size):
    """items: [(name, w, h)] -> {name: (x, y)}. Bottom-left skyline, best y then x."""
    sky = [(0, size, 0)]  # segments (x, width, height)
    placed = {}
    for name, w, h in items:
        best = None
        for i in range(len(sky)):
            x = sky[i][0]
            if x + w > size:
                break
            y, width, j = 0, 0, i
            while width < w:
                y = max(y, sky[j][2])
                width += sky[j][1]
                j += 1
                if j > len(sky) and width < w:
                    break
            if y + h > size:
                continue
            if best is None or (y, x) < (best[0], best[1]):
                best = (y, x)
        if best is None:
            raise SystemExit(f"atlas full at {name}")
        y, x = best
        placed[name] = (x, y)
        # update skyline
        new = [(x, w, y + h)]
        for sx, sw, sh in sky:
            if sx + sw <= x or sx >= x + w:
                new.append((sx, sw, sh))
            else:
                if sx < x:
                    new.append((sx, x - sx, sh))
                if sx + sw > x + w:
                    new.append((x + w, sx + sw - x - w, sh))
        new.sort()
        merged = []
        for seg in new:
            if merged and merged[-1][2] == seg[2] and merged[-1][0] + merged[-1][1] == seg[0]:
                merged[-1] = (merged[-1][0], merged[-1][1] + seg[1], seg[2])
            else:
                merged.append(seg)
        sky = merged
    return placed


def main():
    art = json.loads((ART / "parts.json").read_text(encoding="utf8"))["parts"]
    key = json.loads((KEY / "parts.json").read_text(encoding="utf8"))["parts"]
    marks = json.loads((OUT / "head-landmarks.json").read_text(encoding="utf8"))
    inb = json.loads((INB / "parts.json").read_text(encoding="utf8"))["parts"]
    src = [(n, ART / art[n]["file"]) for n in ART_PARTS] + [(n, KEY / key[n]["file"]) for n in KEY_PARTS] + [(n, INB / inb[n]["file"]) for n in INB_PARTS]
    imgs, cleaned = {}, {}
    for name, path in src:
        im, n = Image.open(path).convert("RGBA"), 0
        if CLEAN.match(name):   # arm drawings only: head and hair keep their faint wisps
            im, n = despeckle(im)
            im, n2 = close_slits(im)
            im, n3 = fix_specks(im)
            n += n2 + n3
        if name == "rightArm.rest":
            im, n4 = fill_enclosed(im)
            n += n4
        if name == "pelvis":
            im, n = smooth_hem(im)
        if name == "torso.noLeftSleeve":
            im, n = smooth_flank(im)
        if name == "neck":
            im, n = widen_neck(im)
        if name in ("head", "head.closed"):
            if name == "head":
                rims0 = find_rims(im, art["head"], marks["head"])
            im, rims = shrink_rims(im, rims0)
            im, n = rim_contrast(im, rims)
        imgs[name] = im
        if n:
            cleaned[name] = n
    items = sorted(((n, im.width + 2 * GUTTER, im.height + 2 * GUTTER) for n, im in imgs.items()), key=lambda t: (-t[2], -t[1], t[0]))
    pos = skyline_pack(items, SIZE)
    atlas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rects, area = {}, 0
    for name, (x, y) in sorted(pos.items()):
        im = imgs[name]
        atlas.paste(im, (x + GUTTER, y + GUTTER))
        rects[name] = [x + GUTTER, y + GUTTER, im.width, im.height]
        area += im.width * im.height
    OUT.mkdir(exist_ok=True)
    atlas.save(OUT / "atlas.png", optimize=True)
    id_atlas(imgs, rects, rims, marks, art)
    atlas.save(OUT / "atlas.webp", lossless=True, quality=100, method=6, exact=True)
    used_h = max(y + h for (n, w, h), (x, y) in ((it, pos[it[0]]) for it in items))
    info = {"size": [SIZE, SIZE], "gutter": GUTTER, "partsPx": area, "fill": round(area / SIZE / SIZE, 4),
            "usedHeight": used_h, "cleanedPx": cleaned, "lensRims2x": rims, "cleaning": "despeckle the whole-arm drawings (largest alpha>=64 body + 2 px) and close their slits up to 2 px (close_slits); the neck is grown 3 px under the soft edges around it (widen_neck); the skirt hem is refitted as a smooth line (smooth_hem) and the torso's left flank smoothed (smooth_flank); the lens rims are toned to silver with faint dark edges (rim_contrast)", "rects": rects}
    (OUT / "atlas-rects.json").write_text(json.dumps(info, indent=1), encoding="utf8")
    # seed atlas (checker only, not shipped): the same atlas with the front head's rims drawn off the eyes
    seed = atlas.copy()
    for name in ("head",):
        x, y, w, h = rects[name]
        seed.paste(seed_glasses_head(imgs[name], rims), (x, y))
    seed.save(OUT / "atlas-seed-glasses.webp", lossless=True, quality=100, method=6, exact=True)
    # decoded-back check: the webp decodes to exactly the png pixels (lossless, exact alpha)
    a = Image.open(OUT / "atlas.webp").convert("RGBA").tobytes()
    b = atlas.tobytes()
    if a != b:
        raise SystemExit("webp is not lossless")
    print(json.dumps({k: v for k, v in info.items() if k != "rects"}), (OUT / "atlas.webp").stat().st_size, "B webp")


if __name__ == "__main__":
    sys.exit(main())

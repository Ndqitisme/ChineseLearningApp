"""Joint-seam and finish check: limbs stay continuous across the joints, with no tears, cut lines, snaps or
doubled parts. Every frame of every clip, at 1x and 2x (2x = the native 4x render box-downsampled by 2).

Per frame, at both scales:
  pieces   detached pieces: components (connected through alpha >= 48) apart from the body with >= 3 (1x)
           or >= 10 (2x) px of alpha >= 128.
  edge     opaque pixels (alpha >= 128) within 2 px (1x) of any of the four frame edges: cut by the frame.
  holes    enclosed see-through tears inside a limb (the strips of upper arms, forearms, thighs and shins; the gaps
           between fingers, hand and hip, arm and skirt, hair and neck are background): components of alpha
           < 128 that do not reach the frame border, thin
           (inscribed radius <= 1.5 px at 1x, 2.5 at 2x) or small, holding no declared gap (manifest
           allowed_holes: the art's own rest gaps). A wide gap between a hanging arm and the body is background.
  dips     (gated at 2x; 1x reported) partial-alpha seams inside the body and limbs, not the hands (hair wisps
           are soft by design; the gaps between fingers are background): a pixel below 200 with both neighbours 2 px away (left and
           right, or above and below) at 250 or more (a pale see-through band that a plain alpha < 128 hole
           test misses). Counted outside declared gaps and away (REST_DIP_R) from the rest
           frame's own dips moved with the head (the art's soft line between the ponytail and the neck).
  notch    (gated at 2x; 1x reported) silhouette notches along every limb (not only at the joints): on the alpha >= 128 outline inside the
           limb strip (capsules around the posed bones) from 35 % down the upper arm or thigh to the wrist or
           ankle, the sharpest concave turn over a +/-k point window.
  cutline  (REPORTED, NOT GATED: see CUT_FRAC) straight cut lines inside skin: Hough segments on Canny edges of the limb's opaque interior (eroded
           2 px), running across the limb (> 50 deg off the bone) and longer than CUT_FRAC of
           the limb's opaque interior width there.
           Shoes (laces), the fingers (all but the first 30 % of the hand), the sleeve (the first 60 % of the
           upper arm) and the thigh top under the skirt hem are left out.
  line     (gated 1x and 2x, LINE_L) a thin line across a limb that its drawing lacks: L* frame - drawing sampled
           along the bone on three lines across it, high-passed by a median along the bone; all three must agree
           (seam_rules.cross_line; the painted cut seed fails it).
  white    shirt-white pixels on the forearm and hand strips, outside the upper-arm strip and the torso box
           between the shoulders:
           a sleeve flap, a cuff floating at the wrist, a white streak down the forearm.
Per frame, from the renderer (manifest clips.<clip>.mesh, RigPlayer.meshQuality on the 1x player):
  mesh     every skinned limb mesh against a rigid copy of its drawing: foldPx, the area (1x px^2) of triangles
           turned over (the mesh folded over itself: a cut line where the layers cross), shearPx, the area of
           triangles stretched more than 2.2x one way than the other (a sleeve sheared into a spike, a crushed
           elbow). Fails above FOLD_PX or SHEAR_PX. Calibrated in --prove: the legacy drawing set on hairTuck
           (render.mjs --legacy) and the rigid rest-arm seed fail.
Per drawing (atlas, once per run): outline  a straight scissor-cut run of an arm drawing's outline with corners at
           both ends, away from the shoulder, over OUTLINE_PX (seam_rules.straight_outline; the hipfront fixture
           fails it).
Per clip, on the 1x frames:
  pop      a single-frame jump: the step to frame i (mean |premultiplied RGBA difference| over the frame) is
           larger than POP_K times both neighbouring steps and above POP_MIN: a part snapped in one frame while
           the motion around it was smooth. And on the left arm: the outline pixels that changed in its strip
           (1x) are at least ARM_POP_MIN and more than ARM_POP_K times the change on either side: the arm
           snapped in one frame (a key drawing swapped in at once).
  swap     every frame where the shown left-arm drawing changes (manifest arm.ti): its arm outline
           change may be at most ARM_SWAP_K times the larger change on either side (and under ARM_SWAP_MIN px it
           passes): a swap must not jump more than the motion around it.
Per frame, on the 4x ID pass (render.mjs: the same meshes and transforms, drawn additively from the
checker-only ID atlas: R lens rims, G irises, B left-arm coverage):
  doubled  a second left-arm drawing in the frame, or one at partial strength over an area (id_rules), in
           DOUBLE_PX or more 4x px: a cross-fade shows two arms, or a mesh smear.
  ghost    partial iris strength over a plateau (3x3 window in [40, 215]) of GHOST_PX or more 4x px: two heads
           cross-faded. Calibrated in --prove: clean frames reach 3, the cross-fade seeds 68-156.
  glasses  (--glasses) rim centroid minus iris centroid per eye, in interocular distances, against the rest
           frame's; fails beyond GLASSES_TOL. Frames with the eyes closed have no irises and are counted apart.

Thresholds: calibrated on the clean renders against the seeds (python -I seam_check.py --prove writes
out/seam-proof.json with the margins). Usage: python -I seam_check.py [frames_dir] [--out out/seam.json]
[--glasses]. Exit 0 only if no frame fails.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

cv2.setNumThreads(1)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))   # python -I drops the script's folder
import seam_rules as SR  # noqa: E402

# limb strips: the bones a strip follows and its half width in 1x px (generous: the strip must hold the outline)
STRIPS = {"leftArm": (["leftUpperArm", "leftForearm", "leftHand"], 9), "rightArm": (["rightUpperArm", "rightForearm", "rightHand"], 8),
          "leftLeg": (["leftThigh", "leftShin", "leftShoe"], 10), "rightLeg": (["rightThigh", "rightShin", "rightShoe"], 10)}
SCALES = {"1x": dict(f=0.25, k=2, min_piece=3, edge=2, hole=3, crack=1.5, dips=6), "2x": dict(f=0.5, k=4, min_piece=10, edge=4, hole=8, crack=2.5, dips=6)}
NOTCH_DEG = {"1x": 100.0, "2x": 100.0}  # gated at both scales; the k-point turn is quantised to 90 on clean outlines
CUT_FRAC = {"1x": None, "2x": None}   # the Hough measure, reported only; the gated cut rule is CUT_LEN (seam_rules.py)
# straight step edges inside skin that the posed drawing does not have, longest in 1x px
# (seam_rules.cut_unexplained); gated at both scales. Calibrated in --prove: the r4-hairTuck fixture,
# the painted cut and the rigid-elbow seed fail, the clean rest frame passes
CUT_LEN = {"1x": 4.25, "2x": 5.5}
BULGE_MAX = 1.6   # limb width / drawing width at the same bone parameter (seam_rules.bulge)
# a thin line across a limb, in L* against the drawing (seam_rules.cross_line); gated at
# both scales. Calibrated in --prove: the painted cut must fail at 1x and 2x, the clean rest frame passes
LINE_L = {"1x": 6.0, "2x": 6.0}
WHITE_PX = {"1x": 4, "2x": 14}
POP_K, POP_MIN = 3.0, 1.0
ARM_POP_K, ARM_POP_MIN = 2.0, 150   # 1x px of the left-arm outline
REST_DIP_R = 1.5   # 1x px: a dip this close to a rest-frame dip (moved with the head) is the art's own soft line
ALLOWED_R = 8      # 1x px: a declared art gap (hair/neck, hand-on-hip loop, arm/skirt) covers holes this close to its point
GLASSES_TOL_C = 0.10   # iod, colour frames (glasses_colour.py); calibrated in --prove against the colour drift seed
GLASSES_TOL = 0.10   # iod; clean frames reach 0.05, a 0.15 iod drift seed scores 0.17 (--prove)
FOLD_PX, SHEAR_PX = 100.0, 300.0   # 1x px^2 (mesh rule); see --prove for the clean maxima and the seeds
ARM_SWAP_K, ARM_SWAP_MIN = 1.5, 60
DOUBLE_PX = 40   # ID pass B at 4x (id_rules)
GHOST_BAND, GHOST_PX = (40, 215), 12       # ID pass G at 4x


REF = None   # seam_rules.Ref: the drawings, from the clean render's rest frame and the atlas


def load(clipdir, name, scale):
    if scale == "1x":
        return np.array(Image.open(clipdir / "1x" / name).convert("RGBA"))
    a = np.array(Image.open(clipdir / "4x" / name).convert("RGBA")).astype(np.float32)
    pm = a.copy(); pm[..., :3] *= a[..., 3:4] / 255
    d = pm.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, 4).mean((1, 3))
    out = d.copy(); al = np.maximum(d[..., 3:4], 1e-6); out[..., :3] = np.where(d[..., 3:4] > 0, d[..., :3] * 255 / al, 0)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def pieces(alpha, min_piece):
    n, lab = cv2.connectedComponents((alpha >= 48).astype(np.uint8), connectivity=8)
    solid = np.bincount(lab[alpha >= 128].ravel(), minlength=n)[1:]
    areas = sorted((int(a) for a in solid), reverse=True)
    return [a for a in areas[1:] if a >= min_piece]


def edge_hits(alpha, e):
    m = alpha >= 128
    return int(m[:e].sum() + m[-e:].sum() + m[:, :e].sum() + m[:, -e:].sum())


def near_any(mask_pts, pts, r):
    return any(np.hypot(mask_pts[:, 0] - p[0], mask_pts[:, 1] - p[1]).min() <= r for p in pts) if len(mask_pts) else False


def holes(alpha, min_px, allowed, crack, scale, region):
    """Enclosed see-through regions that are tears: thin (inscribed radius <= crack px) or small (< 6 min_px),
    and holding no declared gap. A wide gap between a hanging arm and the body is background."""
    see = (alpha < 128).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(see, connectivity=4)
    dist = cv2.distanceTransform(see, cv2.DIST_L2, 3)
    H, W = alpha.shape
    bad = []
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if x == 0 or y == 0 or x + w == W or y + h == H or area < min_px:
            continue
        inside = lab[y:y + h, x:x + w] == i
        if not region[y:y + h, x:x + w][inside].any():
            continue
        if dist[y:y + h, x:x + w][inside].max() > crack and area >= 6 * min_px:
            continue
        ys, xs = np.nonzero(inside)
        if near_any(np.stack([xs + x, ys + y], 1), allowed, ALLOWED_R * scale):
            continue
        bad.append(int(area))
    return bad


def dips(img, allowed, scale_f, region):
    alpha = img[..., 3]
    a = alpha.astype(np.int16)
    # hair strands are soft and dark by design; a seam is pale (skin, shirt)
    region = region & (img[..., :3].astype(np.int16).mean(2) > 110)
    low = a < 200
    hx = np.zeros_like(low); hy = np.zeros_like(low)
    hx[:, 2:-2] = (a[:, :-4] >= 250) & (a[:, 4:] >= 250)
    hy[2:-2, :] = (a[:-4, :] >= 250) & (a[4:, :] >= 250)
    m = low & (hx | hy) & region
    ys, xs = np.nonzero(m)
    keep = [(x, y) for x, y in zip(xs, ys) if not allowed or min(np.hypot(x - p[0], y - p[1]) for p in allowed) > ALLOWED_R * scale_f * 4]
    return keep


def strip_mask(shape, bones, names, half, f):
    m = np.zeros(shape, np.uint8)
    for n in names:
        if n in bones:
            a, b = np.array(bones[n][0]) * f, np.array(bones[n][1]) * f
            cv2.line(m, tuple(int(round(v)) for v in a), tuple(int(round(v)) for v in b), 1, max(1, int(round(2 * half * f * 4))))
    return m.astype(bool)


def notch_region(shape, bones, names, half, f):
    """Where a notch counts: the limb strip from 35 % down the upper arm or thigh (the armpit and the hem are
    concave by nature) to the end of the forearm or shin (the fingers and the shoe laces are not outlines)."""
    m = np.zeros(shape, np.uint8)
    for k, n in enumerate(names[:2]):
        if n not in bones:
            continue
        a, b = np.array(bones[n][0]) * f, np.array(bones[n][1]) * f
        if k == 0:
            a = a + 0.35 * (b - a)
        cv2.line(m, tuple(int(round(v)) for v in a), tuple(int(round(v)) for v in b), 1, max(1, int(round(2 * half * f * 4))))
    return m.astype(bool)


def notch_in(alpha, region, k):
    cs, _ = cv2.findContours((alpha >= 128).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    worst, where = 0.0, None
    for cnt in cs:
        p = cnt[:, 0, :].astype(np.float32)
        if len(p) < 2 * k + 3:
            continue
        inside = region[p[:, 1].astype(int).clip(0, region.shape[0] - 1), p[:, 0].astype(int).clip(0, region.shape[1] - 1)]
        if not inside.any():
            continue
        prv, nxt = np.roll(p, k, 0), np.roll(p, -k, 0)
        v1, v2 = p - prv, nxt - p
        ang = np.degrees(np.arctan2(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0], (v1 * v2).sum(1)))
        sign = -np.sign(cv2.contourArea(cnt, oriented=True)) or 1
        conc = np.where(inside, -sign * ang, 0)
        i = int(np.argmax(conc))
        if conc[i] > worst:
            worst, where = float(conc[i]), p[i].tolist()
    return worst, where


def cutlines(img, bones, names, half, f):
    """Straight segments across the limb inside its opaque interior; returns the longest as a share of the limb's
    opaque interior width there (measured across the bone at the segment's middle)."""
    alpha = img[..., 3]
    inner = cv2.erode((alpha == 255).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    lum = cv2.cvtColor(np.ascontiguousarray(img[..., :3]), cv2.COLOR_RGB2GRAY)
    e = (cv2.Canny(lum, 40, 90) > 0)
    width = 2 * half * f * 4
    worst = 0.0
    for n in names:
        if n not in bones or n.endswith("Shoe"):
            continue
        a, b = np.array(bones[n][0]) * f, np.array(bones[n][1]) * f
        if np.hypot(*(b - a)) < 2:
            continue
        if n.endswith("Thigh"):   # the skirt hem crosses the thigh top: start 26 px (1x) down the bone
            u = (b - a) / np.hypot(*(b - a))
            a = a + u * min(26 * f * 4, 0.9 * np.hypot(*(b - a)))
        if n.endswith("Hand"):    # the wrist only: the gaps between the fingers are straight edges across the hand
            b = a + 0.3 * (b - a)
        if n.endswith("UpperArm"):   # the sleeve hem crosses the upper arm: from 60 % down to the elbow
            a = a + 0.6 * (b - a)
        m = np.zeros(alpha.shape, np.uint8)
        cv2.line(m, tuple(int(round(v)) for v in a), tuple(int(round(v)) for v in b), 1, max(1, int(round(2 * half * f * 4))))
        m = m.astype(bool) & inner & e
        if m.sum() < 3:
            continue
        # the interior width across the bone at its middle
        u = (b - a) / np.hypot(*(b - a)); nrm = np.array([-u[1], u[0]]); c = (a + b) / 2
        pts = [c + nrm * t for t in np.arange(-width, width + 0.5, 0.5)]
        on = [bool(inner[int(round(q[1])), int(round(q[0]))]) if 0 <= int(round(q[1])) < alpha.shape[0] and 0 <= int(round(q[0])) < alpha.shape[1] else False for q in pts]
        wl = 0.5 * max((len(r) for r in "".join("1" if o else "0" for o in on).split("0")), default=0)
        if wl < 3:
            continue
        segs = cv2.HoughLinesP(m.astype(np.uint8) * 255, 1, np.pi / 90, threshold=max(3, int(wl * 0.4)), minLineLength=max(3, int(wl * 0.5)), maxLineGap=1)
        if segs is None:
            continue
        bd = np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0]))
        for x1, y1, x2, y2 in segs.reshape(-1, 4):
            d = abs(((np.degrees(np.arctan2(y2 - y1, x2 - x1)) - bd + 90) % 180) - 90)
            if d > 50:
                worst = max(worst, float(np.hypot(x2 - x1, y2 - y1)) / wl)
    return worst


def whites(img, bones, f):
    """Shirt-white pixels on the forearm/hand strips of both arms, outside the upper-arm strips and the torso box."""
    alpha = img[..., 3]
    rgb = img[..., :3].astype(np.int16)
    mx, mn = rgb.max(2), rgb.min(2)
    white = (alpha >= 200) & (mn >= 205) & (mx - mn <= 28)
    n = 0
    # the forearm may lie over the white shirt (think, tuck): the torso between the shoulders is left out
    torso = np.zeros(alpha.shape, bool)
    if all(k in bones for k in ("leftUpperArm", "rightUpperArm", "leftThigh")):
        xa, xb = sorted([bones["rightUpperArm"][0][0] * f, bones["leftUpperArm"][0][0] * f])
        ya, yb = min(bones["rightUpperArm"][0][1], bones["leftUpperArm"][0][1]) * f - 10 * f * 4, bones["leftThigh"][0][1] * f
        torso[int(max(0, ya)):int(yb), int(xa):int(xb) + 1] = True
    for side, half in (("left", 6), ("right", 5)):
        low = strip_mask(alpha.shape, bones, [f"{side}Forearm", f"{side}Hand"], half, f)
        up = strip_mask(alpha.shape, bones, [f"{side}UpperArm"], 11, f)
        n += int((white & low & ~up & ~torso).sum())
    return n


def check(frames, out_path=None, quiet=False, clips=None):
    man = json.loads((frames / "manifest.json").read_text(encoding="utf8"))
    rest_bones = man["rest_joints"]
    global REF
    if REF is None:
        mm = json.loads((HERE / "out" / "frames" / "manifest.json").read_text(encoding="utf8"))
        REF = SR.Ref(np.array(Image.open(HERE / "out" / "frames" / "rest" / "4x" / "0000.png").convert("RGBA")), mm["rest_joints"])
    report, fails = {}, 0
    # dips of the rest frame (any count): the art's own soft lines, discounted where the head carries them
    rest_dips = {}
    if (frames / "rest" / "1x" / "0000.png").exists() and clips != ["rest"]:
        for sc, s in SCALES.items():
            img = load(frames / "rest", "0000.png", sc)
            rest_dips[sc] = dips(img, [], s["f"], np.ones(img.shape[:2], bool)) or None
    stats = {sc: {"notch": [], "cut": [], "white": [], "dips": []} for sc in SCALES}
    for clipdir in sorted(p for p in frames.iterdir() if p.is_dir() and (clips is None or p.name in clips)):
        clip = clipdir.name
        cm = man["clips"].get(clip, {})
        jm, holes_m = cm.get("joints", {}), man.get("allowed_holes", {}).get(clip, {})
        rows, prev1, steps, prevA, prevB, armpop = [], None, [], None, None, []
        files = sorted((clipdir / "1x").glob("*.png"))
        for fpath in files:
            i = int(fpath.stem)
            bones = jm.get(str(i), rest_bones)
            allowed4 = holes_m.get(str(i), man.get("allowed_holes", {}).get("rest", {}).get("0", []))
            row = {"frame": i, "fails": []}
            for sc, s in SCALES.items():
                img = load(clipdir, fpath.name, sc)
                al = img[..., 3]
                allowed = [[p[0] * s["f"], p[1] * s["f"]] for p in allowed4]
                pc = pieces(al, s["min_piece"])
                if pc:
                    row["fails"].append(f"{sc} pieces {pc[:3]}")
                eh = edge_hits(al, s["edge"])
                if eh:
                    row["fails"].append(f"{sc} edge {eh}px")
                limbs = np.zeros(al.shape, bool)
                for names, half in STRIPS.values():
                    limbs |= strip_mask(al.shape, bones, [n for n in names if not n.endswith(("Hand", "Shoe"))], half * 0.6, s["f"])
                hl = holes(al, s["hole"], allowed, s["crack"], s["f"] * 4, limbs)
                if hl:
                    row["fails"].append(f"{sc} holes {hl[:3]}")
                body = np.zeros(al.shape, bool)
                for names, half in STRIPS.values():   # not the hands: the gaps between fingers are background
                    body |= strip_mask(al.shape, bones, [n for n in names if not n.endswith("Hand")], half, s["f"])
                # neck and torso between the shoulders, from under the chin to the hips (not the hair)
                if "leftUpperArm" in bones and "rightUpperArm" in bones and "leftThigh" in bones:
                    xa = min(bones["rightUpperArm"][0][0], bones["leftUpperArm"][0][0]) * s["f"]
                    xb = max(bones["rightUpperArm"][0][0], bones["leftUpperArm"][0][0]) * s["f"]
                    ya = (min(bones["rightUpperArm"][0][1], bones["leftUpperArm"][0][1]) - 4 * 26) * s["f"]
                    yb = bones["leftThigh"][0][1] * s["f"]
                    body[int(max(0, ya)):int(yb), int(xa):int(xb)] = True
                dp = dips(img, allowed, s["f"], body)
                # the rest frame's own soft lines (the ponytail against the neck), carried by the head, are art
                hc = cm.get("head_centre", {}).get(str(i)); hc0 = man["clips"].get("rest", {}).get("head_centre", {}).get("0")
                if hc and hc0 and rest_dips.get(sc):
                    off = np.array([(hc[0] - hc0[0]) * s["f"], (hc[1] - hc0[1]) * s["f"]])
                    rd = np.array(rest_dips[sc], float) + off
                    dp = [q for q in dp if np.hypot(rd[:, 0] - q[0], rd[:, 1] - q[1]).min() > REST_DIP_R * s["f"] * 4]
                stats[sc]["dips"].append(len(dp))
                if s["dips"] is not None and len(dp) >= s["dips"]:
                    row["fails"].append(f"{sc} dips {len(dp)} at {dp[0]}")
                worst_n, worst_c = 0.0, 0.0
                for limb, (names, half) in STRIPS.items():
                    nd, at = notch_in(al, notch_region(al.shape, bones, names, half, s["f"]), s["k"])
                    cl = cutlines(img, bones, names, half * 0.75, s["f"])
                    worst_n, worst_c = max(worst_n, nd), max(worst_c, cl)
                    if NOTCH_DEG[sc] is not None and nd > NOTCH_DEG[sc]:
                        row["fails"].append(f"{sc} notch {limb} {nd:.0f}deg at {[round(v) for v in at]}")
                    if CUT_FRAC[sc] is not None and cl > CUT_FRAC[sc]:
                        row["fails"].append(f"{sc} cutline {limb} {cl:.2f}w")
                arm = cm.get("arm", {}).get(str(i))
                cu, cu_at, bu, bu_at, li, li_at = 0.0, None, 0.0, None, 0.0, None
                lc = {}
                for limb in SR.LIMB_BONES:
                    tex = REF.drawing(limb, arm)
                    v, a = SR.cross_line(img, bones, limb, tex, s["f"], lc)
                    if v > li:
                        li, li_at = v, [limb, a]
                    v, a = SR.cut_unexplained(img, bones, limb, tex, s["f"], SR.CUT_P[sc])
                    if v > cu:
                        cu, cu_at = v, [limb, a]
                    if limb.endswith("Arm"):
                        v, a = SR.bulge(img, bones, limb, tex, s["f"])
                        if v > bu:
                            bu, bu_at = v, [limb, a]
                if cu > CUT_LEN[sc]:
                    row["fails"].append(f"{sc} cut {cu:.1f}px {cu_at}")
                if bu > BULGE_MAX:
                    row["fails"].append(f"{sc} bulge {bu:.2f} {bu_at}")
                if li > LINE_L[sc]:
                    row["fails"].append(f"{sc} line {li:.1f}L {li_at}")
                stats[sc].setdefault("line", []).append(round(li, 1))
                stats[sc].setdefault("cutLen", []).append(round(cu, 1)); stats[sc].setdefault("bulge", []).append(round(bu, 2))
                wp = whites(img, bones, s["f"])
                if wp > WHITE_PX[sc]:
                    row["fails"].append(f"{sc} white {wp}px")
                stats[sc]["notch"].append(round(worst_n, 1)); stats[sc]["cut"].append(round(worst_c, 2)); stats[sc]["white"].append(wp)
                row[sc] = {"notch": round(worst_n, 1), "cut": round(worst_c, 2), "cutLen": round(cu, 1), "bulge": round(bu, 2), "line": round(li, 1), "white": wp, "dips": len(dp)}
            idimg = load_id(clipdir, fpath.name)
            if idimg is not None:
                p2 = clipdir / "id2" / fpath.name
                ir = id_rules(idimg, np.array(Image.open(p2).convert("RGB")).astype(np.int16) if p2.exists() else None)
                row["id"] = ir
                if ir["doubled"] >= DOUBLE_PX:
                    row["fails"].append(f"id doubled arm {ir['doubled']}px")
                if ir["ghost"] >= GHOST_PX:
                    row["fails"].append(f"id ghosted head {ir['ghost']}px")
                stats["2x"].setdefault("doubled", []).append(ir["doubled"]); stats["2x"].setdefault("ghost", []).append(ir["ghost"])
            mq = cm.get("mesh", {}).get(str(i))
            if mq:
                row["mesh"] = mq
                stats["1x"].setdefault("fold", []).append(mq["foldPx"]); stats["1x"].setdefault("shear", []).append(mq["shearPx"])
                if mq["foldPx"] > FOLD_PX or mq["shearPx"] > SHEAR_PX:
                    row["fails"].append(f"mesh fold {mq['foldPx']} shear {mq['shearPx']} px2")
            a1 = np.array(Image.open(fpath).convert("RGBA"))[..., 3]
            arm = strip_mask(a1.shape, bones, STRIPS["leftArm"][0], STRIPS["leftArm"][1] + 4, 0.25)
            if prevA is not None:
                region = arm | prevA[1]
                diff = int(((a1 >= 128) ^ (prevA[0] >= 128))[region].sum())
                disp = max((float(np.hypot(*(np.array(bones[n][e]) - np.array(prevB[n][e])))) / 4 for n in ("leftForearm", "leftHand") for e in (0, 1) if n in bones and n in prevB), default=0.0)
                length = sum(float(np.hypot(*(np.array(bones[n][1]) - np.array(bones[n][0])))) / 4 for n in STRIPS["leftArm"][0] if n in bones) or 1
                armpop.append((len(armpop) + 1, diff / (length * (disp + 1.0)), diff, disp))
            prevA, prevB = (a1, arm), bones
            cur = np.array(Image.open(fpath).convert("RGBA")).astype(np.float32)
            cur[..., :3] *= cur[..., 3:4] / 255
            steps.append(float(np.abs(cur - prev1).mean()) if prev1 is not None else 0.0)
            prev1 = cur
            rows.append(row)
        # pops: a step much larger than both neighbours
        for k in range(1, len(steps)):
            nb = max(steps[k - 1] if k > 1 else 0, steps[k + 1] if k + 1 < len(steps) else 0)
            if steps[k] > POP_MIN and steps[k] > POP_K * nb:
                rows[k]["fails"].append(f"pop step {steps[k]:.2f} vs {nb:.2f}")
        diffs = [0] + [d for _, _, d, _ in armpop]
        for k, ratio, diff, disp in armpop:
            rows[k]["armChange"] = [round(ratio, 3), diff, round(disp, 2)]
            nb = max(diffs[k - 1] if k > 1 else 0, diffs[k + 1] if k + 1 < len(diffs) else 0)
            if diff >= ARM_POP_MIN and diff > ARM_POP_K * nb:
                rows[k]["fails"].append(f"pop arm {diff}px changed vs {nb}px next to it")
        # jumps: the posed left arm's joints moving in one frame far more than beside it
        jr, _ = SR.jumps([jm.get(str(r["frame"]), rest_bones) for r in rows])
        for k, (stp, nb) in jr.items():
            rows[k]["fails"].append(f"jump arm joint {stp}px vs {nb}px next to it")
        # swaps: the drawing shown changes at frame k (arm.ti indexes arm.keys)
        arm = cm.get("arm", {})
        drawn = [(lambda a: a["keys"][a["ti"]] if a else None)(arm.get(str(r["frame"]))) for r in rows]
        for k in range(1, len(rows)):
            if drawn[k] is None or drawn[k - 1] is None or drawn[k] == drawn[k - 1]:
                continue
            d = diffs[k] if k < len(diffs) else 0
            nb = max(diffs[k - 1] if k > 1 else 0, diffs[k + 1] if k + 1 < len(diffs) else 0)
            rows[k]["swap"] = [drawn[k - 1], drawn[k], d, nb]
            if d >= ARM_SWAP_MIN and d > ARM_SWAP_K * nb:
                rows[k]["fails"].append(f"swap {drawn[k - 1]}->{drawn[k]} arm {d}px changed vs {nb}px next to it")
        for r, st in zip(rows, steps):
            r["step"] = round(st, 3)
        fails += sum(bool(r["fails"]) for r in rows)
        report[clip] = {"frames": len(rows), "failed": [r["frame"] for r in rows if r["fails"]], "rows": rows}
        if not quiet:
            bad = [r for r in rows if r["fails"]]
            print(f"{clip:14s} {len(rows):4d} frames, {len(bad):3d} fail" + (f"  e.g. {bad[0]['frame']}: {', '.join(bad[0]['fails'][:3])}" if bad else ""), flush=True)
    dist = {sc: {k: {"max": max(v) if v else 0, "p99": float(np.percentile(v, 99)) if v else 0} for k, v in st.items()} for sc, st in stats.items()}
    summary = {"framesChecked": sum(v["frames"] for v in report.values()), "framesFailed": fails,
               "thresholds": {"notchDeg": NOTCH_DEG, "cutFrac": CUT_FRAC, "whitePx": WHITE_PX, "popK": POP_K, "popMin": POP_MIN, "holePx": {k: v["hole"] for k, v in SCALES.items()}, "dipsPx": {k: v["dips"] for k, v in SCALES.items()},
                              "foldPx": FOLD_PX, "shearPx": SHEAR_PX, "swapK": ARM_SWAP_K, "swapMin": ARM_SWAP_MIN,
                              "cutLen": CUT_LEN, "bulgeMax": BULGE_MAX, "lineL": LINE_L, "jumpK": SR.JUMP_K, "jumpMinPx": SR.JUMP_MIN},
               "distribution": dist}
    if out_path:
        Path(out_path).write_text(json.dumps({"summary": summary, "clips": report}, indent=1), encoding="utf8")
    return summary, report


# ---------------------------------------------------------------- ID pass: glasses, doubled arm, ghosted head
def load_id(clipdir, name):
    p = clipdir / "id" / name
    return np.array(Image.open(p).convert("RGB")).astype(np.int16) if p.exists() else None


def plateau(ch, lo, hi, win):
    """Pixels of a channel whose whole win x win neighbourhood lies in [lo, hi]: a flat half-strength area. One
    drawing gives 0 or 255 inside and a ramp of 2-4 px at its edge (a window across a ramp reaches outside the
    band); a drawing at partial alpha, alone over the background, gives a plateau."""
    m = ((ch >= lo) & (ch <= hi)).astype(np.uint8)
    return int((cv2.erode(m, np.ones((win, win), np.uint8)) > 0).sum())


def id_rules(idimg, id2=None):
    """doubled: a second left-arm drawing drawn in the same frame (id2, a cross-fade), counted as
    its pixels at >= 30 % strength, plus each drawing at partial strength over an area (B plateau in [20, 85] of
    100, 5x5): one drawing faded over the background, or a mesh smear of stretched soft edge texels. A mesh
    overlapping itself where an elbow folds is one drawing and is not counted (its draw order is by bone).
    ghost: iris strength at partial level over a plateau (G, 3x3): two heads cross-faded."""
    b = np.minimum(idimg[..., 2], 100)
    d = plateau(b, 20, 85, 5)
    if id2 is not None:
        b2 = np.minimum(id2[..., 2], 100)
        d += int((b2 >= 30).sum()) + plateau(b2, 20, 85, 5)
    return {"doubled": d, "ghost": plateau(idimg[..., 1], GHOST_BAND[0], GHOST_BAND[1], 3)}


def glasses_of(idimg):
    """Lens-rim centroid minus iris centroid per eye, in interocular distances, from the ID pass (R rims, G
    irises: the same meshes and transforms as the colour frame). None while the eyes are closed (no irises)."""
    g = idimg[..., 1]
    n, lab, st, cen = cv2.connectedComponentsWithStats((g >= 128).astype(np.uint8), connectivity=8)
    if n < 3:
        return None
    big = sorted(range(1, n), key=lambda i: -st[i, 4])[:2]
    if st[big[1], 4] < 20:
        return None
    eyes = []
    for i in big:   # weighted iris centroid
        ys, xs = np.nonzero(lab == i)
        w = g[ys, xs].astype(np.float64)
        eyes.append(np.array([(xs * w).sum() / w.sum(), (ys * w).sum() / w.sum()]))
    eyes.sort(key=lambda e: e[0])
    iod = float(np.hypot(*(eyes[1] - eyes[0])))
    r = idimg[..., 0].astype(np.float64)
    H, W = r.shape
    Y, X = np.mgrid[0:H, 0:W]
    out = []
    mid = (eyes[0][0] + eyes[1][0]) / 2
    for k, e in enumerate(eyes):
        box = (np.abs(Y - e[1]) < 0.8 * iod) & ((X < mid) if k == 0 else (X >= mid)) & (np.abs(X - e[0]) < 0.9 * iod)
        w = r * box
        if w.sum() < 255 * 20:
            return None
        c = np.array([(X * w).sum() / w.sum(), (Y * w).sum() / w.sum()])
        out.append(((c - e) / iod).tolist())
    return {"offsets": out, "iod": iod}


def glasses_check(frames, out_path, clips=None, ref=None):
    """Every frame: the rims' offset from the irises against the rest frame's; fails beyond GLASSES_TOL iod."""
    if ref is None:
        ref = glasses_of(load_id(HERE / "out" / "frames" / "rest", "0000.png"))["offsets"]
    report, fails, worst, closed = {}, 0, 0.0, 0
    worst_c = 0.0
    man = json.loads((frames / "manifest.json").read_text(encoding="utf8"))
    # colour reference: rest frame of the clean render, its templates from its ID pass
    import glasses_colour as GCOL
    rest_dir = HERE / "out" / "frames" / "rest"
    cref = GCOL.build_ref(np.array(Image.open(rest_dir / "4x" / "0000.png").convert("RGBA")), load_id(rest_dir, "0000.png"))
    hc0 = json.loads((HERE / "out" / "frames" / "manifest.json").read_text(encoding="utf8"))["clips"]["rest"]["head_centre"]["0"]
    for clipdir in sorted(p for p in frames.iterdir() if p.is_dir() and (clips is None or p.name in clips)):
        clip, rows = clipdir.name, []
        cm = man["clips"].get(clip, {})
        for fpath in sorted((clipdir / "id").glob("*.png")):
            i = int(fpath.stem)
            g = glasses_of(load_id(clipdir, fpath.name))
            turn = cm.get("head_turn", {}).get(str(i), [0, 0])
            if g is None:
                closed += 1
                rows.append({"frame": i, "turn": turn, "eyesClosed": True, "fails": []})
                continue
            dev = max(float(np.hypot(o[0] - q[0], o[1] - q[1])) for o, q in zip(g["offsets"], ref))
            worst = max(worst, dev)
            row = {"frame": i, "turn": turn, "dev": round(dev, 4), "fails": [f"glasses off the eyes by {dev:.3f} iod"] if dev > GLASSES_TOL else []}
            f4 = clipdir / "4x" / fpath.name
            hc = cm.get("head_centre", {}).get(str(i))
            if f4.exists() and hc:
                dc, det = GCOL.offset(np.array(Image.open(f4).convert("RGBA")), cref, (hc[0] - hc0[0], hc[1] - hc0[1]))
                if dc is not None:
                    row["devColour"] = round(dc, 4); row["colour"] = det
                    worst_c = max(worst_c, dc)
                    if dc > GLASSES_TOL_C:
                        row["fails"].append(f"colour: glasses off the eyes by {dc:.3f} iod")
            rows.append(row)
        nb = sum(bool(r["fails"]) for r in rows)
        fails += nb
        yaws = [r["turn"][0] for r in rows]
        report[clip] = {"frames": len(rows), "failed": [r["frame"] for r in rows if r["fails"]], "yawRange": [min(yaws), max(yaws)] if yaws else None, "rows": rows}
        print(f"{clip:16s} glasses: {len(rows)} frames, {nb} fail, yaw {report[clip]['yawRange']}", flush=True)
    summary = {"framesChecked": sum(v["frames"] for v in report.values()), "framesFailed": fails, "framesEyesClosed": closed, "tolIod": GLASSES_TOL,
               "worstDevIod": round(worst, 4), "reference": "rest frame rim-minus-iris offsets from the ID pass", "restOffsets": ref,
               "tolIodColour": GLASSES_TOL_C, "worstDevIodColour": round(worst_c, 4),
               "colourReference": "rim and eye templates from the rest colour frame, matched in each colour frame (glasses_colour.py)"}
    Path(out_path).write_text(json.dumps({"summary": summary, "clips": report}, indent=1), encoding="utf8")
    return summary


# ---------------------------------------------------------------- seeds: every rule must fail on its defect
def _save_pair(d, im):
    """Writes a 4x RGBA frame and its 1x box-downsample (premultiplied) into d/4x and d/1x as 0000.png."""
    for sc in ("1x", "4x"):
        (d / sc).mkdir(parents=True, exist_ok=True)
    Image.fromarray(im).save(d / "4x" / "0000.png")
    a = im.astype(np.float32); a[..., :3] *= a[..., 3:4] / 255
    q = a.reshape(340, 4, 139, 4, 4).mean((1, 3)); o = q.copy(); al = np.maximum(q[..., 3:4], 1e-6)
    o[..., :3] = np.where(q[..., 3:4] > 0, q[..., :3] * 255 / al, 0)
    Image.fromarray(np.clip(o + 0.5, 0, 255).astype(np.uint8)).save(d / "1x" / "0000.png")


OUTLINE_PX = 16.0   # 2x tex px: straight cut outline of an arm drawing (seam_rules.straight_outline)


def drawings_check():
    """Every shipped arm drawing in the atlas: no straight scissor-cut outline run
    (OUTLINE_PX) away from the shoulder. Returns ({part: [len, at]}, failed parts)."""
    rig = json.loads((HERE / "out" / "rig.json").read_text(encoding="utf8"))
    at = np.array(Image.open(HERE / "out" / "atlas.png").convert("RGBA"))
    res, bad = {}, []
    for n, p in rig["parts"].items():
        if not n.startswith(("leftArm", "rightArm")) or not p.get("bones"):
            continue
        x, y, w, h = p["rect"]
        tp = {k: [(v[0] - p["pos"][0]) * 2, (v[1] - p["pos"][1]) * 2] for k, v in p["bones"].items()}
        v, a = SR.straight_outline(at[y:y + h, x:x + w], tp)
        res[n] = [round(v, 1), a]
        if v > OUTLINE_PX:
            bad.append(n)
    return res, bad


def prove():
    """Seeds (out/seed-*): the rigid-elbow render (render.mjs --hard), a snap (happy with six frames skipped mid-
    gesture), and defects painted onto
    the clean rest frame: a cut line across the forearm, a detached piece, a thin tear in the thigh, a pale
    see-through band beside the neck, a white flap on the forearm, the figure pushed past the right edge,
    and the front glasses left in place on a turned head. Each must fail with its own rule; the
    clean frames must pass."""
    out = {}
    src = HERE / "out" / "frames"
    man = json.loads((src / "manifest.json").read_text(encoding="utf8"))
    import shutil
    sw = HERE / "out" / "seed-swap"
    shutil.rmtree(sw, ignore_errors=True)
    for sc in ("1x", "4x"):
        (sw / "happy" / sc).mkdir(parents=True, exist_ok=True)
        files = sorted((src / "happy" / sc).glob("*.png"))
        keep = files[:16] + files[22:]
        for k, f in enumerate(keep):
            shutil.copy(f, sw / "happy" / sc / f"{k:04d}.png")
    cm = man["clips"]["happy"]
    remap = lambda d: {str(k): d[str(j)] for k, j in enumerate(list(range(16)) + list(range(22, len(files))))}
    (sw / "manifest.json").write_text(json.dumps({"rest_joints": man["rest_joints"], "allowed_holes": {"happy": remap(man["allowed_holes"]["happy"])},
                                                  "clips": {"happy": {"joints": remap(cm["joints"])}}}), encoding="utf8")
    for name, clip in (("seed-rigid", "wave"), ("seed-swap", "happy")):
        s, r = check(HERE / "out" / name, quiet=True, clips=[clip])
        rows = r[clip]["rows"]
        rules = sorted({f.split()[1] for row in rows for f in row["fails"] if f.split()[0] in ("1x", "2x")} | {"pop" for row in rows for f in row["fails"] if f.startswith("pop")})
        out[name] = {"clip": clip, "failedFrames": r[clip]["failed"], "rules": rules}
    seeds = HERE / "out" / "seed-paint"
    rb = man["rest_joints"]
    j = lambda b, e: np.array(rb[b][e], float)   # 4x px
    base4 = np.array(Image.open(src / "rest" / "4x" / "0000.png").convert("RGBA"))

    def cut(im):
        e0, w0 = j("leftForearm", 0), j("leftForearm", 1); c = (e0 + w0) / 2; u = (w0 - e0) / np.linalg.norm(w0 - e0); n = np.array([-u[1], u[0]])
        m = np.zeros(im.shape[:2], np.uint8)
        cv2.line(m, tuple(int(v) for v in c - n * 26), tuple(int(v) for v in c + n * 26), 1, 3)
        m = m.astype(bool) & (im[..., 3] == 255)
        im[m] = (110, 80, 70, 255); return im

    def piece(im):
        im[1300:1316, 440:456] = (200, 160, 150, 255); return im

    def hole(im):
        k = j("rightThigh", 0) * 0.4 + j("rightThigh", 1) * 0.6
        cv2.line(im, (int(k[0]) - 14, int(k[1]) - 4), (int(k[0]) + 14, int(k[1]) + 4), (0, 0, 0, 0), 3); return im

    def band(im):
        x = int(j("rightUpperArm", 0)[0] + 105); im[230:300, x:x + 6, 3] = (im[230:300, x:x + 6, 3] * 0.55).astype(np.uint8); return im

    def white(im):
        e0, w0 = j("leftForearm", 0), j("leftForearm", 1); c = e0 * 0.4 + w0 * 0.6
        cv2.ellipse(im, tuple(int(v) for v in c), (18, 9), 30, 0, 360, (246, 244, 246, 255), -1); return im

    def edge(im):
        return np.ascontiguousarray(np.roll(im, 100, axis=1))

    # the painted cut is caught by the cross-limb line rule, which must fail it at
    # both 1x and 2x (the Hough step rule found no segment across it)
    want = {"cut": "line", "piece": "pieces", "hole": "holes", "band": "dips", "white": "white", "edge": "edge", "rest": None}
    fns = {"cut": cut, "piece": piece, "hole": hole, "band": band, "white": white, "edge": edge, "rest": lambda im: im}
    for nm, fn in fns.items():
        _save_pair(seeds / nm, fn(base4.copy()))
    holes0 = man["allowed_holes"]["rest"]["0"]
    # each painted seed is the rest frame: it carries the rest frame's head centre, so the art's own soft lines (the
    # ponytail against the neck) are discounted exactly as on the clean clips (rest has 6 such 2x dips)
    hc_rest = man["clips"]["rest"]["head_centre"]
    (seeds / "manifest.json").write_text(json.dumps({"rest_joints": rb, "clips": {k: {"head_centre": hc_rest} for k in fns},
                                                     "allowed_holes": {k: {"0": holes0} for k in fns}}), encoding="utf8")
    s, r = check(seeds, quiet=True)
    out["seed-paint"] = {c: v["rows"][0]["fails"] for c, v in r.items()}
    out["cutCalibration"] = {sc: {"paintedCut": r["cut"]["rows"][0][sc]["cutLen"], "rest": r["rest"]["rows"][0][sc]["cutLen"], "gate": CUT_LEN[sc]} for sc in SCALES}
    out["lineCalibration"] = {sc: {"paintedCut": r["cut"]["rows"][0][sc]["line"], "rest": r["rest"]["rows"][0][sc]["line"], "gate": LINE_L[sc]} for sc in SCALES}
    ok_paint = not out["seed-paint"]["rest"] and all(f"{sc} line" in " ".join(out["seed-paint"]["cut"]) for sc in SCALES) and all(any(f.split()[1] == rule for f in out["seed-paint"][c]) for c, rule in want.items() if rule)
    # the rigid seed must fail frames the clean render of the same clip passes (its own defect, not a shared one)
    _, rc = check(src, quiet=True, clips=["wave"])
    own = sorted(set(out["seed-rigid"]["failedFrames"]) - set(rc["wave"]["failed"]))
    out["seed-rigid"]["failedNotClean"] = own
    # the rigid seed (rest drawing alone on rigid pieces) must fail most raised-arm frames
    # (wave 12-60) that the clean render passes
    raised = [k for k in range(12, 61) if k not in rc["wave"]["failed"]]
    own_raised = [k for k in raised if k in out["seed-rigid"]["failedFrames"]]
    out["seed-rigid"]["raisedFailedShare"] = round(len(own_raised) / max(1, len(raised)), 3)
    ok_rigid = out["seed-rigid"]["raisedFailedShare"] >= 0.6
    # the legacy drawing set on hairTuck (render.mjs --legacy: no in-betweens, tuck bent 45 deg)
    # must fail the mesh rule on frames the clean render passes
    _, rl = check(HERE / "out" / "seed-legacy", quiet=True, clips=["hairTuck"])
    _, rch = check(src, quiet=True, clips=["hairTuck"])
    mesh_fail = [r["frame"] for r in rl["hairTuck"]["rows"] if any(f.startswith("mesh") for f in r["fails"])]
    out["seed-legacy"] = {"meshFailFrames": mesh_fail, "failedNotClean": sorted(set(rl["hairTuck"]["failed"]) - set(rch["hairTuck"]["failed"]))}
    ok_legacy = bool(set(mesh_fail) - set(rch["hairTuck"]["failed"]))
    # known broken frames (fixtures/r4-hairTuck, hairTuck 57-61 as images): their cut is a low-contrast skin
    # step; the mesh rule needs the renderer
    _, rf = check(HERE / "fixtures" / "r4-hairTuck", quiet=True, clips=["hairTuck"])
    out["fixture-r4-hairTuck"] = {"failed": rf["hairTuck"]["failed"], "rows": [{"frame": r["frame"], "1x": r["1x"], "2x": r["2x"], "fails": r["fails"]} for r in rf["hairTuck"]["rows"]]}
    # the fixture is a required fail on the image rules (not the mesh rule, which needs the renderer): at least
    # one of its five frames must fail the cut rule
    ok_fixture = any(any(f.split()[1] == "cut" for f in r["fails"] if f.split()[0] in ("1x", "2x")) for r in rf["hairTuck"]["rows"])
    # glasses drawn off the eyes in COLOUR (atlas-seed-glasses.webp, render.mjs --seed-glasses):
    # the colour rule must fail every eyes-open frame of rest and look
    gs = HERE / "out" / "seed-glasses-colour"
    glasses_check(gs, gs / "glasses.json", clips=["rest", "look"])
    gr = json.loads((gs / "glasses.json").read_text(encoding="utf8"))
    open_rows = [r for c in gr["clips"].values() for r in c["rows"] if not r.get("eyesClosed")]
    col_fail = [r for r in open_rows if any(f.startswith("colour") for f in r["fails"])]
    out["seed-glasses-colour"] = {"eyesOpenFrames": len(open_rows), "colourFailed": len(col_fail), "minDev": min((r.get("devColour", 0) for r in open_rows), default=None)}
    ok_gcol = bool(open_rows) and len(col_fail) == len(open_rows)
    ok_swap = "pop" in out["seed-swap"]["rules"]
    # drifted glasses: on the most turned frame, the rims of the ID pass moved sideways by k iod (glasses
    # that stay put while the face turns); 0.35 and 0.45 must fail, the clean frame must pass
    best = None
    for clip, cm in man["clips"].items():
        for i, t in cm.get("head_turn", {}).items():
            if (src / clip / "id" / f"{int(i):04d}.png").exists() and (best is None or abs(t[0]) > abs(best[2][0])):
                best = (clip, int(i), t)
    clip, i, turn = best
    idimg = load_id(src / clip, f"{i:04d}.png")
    g0 = glasses_of(idimg)
    sd = HERE / "out" / "seed-glasses"
    shutil.rmtree(sd, ignore_errors=True)
    seeds_g = {}
    for k in (0.0, 0.15, 0.35, 0.45):
        im = idimg.copy()
        im[..., 0] = np.roll(idimg[..., 0], int(round(k * g0["iod"] * (1 if turn[0] < 0 else -1))), axis=1)
        nm = "clean" if k == 0 else f"drift{int(k * 100)}"
        (sd / nm / "id").mkdir(parents=True, exist_ok=True)
        Image.fromarray(im.astype(np.uint8)).save(sd / nm / "id" / "0000.png")
        seeds_g[nm] = k
    (sd / "manifest.json").write_text(json.dumps({"clips": {k: {"head_turn": {"0": turn}} for k in seeds_g}}), encoding="utf8")
    glasses_check(sd, sd / "glasses.json")
    rep = json.loads((sd / "glasses.json").read_text(encoding="utf8"))["clips"]
    out["seed-glasses"] = {"from": [clip, i, turn], **{k: rep[k]["rows"][0] for k in rep}}
    ok_gl = all(bool(rep[k]["rows"][0]["fails"]) for k in ("drift15", "drift35", "drift45")) and not rep["clean"]["rows"][0]["fails"]
    # seeded cross-fades: render.mjs --xfade draws an arm cross-fade and a half-alpha head over an
    # unturned one; the doubled-arm and ghosted-head rules must fail on the fade frames, and on wave 13,
    # happy 22 and idle_glance 30 (frames where a cross-fade showed doubled parts)
    xf = HERE / "out" / "seed-xfade"
    s2, r2 = check(xf, quiet=True, clips=["wave", "happy", "idle_glance"])
    xm = json.loads((xf / "manifest.json").read_text(encoding="utf8"))
    out["seed-xfade"] = {}
    ok_x = True
    for c, must in (("wave", 13), ("happy", 22), ("idle_glance", 30)):
        rows = r2[c]["rows"]
        dbl = [r["frame"] for r in rows if any(f.startswith("id ") for f in r["fails"])]
        fades = sorted(int(k) for k, v in xm["clips"][c].get("arm", {}).items() if v and v.get("fade"))
        out["seed-xfade"][c] = {"idFailFrames": dbl, "fadeFrames": fades, "mustFail": must}
        # every fade frame must fail; idle_glance 30 is the head fade and must fail too
        ok_x &= bool(dbl) and all(f in dbl for f in fades) and (c != "idle_glance" or must in dbl)
    # the hipfront fixture drawing (a waist slab cut with straight edges) must fail
    # the outline rule; every shipped arm drawing must pass it
    fx = np.array(Image.open(HERE / "fixtures" / "r6-hipfront" / "leftArm__hipfront.png").convert("RGBA"))
    fb = json.loads((HERE / "fixtures" / "r6-hipfront" / "part.json").read_text(encoding="utf8"))["bones"]
    fv, fa = SR.straight_outline(fx, fb)
    dres, dbad = drawings_check()
    out["outline"] = {"gatePx2x": OUTLINE_PX, "fixtureR6Hipfront": [round(fv, 1), fa], "shipped": dres, "shippedFail": dbad}
    ok_outline = fv > OUTLINE_PX and not dbad
    out["ok"] = {"paint": ok_paint, "outline": ok_outline, "fixtureR4": ok_fixture, "rigid": ok_rigid, "legacy": ok_legacy, "swap": ok_swap, "glasses": ok_gl, "glassesColour": ok_gcol, "xfade": ok_x}
    ok = all(out["ok"].values())
    (HERE / "out" / "seam-proof.json").write_text(json.dumps(out, indent=1), encoding="utf8")
    print(json.dumps(out)[:3000])
    return ok


if __name__ == "__main__":
    if "--prove" in sys.argv:
        sys.exit(0 if prove() else 1)
    opt = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
    vals = {opt(k) for k in ("--only", "--out")}
    args = [a for a in sys.argv[1:] if not a.startswith("--") and a not in vals]
    frames = Path(args[0]) if args else HERE / "out" / "frames"
    only = opt("--only").split(",") if opt("--only") else None
    if "--glasses" in sys.argv:
        s = glasses_check(frames, opt("--out") or HERE / "out" / "glasses.json", only)
    else:
        s, _ = check(frames, opt("--out") or HERE / "out" / "seam.json", clips=only)
        dres, dbad = drawings_check()
        s["drawingsOutline"] = {"gatePx2x": OUTLINE_PX, "parts": dres, "failed": dbad}
        s["framesFailed"] += len(dbad)
    print(json.dumps({k: v for k, v in s.items() if k != "distribution"}))
    sys.exit(0 if s["framesFailed"] == 0 else 1)

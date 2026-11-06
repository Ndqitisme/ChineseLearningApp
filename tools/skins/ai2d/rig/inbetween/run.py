"""In-between left-arm drawings.

Two key drawings per transition could not carry hip -> hang -> level -> up: the rig bent one drawing far from
its art (banana forearm, broken elbow in hairTuck) and swapped drawings in one frame. Three Codex edits of the
master add the poses between them (gen/codex_gen.sh, logged in ../../art/generations.log):
  hipoff   the hand just off the hip, elbow softly bent, hand hanging beside the skirt   (rest <-> hang)
  front    elbow at the side, forearm rising in front of the shirt, loose hand at the chest (rest <-> think/happy)
  tuckmid  elbow forward, hand beside the neck below the ear                               (front <-> tuck)

Each key is cut out with the key-pose lever's own tools (art/keyposes/run.py, imported read-only): registered to
the master on the legs, graded like the master, cut along the bone capsules and what differs from the master.
The sleeve of an arm that lies in front of the shirt is white on white, so the cut keeps the whole upper-arm
capsule there (the torso under it carries the same shirt).
keys.json: the joints, read by eye off the 4x zooms in out/zoom_<key>.png (master px of the key's own image).
Writes out/parts/leftArm__<key>.png (2x app scale) and out/parts.json in the key-pose lever's format.
Usage: <tools/skins/ai2d/.venv python> -I run.py
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
KP = HERE.parents[1] / "art" / "keyposes"
_s = importlib.util.spec_from_file_location("keyposes_run", KP / "run.py")
K = importlib.util.module_from_spec(_s)
sys.modules["keyposes_run"] = K
_s.loader.exec_module(K)     # the key-pose lever as a library (its main() does not run)
cv2.setNumThreads(1)
OUT, PARTS = HERE / "out", HERE / "out" / "parts"
KEYS = json.loads((HERE / "keys.json").read_text())


def sleeve_capsule(img, J):
    """The shoulder 60 % of the upper-arm capsule, every figure pixel in it (sleeve over the shirt)."""
    sh = img.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    S, E = np.array(J["S"], float), np.array(J["E"], float)
    Sx = S + 0.6 * (E - S)
    t = ((X - S[0]) * (E[0] - S[0]) + (Y - S[1]) * (E[1] - S[1])) / float(np.dot(E - S, E - S))
    return (img[..., 3] > 0) & (K.seg_dist(X, Y, S, Sx) < K.ARM_R["upper"] - 12) & (t > -0.05) & (t < 0.62)


def arm_cut(img, master, J):
    """The arm of a key whose forearm lies in front of the shirt: skin-like pixels in the bone capsules that differ
    from the master (the figure is locked), plus every figure pixel of the sleeve capsule (white on white), minus
    hair (a strand the fingers touch stays with the head). The piece holding the elbow is kept, holes filled.
    (The key-pose lever's cut_limb keeps the piece at the wrist after a 5 px closing; on these keys that left a
    12 px speck, so the cut is done here.)"""
    sh = img.shape[:2]
    fg = img[..., 3] > 0
    Lb = K.lab(img[..., :3])
    Cr, hue = np.hypot(Lb[..., 1], Lb[..., 2]), np.degrees(np.arctan2(Lb[..., 2], Lb[..., 1]))
    C = K.B.classes(img)
    skinlike = fg & (Cr >= 5) & (Lb[..., 0] >= 22) & (hue > 25) & (hue < 100) & ~C["plaid"]
    cap = K.capsules(sh, K.limb_segments("leftArm", J))
    seed = (cap & skinlike & K.diff_mask(img, master) & ~(C["hair"] & ~C["skin"])) | sleeve_capsule(img, J)
    # GrabCut refines the seed to the drawn outline (the colour models split skin from shirt; the edge term puts
    # the sleeve's inner edge on the drawn fold line instead of the capsule's arc): definite arm = the seed eroded
    # 6 px along the bones, definite background = outside the capsules grown 10 px
    near = ndi.binary_dilation(cap, iterations=10)
    gc = np.full(sh, cv2.GC_BGD, np.uint8)
    gc[near & fg] = cv2.GC_PR_BGD
    gc[seed] = cv2.GC_PR_FGD
    core = ndi.binary_erosion(seed, iterations=6) & K.capsules(sh, {k: (p, q, r * 0.35) for k, (p, q, r) in K.limb_segments("leftArm", J).items()})
    gc[core] = cv2.GC_FGD
    ys, xs = np.nonzero(near)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb = np.ascontiguousarray(img[y0:y1, x0:x1, :3]); sub = np.ascontiguousarray(gc[y0:y1, x0:x1])
    cv2.setRNGSeed(1)
    bg, fgm = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(rgb, sub, None, bg, fgm, 6, cv2.GC_INIT_WITH_MASK)
    m = np.zeros(sh, bool)
    m[y0:y1, x0:x1] = (sub == cv2.GC_FGD) | (sub == cv2.GC_PR_FGD)
    # shirt white left on the forearm or hand (the shirt between the wrist and the sleeve) and dark strands the
    # fingers touch are not arm
    m &= ~(C["hair"] & ~C["skin"]) & ~(C["dark"] & ~skinlike) & ~(K.shirt_white(img) & ~sleeve_capsule(img, J))
    return K.keep_main(m, J["E"]) & fg


def upper_from_rest(img, rest_mask, J, tmax):
    """The master's rest-arm pixels in this key's upper-arm capsule, from the shoulder to tmax of the way to the
    elbow (projection on S -> E), where the key has figure pixels."""
    sh = img.shape[:2]
    Y, X = np.mgrid[0:sh[0], 0:sh[1]].astype(np.float32)
    S, E = np.array(J["S"], float), np.array(J["E"], float)
    t = ((X - S[0]) * (E[0] - S[0]) + (Y - S[1]) * (E[1] - S[1])) / float(np.dot(E - S, E - S))
    return rest_mask & (img[..., 3] > 0) & (K.seg_dist(X, Y, S, E) < K.ARM_R["upper"] + 6) & (t > -0.3) & (t <= tmax)


def polygon_mask(shape, pts):
    im = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in pts], fill=1)
    return np.array(im, bool)


def main():
    OUT.mkdir(exist_ok=True); PARTS.mkdir(exist_ok=True)
    master_raw = K.load(K.ART / "src" / "master.png")
    master = K.grade_body(K.B.chroma_key(master_raw))
    wave_raw = K.load(K.ART / "src" / "wave.png")
    Ww, _ = K.register(wave_raw, master_raw, "legs")
    wave = K.A.to_master(K.grade_body(K.B.chroma_key(wave_raw)), Ww)
    lines = {"left": K.body_line(master, "left"), "right": K.body_line(master, "right")}
    rest_masks = {"leftArm": K.rest_arm_mask(master, "leftArm", lines, wave)}
    parts, gates = {}, {}
    for name, k in KEYS.items():
        src = HERE / "src" / f"{name}.png"
        raw = K.load(src)
        W, cc = K.register(raw, master_raw, "legs")
        img = K.A.to_master(K.grade_body(K.B.chroma_key(raw)), W)
        J = {j: K.key_pt(W, p) for j, p in k["read"].items()}
        m = arm_cut(img, master, J)
        if "upperFromRest" in k:
            # where the key's upper arm is the master's own (it hangs at her side
            # on front, tuckmid and hipfront), it does not differ from the master and the cut lost it (tuckmid: no
            # sleeve, no upper arm) or left a jagged sleeve edge (front). The master's own arm mask supplies that
            # stretch: its pixels in the upper-arm capsule up to upperFromRest of the way to the elbow, from this key
            m |= upper_from_rest(img, rest_masks["leftArm"], J, k["upperFromRest"])
            m = K.keep_main(m, J["E"]) & (img[..., 3] > 0)
        for poly in k.get("keep", []):
            # a sleeve the capsule cut short (tuckmid: its top, above the shoulder joint), outlined by eye
            m |= polygon_mask(img.shape[:2], [K.key_pt(W, q) for q in poly]) & (img[..., 3] > 0)
        for poly in k.get("drop", []):
            # what the cut wrongly kept, outlined by eye on a 10x gridded zoom of the key (key px)
            m &= ~polygon_mask(img.shape[:2], [K.key_pt(W, q) for q in poly])
        for cx, cy, r in k.get("dropDark", []):
            # dark hair the fingertips touch (tuckmid), lifted with the hand by the cut
            c = K.key_pt(W, [cx, cy])
            Y, X = np.mgrid[0:m.shape[0], 0:m.shape[1]]
            m &= ~((np.hypot(X - c[0], Y - c[1]) < r) & (K.lab(img[..., :3])[..., 0] < 40))
            m = K.keep_main(m, J["E"]) & (img[..., 3] > 0)
        piece = img.copy(); piece[~m] = 0
        d = np.array(K.S_REST) - np.array(J["S"])
        if np.any(np.abs(d) > 0.01):
            T = np.float32([[1, 0, d[0]], [0, 1, d[1]]])
            piece = K.unpremul(cv2.warpAffine(K.premul(piece), T, (piece.shape[1], piece.shape[0]), flags=cv2.INTER_LINEAR))
        piece = K.drop_islands(piece)
        Jd = {j: [p[0] + d[0], p[1] + d[1]] for j, p in J.items()}
        st = K.stats(piece)
        small, P, pos1x = K.to_app_crop(piece, Jd)
        small, st["interior_alpha_px_fixed_2x"] = K.solid_interior(small, fill=False)
        st["ecc"] = round(cc, 4); st["shift_to_rest_pivot_px"] = [round(float(x), 2) for x in d]
        fn = f"leftArm__{name}.png"
        K.save(small, PARTS / fn)
        parts[f"leftArm.{name}"] = {"file": f"parts/{fn}", "limb": "leftArm", "key": name, "size": [small.shape[1], small.shape[0]],
                                    "bones": P, "restPos1x": pos1x, "chain": ["S", "E", "W", "T"], "z": k.get("z", 13.5),
                                    "source": f"rig/inbetween/src/{name}.png", "licence": "CC0-1.0"}
        gates[name] = st
        # 4x zoom of the cut over magenta beside the registered key with the joints, for the by-eye joint read
        x0, y0 = int(min(p[0] for p in J.values())) - 140, int(min(p[1] for p in J.values())) - 140
        x1, y1 = int(max(p[0] for p in J.values())) + 140, int(max(p[1] for p in J.values())) + 140
        x0, y0 = max(0, x0), max(0, y0)
        reg = Image.fromarray(img[y0:y1, x0:x1, :3].copy()); dr = ImageDraw.Draw(reg)
        for j, p in J.items():
            dr.ellipse([p[0] - x0 - 5, p[1] - y0 - 5, p[0] - x0 + 5, p[1] - y0 + 5], outline=(255, 0, 0), width=2)
            dr.text((p[0] - x0 + 7, p[1] - y0 - 7), j, fill=(255, 0, 0))
        cut = piece[y0:y1, x0:x1].astype(np.float32)
        mag = np.zeros_like(cut[..., :3]); mag[...] = (255, 0, 255)
        cutv = Image.fromarray((cut[..., :3] * cut[..., 3:4] / 255 + mag * (1 - cut[..., 3:4] / 255)).astype(np.uint8))
        sheet = Image.new("RGB", (reg.width * 2 + 10, reg.height), (255, 255, 255))
        sheet.paste(reg, (0, 0)); sheet.paste(cutv, (reg.width + 10, 0))
        sheet.save(OUT / f"zoom_{name}.png")
    (OUT / "parts.json").write_text(json.dumps({"about": __doc__.split("\n")[0], "exportScale": K.EXPORT, "masterToApp1x": K.AMAP,
                                                "licence": "CC0-1.0", "parts": parts}, indent=1))
    (OUT / "gates.json").write_text(json.dumps(gates, indent=1))
    print(json.dumps({n: {kk: g[kk] for kk in ("components", "hole_px") if kk in g} for n, g in gates.items()}))


if __name__ == "__main__":
    main()

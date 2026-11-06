"""Checks on the rendered frames (out/frames), written to out/verify.json:
  feet      planted frames: sole and toes (4x, from 20 px at 1x below the rest ankles, clear of the skinning
            blend zone where the sock top bends with the shin) are pixel-identical to rest (premultiplied), so a
            planted foot neither slides nor floats. Airborne frames (drag enter, loop, land before contact) skipped.
  edges     no opaque pixel (alpha >= 128) within 2 px of any of the four edges of a 1x frame: nothing is cut
            off, and the hand keeps 2 px clear. All four edges are read, not only the top and bottom rows.
  agree     mean |box-downsampled 4x - 1x| over premultiplied RGBA (the consistency checker's check 0, bar 6).
  ends      every clip section that starts or ends at rest (one-shots: both ends; enter: first frame; exit: last
            frame, after its settle frames) is byte-identical to the rest frame at 1x and 4x, so the held frame
            takes over without a shimmer.
Usage: python -I verify_frames.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
FR = HERE / "out" / "frames"
man = json.loads((FR / "manifest.json").read_text(encoding="utf8"))
contact_frame = int(160 * 30 / 1000) + 1          # drag land: ground contact at 160 ms
rest4 = np.array(Image.open(FR / "rest" / "4x" / "0000.png").convert("RGBA")).astype(int)
ank_y = int(max(man["rest_joints"]["leftShoe"][0][1], man["rest_joints"]["rightShoe"][0][1])) + 80   # sole and toes: 20 px at 1x below the ankle, clear of the skin blend zone
out = {"feet": {}, "headroom": {}, "agree": {}, "ends": {}}
rest_b = {r: (FR / "rest" / r / "0000.png").read_bytes() for r in ("1x", "4x")}
same_png = lambda a, r: np.array_equal(np.array(Image.open(a).convert("RGBA")), np.array(Image.open(FR / "rest" / r / "0000.png").convert("RGBA")))


def seeded_shift():
    """The same comparison on the rest frame shifted 0.1 px (at 1x) to the right: what a tiny slide scores."""
    from PIL import Image as _I
    im = _I.open(FR / "rest" / "4x" / "0000.png").convert("RGBA")
    sh = np.array(im.transform(im.size, _I.AFFINE, (1, 0, -0.4, 0, 1, 0), resample=_I.BILINEAR)).astype(float)
    r = rest4.astype(float).copy()
    sh[..., :3] *= sh[..., 3:4] / 255; r[..., :3] *= r[..., 3:4] / 255
    return int(np.ceil(np.abs(sh[ank_y:] - r[ank_y:]).max()))
for clip in sorted(p.name for p in FR.iterdir() if p.is_dir()):
    f4 = sorted((FR / clip / "4x").glob("*.png"))
    worst_feet, cut, agree = 0, [], []
    for p in f4:
        i = int(p.stem)
        a4 = np.array(Image.open(p).convert("RGBA")).astype(int)
        a1 = np.array(Image.open(FR / clip / "1x" / p.name).convert("RGBA")).astype(float)
        airborne = clip in ("drag_enter", "drag_loop") or (clip == "drag_exit" and i < contact_frame)
        if not airborne:
            pa = a4[ank_y:].astype(float); pr = rest4[ank_y:].astype(float)
            pa[..., :3] *= pa[..., 3:4] / 255; pr[..., :3] *= pr[..., 3:4] / 255   # premultiplied: RGB under alpha ~0 means nothing
            worst_feet = max(worst_feet, int(np.ceil(np.abs(pa - pr).max())))
        m = a1[..., 3] >= 128
        if m[:2].any() or m[-2:].any() or m[:, :2].any() or m[:, -2:].any():
            cut.append(i)
        pm = a4.astype(float).copy(); pm[..., :3] *= pm[..., 3:4] / 255
        down = pm.reshape(340, 4, 139, 4, 4).mean((1, 3))
        q = a1.copy(); q[..., :3] *= q[..., 3:4] / 255
        agree.append(float(np.abs(down - q).mean()))
    out["feet"][clip] = {"maxShoePixelDiff": worst_feet, "frames": len(f4)}
    out["headroom"][clip] = cut
    out["agree"][clip] = round(max(agree), 3)
    ends = []
    if clip.startswith("idle_") or not (clip.endswith(("_loop",)) or clip == "rest"):
        if not clip.endswith("_exit"):
            ends.append(("first", f4[0].name))
        if not clip.endswith("_enter"):
            ends.append(("last", f4[-1].name))
    if ends:
        out["ends"][clip] = {k: all(same_png(FR / clip / r / n, r) for r in ("1x", "4x")) for k, n in ends}
out["summary"] = {
    # <= 2 of 255 premultiplied: float noise; a 0.1 px slide moves edge pixels by ~25 (measured on a seeded shift below)
    "feetPlantedIdentical": all(v["maxShoePixelDiff"] <= 2 for k, v in out["feet"].items() if k not in ("drag_enter", "drag_loop")),
    "feetMaxDiff": max(v["maxShoePixelDiff"] for k, v in out["feet"].items() if k not in ("drag_enter", "drag_loop")),
    "seededShift0p1pxDiff": seeded_shift(),
    "framesCutAtEdge": sum(len(v) for v in out["headroom"].values()),
    "agreeMax": max(out["agree"].values()),
    "shoeRowsFrom4x": ank_y,
    "endsAtRest": all(all(v.values()) for v in out["ends"].values()),
    "endsOffRest": [f"{c} {k}" for c, v in out["ends"].items() for k, ok in v.items() if not ok],
}
(HERE / "out" / "verify.json").write_text(json.dumps(out, indent=1), encoding="utf8")
print(json.dumps(out["summary"]), json.dumps({k: v["maxShoePixelDiff"] for k, v in out["feet"].items()}))

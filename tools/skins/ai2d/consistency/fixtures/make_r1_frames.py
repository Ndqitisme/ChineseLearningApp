"""Render the look-B fixture (rest, idle and wave) at 4x (556x1360, native resolution) and 1x (139x340).

The look-B pipeline is run unchanged from a copy at fixtures/b_r1/run.py, with the likeness harness found
through the R1 path below. Neither input ships in this repo; the script is the record of how
fixtures/r1_clean/ was made. Two pipeline functions are wrapped, nothing is edited:
  to_app    -> also renders the same master frame natively at 4x with the same app box
  pose_arm  -> records the arm skeleton of each wave frame (joints for the manifest)
Usage: tools/skins/ai2d/.venv/Scripts/python.exe make_r1_frames.py   (about 5 minutes; writes fixtures/r1_clean/)
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
R1 = HERE.parents[2] / "r1"
REF = HERE.parents[4] / "references" / "character" / "face-reference.png"
OUT = HERE / "r1_clean"
APP_W, APP_H, S4 = 139, 340, 4
# Background gaps the rest art really has (4x px, one point inside each): ponytail/neck, a strand by the
# left cheek, the hand-on-hip loop, right hand/thigh, the ankle gap. Checked by eye on the checker's
# evidence image; a hole elsewhere is a defect.
REST_HOLES = [[257.4, 223.5], [136.0, 216.8], [338.9, 471.1], [55.2, 760.1], [80.5, 1250.3]]
# Gaps between the fingers of the raised wave hand (4x px), same check by eye.
WAVE_GAPS = {"4": [[486.0, 233.7]], "16": [[486.0, 233.7]], "5": [[424.0, 182.0]], "15": [[424.0, 182.0]]}

sys.path.insert(0, str(R1 / "harness"))
import likeness  # noqa: E402,F401  frozen likeness harness, imported read-only so run.py finds it

spec = importlib.util.spec_from_file_location("b_r1_run", HERE / "b_r1" / "run.py")
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
B.REF = REF

FOURX: dict[int, tuple] = {}
BOX: list = []
ARM_T: list = []


def app4x(rgba: np.ndarray, box) -> np.ndarray:
    l, t, r, b, sc = box
    sc4 = sc * S4
    pad = np.zeros((max(0, b) + 1, max(0, r) + 1, 4), np.uint8)
    hh, ww = min(rgba.shape[0], pad.shape[0]), min(rgba.shape[1], pad.shape[1])
    pad[:hh, :ww] = rgba[:hh, :ww]
    crop = Image.fromarray(pad[max(0, t):b, max(0, l):r], "RGBA").convert("RGBa")
    nw, nh = max(1, round((r - l) * sc4)), max(1, round((b - t) * sc4))
    small = crop.resize((nw, nh), Image.LANCZOS).convert("RGBA")
    cell = Image.new("RGBA", (APP_W * S4, APP_H * S4))
    cell.alpha_composite(small, ((APP_W * S4 - nw) // 2, APP_H * S4 - nh))
    return np.array(cell)


def to4x_point(p, box):
    l, t, r, b, sc = box
    sc4 = sc * S4
    nw, nh = round((r - l) * sc4), round((b - t) * sc4)
    return [round(float((p[0] - l) * sc4 + (APP_W * S4 - nw) // 2), 2),
            round(float((p[1] - t) * sc4 + APP_H * S4 - nh), 2)]


_to_app, _pose_arm = B.to_app, B.pose_arm


def to_app(rgba, box, scale=1):
    out = _to_app(rgba, box, scale)
    if scale == 1:
        FOURX[id(out)] = (out, app4x(rgba, box))
        if not BOX:
            BOX.append(box)
    return out


def pose_arm(parts, J, T, size):
    ARM_T.append({k: [float(v) for v in T[k]] for k in ("S", "E", "W")})
    return _pose_arm(parts, J, T, size)


B.to_app, B.pose_arm = to_app, pose_arm


def main():
    B.main()
    box = BOX[0]
    if OUT.exists():
        shutil.rmtree(OUT)

    # Rebuild the frame lists in the order run.py rendered them, from the 1x files it wrote.
    art = HERE / "b_r1" / "artifacts"
    idle1 = [np.array(Image.open(p)) for p in sorted((art / "idle").glob("idle_*.png"))]
    wave1 = [np.array(Image.open(p)) for p in sorted((art / "wave_seq").glob("wave_*.png"))]
    rest1 = np.array(Image.open(art / "rest_139x340.png"))
    pairs = list(FOURX.values())

    def find4x(a1):
        for o, f4 in pairs:
            if o.shape == a1.shape and np.array_equal(o, a1):
                return f4
        raise RuntimeError("no 4x twin for a 1x frame")

    for clip, frames in (("rest", [rest1]), ("idle", idle1), ("wave", wave1)):
        for i, a in enumerate(frames):
            for sub, img in (("1x", a), ("4x", find4x(a))):
                d = OUT / clip / sub
                d.mkdir(parents=True, exist_ok=True)
                Image.fromarray(img).save(d / f"{i:04d}.png")

    # wave joints: 7 eased poses, 8 oscillation poses, the eased poses back (run.py's arms_seq order)
    # each eased pose calls pose_arm twice (key a and key b, same skeleton), each oscillation pose once
    assert len(ARM_T) == 22, len(ARM_T)
    poses = ARM_T[0:14:2] + ARM_T[14:22]
    seq = poses[:7] + poses[7:15] + poses[:7][::-1][1:]
    rest_T = poses[0]

    def joints(T):
        return {"leftUpperArm": [to4x_point(T["S"], box), to4x_point(T["E"], box)],
                "leftForearm": [to4x_point(T["E"], box), to4x_point(T["W"], box)]}
    rest_j = joints(rest_T)
    man = {"source": "look B run 1 (r1/look-ai2d/run.py on a copy of its src/), rendered by make_r1_frames.py",
           "scale": S4, "rest_joints": rest_j, "allowed_holes": {"rest": {"0": REST_HOLES}, "wave": WAVE_GAPS},
           "clips": {"idle": {"head_views": [], "joints": {str(i): rest_j for i in range(len(idle1))}},
                     "wave": {"peak": 6, "head_views": [], "joints": {str(i): joints(T) for i, T in enumerate(seq)}}}}
    (OUT / "manifest.json").write_text(json.dumps(man, indent=1))
    # the Codex wave key (a separate generation of the same character), keyed, at 4x: seed for "swapped head"
    key = B.chroma_key(B.load_rgb("wave.png"))
    Image.fromarray(app4x(key, box)).save(HERE / "wave_key_4x.png")
    (HERE / "r1_box.json").write_text(json.dumps({"l_t_r_b_sc": list(map(float, box))}))
    print("wrote", OUT, "frames:", 1, len(idle1), len(wave1))


if __name__ == "__main__":
    main()

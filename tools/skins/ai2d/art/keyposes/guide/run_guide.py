"""3D pose guide for the key-pose art. Rigs the chosen TRELLIS model in Blender,
poses each key and renders, registered to the master's 1024x1536 framing:
  guide/out/<pose>_depth.png   Cycles depth (white near), alpha = silhouette
  guide/out/<pose>_sil.png     silhouette
  guide/out/<pose>_bones.png   OpenPose-style bone overlay on black
  guide/out/<pose>_guide.png   what Codex gets next to the master: grey depth + bone overlay on green
  guide/out/register.png       rest silhouette over the master (registration check)
Usage: tools/skins/ai2d/.venv python run_guide.py [pose ...]  (needs Blender 4.5: set BLENDER to its executable)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ART = HERE.parents[1]
ROOT = HERE.parents[5]
GLB = ROOT / "references" / "character" / "sample_2026-11-05T051444.292.glb"
BLENDER = Path(os.environ.get("BLENDER", ROOT / ".cache" / "sources" / "mh" / "blender-4.5.15-windows-x64" / "blender.exe"))
OUT = HERE / "out"
J = json.loads((ART / "gen" / "joints.json").read_text())
HB = json.loads((ART / "gen" / "head_box.json").read_text())


def master_alpha() -> np.ndarray:
    f = np.asarray(Image.open(ART / "src" / "master.png").convert("RGB")).astype(np.float32)
    g = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    return g < 40


LA, RA = J["rest"]["leftArm"], J["rest"]["rightArm"]
LL, RL = J["rest_r1"]["leftLeg"], J["rest_r1"]["rightLeg"]
hipC = [(LL["H"][0] + RL["H"][0]) / 2, LL["H"][1]]
neckB = [(LA["S"][0] + RA["S"][0]) / 2, (LA["S"][1] + RA["S"][1]) / 2]
JOINTS = {"hipC": hipC, "neckB": neckB, "neckT": [HB["x"] + HB["side"] * 0.5, HB["y"] + HB["side"] * 0.99],
          "headT": [HB["x"] + HB["side"] * 0.5, HB["y"] + HB["side"] * 0.1],
          **{f"l{k}": v for k, v in LA.items()}, **{f"r{k}": v for k, v in RA.items()},
          # legs: read off the model's own rest silhouette (out/rest_sil.png, leg centre lines at rows 840-1500);
          # the model stands on two straight legs, not on the master's bent one, so joints.json legs do not fit
          "lH": [585, 760], "lK": [590, 1060], "lA": [594, 1380], "lToe": [600, 1500],
          "rH": [455, 760], "rK": [450, 1060], "rA": [446, 1380], "rToe": [445, 1500]}
BONES = {"spine": ["hipC", "neckB", None], "neck": ["neckB", "neckT", "spine"], "head": ["neckT", "headT", "neck"],
         "lUpper": ["lS", "lE", "spine"], "lFore": ["lE", "lW", "lUpper"], "lHand": ["lW", "lT", "lFore"],
         "rUpper": ["rS", "rE", "spine"], "rFore": ["rE", "rW", "rUpper"], "rHand": ["rW", "rT", "rFore"],
         "lThigh": ["lH", "lK", "spine"], "lShin": ["lK", "lA", "lThigh"], "lFoot": ["lA", "lToe", "lShin"],
         "rThigh": ["rH", "rK", "spine"], "rShin": ["rK", "rA", "rThigh"], "rFoot": ["rA", "rToe", "rShin"]}

# Key targets in master px [x, y, depth offset in world units; negative = toward the viewer].
# Model height 1.0 ~ 1450 px, so 0.05 is about a forearm's thickness.
POSES = {
    "rest": {},
    "wave_up": {"lE": [765, 415, 0.0], "lW": [740, 256, -0.02], "lT": [738, 150, -0.02]},
    "wave_ul": {"lE": [762, 418, 0.0], "lW": [706, 262, -0.02], "lT": [676, 172, -0.02]},
    "wave_ur": {"lE": [770, 420, 0.0], "lW": [796, 272, -0.02], "lT": [826, 190, -0.02]},
    "think": {"lE": [630, 488, -0.03], "lW": [553, 325, -0.08], "lT": [515, 250, -0.08]},
    "tuck": {"lE": [680, 425, 0.02], "lW": [610, 225, -0.01], "lT": [597, 140, 0.02]},
    "talk": {"lE": [630, 545, -0.02], "lW": [705, 545, -0.10], "lT": [805, 555, -0.12]},
    "happy": {"lE": [650, 510, -0.02], "lW": [668, 345, -0.05], "lT": [668, 292, -0.05]},
    # lifted by the cursor: arms hang a little out from the body, legs dangle with soft knees, toes down
    "drag": {"lE": [668, 560, 0.0], "lW": [690, 765, -0.01], "lT": [694, 860, -0.01],
             "rE": [350, 560, 0.0], "rW": [335, 765, -0.01], "rT": [340, 860, -0.01],
             "_ik": [["lThigh", "lShin", [600, 1355, -0.03], 0.1], ["rThigh", "rShin", [442, 1366, 0.02], -0.1]],
             "lToe": [606, 1478, 0.0], "rToe": [440, 1490, 0.0]},
    # landing: the upper body stays where the master has it (Codex keeps it locked); the knees bend forward and a
    # little out, so the feet rise 80 px; the rig lowers the pelvis to put them back on the floor
    "land": {"lE": [728, 515, 0.0], "lW": [770, 660, -0.03], "lT": [780, 745, -0.03],
             "rE": [330, 545, 0.0], "rW": [300, 720, -0.03], "rT": [292, 805, -0.03],
             "_ik": [["lThigh", "lShin", [604, 1305, 0.0], 0.35], ["rThigh", "rShin", [436, 1305, 0.0], -0.35]],
             "lToe": [612, 1420, -0.06], "rToe": [428, 1420, -0.06]},
}
ARM_ONLY = {"wave_up", "wave_ul", "wave_ur", "think", "tuck", "talk", "happy"}
VIEWS = {"head_yawm12": {"yaw": -12, "pitch": 0, "box": [HB["x"], HB["y"], HB["side"]]},
         "head_yawp12": {"yaw": 12, "pitch": 0, "box": [HB["x"], HB["y"], HB["side"]]},
         "head_pitchm15": {"yaw": 0, "pitch": -15, "box": [HB["x"], HB["y"], HB["side"]]}}
# OpenPose-like colours per bone
COL = {"spine": (255, 0, 85), "neck": (255, 0, 170), "head": (170, 0, 255),
       "lUpper": (255, 170, 0), "lFore": (255, 255, 0), "lHand": (170, 255, 0),
       "rUpper": (0, 170, 255), "rFore": (0, 85, 255), "rHand": (0, 0, 255),
       "lThigh": (0, 255, 85), "lShin": (0, 255, 170), "lFoot": (0, 255, 255),
       "rThigh": (255, 85, 0), "rShin": (255, 0, 0), "rFoot": (170, 0, 0)}
GREEN = (0, 177, 64)


def bones_img(pos: dict, size, scale=1.0, off=(0, 0)) -> Image.Image:
    im = Image.new("RGB", size, (0, 0, 0))
    d = ImageDraw.Draw(im)
    P = lambda j: ((pos[j][0] - off[0]) * scale, (pos[j][1] - off[1]) * scale)
    for b, (h, t, _) in BONES.items():
        d.line([P(h), P(t)], fill=COL[b], width=max(3, int(14 * scale)))
    for j in pos:
        x, y = P(j)
        r = max(3, int(9 * scale))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255))
    return im


def main(only: list[str]) -> None:
    OUT.mkdir(exist_ok=True)
    a = master_alpha()
    ys, xs = np.nonzero(a)
    reg = {"top_px": int(ys.min()), "bottom_px": int(ys.max()), "cx_px": float((xs.min() + xs.max()) / 2),
           "W": 1024, "H": 1536}
    if (HERE / "reg.json").exists():
        reg.update({k: v for k, v in json.loads((HERE / "reg.json").read_text()).items() if k in ("s", "x0", "z0")})
    poses = POSES
    job = {"glb": str(GLB), "out_dir": str(OUT), "reg": reg, "joints": JOINTS, "bones": BONES,
           "poses": poses, "views": VIEWS, "only": only}
    (OUT / "job.json").write_text(json.dumps(job, indent=1))
    prev = json.loads((OUT / "joints3d.json").read_text())["poses"] if (OUT / "joints3d.json").exists() else {}
    r = subprocess.run([str(BLENDER), "-b", "--factory-startup", "--python", str(HERE / "blender_guide.py"), "--",
                        str(OUT / "job.json")], capture_output=True, text=True, timeout=1800)
    (OUT / "blender.log").write_text(r.stdout + r.stderr)
    if "GUIDE_DONE" not in r.stdout:
        raise SystemExit(f"blender failed, see {OUT / 'blender.log'}")
    J3 = json.loads((OUT / "joints3d.json").read_text())
    J3["poses"] = {**prev, **J3["poses"]}           # a partial run keeps the other poses' joints
    (OUT / "joints3d.json").write_text(json.dumps(J3, indent=1))
    for pose, pos in J3["poses"].items():
        dep = Image.open(OUT / f"{pose}_depth.png").convert("RGBA")
        sil = np.asarray(dep)[..., 3] > 127
        Image.fromarray((sil * 255).astype(np.uint8)).save(OUT / f"{pose}_sil.png")
        bones_img(pos, (1024, 1536)).save(OUT / f"{pose}_bones.png")
        g = np.asarray(dep).astype(np.float32)
        if pose in ARM_ONLY and (OUT / "rest_depth.png").exists():
            # torn waist (faces dropped where the fused hand pulled the hip): fill from the rest render with
            # the rest left arm cut away, so Codex sees an intact body and only the limb changes
            base = np.asarray(Image.open(OUT / "rest_depth.png").convert("RGBA")).astype(np.float32).copy()
            cut = Image.new("L", (1024, 1536), 0)
            d = ImageDraw.Draw(cut)
            d.line([tuple(JOINTS[j]) for j in ("lS", "lE", "lW", "lT")], fill=255, width=70, joint="curve")
            d.ellipse([JOINTS["lT"][0] - 45, JOINTS["lT"][1] - 45, JOINTS["lT"][0] + 45, JOINTS["lT"][1] + 45], fill=255)
            cutm = np.asarray(cut) > 0
            torso = np.zeros_like(cutm); torso[:, :int(JOINTS["lS"][0]) - 25] = True   # keep the body side of the shoulder
            base[cutm & ~torso, 3] = 0
            al = g[..., 3:4] / 255
            g = g * al + base * (1 - al)
            sil = g[..., 3] > 127
            Image.fromarray((sil * 255).astype(np.uint8)).save(OUT / f"{pose}_sil.png")
        base = np.empty((1536, 1024, 3), np.float32); base[:] = GREEN
        lum = g[..., :3].mean(-1, keepdims=True)
        al = g[..., 3:4] / 255
        img = base * (1 - al) + (60 + lum * 0.7) * al
        gi = Image.fromarray(img.clip(0, 255).astype(np.uint8))
        bi = bones_img(pos, (1024, 1536))
        m = Image.fromarray((np.asarray(bi).max(-1) > 0).astype(np.uint8) * 255)
        gi.paste(bi, (0, 0), m)
        gi.save(OUT / f"{pose}_guide.png")
    for view in VIEWS:
        p = OUT / f"{view}_depth.png"
        if p.exists():
            dep = np.asarray(Image.open(p).convert("RGBA")).astype(np.float32)
            base = np.empty((1024, 1024, 3), np.float32); base[:] = GREEN
            al = dep[..., 3:4] / 255
            img = base * (1 - al) + (40 + dep[..., :3].mean(-1, keepdims=True) * 0.8) * al
            Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(OUT / f"{view}_guide.png")
    if (OUT / "rest_sil.png").exists():
        sil = np.asarray(Image.open(OUT / "rest_sil.png")) > 127
        m = np.asarray(Image.open(ART / "src" / "master.png").convert("RGB")).astype(np.float32)
        ov = m * 0.5
        ov[sil & a] += (0, 80, 0); ov[sil & ~a] += (120, 0, 0); ov[~sil & a] += (0, 0, 120)
        Image.fromarray(ov.clip(0, 255).astype(np.uint8)).save(OUT / "register.png")
        iou = float((sil & a).sum() / max(1, (sil | a).sum()))
        J3["rest_iou_vs_master"] = round(iou, 4)
        (OUT / "joints3d.json").write_text(json.dumps(J3, indent=1))
        print("rest silhouette IoU vs master", round(iou, 4))
    print(json.dumps({k: J3[k] for k in ("weights", "unweighted_verts", "tris")}))


if __name__ == "__main__":
    main(sys.argv[1:])

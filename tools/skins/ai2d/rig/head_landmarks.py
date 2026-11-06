"""Iris centres, lens rims and jaw of the head drawing the rig ships, in frame px at 1x (rig.json frame, with
the art offset). build_rig.mjs sets the head warp from the eyes and the jaw; pack_atlas.py paints the rims and
irises into the checker's ID atlas from them.

Each head is assembled at its rest place (front: back hair, head, front hair) from the atlas source parts,
upscaled 2x (parts are 2x, so 4x app scale) over white, and located with glasses.locate.
Writes out/head-landmarks.json: { part: { eyes: [[x, y], [x, y]], iod, lenses: [...], offsets } }.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))   # python -I drops the script's folder
import glasses  # noqa: E402

HERE = Path(__file__).resolve().parent
ART, KEY = HERE.parent / "art" / "out", HERE.parent / "art" / "keyposes" / "out"
OFFSET_Y = 9          # build_rig.mjs OFFSET_Y
S = 4                 # app px -> working px
HEADS = {"head": ["backHair", "head", "frontHair"]}   # the one head drawing the rig ships


def main():
    parts = {**json.loads((ART / "parts.json").read_text(encoding="utf8"))["parts"]}
    kp = json.loads((KEY / "parts.json").read_text(encoding="utf8"))["parts"]
    out = {}
    for name, layers in HEADS.items():
        canvas = Image.new("RGBA", (139 * S, 160 * S), (255, 255, 255, 255))
        for ln in layers:
            p = parts.get(ln) or kp[ln]
            base = ART if ln in parts else KEY
            im = Image.open(base / p["file"]).convert("RGBA")
            im = im.resize((im.width * S // 2, im.height * S // 2), Image.LANCZOS)
            canvas.alpha_composite(im, (round(p["restPos1x"][0] * S), round((p["restPos1x"][1] + OFFSET_Y) * S)))
        rgb = np.array(canvas.convert("RGB"))
        f = glasses.locate(rgb)
        if f is None:
            raise SystemExit(f"no face found on {name}")
        sc = lambda q: [round(q[0] / S, 3), round(q[1] / S, 3)]
        out[name] = {"eyes": [sc(e) for e in f["eyes"]], "iod": round(f["iod"] / S, 3),
                     "jawFrom": "mediapipe face oval below the eyes"}
        rims = {**f, "lenses": glasses.find_rims(rgb, f["eyes"], f["iod"])}
        out[name].update({"lenses": [{k: round(g[k] / S, 3) for k in ("cx", "cy", "rx", "ry")} | {"score": round(g["score"], 4)} for g in rims["lenses"]],
                          "offsets": [[round(x, 4) for x in o] for o in glasses.offsets(rims)],
                          "jaw": [sc(q) for q in f["jaw"]]})
        print(name, json.dumps(out[name]))
    (HERE / "out" / "head-landmarks.json").write_text(json.dumps(out, indent=1), encoding="utf8")


if __name__ == "__main__":
    main()

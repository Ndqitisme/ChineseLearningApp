"""Shoulders-to-hips crops for the hand-off-hip in-betweens: these keys are drawn on the crop of the master and
of the guide, upscaled to 1024x1024; paste puts the result back into the master canvas (paste_back) so the
rest of the lever (run.py: register on the legs, cut the arm) sees a full 1024x1536 key like the others.
Usage: python -I crop.py make <key> | paste <key>"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
MASTER = HERE.parents[1] / "art" / "src" / "master.png"
BOX = (380, 180, 1020, 820)   # master px: shoulders to the top of the thighs, the left arm's whole reach
Z = 1024 / (BOX[2] - BOX[0])


def to_crop(p):
    return [round((p[0] - BOX[0]) * Z), round((p[1] - BOX[1]) * Z)]


def make(key):
    k = json.loads((HERE / "keys.json").read_text())[key]
    Image.open(MASTER).convert("RGB").crop(BOX).resize((1024, 1024), Image.LANCZOS).save(HERE / "crop" / "master_crop.png")
    g = Image.open(HERE / "gen" / f"guide_{key}.png").convert("RGB").crop(BOX).resize((1024, 1024), Image.LANCZOS)
    g.save(HERE / "crop" / f"guide_{key}_crop.png")
    print(json.dumps({j: to_crop(p) for j, p in k["joints"].items()}))


def paste(key):
    out = Image.open(HERE / "gen" / key / f"{key}.png").convert("RGB")
    w, h = BOX[2] - BOX[0], BOX[3] - BOX[1]
    full = Image.open(MASTER).convert("RGB")
    full.paste(out.resize((w, h), Image.LANCZOS), BOX[:2])
    full.save(HERE / "src" / f"{key}.png")
    print("pasted", out.size, "->", (w, h), "at", BOX[:2])


if __name__ == "__main__":
    {"make": make, "paste": paste}[sys.argv[1]](sys.argv[2])

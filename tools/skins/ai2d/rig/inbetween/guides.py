"""Pose guides for the in-between arm keys: the master greyed out, the left arm's target bones drawn
over it (orange upper arm, yellow forearm, lime hand, white joint dots), 1024x1536 like the master.
The joints (master px) are the targets the prompts name; they sit between existing key drawings (see KEYS)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
MASTER = HERE.parents[1] / "art" / "src" / "master.png"
KEYP = HERE.parents[1] / "art" / "keyposes" / "out"
KEYS = json.loads((HERE / "keys.json").read_text())

def main():
    m = Image.open(MASTER).convert("RGB")
    grey = ImageOps.grayscale(m).point(lambda v: 150 + v // 6).convert("RGB")
    # the rest left arm (hand on hip) is erased from the guide, so only the target bones show where it goes
    kp = json.loads((KEYP / "parts.json").read_text())
    amap, part = kp["masterToApp1x"], kp["parts"]["leftArm.rest"]
    arm = Image.open(KEYP / part["file"]).getchannel("A")
    s = 1 / (2 * amap["scale"])   # part px are 2x app px
    x0, y0 = (part["restPos1x"][0] - amap["ox"]) / amap["scale"], (part["restPos1x"][1] - amap["oy"]) / amap["scale"]
    arm = arm.resize((round(arm.width * s), round(arm.height * s))).point(lambda v: 255 if v > 8 else 0)
    from PIL import ImageFilter
    arm = arm.filter(ImageFilter.MaxFilter(9))
    grey.paste((172, 172, 172), (round(x0), round(y0)), arm)
    for name, k in KEYS.items():
        im = grey.copy(); d = ImageDraw.Draw(im)
        J = k["joints"]
        for (a, b), col in zip([("S", "E"), ("E", "W"), ("W", "T")], [(255, 140, 0), (255, 220, 0), (150, 255, 0)]):
            d.line([tuple(J[a]), tuple(J[b])], fill=col, width=14)
        for p in J.values():
            d.ellipse([p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9], fill=(255, 255, 255))
        im.save(HERE / "gen" / f"guide_{name}.png")

if __name__ == "__main__":
    main()

"""Packs the rendered character frames (.cache/render3d/reference-v4/frames, from tools/skins/makehuman/build.py)
into the assistant's sprite sheet and manifest.

Usage: .cache/venv/Scripts/python tools/skins/pack.py   (needs pillow)
Output: public/skins/assistant/{sheet.webp, skin.json, CREDITS.txt}
"""
import json
import hashlib
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
FRAMES = ROOT / ".cache" / "render3d" / "reference-v4" / "frames"
OUT = ROOT / "public" / "skins" / "assistant"
FRAME_H = 340
COLUMNS = 10
PAD = 6

# App animation name -> shot rendered by build.py. `drag` and `sleep` hold their last frame
# (duration 0) instead of returning to rest; the others end back on the rest frame.
SHOT_FOR = {"breathe": "breathe", "blink": "blink", "look": "look", "wink": "hair", "think": "think",
            "talk": "talk", "wave": "wave", "happy": "happy"}
HELD = {"drag": "drag", "sleep": "sleep"}

CREDITS = """\
Character "Tiểu Mai": built with MakeHuman / MPFB2 (https://static.makehumancommunity.org/mpfb.html)
and rendered to 2D frames with Blender. Output of MakeHuman itself is CC0.

Assets used (MakeHuman community asset packs, https://static.makehumancommunity.org/assets/assetpacks.html):
- Shirt "elvs_male_shirt_untucked_bd1" by Elvaerwyn, CC-BY,
  https://static.makehumancommunity.org/assets/assetpacks/shirts02.html
  Modified: short sleeves, asymmetric cropped hem, white woven cotton, bust smoothed.
- Fitted tartan skirt, bow, pearl brooch, silver wire spectacles and see-through bangs
  (hair cards): original procedural geometry in
  tools/skins/makehuman/reference_style.py, MIT (project LICENSE).
- Hair ponytail01 (tinted light brown), shoes04 (socks removed), eyebrow001 (tinted),
  eyelashes02, high-poly eyes (brown iris, darkened), teeth_base, tongue01,
  skin young_caucasian_female (warmed, lips tinted), expression targets: MakeHuman system
  assets, CC0.

Licences are as listed in the MakeHuman asset pack metadata (shirts02, skirts02, glasses01,
makehuman_system_assets); the packs say "CC-BY" without a version.
CC-BY: Creative Commons Attribution, https://creativecommons.org/licenses/by/4.0/
CC0: https://creativecommons.org/publicdomain/zero/1.0/
"""


def main() -> int:
    meta = json.loads((FRAMES / "meta.json").read_text(encoding="utf-8"))
    validation = json.loads((FRAMES.parent / "validation.json").read_text(encoding="utf-8"))
    current_hash=hashlib.sha256(b''.join((ROOT/'tools/skins/makehuman'/name).read_bytes()
                                       for name in ('build.py','reference_style.py'))).hexdigest()
    if meta.get('sourceHash') != current_hash or validation.get('sourceHash') != current_hash or not validation.get('complete') or validation['failures']:
        raise ValueError('Run skin:check and skin:render with the same source before packing.')
    names: list[str] = meta["frames"]
    images = [Image.open(FRAMES / f"{n}.png").convert("RGBA") for n in names]
    # One crop for every frame, so the character never jumps between frames.
    boxes = [im.getbbox() for im in images]
    if any(b is None for b in boxes):
        raise ValueError('Empty rendered frame')
    w, h = images[0].size
    if any(im.size != (w,h) for im in images):
        raise ValueError('Mixed frame resolutions')
    edge = [n for n, b in zip(names, boxes) if b[0] == 0 or b[1] == 0 or b[2] == w or b[3] == h]
    if edge:
        print(f"frames touch the render border (cut off): {edge}", file=sys.stderr)
        return 1
    l = max(0, min(b[0] for b in boxes) - PAD); t = max(0, min(b[1] for b in boxes) - PAD)
    r = min(w, max(b[2] for b in boxes) + PAD); b = min(h, max(b[3] for b in boxes) + PAD)
    fw = round((r - l) * FRAME_H / (b - t))
    cells = [im.crop((l, t, r, b)).resize((fw, FRAME_H), Image.LANCZOS) for im in images]

    rows = (len(cells) + COLUMNS - 1) // COLUMNS
    sheet = Image.new("RGBA", (fw * COLUMNS, FRAME_H * rows))
    for i, c in enumerate(cells):
        sheet.alpha_composite(c, ((i % COLUMNS) * fw, (i // COLUMNS) * FRAME_H))
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "sheet.webp", "WEBP", quality=94, method=6)

    index = {n: i for i, n in enumerate(names)}
    shots: dict[str, list] = meta["shots"]
    rest = [[index["rest"], 0]]
    animations = {"idle": rest}
    for app_name, shot in HELD.items():
        animations[app_name] = [[index[f], ms] for f, ms in shots[shot]]
    for app_name, shot in SHOT_FOR.items():
        animations[app_name] = [[index[f], ms] for f, ms in shots[shot]] + rest
    hit_box = cells[index["rest"]].getbbox()
    manifest = {
        "id": "assistant", "name": "Tiểu Mai", "frameW": fw, "frameH": FRAME_H, "columns": COLUMNS,
        "count": len(cells), "pixelated": False, "facing": meta["facing"],
        "version": meta['version'],
        "hit": {"x": hit_box[0] / fw, "y": hit_box[1] / FRAME_H,
                "w": (hit_box[2] - hit_box[0]) / fw, "h": (hit_box[3] - hit_box[1]) / FRAME_H},
        "animations": animations,
        "credit": {"title": "MakeHuman / MPFB2 with original reference clothing and glasses",
                   "license": "CC0 / CC-BY / MIT", "url": "https://static.makehumancommunity.org/assets/assetpacks.html"},
    }
    (OUT / "skin.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "CREDITS.txt").write_text(CREDITS, encoding="utf-8")
    size_kb = (OUT / "sheet.webp").stat().st_size // 1024
    print(f"assistant: {len(cells)} frames {fw}x{FRAME_H}, sheet {sheet.size}, {size_kb} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

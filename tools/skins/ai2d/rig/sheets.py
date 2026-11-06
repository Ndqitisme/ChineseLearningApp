"""Contact sheets of the rendered frames, for the eye: every frame, never a sample.

out/sheets/<clip>_1x.png        every frame at app size over light grey, frame numbers above
out/sheets/<clip>_2x_pNN.png    every frame at 2x (from the 4x render), 10 per row, 20 per page, light grey
out/sheets/<clip>_zoom_pNN.png  every frame zoomed from the 4x render, 10 per page, one column per frame:
                                head and glasses (4x), left shoulder, sleeve, elbow, wrist and hand (4x),
                                right arm and hand (3x), hips, hem, knees and feet (2x)
Usage: python -I sheets.py [clip ...]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
FR = HERE / "out" / "frames"
OUT = HERE / "out" / "sheets"
LIGHT = (232, 232, 236, 255)
# zoom boxes in 1x frame px and their scale
ZOOMS = [("head", (26, 6, 82, 74), 4), ("left arm", (60, 48, 139, 176), 4), ("right arm", (0, 66, 44, 210), 3), ("legs", (24, 160, 100, 340), 2)]


def on(bg, im):
    base = Image.new("RGBA", im.size, bg)
    base.alpha_composite(im)
    return base


def grid(tiles, labels, cols, bg=LIGHT, pad=14):
    w = max(t.width for t in tiles); h = max(t.height for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    S = Image.new("RGBA", (cols * (w + 2), rows * (h + pad)), (255, 255, 255, 255))
    d = ImageDraw.Draw(S)
    for i, t in enumerate(tiles):
        x, y = (i % cols) * (w + 2), (i // cols) * (h + pad)
        S.alpha_composite(on(bg, t), (x, y + pad))
        d.text((x + 2, y + 1), labels[i], fill=(200, 0, 0, 255))
    return S.convert("RGB")


def main(clips):
    OUT.mkdir(parents=True, exist_ok=True)
    all_clips = len(sys.argv) <= 1
    for old in OUT.glob("*.png"):
        if all_clips or any(old.name.startswith(c + "_") for c in clips):
            old.unlink()
    for clip in clips:
        f1 = sorted((FR / clip / "1x").glob("*.png"))
        f4 = sorted((FR / clip / "4x").glob("*.png"))
        if not f1:
            continue
        lab = [p.stem.lstrip("0") or "0" for p in f1]
        grid([Image.open(p).convert("RGBA") for p in f1], lab, min(16, len(f1))).save(OUT / f"{clip}_1x.png")
        big = [Image.open(p).convert("RGBA") for p in f4]
        two = [b.resize((278, 680), Image.LANCZOS) for b in big]
        for pg in range(0, len(two), 20):
            grid(two[pg:pg + 20], lab[pg:pg + 20], 10).save(OUT / f"{clip}_2x_p{pg // 20:02d}.png")
        cols = []
        for b in big:
            parts = []
            for _, (x0, y0, x1, y1), s in ZOOMS:
                c = b.crop((x0 * 4, y0 * 4, x1 * 4, y1 * 4))
                parts.append(c if s == 4 else c.resize(((x1 - x0) * s, (y1 - y0) * s), Image.LANCZOS))
            col = Image.new("RGBA", (max(p.width for p in parts), sum(p.height + 4 for p in parts)), (0, 0, 0, 0))
            y = 0
            for p in parts:
                col.alpha_composite(p, (0, y)); y += p.height + 4
            cols.append(col)
        for pg in range(0, len(cols), 10):
            grid(cols[pg:pg + 10], lab[pg:pg + 10], 10).save(OUT / f"{clip}_zoom_p{pg // 10:02d}.png")
        print(clip, len(f1), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or sorted(p.name for p in FR.iterdir() if p.is_dir()))

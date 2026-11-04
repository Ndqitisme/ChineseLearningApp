"""Builds the app's logo files from the chosen icon artwork (a square PNG, generated with Codex).

The artwork carries no text: AI image models garble Vietnamese diacritics, so the name banner is
drawn here with the app's own fonts.

Usage: .cache/venv/Scripts/python tools/logo/compose.py <artwork.png>   (needs pillow)
Output:
  .cache/logo/icon-1024.png   rounded tile, transparent corners -> `pnpm tauri icon` source
  public/logo/icon.png        128 px tile for the title bar
  public/logo/logo.webp       512 px tile with the name banner (About page)
  docs/logo.png               512 px tile with the name banner (README)
  src-tauri/icons/tray.png    64 px face crop for the tray, where icons show at 16-24 px

Run `pnpm tauri icon .cache/logo/icon-1024.png` afterwards for the app/installer icons.
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONTS = ROOT / ".cache" / "sources"
SIZE = 1024
RADIUS = 200          # corner radius of the tile at 1024 px
INSET = 18            # trims whatever the artwork has outside its own rounded tile
TRAY_BOX = (240, 120, 800, 680)  # face and hair clip in the 1024 tile: still readable at 16 px

PINK, LAVENDER, INK = (236, 111, 151), (155, 140, 240), (74, 35, 64)


def rounded_mask(size, radius, inset=0):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - 1 - inset, size - 1 - inset), radius, fill=255)
    return mask


def tile(art: Image.Image) -> Image.Image:
    art = art.convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    # Scale up slightly so the artwork's own corners fall outside our mask.
    grow = SIZE + 2 * INSET
    art = art.resize((grow, grow), Image.LANCZOS).crop((INSET, INSET, INSET + SIZE, INSET + SIZE))
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(art, (0, 0), rounded_mask(SIZE, RADIUS))
    return out


def gradient(w, h, a, b):
    g = Image.new("RGBA", (w, h))
    px = g.load()
    for x in range(w):
        t = x / max(w - 1, 1)
        c = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
        for y in range(h):
            px[x, y] = c
    return g


def sparkle(draw, cx, cy, r, fill):
    k = r * 0.28
    draw.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k),
                  (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)], fill=fill)


def with_banner(base: Image.Image) -> Image.Image:
    img = base.copy()
    x0, y0, x1, y1 = 120, 772, SIZE - 120, 952
    r = (y1 - y0) // 2
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 10, x1, y1 + 10), r, fill=(120, 40, 80, 90))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10)))
    ring = Image.new("L", img.size, 0)
    ImageDraw.Draw(ring).rounded_rectangle((x0, y0, x1, y1), r, fill=255)
    border = gradient(SIZE, SIZE, PINK, LAVENDER)
    img.paste(border, (0, 0), ring)
    ImageDraw.Draw(img).rounded_rectangle((x0 + 9, y0 + 9, x1 - 9, y1 - 9), r - 9, fill=(255, 255, 255, 250))

    draw = ImageDraw.Draw(img)
    name = ImageFont.truetype(str(FONTS / "Nunito.ttf"), 96)
    name.set_variation_by_name("Black")
    sub = ImageFont.truetype(str(FONTS / "Nunito.ttf"), 38)
    sub.set_variation_by_name("ExtraBold")
    cx = SIZE // 2
    draw.text((cx, y0 + 72), "Tiểu Mai", font=name, fill=INK, anchor="mm")
    draw.text((cx, y0 + 138), "HỌC TIẾNG TRUNG", font=sub, fill=PINK, anchor="mm")
    sparkle(draw, x0 + 70, y0 + 70, 26, (255, 205, 64, 255))
    sparkle(draw, x1 - 70, y0 + 110, 22, LAVENDER + (255,))
    return img


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    base = tile(Image.open(sys.argv[1]))
    (ROOT / ".cache" / "logo").mkdir(parents=True, exist_ok=True)
    (ROOT / "public" / "logo").mkdir(parents=True, exist_ok=True)
    base.save(ROOT / ".cache" / "logo" / "icon-1024.png")
    base.resize((128, 128), Image.LANCZOS).save(ROOT / "public" / "logo" / "icon.png", optimize=True)
    logo = with_banner(base).resize((512, 512), Image.LANCZOS)
    logo.save(ROOT / "public" / "logo" / "logo.webp", "WEBP", quality=90, method=6)
    logo.save(ROOT / "docs" / "logo.png", optimize=True)
    face = base.crop(TRAY_BOX).resize((64, 64), Image.LANCZOS)
    tray = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    tray.paste(face, (0, 0), rounded_mask(64, 14))
    tray.save(ROOT / "src-tauri" / "icons" / "tray.png", optimize=True)
    print("logo files written")
    return 0


if __name__ == "__main__":
    sys.exit(main())

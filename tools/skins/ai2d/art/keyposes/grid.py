"""Zoomed grid of a source image region, for reading joint sites by eye into joints.json.
Usage: python grid.py <src.png> <x0> <y0> <x1> <y1> <out.png> [zoom]
Lines every 10 px (faint) and 50 px (strong, labelled with source-pixel coordinates)."""
import sys

from PIL import Image, ImageDraw

src, x0, y0, x1, y1, out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
z = float(sys.argv[7]) if len(sys.argv) > 7 else 2.0
im = Image.open(src).convert("RGB").crop((x0, y0, x1, y1))
im = im.resize((round(im.width * z), round(im.height * z)), Image.LANCZOS)
d = ImageDraw.Draw(im)
for v in range((x0 // 10) * 10, x1 + 1, 10):
    if v < x0:
        continue
    X = (v - x0) * z
    d.line([(X, 0), (X, im.height)], fill=(255, 0, 255) if v % 50 == 0 else (120, 120, 255), width=2 if v % 50 == 0 else 1)
    if v % 50 == 0:
        d.text((X + 2, 2), str(v), fill=(255, 255, 0))
for v in range((y0 // 10) * 10, y1 + 1, 10):
    if v < y0:
        continue
    Y = (v - y0) * z
    d.line([(0, Y), (im.width, Y)], fill=(255, 0, 255) if v % 50 == 0 else (120, 120, 255), width=2 if v % 50 == 0 else 1)
    if v % 50 == 0:
        d.text((2, Y + 2), str(v), fill=(255, 255, 0))
im.save(out)

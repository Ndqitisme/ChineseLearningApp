"""Cuts the 3x3 icon sheets in tools/icons/sheets/ into public/icons/<name>.png and writes src/lib/ui/icon-names.ts.

Each icon becomes a 128x128 black glyph whose alpha is the ink, scaled so its longer side is 104 px. The app draws
it as a CSS mask filled with the text colour, so icons follow the theme.
Usage: python tools/icons/slice.py   (needs Pillow)
"""
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'tools' / 'icons'
OUT = ROOT / 'public' / 'icons'
NAMES_TS = ROOT / 'src' / 'lib' / 'ui' / 'icon-names.ts'
SIZE, BOX = 128, 104


def stroke_px(alpha: Image.Image) -> int:
    """Rough stroke width: erosions until the ink is gone, times two."""
    mask = alpha.point(lambda v: 255 if v > 127 else 0)
    steps = 0
    while mask.getbbox() and steps < 40:
        mask = mask.filter(ImageFilter.MinFilter(3))
        steps += 1
    return steps * 2


def main() -> None:
    sheets = json.loads((HERE / 'sheets.json').read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    names, report = [], []
    for sheet in sheets:
        ink = ImageOps.invert(Image.open(HERE / 'sheets' / f"sheet-{sheet['id']}.png").convert('L'))
        cell = ink.width / 3
        for i, (name, _) in enumerate(sheet['icons']):
            col, row = i % 3, i // 3
            box = (round(col * cell), round(row * cell), round((col + 1) * cell), round((row + 1) * cell))
            glyph = ink.crop(box).point(lambda v: 0 if v < 24 else v)
            bbox = glyph.getbbox()
            if not bbox:
                raise SystemExit(f'{name}: empty cell in sheet {sheet["id"]}')
            glyph = glyph.crop(bbox)
            scale = BOX / max(glyph.size)
            glyph = glyph.resize((max(1, round(glyph.width * scale)), max(1, round(glyph.height * scale))), Image.LANCZOS)
            alpha = Image.new('L', (SIZE, SIZE), 0)
            alpha.paste(glyph, ((SIZE - glyph.width) // 2, (SIZE - glyph.height) // 2))
            icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
            icon.putalpha(alpha)
            icon.save(OUT / f'{name}.png', optimize=True)
            names.append(name)
            report.append((name, stroke_px(alpha)))
    if len(set(names)) != len(names):
        raise SystemExit('duplicate icon names in sheets.json')
    NAMES_TS.write_text(
        '// Written by tools/icons/slice.py from tools/icons/sheets.json.\n'
        f"export const ICON_NAMES = [\n{''.join(f'  {json.dumps(n)},' + chr(10) for n in names)}] as const;\n"
        'export type IconName = (typeof ICON_NAMES)[number];\n',
        encoding='utf-8', newline='\n')
    widths = sorted(w for _, w in report)
    print(f'{len(names)} icons -> {OUT}; stroke px min {widths[0]} median {widths[len(widths) // 2]} max {widths[-1]}')
    for name, w in report:
        if abs(w - widths[len(widths) // 2]) > 3:
            print(f'  stroke outlier: {name} {w}px')


if __name__ == '__main__':
    main()

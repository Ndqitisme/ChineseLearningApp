"""Subsets the bundled fonts to the characters the app actually uses.

LXGW WenKai's name is a Reserved Font Name under the OFL, so the modified (subset)
font is renamed "TieuMai Kai" as the licence requires.

Usage: .cache/venv/Scripts/python tools/data/subset_font.py
(needs: pip install fonttools brotli)
"""
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / ".cache" / "sources"
OUT = ROOT / "public" / "fonts"

LATIN = "".join(chr(c) for c in range(0x20, 0x7F))
VIETNAMESE = "ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯư" + "".join(chr(c) for c in range(0x1EA0, 0x1EFA))
PINYIN = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ"
PUNCT = "，。！？、：；“”‘’（）《》〈〉【】…—～·「」『』·•–—’‘“”…×÷°%"


def subset_font(src: pathlib.Path, dst: pathlib.Path, text: str, family: str | None) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    font = TTFont(src)
    sub = subset.Subsetter(options)
    sub.populate(text=text)
    sub.subset(font)
    if family:
        rename(font, family)
    dst.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(dst)
    print(f"{dst.relative_to(ROOT)}: {dst.stat().st_size // 1024} KB")


def rename(font: TTFont, family: str) -> None:
    ps_name = family.replace(" ", "") + "-Regular"
    names = {1: family, 2: "Regular", 3: f"{ps_name};subset", 4: f"{family} Regular", 6: ps_name, 16: family, 17: "Regular"}
    table = font["name"]
    for record in list(table.names):
        if record.nameID in names:
            table.setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    for record in list(table.names):
        if record.nameID in (21, 22):  # WWS names would still carry the reserved name
            table.removeNames(nameID=record.nameID)


def main() -> int:
    charset_file = ROOT / ".cache" / "charset.txt"
    if not charset_file.exists():
        print("run `pnpm data:build` first (it writes .cache/charset.txt)", file=sys.stderr)
        return 1
    han = charset_file.read_text(encoding="utf-8")
    ui_han = "小梅学习中文汉字拼音今天复习写声调练习词"  # Chinese used in UI chrome
    subset_font(SRC / "LXGWWenKaiLite-Regular.ttf", OUT / "TieuMaiKai.woff2",
                han + ui_han + LATIN + PINYIN + VIETNAMESE + PUNCT, "TieuMai Kai")
    subset_font(SRC / "Nunito.ttf", OUT / "Nunito.woff2", LATIN + VIETNAMESE + PUNCT + "←→↑↓✓✗★☆♥", None)
    licenses = ROOT / "public" / "licenses"
    licenses.mkdir(parents=True, exist_ok=True)
    (licenses / "OFL-TieuMaiKai.txt").write_bytes((SRC / "OFL-LXGWWenKai.txt").read_bytes())
    (licenses / "OFL-Nunito.txt").write_bytes((SRC / "OFL-Nunito.txt").read_bytes())
    return 0


if __name__ == "__main__":
    sys.exit(main())

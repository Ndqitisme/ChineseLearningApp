"""Splits out/frames into two halves (by frame count) for two parallel runs of the frozen consistency checker (consistency/)
(each half carries rest and its own manifest subset). Usage: python -I cons_split.py <dst_dir>"""
import json
import shutil
import sys
from pathlib import Path

src = Path(__file__).resolve().parent / "out" / "frames"
dst = Path(sys.argv[1])
m = json.loads((src / "manifest.json").read_text(encoding="utf8"))
clips = sorted((c for c in m["clips"] if c != "rest"), key=lambda c: -len(m["clips"][c]["joints"]))
halves = [[], []]; n = [0, 0]
for c in clips:
    k = 0 if n[0] <= n[1] else 1
    halves[k].append(c); n[k] += len(m["clips"][c]["joints"])
for k, hs in enumerate(halves):
    d = dst / f"half{k}"
    shutil.rmtree(d, ignore_errors=True)
    for c in ["rest"] + hs:
        for r in ("1x", "4x"):
            shutil.copytree(src / c / r, d / c / r)
    mm = dict(m)
    mm["clips"] = {c: v for c, v in m["clips"].items() if c in hs or c == "rest"}
    mm["allowed_holes"] = {c: v for c, v in m["allowed_holes"].items() if c in hs or c == "rest"}
    (d / "manifest.json").write_text(json.dumps(mm), encoding="utf8")
    print(k, n[k], hs)

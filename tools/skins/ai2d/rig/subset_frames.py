"""Copies a few clips of out/frames into out/frames-subset with a filtered manifest, for a consistency
checker sample run (the full set is ~1260 frames, about 85 min at 4 s per frame).
Usage: python -I subset_frames.py clip1 clip2 ..."""
import json, shutil, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
src, dst = HERE / "out" / "frames", HERE / "out" / "frames-subset"
clips = ["rest"] + [c for c in sys.argv[1:] if c != "rest"]
shutil.rmtree(dst, ignore_errors=True)
m = json.loads((src / "manifest.json").read_text(encoding="utf8"))
for c in clips:
    shutil.copytree(src / c, dst / c)
m["clips"] = {k: v for k, v in m["clips"].items() if k in clips and k != "rest"}
m["allowed_holes"] = {k: v for k, v in m["allowed_holes"].items() if k in clips}
(dst / "manifest.json").write_text(json.dumps(m), encoding="utf8")
print("subset", clips)

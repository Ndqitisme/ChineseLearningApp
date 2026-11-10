"""List shots in NEW that differ from the same file in OLD.

A shot counts as changed when more than MIN_PX pixels differ by more than TOL levels in any channel.
Usage: python diffshots.py OLD NEW OUT.txt
"""
import sys, os
import numpy as np
from PIL import Image

TOL, MIN_PX = 6, 20
old, new, out = sys.argv[1:4]
changed, missing = [], []
for f in sorted(os.listdir(new)):
    if not f.endswith('.png'):
        continue
    po = os.path.join(old, f)
    if not os.path.exists(po):
        missing.append(f)
        continue
    a = np.asarray(Image.open(po).convert('RGBA'), dtype=np.int16)
    b = np.asarray(Image.open(os.path.join(new, f)).convert('RGBA'), dtype=np.int16)
    if a.shape != b.shape:
        changed.append((f, -1))
        continue
    n = int((np.abs(a - b).max(axis=2) > TOL).sum())
    if n > MIN_PX:
        changed.append((f, n))
with open(out, 'w', encoding='utf-8') as fh:
    for f, n in changed:
        fh.write(f'{f}\t{n}\n')
print(f'{len(changed)} changed, {len(missing)} new (not in old): {missing}')

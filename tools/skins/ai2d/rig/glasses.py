"""Eye and glasses-rim locator, shared by head_landmarks.py (fits the head warp) and seam_check.py (the
glasses-to-eye offset rule: the glasses must stay on the eyes).

It reuses the frozen likeness harness (harness/likeness.py) without changing it: mediapipe face mesh for the iris centres
(landmarks 468 and 473) and the harness's ring score (ring_scores: an ellipse that a thin rim follows over
at least 70 % of its length), searched around each eye (find_rims). Input is an RGB image of a head at about 4x app scale.

Usage: python -I head_landmarks.py   (writes out/head-landmarks.json; see that file)
"""
import sys
from pathlib import Path

import numpy as np

HARNESS = Path(__file__).resolve().parents[1] / "harness"
sys.path.insert(0, str(HARNESS))
import likeness as LK  # noqa: E402  (frozen harness, read-only)


def locate(rgb):
    """rgb: HxWx3 uint8. Returns {eyes: [[x, y], [x, y]] (iris centres, image left first), iod, jaw (the face
    oval below the eyes, sorted by x)} in the image's px, or None when no face is found."""
    L = LK.detect_mesh(np.ascontiguousarray(rgb))
    if L is None:
        return None
    kp = LK.keypoints_from_mesh(L)
    d = LK.derived(kp)
    jaw = [L[i].tolist() for i in LK.OVAL if L[i][1] > d["eye_y"]]
    return {"eyes": sorted([kp["eye_l"], kp["eye_r"]]), "iod": d["iod"], "jaw": sorted(jaw)}


def find_rims(rgb, eyes, iod):
    """One lens ellipse per eye, searched near that eye: the frozen harness's ring score (the 30th percentile
    of oriented thin-line strength along the ellipse, so most of the ring must lie on a line running its way),
    at a scale where the interocular distance is 60 px, with the centre within 0.3 iod of the iris sideways and
    from 0.03 iod above to 0.3 iod below it (these lenses sit low on the eyes in every drawing), rx 0.36 to
    0.66 iod and ry/rx 0.75 to 1.2 (coarse to fine), off the eye (an ellipse 0.3 x 0.13 iod) and around both eye corners
    (+/-0.25 iod). The harness's own search (find_lenses) starts at a radius floor that
    misses the narrower far lens of a turned head, so this one searches around the eye instead.
    Returns [{cx, cy, rx, ry, score}] in the input image's px, eye 0 = image left."""
    import cv2
    s = 60.0 / iod
    small = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    ridge = LK.oriented_ridge(gray, 1.0, max(1.0, s))
    th = np.linspace(0, 2 * np.pi, 96, endpoint=False)
    out = []
    for e in eyes:
        ex, ey = e[0] * s, e[1] * s
        # as in the harness: the ring stays off the eye itself and holds both eye corners (here +/-0.25 iod)
        corners, eye = [[ex - 15, ey], [ex + 15, ey]], (ex, ey, 18, 8)
        # coarse (2 px, 2 px radius, 0.1 aspect), then fine around the best (1 px, 1 px, 0.05)
        def search(xs, ys, rxs, qs):
            CX, CY = np.meshgrid(xs, ys)
            CX, CY = CX.ravel(), CY.ravel()
            best = (-1.0, None)
            for rx in rxs:
                for q in qs:
                    sc = LK.ring_scores(ridge, CX, CY, rx, rx * q, th, corners, eye)
                    i = int(np.argmax(sc))
                    if sc[i] > best[0]:
                        best = (float(sc[i]), (CX[i], CY[i], rx, q))
            return best
        best = search(np.arange(ex - 18, ex + 18.01, 2.0), np.arange(ey - 2, ey + 18.01, 2.0), np.arange(21.6, 39.7, 2.0), np.arange(0.75, 1.2001, 0.1))
        bx, by, brx, bq = best[1]
        best = search(np.arange(bx - 2, bx + 2.01, 1.0), np.arange(by - 2, by + 2.01, 1.0), np.arange(max(21.6, brx - 2), min(39.7, brx + 2.01), 1.0), np.arange(max(0.75, bq - 0.1), min(1.2001, bq + 0.1001), 0.05))
        bx, by, brx, bq = best[1]
        best = (best[0], (bx, by, brx, brx * bq))
        cx, cy, rx, ry = best[1]
        out.append({"cx": cx / s, "cy": cy / s, "rx": rx / s, "ry": ry / s, "score": best[0]})
    return out


def locate_rims(rgb):
    """Iris centres (mediapipe) and the lens rims around them. None when no face is found."""
    f = locate(rgb)
    if f is None:
        return None
    return {**f, "lenses": find_rims(rgb, f["eyes"], f["iod"])}


def offsets(found):
    """Lens centre minus iris centre, per eye, in units of the interocular distance."""
    iod = found["iod"]
    return [[(g["cx"] - e[0]) / iod, (g["cy"] - e[1]) / iod] for g, e in zip(found["lenses"], found["eyes"])]

"""Glasses-to-eye offset read from the COLOUR frame. The ID-pass rule passes by construction,
because the ID rims and irises share the head transform; it cannot see glasses drawn off the eyes).

Templates come from the rest frame once: its 4x colour pixels under the lens rims (ID pass R, grown 1 px) and
under the eyes (ID pass G irises, grown 6 px: iris, lids and lashes), split per eye. In every frame each template
is found by masked normalised cross-correlation (high-passed grey levels, cv2.TM_CCOEFF_NORMED with the mask) in a window
around the rest place moved by the head centre's move from rest. The rule is the rim template's shift minus the
eye template's shift, per eye, in interocular distances: glasses that stay on the eyes move with them (the warp
of a head turn moves both nearly alike), glasses drawn off the eyes do not.
"""
import numpy as np
import cv2

SEARCH = 0.35      # iod: half window around the expected place
GROW_RIM, GROW_EYE = 1, 6


def _gray(img):
    rgb = img[..., :3].astype(np.float32)
    a = img[..., 3:4].astype(np.float32) / 255
    over = rgb * a + 236 * (1 - a)
    g = cv2.cvtColor(np.clip(over, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    # high-pass: thin lines (rims, lids, lashes) carry the match, not the skin's brightness; offset so the
    # normalised cross-correlation of the masked template stays well defined
    return g - cv2.GaussianBlur(g, (0, 0), 3.0) + 128


def build_ref(rest4, rest_id):
    """rest4: 4x RGBA rest frame; rest_id: its ID pass (RGB). Returns per-eye templates and the iod."""
    g = rest_id[..., 1]
    n, lab, st, cen = cv2.connectedComponentsWithStats((g >= 128).astype(np.uint8), connectivity=8)
    big = sorted(range(1, n), key=lambda i: -st[i, 4])[:2]
    eyes = sorted([cen[i] for i in big], key=lambda c: c[0])
    iod = float(np.hypot(*(eyes[1] - eyes[0])))
    mid = (eyes[0][0] + eyes[1][0]) / 2
    gray = _gray(rest4)
    rim = cv2.dilate((rest_id[..., 0] >= 128).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=GROW_RIM)
    eye = cv2.dilate((g >= 64).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=GROW_EYE)
    H, W = g.shape
    X = np.arange(W)[None, :].repeat(H, 0)
    ref = {"iod": iod, "eyes": []}
    for k in range(2):
        side = (X < mid) if k == 0 else (X >= mid)
        e = {}
        for name, m in (("rim", rim), ("eye", eye)):
            mm = (m > 0) & side & (np.abs(np.arange(H)[:, None] - eyes[k][1]) < 0.8 * iod)
            ys, xs = np.nonzero(mm)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            e[name] = {"tpl": gray[y0:y1, x0:x1].copy(), "mask": mm[y0:y1, x0:x1].astype(np.float32), "at": (int(x0), int(y0))}
        ref["eyes"].append(e)
    return ref


def _find(gray, t, exp, r):
    th, tw = t["tpl"].shape
    x0, y0 = int(round(exp[0] - r)), int(round(exp[1] - r))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(gray.shape[1], int(round(exp[0] + r)) + tw), min(gray.shape[0], int(round(exp[1] + r)) + th)
    win = gray[y0:y1, x0:x1]
    if win.shape[0] < th or win.shape[1] < tw:
        return None
    res = cv2.matchTemplate(win, t["tpl"], cv2.TM_CCOEFF_NORMED, mask=t["mask"])
    res = np.nan_to_num(res, nan=-1.0)
    _, mx, _, loc = cv2.minMaxLoc(res)
    # sub-pixel: a parabola through the peak's neighbours on each axis
    px, py = float(loc[0]), float(loc[1])
    if 0 < loc[0] < res.shape[1] - 1:
        a, b, c = res[loc[1], loc[0] - 1], res[loc[1], loc[0]], res[loc[1], loc[0] + 1]
        den = a - 2 * b + c
        px += 0.5 * (a - c) / den if den else 0
    if 0 < loc[1] < res.shape[0] - 1:
        a, b, c = res[loc[1] - 1, loc[0]], res[loc[1], loc[0]], res[loc[1] + 1, loc[0]]
        den = a - 2 * b + c
        py += 0.5 * (a - c) / den if den else 0
    return np.array([x0 + px, y0 + py]), float(mx)


def offset(frame4, ref, head_move):
    """Max over the two eyes of |rim shift - eye shift| / iod; head_move = the head centre's move from rest (4x px).
    Returns (dev, per-eye detail) or (None, reason)."""
    gray = _gray(frame4)
    r = SEARCH * ref["iod"]
    out = []
    for e in ref["eyes"]:
        sh = {}
        for name in ("rim", "eye"):
            t = e[name]
            exp = (t["at"][0] + head_move[0], t["at"][1] + head_move[1])
            f = _find(gray, t, exp, r)
            if f is None:
                return None, "window off the frame"
            sh[name] = (f[0] - np.array(t["at"]), f[1])
        d = (sh["rim"][0] - sh["eye"][0]) / ref["iod"]
        out.append({"dev": float(np.hypot(*d)), "rimScore": round(sh["rim"][1], 3), "eyeScore": round(sh["eye"][1], 3)})
    return max(o["dev"] for o in out), out

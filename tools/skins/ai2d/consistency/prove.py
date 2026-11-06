"""Sensitivity proof for consistency.py: seed one defect per case into a clean fixture frame and check that
the intended check (and only checks that the defect explains) fails, then run the clean fixture frames
(fixtures/r1_clean).

Usage: tools/skins/ai2d/.venv/Scripts/python.exe -I prove.py [--skip-clean]
Writes fixtures/seeded/<case>/ (frames + manifest), runs/seed_<case>/, runs/r1_clean/, and proof.json.
Exit 0 when every seed is caught by its intended check and the clean run fails only on the known fixture
defects listed in HOLDOUT_R1 / WAVE_* / the idle neck seam (each checked by eye, see README.txt), and
reports each of them.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import consistency as C  # noqa: E402

CLEAN = HERE / "fixtures" / "r1_clean"
SEEDED = HERE / "fixtures" / "seeded"
RUNS = HERE / "runs"
PY = str(C.HARNESS_PY)

# Fixture defects the clean run must report, each checked by eye (README.txt, "KNOWN DEFECTS IN THE CLEAN
# FIXTURE"). Any other failure on the clean fixture frames counts as a false alarm and fails the proof.
HOLDOUT_R1 = {"holdout.iris.bright", "holdout.hair.place"}   # iris lighter and greyer; crown hair darker
WAVE_LIMB_R1 = {2, 18}                                          # forearm drawn over the sleeve (a stump)
WAVE_SEAM_R1 = ({5, 15}, (423.5, 381.4))                        # dark semi-transparent cut line at the elbow


def r1_unexpected(rep: dict) -> list:
    """Every clean-run failure that the known fixture defects above do not explain."""
    nb = rep["rest_face"]["neck"]
    bad = []
    for clip, v in rep["clips"].items():
        if not v["summary"]["likeness_peak"].get("pass"):
            bad.append(f"{clip}: likeness_peak")
        for f in v["frames"]:
            for k in f["fails"]:
                c = f["checks"][k]
                if k == "holdout" and {r["id"] for r in c.get("rows", []) if not r["pass"]} <= HOLDOUT_R1 and c.get("rows"):
                    continue
                if k == "limbs" and clip == "wave" and f["frame"] in WAVE_LIMB_R1:
                    continue
                if k == "see_through":
                    comps = [x for x in c["components"] if not x["allowed"]]
                    if clip == "idle" and all(nb[0] - 12 <= x["at"][0] <= nb[2] + 12 and nb[1] - 12 <= x["at"][1] <= nb[3] + 12
                                              for x in comps):
                        continue                                # the neck/collar seam of the idle head layer
                    if clip == "wave" and f["frame"] in WAVE_SEAM_R1[0] and all(
                            np.hypot(x["at"][0] - WAVE_SEAM_R1[1][0], x["at"][1] - WAVE_SEAM_R1[1][1]) < 15 for x in comps):
                        continue
                bad.append(f"{clip} {f['frame']}: {k}")
    return bad


def load(p):
    return C.load(p)


def save_pair(d: Path, name: str, f4: np.ndarray, clean4: np.ndarray, clean1: np.ndarray):
    """Write the seeded 4x frame and a 1x twin that carries the same change (premultiplied area-down delta)."""
    (d / "4x").mkdir(parents=True, exist_ok=True)
    (d / "1x").mkdir(parents=True, exist_ok=True)
    Image.fromarray(f4).save(d / "4x" / name)
    size = (clean1.shape[1], clean1.shape[0])
    delta = (cv2.resize(C.premul(f4), size, interpolation=cv2.INTER_AREA)
             - cv2.resize(C.premul(clean4), size, interpolation=cv2.INTER_AREA))
    p1 = np.clip(C.premul(clean1) + delta, 0, 255)
    a = p1[..., 3:4]
    rgb = np.where(a > 0, p1[..., :3] * 255.0 / np.maximum(a, 1e-6), 0)
    f1 = np.concatenate([np.clip(rgb + 0.5, 0, 255), np.clip(a + 0.5, 0, 255)], -1).astype(np.uint8)
    Image.fromarray(f1).save(d / "1x" / name)


def jagged(p0, p1, n=24, amp=3.0, seed=1):
    rng = np.random.default_rng(seed)
    ts = np.linspace(0, 1, n)
    pts = np.array(p0, float)[None] + ts[:, None] * (np.array(p1, float) - np.array(p0, float))[None]
    pts[:, 1] += rng.uniform(-amp, amp, n)
    return np.round(pts).astype(np.int32)


def hue_rotate(rgba, deg):
    lab = rgb2lab(rgba[..., :3] / 255.0)
    c = np.hypot(lab[..., 1], lab[..., 2])
    h = np.arctan2(lab[..., 2], lab[..., 1]) + np.radians(deg)
    lab[..., 1], lab[..., 2] = c * np.cos(h), c * np.sin(h)
    out = rgba.copy()
    out[..., :3] = np.clip(lab2rgb(lab) * 255 + 0.5, 0, 255).astype(np.uint8)
    return out


def build_seeds(face, man) -> dict:
    rest4, rest1 = load(CLEAN / "rest" / "4x" / "0000.png"), load(CLEAN / "rest" / "1x" / "0000.png")
    wave4, wave1 = load(CLEAN / "wave" / "4x" / "0006.png"), load(CLEAN / "wave" / "1x" / "0006.png")
    rj = man["rest_joints"]
    wj = man["clips"]["wave"]["joints"]["6"]
    x0, y0, x1, y1 = face["neck"]
    neck_y = y0 + 0.45 * (y1 - y0)
    cases = {}

    def seam_line(img, alpha_scale=None, colour=(252, 246, 242)):
        out = img.copy()
        m = np.zeros(img.shape[:2], np.uint8)
        cv2.polylines(m, [jagged((x0 + 8, neck_y), (x1 - 8, neck_y))], False, 1, thickness=2)
        m = (m > 0) & (img[..., 3] >= 250)
        if alpha_scale is None:
            out[m, :3] = colour
        else:
            out[m, 3] = (out[m, 3] * alpha_scale).astype(np.uint8)
        return out

    # 1-2. neck seams: an opaque pale cut line, and a half-transparent gap on the same path
    cases["neck_seam_opaque"] = (seam_line(rest4), rest4, rest1, rj, "seam")
    cases["neck_seam_alpha"] = (seam_line(rest4, alpha_scale=0.5), rest4, rest1, rj, "see_through")
    # 3. ghost hand: the rest hand (past the wrist) copied at 45 % onto the right side of the shirt
    W = np.array(rj["leftForearm"][1])
    E = np.array(rj["leftForearm"][0])
    u = (W - E) / np.linalg.norm(W - E)
    hc = W + u * 30
    r = 40
    hx, hy = int(hc[0]), int(hc[1])
    patch = rest4[hy - r:hy + r, hx - r:hx + r].astype(np.float32)
    g = rest4.copy().astype(np.float32)
    tx, ty = 175, 420                                      # over the shirt, away from both arms
    pa = patch[..., 3:4] / 255.0 * 0.45
    dst = g[ty - r:ty + r, tx - r:tx + r]
    dst[..., :3] = dst[..., :3] * (1 - pa) + patch[..., :3] * pa
    cases["ghost_hand"] = (g.astype(np.uint8), rest4, rest1, rj, "ghost")
    # 4. hue shift of the whole frame by +15 deg in LCh
    cases["hue_shift"] = (hue_rotate(rest4, 15.0), rest4, rest1, rj, "holdout")
    # 5. swapped head: the head box of a separate Codex generation of the same character
    key = load(HERE / "fixtures" / "wave_key_4x.png")
    sw = rest4.copy()
    hb = C.box_mask(rest4.shape, face["head"], pad=20)
    sw[hb] = key[hb]
    cases["swapped_head"] = (sw, rest4, rest1, rj, "head_ssim")
    # 6. hole: a 10 px disc punched out of the skirt
    ho = rest4.copy()
    ho[C.LK.disk_mask(ho.shape, (250, 640), 10), 3] = 0
    cases["hole"] = (ho, rest4, rest1, rj, "holes")
    # 7. island: a 24x24 opaque piece of shirt floating in the background
    isl = rest4.copy()
    isl[880:904, 470:494] = rest4[380:404, 200:224]
    cases["island"] = (isl, rest4, rest1, rj, "islands")
    # 8. truncated limb: the distal 45 % of the raised forearm and the hand erased (wave peak frame)
    tr = wave4.copy()
    e, w = np.array(wj["leftForearm"][0]), np.array(wj["leftForearm"][1])
    cut = C.capsule(tr.shape, e + 0.55 * (w - e), w + (w - e) * 0.9, 30)
    tr[cut, 3] = 0
    cases["truncated_limb"] = (tr, wave4, wave1, wj, "limbs")
    # 9. halo: a 2 px pale key fringe around the legs and shoes
    ha = rest4.copy()
    sil = ha[..., 3] >= 16
    ring = cv2.dilate(sil.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ring &= ~sil
    ring[:800] = False
    ha[ring] = (245, 245, 245, 200)
    cases["halo"] = (ha, rest4, rest1, rj, "halo")
    # 10. a 1x twin that is not the 4x frame (wave peak 1x under the rest 4x)
    cases["agree_mismatch"] = (rest4, None, wave1, rj, "agree_4x_1x")

    shutil.rmtree(SEEDED, ignore_errors=True)
    out = {}
    for name, (f4, c4, c1, joints, expect) in cases.items():
        d = SEEDED / name
        for sub in ("4x", "1x"):
            (d / "rest" / sub).mkdir(parents=True, exist_ok=True)
            shutil.copy(CLEAN / "rest" / sub / "0000.png", d / "rest" / sub / "0000.png")
        if c4 is None:
            for sub, img in (("4x", f4), ("1x", c1)):
                (d / "seed" / sub).mkdir(parents=True, exist_ok=True)
                Image.fromarray(img).save(d / "seed" / sub / "0000.png")
        else:
            save_pair(d / "seed", "0000.png", f4, c4, c1)
        m = {"source": f"seeded case {name} (prove.py)", "scale": 4, "rest_joints": man["rest_joints"],
             "allowed_holes": man["allowed_holes"],
             "clips": {"seed": {"peak": 0, "head_views": [], "joints": {"0": joints}}}}
        (d / "manifest.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
        out[name] = expect
    return out


def run_checker(frames: Path, out: Path, likeness: bool) -> dict:
    shutil.rmtree(out, ignore_errors=True)
    cmd = [PY, "-I", str(HERE / "consistency.py"), "--frames", str(frames), "--out", str(out)]
    if not likeness:
        cmd.append("--no-likeness")
    p = subprocess.run(cmd, capture_output=True, text=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / "log.txt").write_text(p.stdout + "\n--- stderr\n" + p.stderr, encoding="utf-8")
    if p.returncode == 2 or not (out / "report.json").is_file():
        raise SystemExit(f"checker failed on {frames}: exit {p.returncode}\n{p.stderr[-2000:]}")
    return json.loads((out / "report.json").read_text(encoding="utf-8"))


def fails_of(rep: dict) -> set:
    s = set()
    for clip, v in rep["clips"].items():
        for f in v["frames"]:
            s |= {(clip, k) for k in f["fails"]}
        if not v["summary"]["likeness_peak"].get("pass"):
            s.add((clip, "likeness_peak"))
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-clean", action="store_true")
    a = ap.parse_args()
    man = json.loads((CLEAN / "manifest.json").read_text(encoding="utf-8"))
    face = C.rest_face(load(CLEAN / "rest" / "4x" / "0000.png"))
    expect = build_seeds(face, man)
    proof = {"checker_sha256": C.sha256(HERE / "consistency.py"), "seeds": {}, "ok": True}
    for name, check in expect.items():
        # the likeness harness runs only where a face defect is seeded; elsewhere it would add nothing
        lk = name in ("hue_shift", "swapped_head")
        rep = run_checker(SEEDED / name, RUNS / f"seed_{name}", lk)
        f = fails_of(rep)
        seed_fails = sorted(k for c, k in f if c == "seed")
        rest_fails = sorted(k for c, k in f if c == "rest")
        caught = check in seed_fails
        fr = rep["clips"]["seed"]["frames"][0]["checks"][check]
        row = {"intended": check, "caught": caught, "seed_frame_fails": seed_fails, "rest_fails": rest_fails,
               "evidence": {k: v for k, v in fr.items() if k not in ("bands",)}}
        if lk:
            row["likeness_seed"] = rep["clips"]["seed"]["summary"]["likeness_peak"]
        proof["seeds"][name] = row
        proof["ok"] &= caught
        print(f"seed {name}: intended {check} -> {'CAUGHT' if caught else 'MISSED'}; seed fails {seed_fails}", flush=True)
    if not a.skip_clean:
        rep = run_checker(CLEAN, RUNS / "r1_clean", True)
        f = fails_of(rep)
        unexpected = r1_unexpected(rep)
        proof["clean"] = {"fails": sorted(f), "unexpected": unexpected, "summary": rep["summary"],
                          "frames_failed": {c: v["summary"]["failed_frames_by_check"] for c, v in rep["clips"].items()}}
        fr = rep["clips"]
        by = {c: v["summary"]["failed_frames_by_check"] for c, v in fr.items()}
        real = {"wave forearm over sleeve (2, 18)": set(by["wave"].get("limbs", [])) >= WAVE_LIMB_R1,
                "wave elbow seam (5, 15)": set(by["wave"].get("see_through", [])) >= WAVE_SEAM_R1[0],
                "idle neck seam (any frame)": bool(by["idle"].get("see_through")),
                "iris hold-out (rest)": any(r["id"] == "holdout.iris.bright" and not r["pass"]
                                            for r in fr["rest"]["frames"][0]["checks"]["holdout"]["rows"])}
        proof["clean"]["r1_defects_reported"] = real
        proof["ok"] &= not unexpected and all(real.values())
        print("r1 defects reported:", real)
        print(f"clean r1: fails {sorted(f)}; unexpected {unexpected}")
    (HERE / "proof.json").write_text(json.dumps(proof, indent=1, default=str), encoding="utf-8")
    print("proof", "OK" if proof["ok"] else "FAILED")
    return 0 if proof["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

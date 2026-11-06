"""Sensitivity proof for the frozen likeness harness.

Builds perturbed copies of the reference (and of one reference-v4 body frame), runs likeness.py
on each case through its frozen CLI in a subprocess, and checks that each perturbation is flagged
by the metric meant to catch it. Writes artifacts/sensitivity.json and prints a table.
Rerun: tools/skins/ai2d/.venv/Scripts/python.exe tools/skins/ai2d/harness/run_sensitivity.py
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from skimage.color import deltaE_ciede2000

import likeness as K

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REF = ROOT / "references/character/face-reference.png"
V4 = ROOT / ".cache/render3d/reference-v4/frames"
ART = HERE / "artifacts"
PERT = ART / "perturb"
PY = HERE / ".venv/Scripts/python.exe"


def save(rgb: np.ndarray, name: str) -> Path:
    p = PERT / name
    Image.fromarray(rgb).save(p)
    return p


def ref_info():
    rgb = K.over(K.load_rgba(REF))
    kp = K.keypoints_from_mesh(K.detect_mesh(rgb))
    lab = K.lab_of(rgb)
    cols, _ = K.palette(rgb, lab, kp)
    return rgb, lab, kp, cols


def hair_hue(rgb, lab, kp, cols, deg=25.0):
    d = K.derived(kp)
    H, W = rgb.shape[:2]
    de_hair = deltaE_ciede2000(lab, np.broadcast_to(cols["hair"][0], lab.shape))
    de_skin = deltaE_ciede2000(lab, np.broadcast_to(cols["skin"][0], lab.shape))
    oval = np.zeros((H, W), np.uint8)
    L = K.detect_mesh(rgb)
    cv2.fillPoly(oval, [np.round(L[K.OVAL]).astype(np.int32)], 1)
    yy, xx = np.mgrid[:H, :W]
    box = ((xx > kp["face_l"][0] - 0.4 * d["fw"]) & (xx < kp["face_r"][0] + 0.4 * d["fw"]) &
           (yy > d["eye_y"] - 1.6 * d["h"]) & (yy < kp["chin"][1] + 0.3 * d["h"]))
    face_below_brow = (oval > 0) & (yy > kp["brow_y"])
    m = (box & (de_hair < 22) & (de_skin > 8) & ~face_below_brow).astype(np.float32)
    m = cv2.GaussianBlur(m, (0, 0), 1.5)[..., None]
    hsv = cv2.cvtColor(rgb.astype(np.float32) / 255, cv2.COLOR_RGB2HSV)
    hsv[..., 0] = (hsv[..., 0] + deg) % 360
    shifted = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB) * 255
    return np.clip(m * shifted + (1 - m) * rgb, 0, 255).astype(np.uint8), m[..., 0]


def eyes_scaled(rgb, kp, f=1.3):
    out = rgb.astype(np.float32)
    H, W = rgb.shape[:2]
    yy, xx = np.mgrid[:H, :W]
    for ck in ("eye_l_corners", "eye_r_corners"):
        c0, c1 = np.array(kp[ck], float)
        c = (c0 + c1) / 2
        ew = float(np.linalg.norm(c1 - c0))
        M = cv2.getRotationMatrix2D((float(c[0]), float(c[1])), 0, f)
        warped = cv2.warpAffine(rgb, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
        t = np.sqrt(((xx - c[0]) / (0.8 * ew)) ** 2 + ((yy - c[1]) / (0.4 * ew)) ** 2)
        m = np.clip((1.0 - t) / 0.15, 0, 1)[..., None]
        out = m * warped + (1 - m) * out
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def fringe_cut(rgb, lab, kp, cols):
    """Paint forehead skin over every not-skin pixel from 0.30 face heights above the brow line
    down to just below it, across the face: the fringe now ends well above the brows."""
    from skimage.color import lab2rgb
    d = K.derived(kp)
    H, W = rgb.shape[:2]
    yy, xx = np.mgrid[:H, :W]
    skin = cols["skin"][0]
    de = deltaE_ciede2000(lab, np.broadcast_to(skin, lab.shape))
    region = ((yy > kp["brow_y"] - 0.30 * d["h"]) & (yy < kp["brow_y"] + 0.04 * d["h"]) &
              (xx > kp["face_l"][0] + 0.08 * d["fw"]) & (xx < kp["face_r"][0] - 0.08 * d["fw"]))
    m = cv2.GaussianBlur((region & (de > 6)).astype(np.float32), (0, 0), 2.0)[..., None]
    skin_rgb = np.clip(lab2rgb(skin[None, None, :]) * 255, 0, 255)
    rng = np.random.default_rng(0)
    fill = skin_rgb + rng.normal(0, 2.0, rgb.shape)
    return np.clip(m * fill + (1 - m) * rgb, 0, 255).astype(np.uint8)


def run_case(name: str, cand: Path, body: list[Path] | None = None, extra: list[str] | None = None) -> dict:
    out = ART / "cases" / name
    cmd = [str(PY), str(HERE / "likeness.py"), "--ref", str(REF), "--cand", str(cand), "--out", str(out)]
    if body:
        cmd += ["--body", *map(str, body)]
    cmd += extra or []
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE)
    line = [l for l in p.stdout.splitlines() if l.startswith("likeness")]
    print(f"[{name}] exit {p.returncode}: {line[-1] if line else p.stderr[-400:]}")
    res = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    res["_exit"] = p.returncode
    return res


def by_id(res):
    return {m["id"]: m for m in res["metrics"]}


def main() -> int:
    PERT.mkdir(parents=True, exist_ok=True)
    rgb, lab, kp, cols = ref_info()
    d = K.derived(kp)
    # perturbations of the reference face
    noisy = {
        "noise_half": save(cv2.resize(rgb, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), "ref_half.png"),
        "noise_shift": save(rgb[int(0.05 * rgb.shape[0]):, int(0.05 * rgb.shape[1]):], "ref_shift5.png"),
    }
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "JPEG", quality=75)
    noisy["noise_jpeg75"] = save(np.array(Image.open(buf).convert("RGB")), "ref_jpeg75.png")
    hh, hmask = hair_hue(rgb, lab, kp, cols)
    save((hmask * 255).astype(np.uint8), "mask_hair_hue.png")
    pert = {"hair_hue_plus25": save(hh, "ref_hair_hue25.png"),
            "eyes_scaled_1p3": save(eyes_scaled(rgb, kp), "ref_eyes1p3.png")}
    lenses = K.find_lenses(rgb, kp)
    go, gmask = K.glasses_out(rgb, lenses, d["iod"])
    save((gmask * 255).astype(np.uint8), "mask_glasses_out.png")
    pert["glasses_painted_out"] = save(go, "ref_glasses_out.png")
    pert["fringe_cut"] = save(fringe_cut(rgb, lab, kp, cols), "ref_fringe_cut.png")

    expected = {"hair_hue_plus25": ["palette.hair"],
                "eyes_scaled_1p3": ["geometry.eye_width_over_face_width"],
                "glasses_painted_out": ["geometry.glasses_rim_diameter_over_face_width"],
                "fringe_cut": ["geometry.fringe_minus_brow_over_face_height"]}
    results = {"self": run_case("self", REF)}
    for k, p in noisy.items():
        results[k] = run_case(k, p)
    for k, p in pert.items():
        results[k] = run_case(k, p)

    # v4 baseline, and legibility perturbations on the v4 rest frame
    v4face, v4rest = V4 / "face_neutral.png", V4 / "rest.png"
    results["baseline_v4"] = run_case("baseline_v4", v4face, [v4rest])
    cinfo = K.analyse_face(v4face, None, "v4")
    rgba = K.load_rgba(v4rest)
    bf = K.body_face(rgba, None, K.lens_model(cinfo))
    biod = float(np.linalg.norm(np.subtract(bf["eye_r"], bf["eye_l"])))
    body_rgb = rgba[..., :3].copy()
    out_rgb, _ = K.glasses_out(body_rgb, bf["glasses"], biod, band_frac=0.06)
    Image.fromarray(np.dstack([out_rgb, rgba[..., 3]])).save(PERT / "rest_glasses_out.png")
    painted = body_rgb.copy()
    for e in (bf["eye_l"], bf["eye_r"]):
        x, y = int(round(e[0])), int(round(e[1] + 0.6 * biod))
        skin = np.median(body_rgb[y - 1:y + 2, x - 1:x + 2].reshape(-1, 3), axis=0)
        cv2.ellipse(painted, (int(round(e[0])), int(round(e[1]))), (max(2, int(0.32 * biod)), max(1, int(0.16 * biod))),
                    0, 0, 360, tuple(int(v) for v in skin), -1)
    Image.fromarray(np.dstack([painted, rgba[..., 3]])).save(PERT / "rest_eyes_painted.png")
    results["body_glasses_out"] = run_case("body_glasses_out", v4face, [PERT / "rest_glasses_out.png"])
    results["body_eyes_painted"] = run_case("body_eyes_painted", v4face, [PERT / "rest_eyes_painted.png"])
    expected["body_glasses_out"] = ["legibility.glasses.rest_glasses_out"]
    expected["body_eyes_painted"] = ["legibility.eyes.rest_eyes_painted"]

    # probe mode: a faithful probe must reproduce the mesh numbers; a wrong one must be rejected
    cinfo_kp = {k: v for k, v in cinfo["kp"].items() if not k.startswith("_")}
    good = dict(cinfo_kp, glasses={s: {k: cinfo["lenses"][s][k] for k in ("cx", "cy", "rx", "ry")} for s in "lr"},
                fringe_y=cinfo["fringe_y"])
    (PERT / "probe_good.json").write_text(json.dumps(good, indent=1), encoding="utf-8")
    cd = K.derived(cinfo["kp"])
    bad = dict(good, eye_l=[cd["el"][0], cd["eye_y"] - 0.45 * cd["h"]], eye_r=[cd["er"][0], cd["eye_y"] - 0.45 * cd["h"]],
               mouth_l=[cd["ml"][0], cd["ml"][1] + 0.3 * cd["h"]], mouth_r=[cd["mr"][0], cd["mr"][1] + 0.3 * cd["h"]])
    bad.pop("eye_l_lids"), bad.pop("eye_r_lids")
    (PERT / "probe_bad.json").write_text(json.dumps(bad, indent=1), encoding="utf-8")
    results["probe_good"] = run_case("probe_good", v4face, None, ["--probe", str(PERT / "probe_good.json"), "--mode", "probe"])
    results["probe_bad"] = run_case("probe_bad", v4face, None, ["--probe", str(PERT / "probe_bad.json"), "--mode", "probe"])

    # verdicts
    table, problems = [], []
    noise_floor = {}
    for name in ("self", *noisy):
        r = results[name]
        if r["summary"]["failed"]:
            problems.append(f"{name}: expected no failures, got {r['summary']['failed_ids']}")
        for mid, m in by_id(r).items():
            if m["value"] is not None:
                noise_floor[mid] = max(noise_floor.get(mid, 0.0), abs(m["value"]))
    for name, ids in expected.items():
        r = results[name]
        failed = set(r["summary"]["failed_ids"])
        missing = [i for i in ids if i not in failed]
        if missing:
            problems.append(f"{name}: expected flag {missing} not raised (failed: {sorted(failed)})")
        base = set(results["baseline_v4"]["summary"]["failed_ids"]) if name.startswith("body") else set()
        collateral = sorted(failed - set(ids) - base)
        table.append({"case": name, "expected": ids, "flagged": sorted(failed), "collateral": collateral,
                      "values": {i: by_id(r)[i]["value"] for i in ids}})
    pg, base = by_id(results["probe_good"]), by_id(results["baseline_v4"])
    probe_dev = {i: abs(pg[i]["value"] - base[i]["value"]) for i in pg
                 if i in base and pg[i]["value"] is not None and base[i]["value"] is not None}
    if results["probe_good"]["summary"]["cand_mode"] != "probe":
        problems.append(f"probe_good ran as {results['probe_good']['summary']['cand_mode']}")
    if any(v > 1e-6 for k, v in probe_dev.items() if k != "palette.lips"):  # probe lips are ellipses, mesh lips a polygon
        problems.append(f"probe_good differs from mesh baseline: {probe_dev}")
    pb = results["probe_bad"]["summary"]
    if "UNVALIDATED" not in pb["cand_mode"] or pb["pass"]:
        problems.append(f"probe_bad was not rejected: mode {pb['cand_mode']}, pass {pb['pass']}")
    summary = {
        "probe_good_max_dev_vs_mesh": probe_dev,
        "probe_bad": {"mode": pb["cand_mode"], "pass": pb["pass"],
                      "attempts": results["probe_bad"]["cand"]["attempts"]},
        "cases": len(results),
        "metrics_ran_per_case": {k: f"{v['summary']['metrics_ran']}/{v['summary']['metrics_total']}" for k, v in results.items()},
        "errors_per_case": {k: v["summary"]["failed"] for k, v in results.items()},
        "noise_floor_abs": noise_floor,
        "perturbations": table,
        "baseline_v4": {m["id"]: {"value": m["value"], "pass": m["pass"], "ref": m.get("ref"), "cand": m.get("cand")}
                        for m in results["baseline_v4"]["metrics"]},
        "problems": problems,
        "ok": not problems,
    }
    (ART / "sensitivity.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print("\nnoise floor (max |value| over self + 3 noisy copies):")
    for k, v in noise_floor.items():
        print(f"  {k:60s} {v:.4f}")
    print("\nperturbations:")
    for t in table:
        print(f"  {t['case']:22s} expected {t['expected']} -> {'FLAGGED' if all(i in t['flagged'] for i in t['expected']) else 'MISSED'}"
              f"  values {{{', '.join(f'{k}: {v if v is None else round(v, 3)}' for k, v in t['values'].items())}}}"
              f"  collateral {t['collateral']}")
    print("\nerrors per case:", summary["errors_per_case"])
    print("metrics ran per case:", summary["metrics_ran_per_case"])
    print("probe_good |value - mesh baseline|:", {k: round(v, 6) for k, v in probe_dev.items()})
    print("probe_bad:", summary["probe_bad"])
    print("problems:", problems or "none")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())

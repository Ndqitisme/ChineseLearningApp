"""Generates an offline voice pack (female + male) for every dataset word with Kokoro-82M via sherpa-onnx. The app ships no audio.

Setup: pip install sherpa-onnx==2.0.1 lameenc, then extract kokoro-multi-lang-v1_0.tar.bz2 from the sherpa-onnx tts-models release.
Usage: python tools/voicepack/make_pack.py --model .cache/sources/tts/kokoro-multi-lang-v1_0 --out voicepack [--limit 20] [--examples]
"""
import argparse
import json
import pathlib
import sys
import time

import lameenc
import sherpa_onnx

ROOT = pathlib.Path(__file__).resolve().parents[2]
# Speaker ids of the zh voices in kokoro-multi-lang-v1_0. The author grades them "D",
# so audition a sample before a full run.
VOICES = {"zf_xiaobei": 45, "zf_xiaoni": 46, "zf_xiaoxiao": 47, "zf_xiaoyi": 48,
          "zm_yunjian": 49, "zm_yunxi": 50, "zm_yunxia": 51, "zm_yunyang": 52}
UNSAFE = set('<>:"/\\|?*')


def make_tts(model: pathlib.Path) -> sherpa_onnx.OfflineTts:
    kokoro = sherpa_onnx.OfflineTtsKokoroModelConfig(
        model=str(model / "model.onnx"), voices=str(model / "voices.bin"), tokens=str(model / "tokens.txt"),
        lexicon=f"{model / 'lexicon-us-en.txt'},{model / 'lexicon-zh.txt'}")
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(kokoro=kokoro, num_threads=4),
        rule_fsts=",".join(str(p) for p in model.glob("*-zh.fst")))
    if not config.validate():
        raise SystemExit(f"invalid model folder: {model}")
    return sherpa_onnx.OfflineTts(config)


def trim(samples, rate, threshold=0.01, pad_ms=60):
    """Cut leading/trailing silence so a clip starts the moment the button is pressed."""
    idx = [i for i, s in enumerate(samples) if abs(s) > threshold]
    if not idx:
        return samples
    pad = int(rate * pad_ms / 1000)
    return samples[max(0, idx[0] - pad): idx[-1] + pad]


def to_mp3(samples, rate) -> bytes:
    pcm = b"".join(int(max(-1.0, min(1.0, s)) * 32767).to_bytes(2, "little", signed=True) for s in samples)
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode(pcm) + enc.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--female", default="zf_xiaoyi", choices=[v for v in VOICES if v.startswith("zf")])
    ap.add_argument("--male", default="zm_yunjian", choices=[v for v in VOICES if v.startswith("zm")])
    ap.add_argument("--speed", type=float, default=0.9)
    ap.add_argument("--limit", type=int, default=0, help="only the first N texts (for auditioning)")
    ap.add_argument("--examples", action="store_true", help="also voice the example sentences")
    args = ap.parse_args()

    dataset = json.loads((ROOT / "src" / "generated" / "dataset.json").read_text(encoding="utf-8"))
    texts = [w["hanzi"] for w in dataset["words"]]
    if args.examples:
        texts += [w["ex"]["zh"] for w in dataset["words"] if w.get("ex")]
    texts = [t for t in dict.fromkeys(texts) if not (set(t) & UNSAFE)]
    if args.limit:
        texts = texts[: args.limit]

    tts = make_tts(args.model)
    started = time.time()
    for slot, voice in (("female", args.female), ("male", args.male)):
        folder = args.out / slot
        folder.mkdir(parents=True, exist_ok=True)
        for i, text in enumerate(texts):
            target = folder / f"{text}.mp3"
            if target.exists():
                continue  # resumable: rerun after an interruption
            audio = tts.generate(text, sid=VOICES[voice], speed=args.speed)
            if not audio.samples:
                print(f"!! no audio for {text} ({voice})", file=sys.stderr)
                continue
            tmp = target.with_suffix(".tmp")
            tmp.write_bytes(to_mp3(trim(audio.samples, audio.sample_rate), audio.sample_rate))
            tmp.replace(target)
            if i % 100 == 0:
                print(f"{slot}: {i + 1}/{len(texts)}  {time.time() - started:.0f}s", flush=True)

    manifest = {
        "name": f"Kokoro ({args.female} / {args.male})",
        "license": "Kokoro-82M Apache-2.0 · sherpa-onnx Apache-2.0",
        "format": "mp3",
        "voices": {"female": "female", "male": "male"},
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done: {len(texts)} texts x 2 voices in {time.time() - started:.0f}s -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

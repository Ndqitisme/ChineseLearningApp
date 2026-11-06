#!/usr/bin/env bash
# usage: codex_gen.sh <name> <input.png> <prompt.txt>
#   one Codex image generation -> gen/<name>/<name>.png, copied to src/<name>.png
# Logs prompt file, input file (with sha256) and output to generations.log. Refuses once the log holds CODEX_BUDGET
# GEN lines (default 30), so a loop cannot spend the account's image quota.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(dirname "$here")"
name="$1"; input="$2"; prompt="$3"
fig="$root/../../../../references/character/figure-outfit-reference.png"
if [ -f "$fig" ] && [ "$(sha256sum < "$input")" = "$(sha256sum < "$fig")" ]; then echo "refusing: figure photo" >&2; exit 2; fi
out="$here/$name"; mkdir -p "$out"
cp "$input" "$out/input.png"; cp "$prompt" "$out/prompt.txt"
n=$(grep -c '^GEN ' "$root/generations.log" 2>/dev/null || true)
if [ "${n:-0}" -ge "${CODEX_BUDGET:-30}" ]; then echo "budget exhausted ($n)" >&2; exit 3; fi
{ echo "GEN $(date -Iseconds) name=$name input=$(basename "$input") input_sha256=$(sha256sum < "$input" | cut -c1-16) prompt=gen/$(basename "$prompt")"; } >> "$root/generations.log"
codex exec --skip-git-repo-check -s workspace-write -C "$out" -i "$out/input.png" -o "$out/codex-last.txt" - < "$out/prompt.txt" > "$out/codex.log" 2>&1 || true
png="$(ls "$out"/*.png 2>/dev/null | grep -v '/input.png$' | head -1 || true)"
if [ -z "$png" ]; then echo "  -> $name FAILED (no png; see gen/$name/codex.log)" >> "$root/generations.log"; exit 1; fi
cp "$png" "$root/src/$name.png"
echo "  -> $name output=src/$name.png sha256=$(sha256sum < "$png" | cut -c1-16) " >> "$root/generations.log"

#!/usr/bin/env bash
# usage: codex_gen.sh <name> <prompt.txt> <input1.png> [input2.png ...]
#   one Codex image generation -> inbetween/gen/<name>/<name>.png, copied to inbetween/src/<name>.png.
# Same recipe as art/keyposes/gen/codex_gen2.sh: every call is logged in art/generations.log, a call is refused once
# that log holds CODEX_BUDGET GEN lines (default 30), and the figure photo is refused.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; ib="$(dirname "$here")"; art="$ib/../../art"
name="$1"; prompt="$2"; shift 2
fig="$ib/../../../../../references/character/figure-outfit-reference.png"
out="$here/$name"
if [ -e "$out/codex.log" ]; then t=1; while [ -e "$here/${name}_try$t" ]; do t=$((t+1)); done; mv "$out" "$here/${name}_try$t"; fi
mkdir -p "$out"; cp "$prompt" "$out/prompt.txt"
args=(); names=(); i=0
for f in "$@"; do
  if [ -f "$fig" ] && [ "$(sha256sum < "$f")" = "$(sha256sum < "$fig")" ]; then echo "refusing: figure photo" >&2; exit 2; fi
  i=$((i+1)); cp "$f" "$out/input$i.png"; args+=(-i "$out/input$i.png")
  names+=("$(basename "$f"):$(sha256sum < "$f" | cut -c1-16)")
done
n=$(grep -c '^GEN ' "$art/generations.log" 2>/dev/null || true)
if [ "${n:-0}" -ge "${CODEX_BUDGET:-30}" ]; then echo "budget exhausted ($n)" >&2; exit 3; fi
echo "GEN $(date -Iseconds) name=$name inputs=${names[*]} prompt=../rig/inbetween/gen/$(basename "$prompt")" >> "$art/generations.log"
codex exec --skip-git-repo-check -s workspace-write -C "$out" "${args[@]}" -o "$out/codex-last.txt" - < "$out/prompt.txt" > "$out/codex.log" 2>&1 || true
png="$(ls "$out"/*.png 2>/dev/null | grep -v '/input[0-9]*.png$' | head -1 || true)"
if [ -z "$png" ]; then echo "  -> $name FAILED (no png; see ../rig/inbetween/gen/$name/codex.log)" >> "$art/generations.log"; exit 1; fi
cp "$png" "$ib/src/$name.png"
{ echo "## PROMPT $name (inputs ../rig/inbetween/gen/$name/input*.png)"; sed 's/^/  /' "$out/prompt.txt"; } >> "$art/generations.log"
echo "  -> $name output=../rig/inbetween/src/$name.png sha256=$(sha256sum < "$png" | cut -c1-16)" >> "$art/generations.log"

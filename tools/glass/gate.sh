#!/bin/bash
# Full glass verification sweep: contrast and non-text in all glass modes, states, prove, idle, svelte-check and vitest,
# with up to 3 Chrome jobs at once under a memory watchdog, and one PASS/FAIL summary.
# Usage: bash gate.sh [--resume] [--shoot] [--label NAME] [--pages a,b] [--dry-run]
#   --resume     with the same --label, keep jobs that finished with exit 0 and run only the rest
#   --shoot      archive GLASS/final to GLASS/final-NAME, reshoot all shots into GLASS/final first (alone)
#   --label      name of the run (default: date and time); results go to GLASS/gate-NAME/
#   --pages      limit contrast and states to these pages: a hash (#/tones), a route name (tones), or home (#/)
#   --dry-run    print the job list and commands, run nothing
set -u
export MSYS_NO_PATHCONV=1
T=$(cd "$(dirname "$0")" && pwd -W)
R=$(cd "$T/../.." && pwd -W)
G=$R/.cache/glass
mkdir -p "$G"
USAGE="usage: bash gate.sh [--resume] [--shoot] [--label NAME] [--pages a,b] [--dry-run]"

RESUME=0 SHOOT=0 DRY=0 LABEL=$(date +%Y%m%d-%H%M) PAGES_ARG=''
while [ $# -gt 0 ]; do
  case $1 in
    --shoot) SHOOT=1 ;;
    --dry-run) DRY=1 ;;
    --resume) RESUME=1 ;;
    --label) LABEL=${2:?--label needs a name}; shift ;;
    --pages) PAGES_ARG=${2:?--pages needs a list}; shift ;;
    -h|--help) echo "$USAGE"; exit 0 ;;
    *) echo "unknown option $1"; echo "$USAGE"; exit 2 ;;
  esac
  shift
done
[[ $LABEL =~ ^[A-Za-z0-9._-]+$ ]] || { echo "label may use letters, digits, . _ - only"; exit 2; }
OUT=$G/gate-$LABEL

MAX_CHROME=2
NEED_MB=3000        # free physical and commit before a Chrome job starts
KILL_MB=2000        # watchdog kills a job's tree under this
MEM_WAIT_S=1800     # limit for each wait for free memory
MAX_RETRIES=3

# The harness closes itself after 25 min; with 3 jobs at once a 4-combo contrast
# batch may pass that, so split a batch here if its log ends in "deadline: closing".
CONTRAST_BATCHES=(
  "a sakura-light,sakura-dark"
  "b matcha-light,matcha-dark"
  "c boba-light,boba-dark"
  "d ocean-light,ocean-dark"
  "e night-light,night-dark"
)
NONTEXT_BATCHES=(
  "a sakura-light,sakura-dark,matcha-light"
  "b matcha-dark,boba-light,boba-dark"
  "c ocean-light,ocean-dark"
  "d night-light,night-dark"
)

# Tools match pages by exact hash, so "tones" becomes "#/tones" and "home" becomes "#/".
PAGE_HASHES=''
if [ -n "$PAGES_ARG" ]; then
  for p in ${PAGES_ARG//,/ }; do
    case $p in '#'*) h=$p ;; home) h='#/' ;; *) h="#/$p" ;; esac
    PAGE_HASHES+=${PAGE_HASHES:+,}$h
  done
fi

# Job table: name | kind (chrome, plain) | time limit s | summary parser | command (run with eval, ends in exec).
NAMES=() KINDS=() LIMITS=() PARSERS=() CMDS=()
add() { NAMES+=("$1"); KINDS+=("$2"); LIMITS+=("$3"); PARSERS+=("$4"); CMDS+=("$5"); }
q() { printf '%q' "$1"; }

# Longest jobs first, so the short ones fill the slots at the end.
for g in refract fallback reduced; do
  for b in "${CONTRAST_BATCHES[@]}"; do
    set -- $b
    add "contrast-$g-$1" chrome 2400 contrast \
      "PAGES_ONLY=$(q "$PAGE_HASHES") ONLY=$2 GLASS=$g exec node $T/contrast.mjs $OUT/contrast-$g-$1.json"
  done
done
for g in refract fallback reduced; do
  for b in "${NONTEXT_BATCHES[@]}"; do
    set -- $b
    add "nontext-$g-$1" chrome 2400 nontext "ONLY=$2 GLASS=$g exec node $T/nontext.mjs $OUT/nontext-$g-$1.json"
  done
done
for c in ocean-light ocean-dark night-dark; do
  if [ -n "$PAGE_HASHES" ]; then pages="PAGES=$(q "$PAGE_HASHES") "; else pages=''; fi
  add "states-$c" chrome 3600 states "${pages}ONLY=$c exec node $T/states.mjs $OUT/states-$c.json"
done
add idle chrome 600 idle "exec node $T/idle.mjs"
for tm in "ocean light" "ocean dark" "night dark" "sakura light"; do
  add "prove-${tm// /-}" chrome 900 prove "exec node $T/prove.mjs $tm"
done
add check plain 600 check "exec pnpm --ignore-workspace check"
add vitest plain 600 vitest "exec pnpm --ignore-workspace vitest run src/lib"
SHOOT_CMD="exec node $T/shoot.mjs $G/final"

if [ $DRY -eq 1 ]; then
  echo "$USAGE"
  echo "label $LABEL, logs in $OUT/, pages: ${PAGE_HASHES:-all} (contrast and states only)"
  [ $SHOOT -eq 1 ] && { echo; echo "first, alone: archive $G/final -> $G/final-$LABEL, then"; echo "  shoot  chrome 1500 s  cd $G && $SHOOT_CMD"; }
  echo; echo "then up to $MAX_CHROME Chrome jobs at once, plain jobs alongside:"
  for i in "${!NAMES[@]}"; do
    dir=$G; [ "${KINDS[$i]}" = plain ] && dir=$R
    printf '%2d  %-22s %-6s %5s s  cd %s && %s\n' $((i + 1)) "${NAMES[$i]}" "${KINDS[$i]}" "${LIMITS[$i]}" "${dir/$G/GLASS}" "${CMDS[$i]//$G/GLASS}"
  done
  echo; echo "(GLASS = $G)"
  exit 0
fi

[ -e "$OUT" ] && [ $RESUME -eq 0 ] && { echo "$OUT exists; pick another --label"; exit 1; }
mkdir -p "$OUT"
LOG=$OUT/gate.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

# Free physical and commit memory in MB.
status() { powershell -NoProfile -Command "\$o = Get-CimInstance Win32_OperatingSystem; '{0} {1}' -f [int](\$o.FreePhysicalMemory/1024), [int](\$o.FreeVirtualMemory/1024)" | tr -d '\r'; }
# wait_mem <tag>: returns 1 when MEM_WAIT_S passes without both reaching NEED_MB.
wait_mem() {
  local t0=$SECONDS first=1 phys virt
  while :; do
    read phys virt < <(status)
    if [ "${phys:-0}" -ge $NEED_MB ] && [ "${virt:-0}" -ge $NEED_MB ]; then
      [ $first -eq 0 ] && say "$1: memory clear after $((SECONDS - t0)) s (physical $phys MB, commit $virt MB)"
      return 0
    fi
    [ $first -eq 1 ] && say "$1: waiting for memory: physical ${phys:-?} MB, commit ${virt:-?} MB (need $NEED_MB of each)"
    first=0
    if [ $((SECONDS - t0)) -ge $MEM_WAIT_S ]; then say "$1: memory wait limit $MEM_WAIT_S s hit (physical ${phys:-?} MB, commit ${virt:-?} MB)"; return 1; fi
    sleep 10
  done
}

# run_job <i>: runs job i (or the shoot step when i is "shoot") in the background caller's subshell, with the watchdog
# for Chrome jobs; writes OUT/.res-<name>: rc seconds attempts note. The first memory wait for a Chrome job is done by
# the scheduler before it starts this.
run_job() {
  local name kind limit cmd dir
  if [ "$1" = shoot ]; then name=shoot kind=chrome limit=1500 cmd=$SHOOT_CMD
  else name=${NAMES[$1]} kind=${KINDS[$1]} limit=${LIMITS[$1]} cmd=${CMDS[$1]}; fi
  dir=$G; [ "$kind" = plain ] && dir=$R
  local tries=0 t0=$SECONDS rc note='' pid wpid tstart killed phys virt
  while :; do
    say "== $name (attempt $((tries + 1)))"
    ( cd "$dir" && eval "$cmd" ) > "$OUT/$name.log" 2>&1 &
    pid=$!; sleep 1; wpid=$(cat /proc/$pid/winpid 2>/dev/null)
    echo "$wpid" > "$OUT/.pid-$name"
    tstart=$SECONDS killed=0
    while kill -0 $pid 2>/dev/null; do
      sleep 5
      if [ $((SECONDS - tstart)) -gt $limit ]; then
        taskkill /T /F /PID $wpid > /dev/null 2>&1; wait $pid 2>/dev/null
        rc=124 note="time limit $limit s: killed"; killed=2; break
      fi
      [ "$kind" = plain ] && continue
      read phys virt < <(status)
      if [ "${phys:-0}" -lt $KILL_MB ] || [ "${virt:-0}" -lt $KILL_MB ]; then
        say "$name: watchdog: physical ${phys:-?} MB, commit ${virt:-?} MB: killing tree (Windows PID $wpid)"
        # One slash per switch: MSYS_NO_PATHCONV=1 passes "//T" through unchanged and taskkill rejects it.
        taskkill /T /F /PID $wpid > /dev/null 2>&1; wait $pid 2>/dev/null
        killed=1; break
      fi
    done
    rm -f "$OUT/.pid-$name"
    if [ $killed -eq 0 ]; then wait $pid; rc=$?; break; fi
    [ $killed -eq 2 ] && break
    tries=$((tries + 1))
    if [ $tries -gt $MAX_RETRIES ]; then rc=137 note="killed by the watchdog $tries times"; break; fi
    if ! wait_mem "$name retry"; then rc=125 note="memory wait limit hit before retry $tries"; break; fi
    say "$name: retry $tries of $MAX_RETRIES"
  done
  say "$name: exit $rc after $((SECONDS - t0)) s${note:+ ($note)}"
  echo "$rc $((SECONDS - t0)) $((tries + 1)) $note" > "$OUT/.res-$name"
}

RUNNERS=()
cleanup() {
  local f
  for f in "$OUT"/.pid-*; do
    [ -e "$f" ] || continue
    [ -n "$(cat "$f")" ] && taskkill /T /F /PID "$(cat "$f")" > /dev/null 2>&1
    rm -f "$f"
  done
  [ ${#RUNNERS[@]} -gt 0 ] && kill "${RUNNERS[@]}" 2>/dev/null
}
trap 'say "interrupted"; cleanup; exit 130' INT TERM

TMPW=$(node -e "process.stdout.write(require('os').tmpdir().replace(/\\\\/g, '/'))")
PROFILES_BEFORE=$(ls -d "$TMPW"/tieumai-glass-* 2>/dev/null)

say "gate $LABEL: shoot $SHOOT, pages ${PAGE_HASHES:-all}, ${#NAMES[@]} jobs"
if [ $SHOOT -eq 1 ]; then
  [ -e "$G/final-$LABEL" ] && { say "$G/final-$LABEL exists, not overwriting"; exit 1; }
  if [ -d "$G/final" ]; then
    mv "$G/final" "$G/final-$LABEL" || { say "archive failed"; exit 1; }
    say "archived: final-$LABEL has $(ls "$G/final-$LABEL" | grep -c '\.png$') shots"
  fi
  if wait_mem shoot; then run_job shoot
  else echo "125 0 0 memory wait limit hit" > "$OUT/.res-shoot"; fi
fi

MEM_GIVEUP=0 CHROME_PIDS=()
alive_chrome() { local n=0 p; for p in "${CHROME_PIDS[@]}"; do kill -0 $p 2>/dev/null && n=$((n + 1)); done; echo $n; }
# --resume: keep jobs that already finished with exit 0 in OUT; run the rest.
done_ok() { [ $RESUME -eq 1 ] && [ -f "$OUT/.res-$1" ] && [ "$(cut -d' ' -f1 "$OUT/.res-$1")" = 0 ]; }
for i in "${!NAMES[@]}"; do
  done_ok "${NAMES[$i]}" && { say "${NAMES[$i]}: kept from the earlier run"; continue; }
  [ "${KINDS[$i]}" = plain ] && { run_job $i & RUNNERS+=($!); }
done
for i in "${!NAMES[@]}"; do
  [ "${KINDS[$i]}" = chrome ] || continue
  done_ok "${NAMES[$i]}" && continue
  if [ $MEM_GIVEUP -eq 1 ]; then echo "125 0 0 not started: an earlier memory wait hit its limit" > "$OUT/.res-${NAMES[$i]}"; continue; fi
  while [ "$(alive_chrome)" -ge $MAX_CHROME ]; do sleep 5; done
  if ! wait_mem "${NAMES[$i]}"; then
    MEM_GIVEUP=1; echo "125 0 0 memory wait limit hit" > "$OUT/.res-${NAMES[$i]}"; continue
  fi
  run_job $i & RUNNERS+=($!) CHROME_PIDS+=($!)
  # Let each Chrome start and take its memory before the next free-memory check.
  sleep 20
done
wait
cleanup

# Profiles a killed job left behind; skip any a running Chrome still uses (another agent's run).
INUSE=$(powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { \$_.CommandLine }" | tr -d '\r' | grep -o 'tieumai-glass-[A-Za-z0-9]*' | sort -u)
removed=0
for d in $(ls -d "$TMPW"/tieumai-glass-* 2>/dev/null); do
  grep -qxF "$d" <<< "$PROFILES_BEFORE" && continue
  grep -qxF "$(basename "$d")" <<< "$INUSE" && continue
  rm -rf "$d" && removed=$((removed + 1))
done
say "removed $removed leftover profile folders"

# Summary: the tool's own count line; N = what was measured, M = what failed.
summary_line() { # parser log -> "N M line" or empty
  local s
  s=$(sed 's/\x1b\[[0-9;]*m//g' "$2" 2>/dev/null)
  case $1 in
    contrast) grep -E '^[0-9]+ runs measured, [0-9]+ below threshold' <<< "$s" | tail -1 | awk '{print $1, $4, $0}' ;;
    nontext) grep -E '^[0-9]+ non-text checks, [0-9]+ below 3:1' <<< "$s" | tail -1 | awk '{print $1, $4, $0}' ;;
    states) grep -E '^[0-9]+ samples, [0-9]+ with problems' <<< "$s" | tail -1 | awk '{print $1, $3, $0}' ;;
    shoot) grep -E '^[0-9]+ screenshots in .*console errors in [0-9]+ contexts' <<< "$s" | tail -1 | sed -E 's/^([0-9]+) .*errors in ([0-9]+) contexts$/\1 \2 &/' ;;
    check) grep -E 'COMPLETED [0-9]+ FILES [0-9]+ ERRORS' <<< "$s" | tail -1 | sed -E 's/.*COMPLETED ([0-9]+) FILES ([0-9]+) ERRORS.*/\1 \2 &/' ;;
    vitest) local t; t=$(grep -E '^ *Tests +.*\(([0-9]+)\)' <<< "$s" | tail -1)
      [ -n "$t" ] && echo "$(sed -E 's/.*\(([0-9]+)\).*/\1/' <<< "$t") $(grep -oE '[0-9]+ failed' <<< "$t" | grep -oE '[0-9]+' || echo 0) $(echo $t)" ;;
    # prove and idle print measurements without a threshold: the last section's heading shows the run completed.
    prove) grep -q '^R-23 press vs default' <<< "$s" && echo "1 0 report complete (no threshold in the tool)" ;;
    idle) grep -q '^pet: bubble only' <<< "$s" && echo "1 0 report complete (no threshold in the tool)" ;;
  esac
}
SUM=$OUT/summary.txt
: > "$SUM"
overall=PASS
row() { # name parser
  local name=$1 parser=$2 rc secs tries note n m line verdict=PASS why=''
  if [ -f "$OUT/.res-$name" ]; then read rc secs tries note < "$OUT/.res-$name"; else rc=none secs=0 tries=0 note='no result'; fi
  read n m line <<< "$(summary_line $parser "$OUT/$name.log")"
  if [ "$rc" != 0 ]; then verdict=FAIL why="exit $rc${note:+ $note}"
  elif [ -z "${n:-}" ]; then verdict=FAIL why='no summary line'
  elif [ "$n" -eq 0 ]; then verdict=FAIL why='nothing measured'
  elif [ "$m" -gt 0 ]; then verdict=FAIL why="$m below"
  fi
  [ $verdict = FAIL ] && overall=FAIL
  [ "${tries:-1}" -gt 1 ] && why+="${why:+, }$tries attempts"
  printf '%-22s exit %-4s %3dm%02ds  %-4s %s%s\n' "$name" "$rc" $((secs / 60)) $((secs % 60)) $verdict "${line:--}" "${why:+  [$why]}" >> "$SUM"
}
{ [ $SHOOT -eq 1 ] || [ -f "$OUT/.res-shoot" ]; } && row shoot shoot
for i in "${!NAMES[@]}"; do row "${NAMES[$i]}" "${PARSERS[$i]}"; done
echo "OVERALL $overall" >> "$SUM"
rm -f "$OUT"/.res-*
cat "$SUM"
say "done: $overall"
[ $overall = PASS ]

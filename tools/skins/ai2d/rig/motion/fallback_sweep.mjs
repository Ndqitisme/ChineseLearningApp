// What a sprite sheet would cost if it shipped instead of the live rig: for each fps, the spec is
// checked as if it shipped the sprite at that rate. Prints frames, decoded RAM and the motion rules
// it breaks. Writes artifacts/fallback-sweep.json.
// Usage: node fallback_sweep.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(HERE, 'motion-spec.json'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'motion-sweep-'));
const rows = [];
for (const fps of [5, 8, 10, 12, 15, 20, 30]) {
  const s = JSON.parse(JSON.stringify(spec));
  s.budget.ships = 'sprite';
  s.budget.runtimes.sprite.fps = fps;
  const p = join(dir, `s${fps}.json`), j = join(dir, `r${fps}.json`);
  writeFileSync(p, JSON.stringify(s));
  spawnSync(process.execPath, [join(HERE, 'check_spec.mjs'), p, '--json', j], { encoding: 'utf8' });
  const r = JSON.parse(readFileSync(j, 'utf8'));
  const by = {};
  for (const x of r.violations) by[x.rule] = (by[x.rule] ?? 0) + 1;
  const b = r.stats.budget.sprite;
  rows.push({ fps, frames: b.frames, sheet: b.sheet, ramBytes: b.ramBytes, xV4: +(b.ramBytes / 9_452_000).toFixed(2), estWebpBytes: b.estWebpBytes, violations: r.violations.length, byRule: by });
  console.log(`${String(fps).padStart(2)} fps: ${b.frames} frames, ${(b.ramBytes / 1e6).toFixed(1)} MB (${(b.ramBytes / 9_452_000).toFixed(2)}x v4), ${r.violations.length} violations ${JSON.stringify(by)}`);
}
rmSync(dir, { recursive: true, force: true });
writeFileSync(join(HERE, 'artifacts', 'fallback-sweep.json'), JSON.stringify(rows, null, 1));

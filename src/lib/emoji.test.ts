import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Windows 10's Segoe UI Emoji stops at Emoji 12.0: anything newer renders as an empty box
// (the "Trà sữa" theme once used 🧋). Ranges below are the Emoji 13–15 additions.
const NEWER: [number, number][] = [
  [0x1f6d6, 0x1f6df], [0x1f6fb, 0x1f6fc], [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f90c], [0x1f972, 0x1f972],
  [0x1f977, 0x1f979], [0x1f9a3, 0x1f9a4], [0x1f9ab, 0x1f9ad], [0x1f9cb, 0x1f9cc], [0x1fa74, 0x1fa77],
  [0x1fa7b, 0x1fa7f], [0x1fa83, 0x1fa8f], [0x1fa96, 0x1faff],
];
const PERSON = 0x1f9d1; // gender-neutral ZWJ sequences (🧑‍💼) arrived in Emoji 12.1

function unsupported(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu)) {
    const cps = [...m[0]].map((c) => c.codePointAt(0)!);
    const newer = cps.some((cp) => NEWER.some(([a, b]) => cp >= a && cp <= b));
    if (newer || (cps[0] === PERSON && cps.includes(0x200d))) found.add(m[0]);
  }
  return [...found];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(svelte|ts|json)$/.test(f) && !f.includes('generated') && !f.endsWith('.test.ts'))
    .map((f) => join(dir, f));
}

describe('emoji', () => {
  it('only uses emoji that Windows 10 can draw', () => {
    const bad = [...sourceFiles('src'), ...sourceFiles('data')]
      .flatMap((f) => unsupported(readFileSync(f, 'utf8')).map((e) => `${f}: ${e}`));
    expect(bad).toEqual([]);
  });

  it('recognises the emoji that broke before', () => {
    expect(unsupported('🧋 🧑‍💼')).toHaveLength(2);
    expect(unsupported('🥤 👔 👨‍👩‍👧 🌸')).toEqual([]);
  });
});

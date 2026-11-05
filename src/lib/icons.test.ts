import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from './theme/themes.ts';
import { GROUPS } from './data.ts';
import { ICON_NAMES } from './ui/icon-names.ts';

const sourceFiles = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(svelte|ts|json)$/.test(f) && !f.includes('generated') && !f.endsWith('.test.ts'))
    .map((f) => join(dir, f));

describe('icons', () => {
  it('the UI and topic data use icons, not emoji', () => {
    const files = [...sourceFiles('src'), 'data/topics/_index.json'];
    const found = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\p{Extended_Pictographic}/gu)].map((m) => `${f}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  // Topic icons come from JSON, so the type checker cannot catch a misspelt name.
  it('every icon name in data has a file', () => {
    const topics: { icon: string }[] = JSON.parse(readFileSync('data/topics/_index.json', 'utf8'));
    const known = new Set<string>(ICON_NAMES);
    const used = [...topics.map((t) => t.icon), ...THEMES.map((t) => t.icon), ...GROUPS.map((g) => g.icon)];
    expect(used.filter((n) => !known.has(n))).toEqual([]);
    expect(ICON_NAMES.filter((n) => !existsSync(`public/icons/${n}.png`))).toEqual([]);
  });
});

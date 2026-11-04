<script lang="ts">
  import type { Syllable } from '../pinyin.ts';

  /** Renders written pinyin with each syllable coloured by tone, keeping the original spacing. */
  let { text, syllables, colored = true }: { text: string; syllables: Syllable[]; colored?: boolean } = $props();

  const parts = $derived.by(() => {
    const out: { s: string; tone?: number }[] = [];
    let rest = text;
    for (const syl of syllables) {
      const at = rest.toLowerCase().indexOf(syl.py.toLowerCase());
      if (at < 0) continue;
      if (at > 0) out.push({ s: rest.slice(0, at) });
      out.push({ s: rest.slice(at, at + syl.py.length), tone: syl.tone });
      rest = rest.slice(at + syl.py.length);
    }
    if (rest) out.push({ s: rest });
    return out;
  });
</script>

<span class="pinyin" class:colored>{#each parts as p, i (i)}{#if p.tone}<span class="t{p.tone}">{p.s}</span>{:else}{p.s}{/if}{/each}</span>

<style>
  .pinyin {
    font-family: var(--font-pinyin);
    letter-spacing: 0.01em;
  }
  .colored .t1 { color: var(--tone1); }
  .colored .t2 { color: var(--tone2); }
  .colored .t3 { color: var(--tone3); }
  .colored .t4 { color: var(--tone4); }
  .colored .t5 { color: var(--tone5); }
</style>

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
    /* The Kai face is thin at small sizes; a hairline stroke keeps the tone colours at full strength in the glyph core. */
    -webkit-text-stroke: 0.25px currentColor;
  }
  /* Even so the stroke core of a tone colour was 3.0-4.5:1 at 15-18px in light themes (5:1 declared on white; 3.0 on a
     hovered row), and 4.1-4.5:1 on a hovered search row in dark ones. The face has one weight, so 600 is a synthetic
     bold: 4.6-5.3:1 in light themes. The hues stay the tone colours. */
  .pinyin { font-weight: 600; }
  .colored .t1 { color: var(--tone1); }
  .colored .t2 { color: var(--tone2); }
  .colored .t3 { color: var(--tone3); }
  .colored .t4 { color: var(--tone4); }
  .colored .t5 { color: var(--tone5); }
</style>

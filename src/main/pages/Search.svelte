<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass, LIGHT_SPECULAR } from '../../lib/ui/glass/glass.ts';
  import { theme } from '../../lib/theme/apply.svelte.ts';
  import { topics, words } from '../../lib/data.ts';
  import { searchKey } from '../../lib/pinyin.ts';
  import { hskLevel, isOpenAnyEdition, settings } from '../../lib/settings.svelte.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import WordRow from '../components/WordRow.svelte';

  import { untrack } from 'svelte';
  let { query = '' }: { query?: string } = $props();
  let q = $state(untrack(() => query));
  // The query lives in the URL so Back from a word page brings the results back. replaceState fires no
  // hashchange, so typing neither re-mounts the page nor adds a history entry per key.
  $effect(() => {
    const term = q.trim();
    const hash = term ? `#/search/${encodeURIComponent(term)}` : '#/search';
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
  });

  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  // Precomputed once: folding thousands of entries on every keystroke is wasted work. Both editions' words are
  // searchable, so a word stays findable after an edition switch.
  const index = words.filter(isOpenAnyEdition).map((w) => ({ w, py: searchKey(w.pinyin), vi: fold(w.vi + ' ' + (w.viFull ?? '')), hv: fold(w.hanviet ?? '') }));

  const results = $derived.by(() => {
    const term = q.trim();
    if (!term) return [];
    if (/\p{Script=Han}/u.test(term)) return index.filter((e) => e.w.hanzi.includes(term)).map((e) => e.w).slice(0, 100);
    const key = searchKey(term);
    const f = fold(term);
    const scored: { w: (typeof words)[number]; s: number }[] = [];
    for (const e of index) {
      let s = 0;
      if (e.py === key) s = 100;
      else if (e.py.startsWith(key)) s = 60;
      if (e.hv === f) s = Math.max(s, 90);
      else if (e.hv.startsWith(f)) s = Math.max(s, 40);
      const at = e.vi.indexOf(f);
      if (at === 0) s = Math.max(s, 70);
      else if (at > 0) s = Math.max(s, 30);
      if (s) scored.push({ w: e.w, s: s - (hskLevel(e.w) ?? 4) });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, 100).map((r) => r.w);
  });
</script>

<div class="page">
  <h1><Icon name="nav-search" hue={HUE_OF.search} /> Tra cứu</h1>
  <p class="lead">Gõ chữ Hán, pinyin (có hoặc không dấu, ví dụ “mifan”), nghĩa tiếng Việt hoặc âm Hán&nbsp;Việt.</p>
  <!-- svelte-ignore a11y_autofocus -->
  <input class="search glass glass-focus" use:glass={{ blur: 0, specular: theme.dark ? 0.2 : LIGHT_SPECULAR, saturate: 1.1 }} type="search" placeholder="Ví dụ: 米饭 · mifan · cơm · mễ phạn" bind:value={q} autofocus />
  {#if q.trim()}
    <p class="muted">{results.length} kết quả{results.length === 100 ? ' (hiện 100 kết quả đầu)' : ''}</p>
    {#if results.length}
      <div class="card glass list">{#each results as w (w.id)}<WordRow word={w} showTopic />{/each}</div>
    {:else}
      <p class="empty">Không tìm thấy.<br />Bộ từ hiện có {index.length} từ (HSK 1–{settings.hskOpen} và {topics.length} chủ đề).</p>
    {/if}
  {/if}
</div>

<style>
  .search { width: 100%; font-size: 18px; padding: 12px 18px; border-radius: 99px; margin-bottom: 10px; --glass-alpha: 62%; }
  .list { padding: 8px; }
</style>

<script lang="ts">
  import { words } from '../../lib/data.ts';
  import { searchKey } from '../../lib/pinyin.ts';
  import WordRow from '../components/WordRow.svelte';

  import { untrack } from 'svelte';
  let { query = '' }: { query?: string } = $props();
  let q = $state(untrack(() => query));

  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  // Precomputed once: folding 2.5k entries on every keystroke is wasted work.
  const index = words.map((w) => ({ w, py: searchKey(w.pinyin), vi: fold(w.vi + ' ' + (w.viFull ?? '')), hv: fold(w.hanviet ?? '') }));

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
      if (s) scored.push({ w: e.w, s: s - (e.w.hsk ?? 4) });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, 100).map((r) => r.w);
  });
</script>

<div class="page">
  <h1>🔎 Tra cứu</h1>
  <p class="lead">Gõ chữ Hán, pinyin (có hoặc không dấu, ví dụ “mifan”), nghĩa tiếng Việt hoặc âm Hán Việt.</p>
  <!-- svelte-ignore a11y_autofocus -->
  <input class="search" type="search" placeholder="Ví dụ: 米饭 · mifan · cơm · mễ phạn" bind:value={q} autofocus />
  {#if q.trim()}
    <p class="muted">{results.length} kết quả{results.length === 100 ? ' (hiện 100 kết quả đầu)' : ''}</p>
    {#if results.length}
      <div class="card list">{#each results as w (w.id)}<WordRow word={w} />{/each}</div>
    {:else}
      <p class="empty">Không tìm thấy. Bộ từ hiện có {words.length} từ (HSK 1–3 và 22 chủ đề).</p>
    {/if}
  {/if}
</div>

<style>
  .search { width: 100%; font-size: 18px; padding: 12px 16px; border-radius: 16px; margin-bottom: 10px; }
  .list { padding: 8px; }
</style>

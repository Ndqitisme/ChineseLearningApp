<script lang="ts">
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';

  let { word }: { word: Word } = $props();
  const e = $derived(progress.exposure[word.id]);
  const status = $derived(e?.k ? 'known' : (e?.n ?? 0) >= TARGET_EXPOSURES ? 'familiar' : (e?.n ?? 0) > 0 ? 'learning' : 'new');
  const LABEL = { known: 'Đã biết', familiar: 'Đã quen', learning: 'Đang học', new: 'Mới' };
</script>

<a class="row" href="#/word/{encodeURIComponent(word.id)}" data-has-pinyin>
  <span class="hz han">{word.hanzi}</span>
  <span class="mid">
    <span class="py"><Pinyin text={word.pinyin} syllables={word.syllables} /></span>
    <span class="vi">{word.vi}</span>
  </span>
  <span class="hv">{word.hanviet}</span>
  {#if e?.s}<span class="star">★</span>{/if}
  <span class="st {status}" title={LABEL[status]}></span>
</a>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 14px;
    border-radius: 14px;
    color: var(--text);
    text-decoration: none;
  }
  .row:hover { background: var(--surface-2); }
  .hz { font-size: 28px; min-width: 76px; }
  .mid { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .py { font-size: 15px; }
  .vi { font-weight: 800; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hv { color: var(--text-2); font-size: 13px; text-transform: capitalize; }
  .star { color: #e0a100; }
  .st { width: 10px; height: 10px; border-radius: 50%; background: var(--border); flex: none; }
  .st.learning { background: var(--tone2); }
  .st.familiar { background: var(--tone4); }
  .st.known { background: var(--good); }
</style>

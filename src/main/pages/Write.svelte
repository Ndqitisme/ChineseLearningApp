<script lang="ts">
  import { isHan } from '../../lib/pinyin.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import HanziStroke from '../components/HanziStroke.svelte';
  import { deckFrom, shuffle } from '../deck.ts';

  import { untrack } from 'svelte';
  let { params }: { params: string[] } = $props();
  const deck = untrack(() => deckFrom(params));
  const queue: Word[] = shuffle(deck.words).slice(0, 12);

  let wi = $state(0);
  let ci = $state(0);
  let attempt = $state(0);
  let showOutline = $state(true);
  let result = $state<number | null>(null);
  let totalMistakes = $state(0);

  const word = $derived(queue[wi]);
  const chars = $derived(word ? [...word.hanzi].filter(isHan) : []);

  function complete(mistakes: number) {
    result = mistakes;
    totalMistakes += mistakes;
  }
  function next() {
    result = null;
    if (ci + 1 < chars.length) ci++;
    else { wi++; ci = 0; }
    attempt++;
  }
  function retry() { result = null; attempt++; }
</script>

<div class="page">
  <a href="#/practice" class="muted back">← Luyện tập</a>
  <h1>✍️ Viết theo nét</h1>
  <p class="lead">{deck.title} · vẽ từng nét bằng chuột theo đúng thứ tự. Sai 3 lần thì có gợi ý.</p>

  {#if word}
    <div class="layout">
      <div class="card target" data-has-pinyin>
        <span class="muted">Từ {wi + 1}/{queue.length}</span>
        <div class="word han">
          {#each chars as ch, i (i)}<span class:current={i === ci} class:done={i < ci}>{ch}</span>{/each}
        </div>
        <Pinyin text={word.pinyin} syllables={word.syllables} />
        <div class="vi">{word.vi}</div>
        <label class="row small"><input type="checkbox" bind:checked={showOutline} onchange={() => attempt++} /> Hiện chữ mờ để tô theo</label>
      </div>
      <div class="board">
        {#key `${wi}-${ci}-${attempt}`}
          <HanziStroke char={chars[ci]} size={300} mode="quiz" {showOutline} oncomplete={complete} />
        {/key}
        {#if result !== null}
          <div class="result card">
            <b class={result === 0 ? 'good' : result < 3 ? '' : 'bad'}>{result === 0 ? 'Hoàn hảo! 🎉' : `Xong, sai ${result} nét`}</b>
            <div class="row">
              <button class="btn" onclick={retry}>Viết lại</button>
              <button class="btn primary" onclick={next}>Tiếp →</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else if queue.length}
    <div class="card done">
      <div class="big">🖌️</div>
      <h2>Xong {queue.length} từ, tổng cộng sai {totalMistakes} nét</h2>
      <a class="btn primary" href="#/practice">Về trang luyện tập</a>
    </div>
  {:else}
    <p class="empty">Chưa có từ để luyện viết.</p>
  {/if}
</div>

<style>
  .back { text-decoration: none; font-weight: 700; }
  .layout { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
  .target { display: flex; flex-direction: column; gap: 6px; min-width: 240px; font-size: 18px; }
  .word { font-size: 56px; letter-spacing: 4px; }
  .word span { color: var(--text-2); opacity: .45; }
  .word span.current { color: var(--primary); opacity: 1; }
  .word span.done { color: var(--good); opacity: 1; }
  .vi { font-weight: 900; font-size: 20px; }
  .small { font-size: 13px; margin-top: 8px; }
  .board { display: flex; flex-direction: column; gap: 12px; }
  .result { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .done { text-align: center; padding: 30px; }
  .done .big { font-size: 48px; }
  .done a { text-decoration: none; }
</style>

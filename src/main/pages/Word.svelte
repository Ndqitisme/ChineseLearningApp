<script lang="ts">
  import BackButton from '../components/BackButton.svelte';
  import { onMount, tick } from 'svelte';
  import { topicById, wordById } from '../../lib/data.ts';
  import { requestExposurePatch } from '../../lib/exposure.ts';
  import { isHan } from '../../lib/pinyin.ts';
  import { progress, saveProgress } from '../../lib/progress.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { previewIntervals } from '../../lib/srs.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import HanziStroke from '../components/HanziStroke.svelte';

  let { id }: { id: string } = $props();
  const word = $derived(wordById.get(id));
  const e = $derived(word ? progress.exposure[word.id] : undefined);
  const card = $derived(word ? progress.srs[word.id] : undefined);
  let speakError = $state('');
  let strokeKey = $state(0);
  let strokeEls = $state<HanziStroke[]>([]);
  let strokeRun = 0;

  /** One character at a time, left to right: animating all of them at once is hard to follow. */
  async function playStrokes() {
    const run = ++strokeRun;
    await tick();
    for (const el of strokeEls) {
      if (run !== strokeRun) return;
      await el?.play();
    }
  }
  function replayStrokes() {
    strokeKey++;
    playStrokes();
  }
  onMount(playStrokes);

  async function say(slot: 'female' | 'male', text: string) {
    speakError = '';
    try { await speak(text, slot); } catch (err) { speakError = String((err as Error).message ?? err); }
  }
  async function addToReview() {
    if (!word || progress.srs[word.id]) return;
    progress.srs[word.id] = { due: new Date().toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 };
    await saveProgress('srs');
  }
</script>

<div class="page">
  {#if word}
    <BackButton to="/search" useHistory />
    <div class="hero card">
      <div class="strokes">
        {#key strokeKey}
          {#each [...word.hanzi].filter(isHan) as ch, i (i)}
            <HanziStroke bind:this={strokeEls[i]} char={ch} size={[...word.hanzi].length > 2 ? 120 : 170} mode="sequence" />
          {/each}
        {/key}
      </div>
      <div class="info" data-has-pinyin>
        <div class="py"><Pinyin text={word.pinyin} syllables={word.syllables} /></div>
        <div class="vi">{word.vi}</div>
        {#if word.hanviet}<div class="hv">Hán Việt: <b>{word.hanviet}</b></div>{/if}
        <div class="chips">
          {#if word.hsk}<a class="chip" href="#/hsk/{word.hsk}">HSK {word.hsk}</a>{/if}
          {#each word.topics as t (t)}
            {@const topic = topicById.get(t)}
            {#if topic}<a class="chip" href="#/topic/{t}">{topic.icon} {topic.title}</a>{/if}
          {/each}
        </div>
        <div class="row btns">
          <button class="btn" onclick={replayStrokes}>✍️ Xem lại nét</button>
          {#if speechAvailable()}
            <button class="btn" onclick={() => say('female', word.hanzi)}>🔊 Giọng nữ</button>
            <button class="btn" onclick={() => say('male', word.hanzi)}>🔊 Giọng nam</button>
          {:else}
            <a class="btn ghost" href="#/settings">🔇 Cài giọng đọc…</a>
          {/if}
        </div>
        {#if speakError}<p class="bad small">{speakError}</p>{/if}
      </div>
    </div>

    {#if word.ex}
      <h2 class="section-title">Ví dụ</h2>
      <div class="card ex">
        <div class="han ex-zh" data-hover-pinyin="on">{word.ex.zh}
          {#if speechAvailable()}<button class="btn ghost sm" onclick={() => say('female', word.ex!.zh)}>🔊</button>{/if}
        </div>
        <div class="ex-py" data-has-pinyin>{word.ex.py}</div>
        <div class="ex-vi">{word.ex.vi}</div>
      </div>
    {/if}

    {#if word.viFull && word.viFull !== word.vi}
      <h2 class="section-title">Nghĩa đầy đủ (CVDICT)</h2>
      <div class="card full">{word.viFull}</div>
    {/if}

    <h2 class="section-title">Học từ này</h2>
    <div class="row btns">
      <button class="btn" class:primary={e?.s} onclick={() => requestExposurePatch(word.id, { starred: !e?.s })}>{e?.s ? '★ Đã lưu sổ tay' : '☆ Lưu vào sổ tay'}</button>
      <button class="btn" class:primary={e?.k} onclick={() => requestExposurePatch(word.id, { known: !e?.k })}>{e?.k ? '✓ Đã biết' : 'Đánh dấu đã biết'}</button>
      {#if card}
        <span class="muted">Ôn tiếp: {new Date(card.due).toLocaleDateString('vi-VN')} · lần ôn {card.reps}</span>
      {:else}
        <button class="btn" onclick={addToReview}>🔁 Thêm vào ôn tập</button>
        <span class="muted small">Nếu nhớ tốt, lần ôn sau: {previewIntervals(undefined)[3]}</span>
      {/if}
    </div>
    <p class="muted small">Tiểu Mai đã cho bạn xem từ này {e?.n ?? 0} lần.</p>
  {:else}
    <p class="empty">Không tìm thấy từ “{id}”.</p>
  {/if}
</div>

<style>
  .hero { display: flex; gap: 28px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .strokes { display: flex; gap: 10px; flex-wrap: wrap; }
  .info { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 6px; }
  .py { font-size: 30px; }
  .vi { font-size: 24px; font-weight: 900; }
  .hv { color: var(--text-2); font-size: 16px; }
  .hv b { text-transform: capitalize; color: var(--text); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chips a { text-decoration: none; }
  .btns { flex-wrap: wrap; margin-top: 6px; }
  .btns a { text-decoration: none; }
  .ex-zh { font-size: 26px; display: flex; align-items: center; gap: 6px; }
  .ex-py { font-family: var(--font-pinyin); color: var(--text-2); font-size: 17px; margin-top: 2px; }
  .ex-vi { font-weight: 800; margin-top: 6px; font-size: 16px; }
  .full { line-height: 1.6; }
  .small { font-size: 12.5px; }
  .sm { padding: 2px 8px; }
</style>

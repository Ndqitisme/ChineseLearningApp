<script lang="ts">
  import { progress, saveProgress, today } from '../../lib/progress.svelte.ts';
  import { speak } from '../../lib/speech/index.ts';
  import { gradeFromAnswer, review } from '../../lib/srs.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { deckFrom, distractors, shuffle } from '../deck.ts';

  /** params: [mode, ...deck params] — mode is "meaning" | "hanzi" | "listen". */
  import { untrack } from 'svelte';
  let { params }: { params: string[] } = $props();
  // Computed once: the page is re-created on navigation, and the deck must not reshuffle
  // mid-round when the assistant records a new exposure in the background.
  type Mode = 'meaning' | 'hanzi' | 'listen';
  const mode = untrack(() => (['meaning', 'hanzi', 'listen'].includes(params[0]) ? params[0] : 'meaning') as Mode);
  const deck = untrack(() => deckFrom(params.slice(1)));
  const ROUND = 10;

  interface Question { word: Word; options: Word[] }
  let questions = $state<Question[]>([]);
  let index = $state(0);
  let picked = $state<string | null>(null);
  let correct = $state(0);
  let started = 0;

  function newRound() {
    const key = mode === 'meaning' ? (w: Word) => w.vi : (w: Word) => w.hanzi;
    questions = shuffle(deck.words).slice(0, ROUND).map((word) => ({ word, options: shuffle([word, ...distractors(word, 3, key)]) }));
    index = 0;
    correct = 0;
    picked = null;
    started = performance.now();
    if (mode === 'listen' && questions[0]) speak(questions[0].word.hanzi).catch(() => {});
  }
  newRound();

  const q = $derived(questions[index]);

  async function choose(option: Word) {
    if (picked || !q) return;
    picked = option.id;
    const ok = option.id === q.word.id;
    if (ok) correct++;
    progress.srs[q.word.id] = review(progress.srs[q.word.id], gradeFromAnswer(ok, performance.now() - started));
    progress.reviewDays[today()] = (progress.reviewDays[today()] ?? 0) + 1;
    await Promise.all([saveProgress('srs'), saveProgress('reviewDays')]);
  }
  function next() {
    index++;
    picked = null;
    started = performance.now();
    if (mode === 'listen' && questions[index]) speak(questions[index].word.hanzi).catch(() => {});
  }
  function onKey(e: KeyboardEvent) {
    if (!q) return;
    if (!picked && ['1', '2', '3', '4'].includes(e.key)) choose(q.options[Number(e.key) - 1]);
    else if (picked && (e.key === 'Enter' || e.key === ' ')) next();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <a href="#/practice" class="muted back">← Luyện tập</a>
  <h1>{mode === 'meaning' ? '🧠 Đoán nghĩa' : mode === 'hanzi' ? '🔤 Chọn mặt chữ' : '👂 Nghe chọn chữ'}</h1>
  <p class="lead">{deck.title} · bấm phím 1–4 để chọn, Enter để qua câu</p>

  {#if deck.words.length < 4}
    <p class="empty">Cần ít nhất 4 từ để luyện. Hãy để Tiểu Mai cho bạn xem thêm vài từ nhé.</p>
  {:else if q}
    <div class="progress"><i style:width="{(index / questions.length) * 100}%"></i></div>
    <div class="card question">
      <span class="muted count">Câu {index + 1}/{questions.length}</span>
      {#if mode === 'meaning'}
        <div class="prompt han" data-hover-pinyin={picked ? 'on' : 'off'}>{q.word.hanzi}</div>
      {:else if mode === 'hanzi'}
        <div class="prompt vi-prompt">{q.word.vi}</div>
      {:else}
        <button class="btn listen" onclick={() => speak(q.word.hanzi).catch(() => {})}>🔊 Nghe lại</button>
      {/if}
      {#if picked}
        <div class="answer" data-has-pinyin>
          <span class="han">{q.word.hanzi}</span>
          <Pinyin text={q.word.pinyin} syllables={q.word.syllables} />
          <span>· {q.word.vi}</span>
          {#if q.word.hanviet}<span class="muted">· Hán Việt: {q.word.hanviet}</span>{/if}
        </div>
      {/if}
    </div>
    <div class="options" data-hover-pinyin="off">
      {#each q.options as o, i (o.id)}
        <button
          class="card option"
          class:right={picked && o.id === q.word.id}
          class:wrong={picked === o.id && o.id !== q.word.id}
          disabled={!!picked}
          onclick={() => choose(o)}
        >
          <span class="key">{i + 1}</span>
          {#if mode === 'meaning'}{o.vi}{:else}<span class="han opt-han">{o.hanzi}</span>{/if}
        </button>
      {/each}
    </div>
    {#if picked}<div class="row next"><button class="btn primary" onclick={next}>Tiếp →</button></div>{/if}
  {:else}
    <div class="card done">
      <div class="big">{correct >= 8 ? '🎉' : correct >= 5 ? '👏' : '💪'}</div>
      <h2>Đúng {correct}/{questions.length} câu</h2>
      <p class="muted">Kết quả đã được ghi vào lịch ôn tập.</p>
      <div class="row center">
        <button class="btn primary" onclick={newRound}>Làm lượt mới</button>
        <a class="btn" href="#/review">Ôn tập</a>
      </div>
    </div>
  {/if}
</div>

<style>
  .back { text-decoration: none; font-weight: 700; }
  .progress { height: 8px; background: var(--surface-2); border-radius: 99px; overflow: hidden; margin-bottom: 14px; }
  .progress i { display: block; height: 100%; background: var(--primary); transition: width .3s; }
  .question { text-align: center; padding: 26px; position: relative; }
  .count { position: absolute; left: 18px; top: 14px; font-size: 13px; font-weight: 700; }
  .prompt { font-size: 72px; line-height: 1.2; }
  .vi-prompt { font-size: 30px; font-weight: 900; padding: 20px 0; }
  .listen { font-size: 20px; padding: 14px 26px; }
  .answer { margin-top: 10px; display: flex; gap: 8px; justify-content: center; align-items: baseline; flex-wrap: wrap; font-size: 18px; font-weight: 800; }
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
  .option { text-align: left; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 12px; cursor: pointer; color: var(--text); }
  .option:hover:not(:disabled) { border-color: var(--primary); }
  .option.right { border-color: var(--good); background: color-mix(in srgb, var(--good) 14%, var(--surface)); }
  .option.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, var(--surface)); }
  .option:disabled { cursor: default; }
  .key { width: 26px; height: 26px; border-radius: 8px; background: var(--surface-2); display: grid; place-items: center; font-size: 13px; color: var(--text-2); flex: none; }
  .opt-han { font-size: 30px; }
  .next { justify-content: flex-end; margin-top: 14px; }
  .done { text-align: center; padding: 30px; }
  .done .big { font-size: 54px; }
  .center { justify-content: center; }
  .center a { text-decoration: none; }
</style>

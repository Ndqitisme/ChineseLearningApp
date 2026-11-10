<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { revealRow } from '../../lib/ui/reveal.ts';
  import Phrases from '../../lib/ui/Phrases.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import BackButton from '../components/BackButton.svelte';
  import { progress, saveProgress, today } from '../../lib/progress.svelte.ts';
  import { onSpeech, speak, speechAvailable } from '../../lib/speech/index.ts';
  import { gradeFromAnswer, review } from '../../lib/srs.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { deckFrom, deckOrigin, distractors, shuffle } from '../deck.ts';

  import { onMount, untrack } from 'svelte';
  /** params: [mode, ...deck params] — mode is "meaning" | "hanzi" | "listen". */
  let { params }: { params: string[] } = $props();
  type Mode = 'meaning' | 'hanzi' | 'listen';
  // Computed once: the page is re-created on navigation, and the deck must not reshuffle
  // mid-round when the assistant records a new exposure in the background.
  const mode = untrack(() => (['meaning', 'hanzi', 'listen'].includes(params[0]) ? params[0] : 'meaning') as Mode);
  const deck = untrack(() => deckFrom(params.slice(1)));
  const ROUND = 10;

  interface Question { word: Word; options: Word[] }
  let questions = $state<Question[]>([]);
  let index = $state(0);
  let picked = $state<string | null>(null);
  let correct = $state(0);
  let started = 0;
  /** Listen mode: the answer time starts when the word is first heard, not when a clip starts loading. */
  let waitingForSound = false;
  let speakError = $state('');
  let nextRow = $state<HTMLElement>();
  // The row is in view before the answer: when the pill appears the page does not move under the pointer.
  $effect(() => { if (index < questions.length) revealRow(nextRow); });
  onMount(() => onSpeech((phase) => {
    if (phase === 'start' && waitingForSound) { waitingForSound = false; started = performance.now(); }
  }));

  function say(hanzi: string) {
    speakError = '';
    speak(hanzi).catch((err) => { speakError = `Không phát được âm thanh: ${(err as Error).message ?? err}`; });
  }

  function newRound() {
    const key = mode === 'meaning' ? (w: Word) => w.vi : (w: Word) => w.hanzi;
    questions = shuffle(deck.words).slice(0, ROUND).map((word) => ({ word, options: shuffle([word, ...distractors(word, 3, key)]) }));
    index = 0;
    correct = 0;
    picked = null;
    startTimer();
    if (mode === 'listen' && questions[0]) say(questions[0].word.hanzi);
  }
  function startTimer() {
    started = performance.now();
    waitingForSound = mode === 'listen';
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
    startTimer();
    if (mode === 'listen' && questions[index]) say(questions[index].word.hanzi);
  }
  function onKey(e: KeyboardEvent) {
    if (!q) return;
    if (!picked && ['1', '2', '3', '4'].includes(e.key)) choose(q.options[Number(e.key) - 1]);
    else if (picked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <BackButton to={deckOrigin(params.slice(1))} useHistory />
  <h1><Icon name={mode === 'meaning' ? 'quiz-meaning' : mode === 'hanzi' ? 'quiz-hanzi' : 'quiz-listen'} hue={HUE_OF[mode]} /> {mode === 'meaning' ? 'Đoán nghĩa' : mode === 'hanzi' ? 'Chọn mặt chữ' : 'Nghe chọn chữ'}</h1>
  <p class="lead">{deck.title}<br />Gợi ý phím: 1–4 để chọn đáp án, Enter để sang câu tiếp.</p>

  {#if deck.gone}
    <p class="empty">{deck.gone.text} <a href={deck.gone.href}>{deck.gone.link}</a></p>
  {:else if deck.words.length < 4}
    <p class="empty">Cần ít nhất 4 từ trong bộ này để luyện.</p>
  {:else if q}
    <div class="progress"><i style:width="{(index / questions.length) * 100}%"></i></div>
    <div class="card glass question">
      <span class="muted count">Câu {index + 1}/{questions.length}</span>
      {#if mode === 'meaning'}
        <div class="prompt han" data-hover-pinyin={picked ? 'on' : 'off'}>{q.word.hanzi}</div>
      {:else if mode === 'hanzi'}
        <div class="prompt vi-prompt">{q.word.vi}</div>
      {:else}
        <button use:glass class="btn glass glass-press listen" onclick={() => say(q.word.hanzi)}><Icon name="speaker" /> Nghe lại</button>
        {#if !speechAvailable()}
          <p class="muted small">Chưa có giọng đọc. Cài giọng trong <a href="#/settings/voice">Cài đặt › Giọng đọc</a>.</p>
        {:else if speakError}<p class="bad small">{speakError}</p>{/if}
      {/if}
      <!-- The answer line's height is reserved from the start, so answering never moves the options. -->
      <div class="answer" data-has-pinyin>
        {#if picked}
          <span class="han">{q.word.hanzi}</span>
          <Pinyin text={q.word.pinyin} syllables={q.word.syllables} />
          <span>· {q.word.vi}</span>
          {#if q.word.hanviet}<span class="muted">· Hán Việt: {q.word.hanviet}</span>{/if}
        {/if}
      </div>
    </div>
    <div class="options" data-hover-pinyin="off">
      {#each q.options as o, i (o.id)}
        <button
          class="card glass glass-lift option"
          use:glass={{ hover: !picked }}
          class:right={picked && o.id === q.word.id}
          class:wrong={picked === o.id && o.id !== q.word.id}
          disabled={!!picked}
          onclick={() => choose(o)}
        >
          <span class="key">{i + 1}</span>
          {#if mode === 'meaning'}<span><Phrases text={o.vi} /></span>{:else}<span class="han opt-han">{o.hanzi}</span>{/if}
          {#if picked && o.id === q.word.id}<span class="mark verdict-mark right"><Icon name="check-disc" size="20px" /></span>
          {:else if picked === o.id}<span class="mark verdict-mark wrong"><Icon name="cross-disc" size="20px" /></span>{/if}
        </button>
      {/each}
    </div>
    <!-- The slot for "Tiếp" is always there; only the pill appears, so nothing below moves. -->
    <div class="row next" bind:this={nextRow}>{#if picked}<button use:glass class="btn glass glass-press primary" onclick={next} {@attach revealRow}>Tiếp →</button>{/if}</div>
  {:else}
    <div class="card glass done">
      <div class="big"><Icon name={correct >= 0.8 * questions.length ? 'result-great' : correct >= 0.5 * questions.length ? 'result-good' : 'result-try'} /></div>
      <h2>Đúng {correct}/{questions.length} câu</h2>
      <p class="muted">Kết quả đã được ghi vào lịch ôn tập.</p>
      <div class="row center">
        <button use:glass class="btn glass glass-press primary" onclick={newRound}>Làm lượt mới</button>
        <a use:glass class="btn glass glass-press" href="#/review">Ôn tập</a>
      </div>
    </div>
  {/if}
</div>

<style>
  .progress { margin-bottom: 14px; }
  .question { text-align: center; padding: 20px 26px 16px; position: relative; }
  .count { position: absolute; left: 18px; top: 14px; font-size: 13px; font-weight: 700; }
  .prompt { font-size: 64px; line-height: 1.2; }
  .vi-prompt { font-size: 30px; font-weight: 900; padding: 20px 0; }
  .listen { font-size: 20px; padding: 14px 26px; }
  .small { font-size: 12.5px; }
  .answer { min-height: 28px; margin-top: 8px; display: flex; gap: 8px; justify-content: center; align-items: baseline; flex-wrap: wrap; font-size: 18px; font-weight: 800; }
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
  .next { min-height: 38px; }
  .option { text-align: left; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 12px; cursor: pointer; color: var(--text); }
  .option:focus-visible { outline: 2px solid var(--primary-ink); outline-offset: 2px; }
  /* Right and chosen-wrong: a tint and a 2px ring over the edge, the rim just inside it. */
  .option.right, .option.wrong { --glass-alpha: 88%; --glass-rim-w: 3px; box-shadow: inset 0 0 0 2px var(--c), var(--glass-rim), var(--glass-shadow, var(--shadow)); --glass-tint: color-mix(in srgb, var(--c) 22%, var(--surface)); }
  .option { --arc-inset: 2px; --arc-r: var(--radius); }
  .option.right { --c: var(--good); }
  /* The verdict as a mark too, not hue alone: the revealed pinyin above uses the same reds and greens for its tones. */
  .mark { position: absolute; top: 7px; right: 7px; width: 16px; height: 16px; }
  .mark :global(.icon) { margin: -2px; }
  .option.wrong { --c: var(--bad); }
  /* The other options after answering: inactive, as other disabled glass (muted label, thinner, no shadow). */
  .option:disabled { cursor: default; }
  .option:disabled:not(.right):not(.wrong) { color: var(--text-2); --glass-alpha: 70%; --glass-rim-hi: .5; --glass-rim-mid: .15; --glass-shadow: 0 0 transparent; }
  .key { width: 26px; height: 26px; border-radius: 8px; background: color-mix(in srgb, var(--text) 8%, transparent); display: grid; place-items: center; font-size: 13px; color: color-mix(in srgb, var(--text-2) 50%, var(--text)); flex: none; }
  /* On the right and wrong tints the muted key number fell to 4.47:1 (Trà sữa dark, fallback): the text colour there. */
  .option.right .key, .option.wrong .key { color: var(--text); }
  .opt-han { font-size: 30px; }
  .next { justify-content: flex-end; margin-top: 14px; }
  /* At 600 px tall a question with a two-line answer left the "Tiếp" row 12 px short of fitting, so the page landed
     scrolled and its header sat higher than on the other practice pages. */
  @media (max-height: 660px) {
    .question { padding-top: 14px; padding-bottom: 12px; }
    .next { margin-top: 10px; }
  }
  .done { text-align: center; padding: 30px; }
  .done .big { font-size: 54px; }
  .center { justify-content: center; }
  .center a { text-decoration: none; }
</style>

<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { progress, saveProgress, today } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { openWord } from '../../lib/settings.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { previewIntervals, Rating, review, type Grade } from '../../lib/srs.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { reviewQueueIds } from '../review-queue.ts';

  let queue = $state<Word[]>(reviewQueueIds().map((id) => openWord(id)).filter((w): w is Word => !!w));
  let flipped = $state(false);
  const word = $derived(queue[0]);
  const intervals = $derived(word ? previewIntervals(progress.srs[word.id]) : null);

  async function grade(g: Grade) {
    if (!word) return;
    progress.srs[word.id] = review(progress.srs[word.id], g);
    progress.reviewDays[today()] = (progress.reviewDays[today()] ?? 0) + 1;
    await Promise.all([saveProgress('srs'), saveProgress('reviewDays')]);
    // "Again" puts the card back at the end of this session.
    queue = g === Rating.Again ? [...queue.slice(1), word] : queue.slice(1);
    flipped = false;
  }
  function onKey(e: KeyboardEvent) {
    if (!word) return;
    if (!flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flipped = true; }
    else if (flipped && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) as Grade);
  }
  const BUTTONS: { g: Grade; label: string; help: string; cls: string }[] = [
    { g: Rating.Again, label: 'Quên', help: 'Không nhớ ra nghĩa hoặc cách đọc', cls: 'again' },
    { g: Rating.Hard, label: 'Khó', help: 'Nhớ ra nhưng phải nghĩ lâu hoặc còn sai một phần', cls: 'hard' },
    { g: Rating.Good, label: 'Nhớ', help: 'Nhớ ra đúng sau một chút', cls: 'good' },
    { g: Rating.Easy, label: 'Dễ', help: 'Nhớ ngay, rất chắc chắn', cls: 'easy' },
  ];
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <h1><Icon name="nav-review" hue={HUE_OF.review} /> Ôn tập</h1>
  <p class="lead">Ôn các từ đến hạn và từ mới theo lịch lặp lại ngắt quãng.</p>
  {#if word}
    <!-- A div, not a button: Chromium's caret hit-testing skips text inside buttons, so hover
         pinyin could never work on the example sentence. -->
    <div
      class="card flash"
      role="button"
      tabindex="0"
      onclick={() => (flipped = true)}
      onkeydown={(e) => { if (e.key === 'Enter') flipped = true; }}
      data-hover-pinyin={flipped ? 'on' : 'off'}
    >
      <div class="hz han" data-has-pinyin={flipped ? '' : undefined}>{word.hanzi}</div>
      {#if flipped}
        <div class="back">
          <div class="py"><Pinyin text={word.pinyin} syllables={word.syllables} /></div>
          <div class="vi">{word.vi}</div>
          {#if word.hanviet}<div class="muted">Hán Việt: {word.hanviet}</div>{/if}
          {#if word.ex}<div class="ex"><span class="han">{word.ex.zh}</span><br /><span class="muted">{word.ex.vi}</span></div>{/if}
        </div>
      {:else}
        <div class="muted hint">Bấm vào thẻ để xem đáp án</div>
      {/if}
    </div>
    {#if flipped && intervals}
      <p class="grade-help">Chọn mức độ nhớ để hẹn lần ôn tiếp theo.</p>
      <div class="grades">
        {#each BUTTONS as b, i (b.g)}
          <button class="btn {b.cls}" onclick={() => grade(b.g)} title="{b.help} · ôn lại sau {intervals[b.g]}"><span>{i + 1} · {b.label}</span><small>ôn lại sau {intervals[b.g]}</small></button>
        {/each}
        {#if speechAvailable()}<button class="btn" onclick={() => speak(word.hanzi).catch(() => {})}><Icon name="speaker" hue={HUE_OF.listen} /></button>{/if}
      </div>
    {/if}
    <div class="status">
      <b class="remaining">Còn {queue.length} thẻ cần ôn</b>
      <span class="muted">Gợi ý phím: Space để lật thẻ, phím 1–2–3–4 để chấm mức độ nhớ</span>
    </div>
  {:else}
    <div class="card empty-card">
      <div class="big done"><Icon name="done" /></div>
      <h2>Không còn thẻ cần ôn</h2>
      <p class="muted">Thẻ mới được thêm khi bạn luyện đoán nghĩa, hoặc khi một từ đã hiện đủ {TARGET_EXPOSURES} lần.</p>
      <a class="btn primary" href="#/quiz/meaning"><Icon name="quiz-meaning" /> Luyện đoán nghĩa</a>
    </div>
  {/if}
</div>

<style>
  .flash { width: 100%; min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; color: var(--text); }
  .hz { font-size: 84px; line-height: 1.15; }
  .hint { font-size: 14px; }
  .back { text-align: center; display: flex; flex-direction: column; gap: 4px; }
  .py { font-size: 26px; }
  .vi { font-size: 22px; font-weight: 900; }
  .ex { margin-top: 8px; font-size: 15px; }
  .ex .han { font-size: 20px; }
  .grade-help { text-align: center; margin: 16px 0 0; color: var(--text-2); font-size: 14px; }
  .grades { display: flex; gap: 10px; justify-content: center; margin-top: 10px; flex-wrap: wrap; }
  .grades .btn { flex-direction: column; min-width: 120px; gap: 0; }
  .grades small { font-weight: 600; opacity: .75; font-size: 11.5px; }
  /* Label text is mixed toward --text so it stays at 4.5:1 on the tint. */
  .again { --c: var(--bad); }
  .hard { --c: var(--hue-amber); }
  .good { --c: var(--good); }
  .easy { --c: var(--hue-blue); }
  .again, .hard, .good, .easy { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, var(--surface)); color: color-mix(in srgb, var(--c) 60%, var(--text)); }
  .again:hover, .hard:hover, .good:hover, .easy:hover { background: color-mix(in srgb, var(--c) 16%, var(--surface)); }
  .status { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-top: 18px; font-size: 14px; }
  .empty-card { text-align: center; padding: 34px; }
  .empty-card .big { font-size: 48px; }
  .done { color: var(--good); }
  .empty-card a { text-decoration: none; }
</style>

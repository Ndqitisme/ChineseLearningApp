<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { progress, saveProgress, today } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { openWordAnyEdition } from '../../lib/settings.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { previewIntervals, Rating, review, type Grade } from '../../lib/srs.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { countNewCard, LEARN_AHEAD_MIN, NEW_PER_DAY, reviewQueueIds } from '../review-queue.svelte.ts';

  let queue = $state<Word[]>(reviewQueueIds().map((id) => openWordAnyEdition(id)).filter((w): w is Word => !!w));
  let flipped = $state(false);
  /** A grade is being saved: a second key press or click must not grade the same card again. */
  let grading = false;
  let flashEl = $state<HTMLElement>();
  // The card takes focus so Space flips it, also right after arriving from a nav link. That focus is not the
  // keyboard's: the ring shows only once the learner tabs.
  let autoFocused = $state(false);
  $effect(() => { if (word && !flipped) { flashEl?.focus({ preventScroll: true }); autoFocused = true; } });
  const word = $derived(queue[0]);
  const intervals = $derived(word ? previewIntervals(progress.srs[word.id]) : null);

  async function grade(g: Grade) {
    if (!word || grading) return;
    grading = true;
    const graded = word;
    const isNew = !progress.srs[graded.id];
    const card = review(progress.srs[graded.id], g);
    progress.srs[graded.id] = card;
    progress.reviewDays[today()] = (progress.reviewDays[today()] ?? 0) + 1;
    if (isNew) countNewCard(graded.id);
    // A card due again soon ("Again", or a new card's short learning step) comes back at the end of this session.
    const soon = Date.parse(card.due) - Date.now() <= LEARN_AHEAD_MIN * 60_000;
    queue = soon ? [...queue.slice(1), graded] : queue.slice(1);
    flipped = false;
    try { await Promise.all([saveProgress('srs'), saveProgress('reviewDays')]); } finally { grading = false; }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Tab') autoFocused = false;
    if (!word) return;
    // Space and Enter on a focused link, button or checkbox belong to that control.
    const onControl = e.target instanceof Element && !!e.target.closest('a, button, input, select, textarea');
    if (!flipped && !onControl && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flipped = true; }
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
    <!-- Above the card: flipping grows the card and adds the grade row below it, and nothing under them moves. -->
    <div class="status">
      <b class="remaining">Còn {queue.length} thẻ cần ôn</b>
      <span class="muted">Gợi ý phím: Space để lật thẻ, phím 1–2–3–4 để chấm mức độ nhớ</span>
    </div>
    <!-- A div, not a button: Chromium's caret hit-testing skips text inside buttons, so hover
         pinyin could never work on the example sentence. -->
    <div
      class="card glass glass-lift flash"
      use:glass={{ specular: 0.4 }}
      bind:this={flashEl}
      role="button"
      tabindex="0"
      onclick={() => (flipped = true)}
      onkeydown={(e) => { if (e.key === 'Enter') flipped = true; }}
      data-hover-pinyin={flipped ? 'on' : 'off'}
      data-autofocus={autoFocused ? '' : undefined}
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
      <div class="grades" {@attach (el) => el.scrollIntoView({ block: 'nearest' })}>
        {#each BUTTONS as b, i (b.g)}
          <button use:glass class="btn glass glass-press {b.cls}" onclick={() => grade(b.g)} title="{b.help} · ôn lại sau {intervals[b.g]}"><span>{i + 1} · {b.label}</span><small>ôn lại sau {intervals[b.g]}</small></button>
        {/each}
        {#if speechAvailable()}<button use:glass class="btn glass glass-press" onclick={() => speak(word.hanzi).catch(() => {})}><Icon name="speaker" hue={HUE_OF.listen} /></button>{/if}
      </div>
    {/if}
  {:else}
    <div class="card glass empty-card">
      <div class="big done"><Icon name="done" /></div>
      <h2>Không còn thẻ cần ôn</h2>
      <p class="muted">
        Thẻ mới đến từ các bài đoán nghĩa, chọn mặt chữ và nghe chọn chữ.<br />
        Nút “Thêm vào ôn tập” ở trang từ cũng thêm thẻ.<br />
        Từ Tiểu Mai đã nhắc đủ {TARGET_EXPOSURES} lần thành thẻ mới, mỗi ngày tối đa {NEW_PER_DAY} từ.
      </p>
      <a use:glass class="btn glass glass-press primary" href="#/quiz/meaning"><Icon name="quiz-meaning" /> Luyện đoán nghĩa</a>
    </div>
  {/if}
</div>

<style>
  .flash { width: 100%; min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; color: var(--text); --glass-alpha: 60%; }
  /* At 600 px tall the flipped card, its help line and the grade row fit without scrolling. */
  @media (max-height: 660px) { .flash { min-height: 276px; } }
  .flash:focus-visible { outline: 2px solid var(--primary-ink); outline-offset: 2px; }
  .flash[data-autofocus]:focus-visible { outline: none; }
  .hz { font-size: 84px; line-height: 1.15; }
  .hint { font-size: 14px; }
  .back { text-align: center; display: flex; flex-direction: column; gap: 4px; }
  .py { font-size: 26px; }
  .vi { font-size: 22px; font-weight: 900; }
  .ex { margin-top: 8px; font-size: 15px; }
  .ex .han { font-size: 20px; }
  /* Light: the 15px translation's stroke core was 4.0-4.4:1; as the bubble's translation line, half the text colour and 500. */
  :global(:root[data-theme='light']) .ex .muted { color: color-mix(in srgb, var(--text-2) 50%, var(--text)); font-weight: 500; }
  .grade-help { text-align: center; margin: 16px 0 0; color: var(--text-2); font-size: 14px; }
  /* Scrolled into view when the card flips, with room for a hovered pill's shadow under it. */
  .grades { display: flex; gap: 10px; justify-content: center; margin-top: 10px; flex-wrap: wrap; }
  .grades .btn { flex-direction: column; min-width: 120px; gap: 0; }
  .grades small { font-weight: 700; font-size: 11.5px; }
  /* Light: the 11.5px line renders lighter than the label colour; under the press shadow its stroke core was 4.2:1. */
  :global(:root[data-theme='light']) .grades small { color: color-mix(in srgb, currentColor 75%, var(--text)); }
  /* Label text is mixed toward --text so it stays at 4.5:1 on the tint. */
  .again { --c: var(--bad); }
  .hard { --c: var(--hue-amber); }
  .good { --c: var(--good); }
  .easy { --c: var(--hue-blue); }
  /* Thin glass with the hue in a tint and a ring, so the backdrop still bends at the bezel. The ring is the full hue: at
     55 % it fell to 1.9:1 against the light field. */
  .again, .hard, .good, .easy { --glass-tint: color-mix(in srgb, var(--c) 18%, var(--surface)); --glass-alpha: 55%; --glass-rim-w: 3px; box-shadow: inset 0 0 0 2px var(--c), var(--glass-rim), var(--glass-shadow, var(--shadow)); color: color-mix(in srgb, var(--c) 60%, var(--text)); }
  /* Hover deepens the grade's own tint, never the plain pills' primary tint. */
  .again, .hard, .good, .easy { --btn-hover-tint: color-mix(in srgb, var(--c) 26%, var(--surface)); }
  .status { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0 0 12px; font-size: 14px; }
  .empty-card { text-align: center; padding: 34px; }
  .empty-card .big { font-size: 48px; }
  .done { color: var(--good); }
  .empty-card a { text-decoration: none; }
</style>

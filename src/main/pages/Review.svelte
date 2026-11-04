<script lang="ts">
  import { wordById } from '../../lib/data.ts';
  import { progress, saveProgress, today } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { isDue, previewIntervals, Rating, review, type Grade } from '../../lib/srs.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';

  const NEW_PER_SESSION = 10;

  /** Due cards first; then words Tiểu Mai has shown enough times that have no card yet. */
  function buildQueue(): Word[] {
    const due = Object.entries(progress.srs).filter(([, c]) => isDue(c)).sort((a, b) => Date.parse(a[1].due) - Date.parse(b[1].due)).map(([id]) => id);
    const fresh = Object.entries(progress.exposure)
      .filter(([id, e]) => !progress.srs[id] && !e.k && e.n >= TARGET_EXPOSURES)
      .slice(0, NEW_PER_SESSION)
      .map(([id]) => id);
    return [...due, ...fresh].map((id) => wordById.get(id)).filter((w): w is Word => !!w);
  }

  let queue = $state<Word[]>(buildQueue());
  let flipped = $state(false);
  let done = $state(0);
  const word = $derived(queue[0]);
  const intervals = $derived(word ? previewIntervals(progress.srs[word.id]) : null);

  async function grade(g: Grade) {
    if (!word) return;
    progress.srs[word.id] = review(progress.srs[word.id], g);
    progress.reviewDays[today()] = (progress.reviewDays[today()] ?? 0) + 1;
    await Promise.all([saveProgress('srs'), saveProgress('reviewDays')]);
    // "Again" puts the card back at the end of this session.
    queue = g === Rating.Again ? [...queue.slice(1), word] : queue.slice(1);
    if (g !== Rating.Again) done++;
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
  <h1>🔁 Ôn tập</h1>
  <p class="lead">Còn {queue.length} thẻ · đã xong {done} · phím Space để lật thẻ, phím 1–4 để chấm mức nhớ</p>
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
        <div class="muted hint">Nhớ lại nghĩa và cách đọc trong đầu, rồi bấm vào thẻ (hoặc Space) để xem đáp án</div>
      {/if}
    </div>
    {#if flipped && intervals}
      <p class="grade-help">Bạn nhớ từ này đến đâu? Chọn một mức, Tiểu Mai sẽ hẹn lần ôn tiếp theo: càng nhớ chắc thì càng lâu mới phải ôn lại.</p>
      <div class="grades">
        {#each BUTTONS as b, i (b.g)}
          <button class="btn {b.cls}" onclick={() => grade(b.g)} title="{b.help} · ôn lại sau {intervals[b.g]}"><span>{i + 1} · {b.label}</span><small>ôn lại sau {intervals[b.g]}</small></button>
        {/each}
        {#if speechAvailable()}<button class="btn" onclick={() => speak(word.hanzi).catch(() => {})}>🔊</button>{/if}
      </div>
    {/if}
  {:else}
    <div class="card empty-card">
      <div class="big">🌸</div>
      <h2>Không còn thẻ nào cần ôn!</h2>
      <p class="muted">Thẻ mới được tạo khi bạn luyện đoán nghĩa, hoặc khi Tiểu Mai đã cho bạn xem một từ đủ {TARGET_EXPOSURES} lần.</p>
      <a class="btn primary" href="#/quiz/meaning">🧠 Luyện đoán nghĩa</a>
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
  .again { border-color: var(--bad); color: var(--bad); }
  .hard { border-color: var(--tone2); color: var(--tone2); }
  .good { border-color: var(--good); color: var(--good); }
  .easy { border-color: var(--tone4); color: var(--tone4); }
  .empty-card { text-align: center; padding: 34px; }
  .empty-card .big { font-size: 48px; }
  .empty-card a { text-decoration: none; }
</style>

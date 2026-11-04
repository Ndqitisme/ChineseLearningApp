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
  const BUTTONS: { g: Grade; label: string; cls: string }[] = [
    { g: Rating.Again, label: 'Quên', cls: 'again' },
    { g: Rating.Hard, label: 'Khó', cls: 'hard' },
    { g: Rating.Good, label: 'Nhớ', cls: 'good' },
    { g: Rating.Easy, label: 'Dễ', cls: 'easy' },
  ];
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <h1>🔁 Ôn tập</h1>
  <p class="lead">Còn {queue.length} thẻ · đã xong {done} · Space để lật, 1–4 để chấm</p>
  {#if word}
    <button class="card flash" onclick={() => (flipped = true)} data-hover-pinyin={flipped ? 'on' : 'off'}>
      <div class="hz han">{word.hanzi}</div>
      {#if flipped}
        <div class="back" data-has-pinyin>
          <div class="py"><Pinyin text={word.pinyin} syllables={word.syllables} /></div>
          <div class="vi">{word.vi}</div>
          {#if word.hanviet}<div class="muted">Hán Việt: {word.hanviet}</div>{/if}
          {#if word.ex}<div class="ex"><span class="han">{word.ex.zh}</span><br /><span class="muted">{word.ex.vi}</span></div>{/if}
        </div>
      {:else}
        <div class="muted hint">Nhớ nghĩa và cách đọc, rồi bấm để lật thẻ</div>
      {/if}
    </button>
    {#if flipped && intervals}
      <div class="grades">
        {#each BUTTONS as b, i (b.g)}
          <button class="btn {b.cls}" onclick={() => grade(b.g)}><span>{i + 1} · {b.label}</span><small>{intervals[b.g]}</small></button>
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
  .grades { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
  .grades .btn { flex-direction: column; min-width: 96px; gap: 0; }
  .grades small { font-weight: 600; opacity: .75; font-size: 11.5px; }
  .again { border-color: var(--bad); color: var(--bad); }
  .hard { border-color: var(--tone2); color: var(--tone2); }
  .good { border-color: var(--good); color: var(--good); }
  .easy { border-color: var(--tone4); color: var(--tone4); }
  .empty-card { text-align: center; padding: 34px; }
  .empty-card .big { font-size: 48px; }
  .empty-card a { text-decoration: none; }
</style>

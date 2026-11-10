<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import BackButton from '../components/BackButton.svelte';
  import { untrack } from 'svelte';
  import { dataset, words } from '../../lib/data.ts';
  import { splitWritten, toSyllables } from '../../lib/pinyin.ts';
  import { plain, score, tiles, type Score } from '../../lib/sentence.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { isOpen } from '../../lib/settings.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { deckFrom, deckOrigin, shuffle } from '../deck.ts';

  /** params: [mode, ...deck params]; mode "order" rebuilds example sentences, "qa" answers questions. */
  let { params }: { params: string[] } = $props();
  type Mode = 'order' | 'qa';
  const mode = untrack(() => (params[0] === 'qa' ? 'qa' : 'order') as Mode);
  const deckParams = untrack(() => params.slice(1));
  const deck = untrack(() => deckFrom(deckParams));
  const ROUND = 8;

  interface Item {
    question?: string;  // qa: the Chinese question
    prompt: string;     // Vietnamese meaning to aim for
    accepted: string[][];
    sentence: string;   // the reference sentence as displayed
    py: string;
    vi: string;
    pool: { id: number; text: string }[];
  }

  const usable = (t: string[]) => t.length >= 3 && t.length <= 9;

  function orderItems(): { items: Item[]; source: string } {
    const fromDeck = deck.words.filter((w) => w.ex && usable(tiles(w.ex.zh)));
    const pick = fromDeck.length >= 5 ? fromDeck : words.filter((w) => isOpen(w) && w.ex && usable(tiles(w.ex.zh)));
    const source = fromDeck.length >= 5 ? deck.title : 'Câu ví dụ trong các chủ đề';
    return {
      source,
      items: shuffle(pick).slice(0, ROUND).map((w) => {
        const t = tiles(w.ex!.zh);
        return { prompt: w.ex!.vi, accepted: [t], sentence: w.ex!.zh, py: w.ex!.py, vi: w.ex!.vi, pool: shuffle(t.map((text, id) => ({ id, text }))) };
      }),
    };
  }

  function qaItems(): { items: Item[]; source: string } {
    const topic = deckParams[0] === 'topic' ? deckParams[1] : '';
    const inTopic = dataset.qa.filter((x) => x.topic === topic);
    const pick = inTopic.length >= 2 ? inTopic : dataset.qa;
    return {
      source: inTopic.length >= 2 ? deck.title : 'Câu hỏi thường ngày',
      items: shuffle(pick).slice(0, ROUND).map((x) => {
        const t = tiles(x.a);
        return {
          question: x.q, prompt: x.qVi, accepted: [x.a, ...(x.alt ?? [])].map(tiles),
          sentence: plain(x.a), py: x.aPy, vi: x.aVi, pool: shuffle(t.map((text, id) => ({ id, text }))),
        };
      }),
    };
  }

  let round = $state(deck.gone ? { items: [], source: deck.title } : mode === 'qa' ? qaItems() : orderItems());
  let index = $state(0);
  let picked = $state<number[]>([]);
  let result = $state<Score | null>(null);
  let points = $state<number[]>([]);

  const item = $derived(round.items[index]);
  const answer = $derived(item ? picked.map((id) => item.pool.find((p) => p.id === id)!.text) : []);
  const complete = $derived(!!item && picked.length === item.pool.length);

  function add(id: number) { if (!result && !picked.includes(id)) picked = [...picked, id]; }
  function remove(id: number) { if (!result) picked = picked.filter((p) => p !== id); }
  function check() {
    if (!item || !picked.length || result) return;
    result = score(answer, item.accepted);
    points = [...points, result.points];
  }
  function next() {
    index++;
    picked = [];
    result = null;
  }
  function again() {
    round = mode === 'qa' ? qaItems() : orderItems();
    index = 0;
    picked = [];
    result = null;
    points = [];
  }
  function onKey(e: KeyboardEvent) {
    if (!item) return;
    // Enter on a focused link or enabled button (Tiếp, Xoá hết, a tab) activates that control instead. Tiles are
    // the board itself: a clicked tile keeps focus, and Enter then still checks the answer.
    const control = e.target instanceof Element ? e.target.closest('a, button:not(.tile)') : null;
    if (e.key === 'Enter' && control && !(control as HTMLButtonElement).disabled) return;
    if (e.key === 'Enter') { e.preventDefault(); if (result) next(); else if (complete) check(); }
    else if (e.key === 'Backspace' && !result && picked.length) { e.preventDefault(); picked = picked.slice(0, -1); }
  }
  const average = $derived(points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : 0);
  const verdict = (p: number) => (p === 100 ? 'Chính xác' : p >= 70 ? 'Gần đúng' : 'Cần xem lại');
  const tail = deckParams.length ? `/${deckParams.join('/')}` : '';
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <BackButton to={deckOrigin(deckParams)} useHistory />
  <h1><Icon name="build" hue={HUE_OF.build} /> Ghép câu</h1>
  <div class="tabs">
    <a class="chip glass glass-press" class:on={mode === 'order'} use:glass={{ when: !(mode === 'order') }} href="#/build/order{tail}">Sắp xếp thành câu</a>
    <a class="chip glass glass-press" class:on={mode === 'qa'} use:glass={{ when: !(mode === 'qa') }} href="#/build/qa{tail}">Trả lời câu hỏi</a>
  </div>
  <p class="lead">
    {round.source}<br />
    Bấm các từ theo đúng thứ tự để ghép câu; bấm lại một từ đã chọn để bỏ ra.<br />
    Gợi ý phím: Enter để chấm, Backspace để bỏ từ cuối.
  </p>

  {#if deck.gone}
    <p class="empty">{deck.gone.text} <a href={deck.gone.href}>{deck.gone.link}</a></p>
  {:else if item}
    <div class="progress"><i style:width="{(index / round.items.length) * 100}%"></i></div>
    <div class="card glass task">
      <span class="muted count">Câu {index + 1}/{round.items.length}</span>
      {#if item.question}
        <div class="question han">{item.question}</div>
        <div class="muted">{item.prompt}</div>
        <div class="ask">Ghép câu trả lời:</div>
      {:else}
        <div class="ask">Ghép thành câu có nghĩa: <b>“{item.prompt}”</b></div>
      {/if}

      <div class="answer" class:done={!!result}>
        {#each picked as id, i (id)}
          {@const tile = item.pool.find((p) => p.id === id)!}
          <button class="tile glass glass-press han" use:glass class:ok={result?.inPlace[i]} class:off={result && !result.inPlace[i]} onclick={() => remove(id)} disabled={!!result}>{tile.text}{#if result}<span class="badge verdict-mark"><Icon name={result.inPlace[i] ? 'check-disc' : 'cross-disc'} size="17px" /></span>{/if}</button>
        {:else}
          <span class="muted placeholder">Chọn các từ bên dưới…</span>
        {/each}
      </div>

      {#if !result}
        <div class="pool">
          {#each item.pool as tile (tile.id)}
            <button class="tile glass glass-press han" use:glass class:used={picked.includes(tile.id)} disabled={picked.includes(tile.id)} onclick={() => add(tile.id)}>{tile.text}</button>
          {/each}
        </div>
        <div class="row actions">
          <button use:glass class="btn glass glass-press" onclick={() => (picked = [])} disabled={!picked.length}>Xoá hết</button>
          <button use:glass class="btn glass glass-press primary" onclick={check} disabled={!complete}>Kiểm tra</button>
        </div>
      {:else}
        <div class="result">
          <div class="points" class:perfect={result.points === 100}><b>{result.points}</b>/100 · {verdict(result.points)}</div>
          <div class="reference" data-has-pinyin>
            <span class="muted">Câu chuẩn:</span>
            <span class="han ref-zh">{result.target === 0 ? item.sentence : item.accepted[result.target].join('')}</span>
            {#if speechAvailable()}<button use:glass class="btn glass glass-press ghost sm" onclick={() => speak(item.sentence).catch(() => {})}><Icon name="speaker" /></button>{/if}
            <div class="ref-py"><Pinyin text={item.py} syllables={toSyllables(splitWritten(item.py))} /></div>
            <div class="ref-vi">{item.vi}</div>
          </div>
          {#if result.points < 100}<p class="muted small">Từ mang dấu <span class="legend-mark"><Icon name="cross-disc" size="15px" /></span> đứng lệch thứ tự so với câu chuẩn.<br />Một số câu còn có cách sắp xếp khác cũng đúng; câu chuẩn là cách nói thông dụng nhất.</p>{/if}
        </div>
      {/if}
    </div>
    <!-- Right-aligned under the exercise, as on the quiz pages. -->
    {#if result}<div class="row next"><button use:glass class="btn glass glass-press primary" onclick={next} {@attach (el) => el.scrollIntoView({ block: 'nearest' })}>Tiếp →</button></div>{/if}
  {:else if round.items.length}
    <div class="card glass summary">
      <div class="big"><Icon name={average >= 90 ? 'result-great' : average >= 60 ? 'result-good' : 'result-try'} /></div>
      <h2>Điểm trung bình {average}/100</h2>
      <p class="muted">{points.filter((p) => p === 100).length}/{points.length} câu chính xác hoàn toàn.</p>
      <div class="row center">
        <button use:glass class="btn glass glass-press primary" onclick={again}>Làm lượt mới</button>
        <a use:glass class="btn glass glass-press" href="#/practice">Về trang luyện tập</a>
      </div>
    </div>
  {:else}
    <p class="empty">Chưa có câu để luyện ở đây.</p>
  {/if}
</div>

<style>
  .tabs { display: flex; gap: 8px; margin: 2px 0 6px; }
  .tabs a { text-decoration: none; }
  .progress { margin-bottom: 14px; }
  .task { display: flex; flex-direction: column; gap: 10px; }
  .count { font-size: 13px; }
  .question { font-size: 30px; }
  .ask { font-weight: 800; }
  .answer {
    /* One tile row (41px) plus the box padding, so the first tile does not grow the box. */
    min-height: 70px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border: 1.5px dashed color-mix(in srgb, var(--border) 90%, var(--text-2));
    /* Nested in the card's 20px padding: the card radius minus the padding. */
    border-radius: max(4px, calc(var(--radius) - 20px));
    background: color-mix(in srgb, var(--surface) 35%, transparent);
  }
  .answer.done { border-style: solid; }
  .placeholder { font-size: 14px; }
  .pool { display: flex; flex-wrap: wrap; gap: 8px; }
  .tile {
    font-size: 24px;
    padding: 6px 14px;
    border: 0;
    border-radius: 12px;
    color: var(--text);
    cursor: pointer;
    /* Thin refracting glass, as the plain pills under it. */
    --glass-alpha: 30%;
  }
  .tile:hover:not(:disabled) { outline-color: var(--primary); }
  /* Pressed, the resting fill comes back under the press wash (the hover tint is lighter than it in dark themes). */
  .tile:hover:not(:disabled):not(:active) { --glass-tint: color-mix(in srgb, var(--primary) var(--pill-hover-tint), var(--surface)); }
  /* Used: a thinner surface with no shadow and the glyph in the muted colour (3:1 as large text), not an opacity fade. */
  .tile.used { cursor: default; color: var(--text-2); --glass-alpha: 12%; --glass-shadow: 0 0 transparent; }
  /* Scored: the tiles stay glass. The verdict is a tint plus a 2px ring over the edge, with the rim just inside it. */
  .tile.ok, .tile.off { --glass-alpha: 78%; --glass-rim-w: 3px; --glass-shadow: 0 1px 2px rgb(var(--glass-black) / .1), 0 2px 6px rgb(var(--glass-black) / .06); box-shadow: inset 0 0 0 2px var(--c), var(--glass-rim), var(--glass-shadow); color: var(--c); --glass-tint: color-mix(in srgb, var(--c) 18%, var(--surface)); }
  /* --good is a light green: a 12 % tint and a glyph pulled toward the text colour keep 4.5:1. */
  .tile { --arc-inset: 2px; --arc-r: 12px; }
  .tile.ok { --c: var(--good); --glass-tint: color-mix(in srgb, var(--good) 12%, var(--surface)); color: color-mix(in srgb, var(--good) 70%, var(--text)); }
  .tile.off { --c: var(--tone2); }
  /* The ring colour alone clashes with the tone colours of the reference pinyin: a disc with a check or a cross on the
     ring, as on the tone buttons (Tones.svelte), in the ring's colour. */
  .badge { position: absolute; top: -6px; right: 1px; width: 14px; height: 14px; box-shadow: 0 0 0 2px var(--surface); color: var(--c); }
  .badge :global(.icon) { margin: -1.5px; }
  .legend-mark { display: inline-grid; vertical-align: -2px; color: var(--tone2); }
  .tile:disabled { cursor: default; }
  .actions { gap: 8px; }
  /* Scrolled into view with room for the card's padding and its shadow under it. */
  .actions .btn, .next .btn { scroll-margin-bottom: 24px; }
  .next { justify-content: flex-end; margin-top: 14px; }
  .result { display: flex; flex-direction: column; gap: 8px; }
  .points { font-size: 20px; }
  .points b { font-size: 28px; color: var(--tone2); }
  .points.perfect b { color: var(--good); }
  .reference { line-height: 1.5; }
  .ref-zh { font-size: 24px; margin-left: 6px; }
  .ref-py { font-family: var(--font-pinyin); color: var(--text-2); }
  .ref-vi { font-weight: 800; }
  .small { font-size: 12.5px; margin: 0; }
  .sm { padding: 2px 8px; }
  .summary { text-align: center; padding: 30px; }
  .summary .big { font-size: 48px; }
  .summary a { text-decoration: none; }
  .center { justify-content: center; }
</style>

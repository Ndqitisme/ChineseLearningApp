<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import { untrack } from 'svelte';
  import { dataset, words } from '../../lib/data.ts';
  import { plain, score, tiles, type Score } from '../../lib/sentence.ts';
  import { isOpen } from '../../lib/settings.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { deckFrom, shuffle } from '../deck.ts';

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
    if (e.key === 'Enter') { e.preventDefault(); if (result) next(); else if (complete) check(); }
    else if (e.key === 'Backspace' && !result && picked.length) { e.preventDefault(); picked = picked.slice(0, -1); }
  }
  const average = $derived(points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : 0);
  const verdict = (p: number) => (p === 100 ? 'Chính xác' : p >= 70 ? 'Gần đúng' : 'Cần xem lại');
  const tail = deckParams.length ? `/${deckParams.join('/')}` : '';
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <BackButton to="/practice" label="Luyện tập" />
  <h1><Icon name="build" /> Ghép câu</h1>
  <div class="tabs">
    <a class="chip" class:on={mode === 'order'} href="#/build/order{tail}">Sắp xếp thành câu</a>
    <a class="chip" class:on={mode === 'qa'} href="#/build/qa{tail}">Trả lời câu hỏi</a>
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
    <div class="card task">
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
          <button class="tile han" class:ok={result?.inPlace[i]} class:off={result && !result.inPlace[i]} onclick={() => remove(id)} disabled={!!result}>{tile.text}</button>
        {:else}
          <span class="muted placeholder">Chọn các từ bên dưới…</span>
        {/each}
      </div>

      {#if !result}
        <div class="pool">
          {#each item.pool as tile (tile.id)}
            <button class="tile han" class:used={picked.includes(tile.id)} disabled={picked.includes(tile.id)} onclick={() => add(tile.id)}>{tile.text}</button>
          {/each}
        </div>
        <div class="row actions">
          <button class="btn" onclick={() => (picked = [])} disabled={!picked.length}>Xoá hết</button>
          <button class="btn primary" onclick={check} disabled={!complete}>Kiểm tra</button>
        </div>
      {:else}
        <div class="result">
          <div class="points" class:perfect={result.points === 100}><b>{result.points}</b>/100 · {verdict(result.points)}</div>
          <div class="reference" data-has-pinyin>
            <span class="muted">Câu chuẩn:</span>
            <span class="han ref-zh">{result.target === 0 ? item.sentence : item.accepted[result.target].join('')}</span>
            {#if speechAvailable()}<button class="btn ghost sm" onclick={() => speak(item.sentence).catch(() => {})}><Icon name="speaker" /></button>{/if}
            <div class="ref-py">{item.py}</div>
            <div class="ref-vi">{item.vi}</div>
          </div>
          {#if result.points < 100}<p class="muted small">Từ màu cam là chỗ lệch thứ tự so với câu chuẩn.<br />Một số câu còn có cách sắp xếp khác cũng đúng; câu chuẩn là cách nói thông dụng nhất.</p>{/if}
          <div class="row actions"><button class="btn primary" onclick={next}>Tiếp →</button></div>
        </div>
      {/if}
    </div>
  {:else if round.items.length}
    <div class="card summary">
      <div class="big"><Icon name={average >= 90 ? 'result-great' : average >= 60 ? 'result-good' : 'result-try'} /></div>
      <h2>Điểm trung bình {average}/100</h2>
      <p class="muted">{points.filter((p) => p === 100).length}/{points.length} câu chính xác hoàn toàn.</p>
      <div class="row center">
        <button class="btn primary" onclick={again}>Làm lượt mới</button>
        <a class="btn" href="#/practice">Về trang luyện tập</a>
      </div>
    </div>
  {:else}
    <p class="empty">Chưa có câu để luyện ở đây.</p>
  {/if}
</div>

<style>
  .tabs { display: flex; gap: 8px; margin: 2px 0 6px; }
  .tabs a { text-decoration: none; }
  .progress { height: 8px; background: var(--surface-2); border-radius: 99px; overflow: hidden; margin-bottom: 14px; }
  .progress i { display: block; height: 100%; background: var(--primary); transition: width .3s; }
  .task { display: flex; flex-direction: column; gap: 10px; }
  .count { font-size: 13px; }
  .question { font-size: 30px; }
  .ask { font-weight: 800; }
  .answer {
    min-height: 62px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border: 2px dashed var(--border);
    border-radius: 14px;
  }
  .answer.done { border-style: solid; }
  .placeholder { font-size: 14px; }
  .pool { display: flex; flex-wrap: wrap; gap: 8px; }
  .tile {
    font-size: 24px;
    padding: 6px 14px;
    border: 2px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }
  .tile:hover:not(:disabled) { border-color: var(--primary); }
  .tile.used { opacity: .3; cursor: default; }
  .tile.ok { border-color: var(--good); color: var(--good); }
  .tile.off { border-color: var(--tone2); color: var(--tone2); }
  .tile:disabled { cursor: default; }
  .actions { gap: 8px; }
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

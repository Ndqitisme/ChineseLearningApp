<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import Switch from '../../lib/ui/Switch.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import BackButton from '../components/BackButton.svelte';
  import { isHan } from '../../lib/pinyin.ts';
  import { settings, updateSettings } from '../../lib/settings.svelte.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import HanziStroke from '../components/HanziStroke.svelte';
  import { deckFrom, deckOrigin, shuffle } from '../deck.ts';

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
  /** Auto demo runs only on a character's first try, not after "Viết lại". */
  let firstTry = $state(true);
  let board = $state<HanziStroke>();

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
    firstTry = true;
    attempt++;
  }
  function retry() { result = null; firstTry = false; attempt++; }
</script>

<div class="page">
  <BackButton to={deckOrigin(params)} useHistory />
  <h1><Icon name="write" hue={HUE_OF.write} /> Viết theo nét</h1>
  <p class="lead">{deck.title}<br />Xem mẫu thứ tự nét rồi vẽ lại bằng chuột.<br />Sai 3 lần ở một nét thì nét đó tự hiện gợi&nbsp;ý.</p>

  {#if deck.gone}
    <p class="empty">{deck.gone.text} <a href={deck.gone.href}>{deck.gone.link}</a></p>
  {:else if word}
    <div class="layout">
      <div class="card glass target" data-has-pinyin>
        <span class="muted">Từ {wi + 1}/{queue.length}</span>
        <div class="word han">
          {#each chars as ch, i (i)}<span class:current={i === ci} class:done={i < ci}>{ch}</span>{/each}
        </div>
        <Pinyin text={word.pinyin} syllables={word.syllables} />
        <div class="vi">{word.vi}</div>
        <label class="row small"><Switch checked={showOutline} onchange={(on) => { showOutline = on; attempt++; }} /> Hiện chữ mờ để tô theo</label>
        <label class="row small"><Switch checked={settings.writeDemo} onchange={(on) => updateSettings({ writeDemo: on })} /> Tự xem mẫu khi sang chữ mới</label>
      </div>
      <div class="board">
        {#key `${wi}-${ci}-${attempt}`}
          <HanziStroke bind:this={board} char={chars[ci]} size={300} mode="quiz" {showOutline} demoFirst={settings.writeDemo && firstTry} oncomplete={complete} />
        {/key}
        {#if result === null}
          <div class="row tools">
            <button use:glass class="btn glass glass-press" onclick={() => board?.demo()}><Icon name="play" /> Xem mẫu</button>
            <button use:glass class="btn glass glass-press" onclick={() => board?.hint()}><Icon name="hint" /> Gợi ý nét</button>
          </div>
        {/if}
        {#if result !== null}
          <div class="result card">
            <b class={result === 0 ? 'good' : result < 3 ? '' : 'bad'}>{result === 0 ? 'Không sai nét nào' : `Sai ${result} nét`}</b>
            <div class="row">
              <button use:glass class="btn glass glass-press" onclick={retry}>Viết lại</button>
              <button use:glass class="btn glass glass-press primary" onclick={next}>Tiếp →</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else if queue.length}
    <div class="card glass done">
      <div class="big"><Icon name="brush" /></div>
      <h2>Xong {queue.length} từ, tổng cộng sai {totalMistakes} nét</h2>
      <a use:glass class="btn glass glass-press primary" href="#/practice">Về trang luyện tập</a>
    </div>
  {:else}
    <p class="empty">Chưa có từ để luyện viết.</p>
  {/if}
</div>

<style>
  /* The target card and the board stay on one row down to 860 px: the card gives up width, the board keeps 300 px.
     (With wrapping on, the line breaks at the card's full width before it can shrink.) The card grows only to its
     content's width, the board follows it, and the card stretches to the board's height so the two bottoms line up. */
  .layout { display: flex; gap: 24px; align-items: stretch; }
  .target { flex: 1 1 420px; display: flex; flex-direction: column; gap: 6px; min-width: 220px; font-size: 18px; }
  .board { flex: none; }
  .word { font-size: 56px; letter-spacing: 4px; }
  /* Characters still to write: the muted colour (3:1 as large text), not a faded ghost. */
  .word span { color: var(--text-2); }
  .word span.current { color: var(--primary-ink); opacity: 1; }
  .word span.done { color: var(--good); opacity: 1; }
  .vi { font-weight: 900; font-size: 20px; }
  .small { font-size: 13px; margin-top: 8px; cursor: pointer; }
  .board { display: flex; flex-direction: column; gap: 12px; }
  .tools { gap: 8px; }
  .result { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .done { text-align: center; padding: 30px; }
  .done .big { font-size: 48px; }
  .done a { text-decoration: none; }
</style>

<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import type { Word } from '../lib/types.ts';
  import { topicById } from '../lib/data.ts';
  import { hskLevel } from '../lib/settings.svelte.ts';
  import Pinyin from '../lib/ui/Pinyin.svelte';
  import type { Anchor } from './geometry.ts';

  interface Props {
    word: Word;
    revealed: boolean;
    swapping: boolean;
    anchor: Anchor;
    starred: boolean;
    canSpeak: boolean;
    /** false when the character is hidden: no tail pointing at her head. */
    tail: boolean;
    /** Tail offset from the bubble's top, CSS px (level with her eyes). */
    tailTop?: number;
    showHanviet: boolean;
    showExample: boolean;
    onopen: () => void;
    onspeak: () => void;
    onsetupvoice: () => void;
    onhandledown: (e: PointerEvent) => void;
    onhandlemove: (e: PointerEvent) => void;
    onknown: () => void;
    onstar: () => void;
    onreveal: () => void;
    onhover: (inside: boolean) => void;
  }
  let p: Props = $props();
  const topic = $derived(p.word.topics[0] ? topicById.get(p.word.topics[0]) : undefined);
  const size = $derived([...p.word.hanzi].length > 3 ? 'long' : 'short');
  const level = $derived(hskLevel(p.word));
  /** Presses on controls act on them; anywhere else on the bubble starts a window drag. */
  const onControl = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a, input, select, textarea');
</script>

<div
  class="bubble"
  class:right={p.anchor.h === 'right'}
  class:notail={!p.tail}
  style:--tail-top={p.tailTop === undefined ? null : `${p.tailTop}px`}
  role="dialog"
  aria-label="Từ mới"
  tabindex="-1"
  onpointerenter={() => p.onhover(true)}
  onpointerleave={() => p.onhover(false)}
  onpointerdown={(e) => { if (!onControl(e.target)) p.onhandledown(e); }}
  onpointermove={p.onhandlemove}
>
  <div class="content" class:out={p.swapping}>
  <div class="meta">
    {#if topic}<span><Icon name={topic.icon} /> {topic.title}</span>{/if}
    {#if level}<span class="hsk">HSK {level}</span>{/if}
  </div>

  <!-- Hover pinyin stays off until the meaning is revealed, so it cannot give the answer away. -->
  <div class="head" data-has-pinyin={p.revealed ? '' : undefined} data-hover-pinyin={p.revealed ? undefined : 'off'}>
    <button class="hanzi han {size}" onclick={p.onopen} title="Mở trong app">{p.word.hanzi}</button>
  </div>

  {#if p.revealed}
    <div class="reveal">
      <div class="pinyin"><Pinyin text={p.word.pinyin} syllables={p.word.syllables} /></div>
      <div class="vi">{p.word.vi}</div>
      {#if p.showHanviet && p.word.hanviet}<div class="hv">Hán Việt: {p.word.hanviet}</div>{/if}
      {#if p.showExample && p.word.ex}
        <div class="ex"><span class="han">{p.word.ex.zh}</span><br /><span class="ex-vi">{p.word.ex.vi}</span></div>
      {/if}
    </div>
  {:else}
    <button class="guess" onclick={p.onreveal}>Đoán nghĩa trước khi <b>xem đáp án</b></button>
  {/if}

  <div class="actions">
    <div class="marks">
      <button onclick={p.onknown} title="Đánh dấu đã biết">✓ Biết rồi</button>
      <button class:on={p.starred} onclick={p.onstar} title="Lưu vào sổ tay">{p.starred ? '★' : '☆'}</button>
    </div>
    <button
      class="speak"
      class:off={!p.canSpeak}
      onclick={p.canSpeak ? p.onspeak : p.onsetupvoice}
      title={p.canSpeak ? 'Nghe phát âm' : 'Chưa cài giọng đọc — bấm để cài'}
      aria-label="Nghe phát âm"
    ><Icon name="speaker" /></button>
  </div>
  </div>
</div>

<style>
  .bubble {
    position: relative;
    width: 264px;
    padding: 10px 14px 10px;
    background: var(--bubble-bg);
    color: var(--bubble-text);
    border: 2.5px solid var(--bubble-border);
    border-radius: var(--radius);
    box-shadow: var(--pet-shadow);
    text-align: center;
    cursor: grab;
    animation: pop 0.22s cubic-bezier(0.2, 1.4, 0.4, 1);
    transform-origin: top left;
  }
  .bubble.right { transform-origin: top right; }
  .bubble :global(button) { cursor: pointer; }
  /* Tail on the side facing Tiểu Mai, level with her head. */
  .bubble::after {
    content: '';
    position: absolute;
    /* never below the bubble's last 30 px, whatever its height */
    top: min(var(--tail-top, 26px), calc(100% - 30px));
    left: -11px;
    width: 16px;
    height: 16px;
    background: var(--bubble-bg);
    border-left: 2.5px solid var(--bubble-border);
    border-bottom: 2.5px solid var(--bubble-border);
    transform: rotate(45deg);
    border-bottom-left-radius: 4px;
  }
  .bubble.right::after {
    left: auto;
    right: -11px;
    border: 0;
    border-top: 2.5px solid var(--bubble-border);
    border-right: 2.5px solid var(--bubble-border);
    border-radius: 0 4px 0 0;
  }
  .bubble.notail::after { display: none; }
  @keyframes pop {
    from { transform: scale(0.6); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .content { transition: opacity 0.45s ease; }
  .content.out { opacity: 0; pointer-events: none; }
  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-2);
    gap: 6px;
  }
  .hsk {
    background: var(--surface-2);
    border-radius: 99px;
    padding: 0 7px;
  }
  .hanzi {
    display: block;
    margin: 0 auto;
    border: 0;
    background: none;
    font-size: 46px;
    line-height: 1.15;
    color: var(--bubble-text);
    padding: 0 4px;
    border-radius: 10px;
  }
  .hanzi.long { font-size: 34px; }
  .head { display: flex; align-items: center; justify-content: center; }
  .speak {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .speak:hover { background: var(--accent); }
  .speak.off { opacity: .45; filter: grayscale(1); }
  .hanzi:hover { background: var(--surface-2); }
  .reveal { animation: fade 0.25s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(3px); } }
  .pinyin { font-size: 17px; margin-top: 1px; }
  .vi { font-weight: 800; font-size: 20px; margin-top: 3px; line-height: 1.25; }
  .hv { font-size: 15px; color: var(--text-2); margin-top: 3px; }
  .ex { font-size: 12.5px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); line-height: 1.45; }
  .ex .han { font-size: 15px; }
  .ex-vi { color: var(--text-2); }
  .guess {
    border: 1.5px dashed var(--bubble-border);
    background: none;
    border-radius: 99px;
    padding: 5px 12px;
    font-size: 12.5px;
    color: var(--text-2);
    margin: 6px 0 2px;
  }
  .guess b { color: var(--primary); }
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }
  .marks { display: flex; gap: 6px; }
  .marks button {
    border: 0;
    background: var(--surface-2);
    border-radius: 99px;
    padding: 3px 10px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text);
  }
  .marks button:hover { background: var(--accent); }
  .marks button.on { color: #e0a100; }
</style>

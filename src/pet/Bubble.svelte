<script lang="ts">
  import type { Word } from '../lib/types.ts';
  import { topicById } from '../lib/data.ts';
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
    /** The topic line doubles as a drag handle when there is no character to grab. */
    draggable: boolean;
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
</script>

<div
  class="bubble"
  class:right={p.anchor.h === 'right'}
  class:notail={!p.tail}
  role="dialog"
  aria-label="Từ mới"
  tabindex="-1"
  onpointerenter={() => p.onhover(true)}
  onpointerleave={() => p.onhover(false)}
>
  <div class="content" class:out={p.swapping}>
  <div
    class="meta"
    class:handle={p.draggable}
    role="presentation"
    title={p.draggable ? 'Kéo để di chuyển' : undefined}
    onpointerdown={p.draggable ? p.onhandledown : undefined}
    onpointermove={p.draggable ? p.onhandlemove : undefined}
  >
    {#if topic}<span>{topic.icon} {topic.title}</span>{/if}
    {#if p.word.hsk}<span class="hsk">HSK {p.word.hsk}</span>{/if}
  </div>

  <!-- Pinyin is shown under the word once revealed; before that, hovering must not give it away. -->
  <div class="head" data-has-pinyin={p.revealed ? '' : undefined} data-hover-pinyin={p.revealed ? undefined : 'off'}>
    <button class="hanzi han {size}" onclick={p.onopen} title="Mở trong app">{p.word.hanzi}</button>
    <button
      class="speak"
      class:off={!p.canSpeak}
      onclick={p.canSpeak ? p.onspeak : p.onsetupvoice}
      title={p.canSpeak ? 'Nghe phát âm' : 'Chưa cài giọng đọc — bấm để cài'}
      aria-label="Nghe phát âm"
    >🔊</button>
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
    <button class="guess" onclick={p.onreveal}>Đoán nghĩa trước nhé… <b>xem đáp án</b></button>
  {/if}

  <div class="actions">
    <button onclick={p.onknown} title="Mình biết từ này rồi">✓ Biết rồi</button>
    <button class:on={p.starred} onclick={p.onstar} title="Lưu vào sổ tay">{p.starred ? '★' : '☆'}</button>
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
    box-shadow: var(--shadow);
    text-align: center;
    animation: pop 0.22s cubic-bezier(0.2, 1.4, 0.4, 1);
    transform-origin: bottom left;
  }
  .bubble.right { transform-origin: bottom right; }
  /* tail pointing at Tiểu Mai's head */
  .bubble::after {
    content: '';
    position: absolute;
    bottom: -11px;
    left: 26px;
    width: 16px;
    height: 16px;
    background: var(--bubble-bg);
    border-right: 2.5px solid var(--bubble-border);
    border-bottom: 2.5px solid var(--bubble-border);
    transform: rotate(45deg);
    border-bottom-right-radius: 4px;
  }
  .bubble.right::after { left: auto; right: 26px; }
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
  .head { display: flex; align-items: center; justify-content: center; gap: 2px; }
  .speak {
    flex: none;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .speak:hover { background: var(--accent); }
  .speak.off { opacity: .45; filter: grayscale(1); }
  .meta.handle { cursor: grab; }
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
    justify-content: center;
    gap: 6px;
    margin-top: 8px;
  }
  .actions button {
    border: 0;
    background: var(--surface-2);
    border-radius: 99px;
    padding: 3px 10px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text);
  }
  .actions button:hover { background: var(--accent); }
  .actions button.on { color: #e0a100; }
</style>

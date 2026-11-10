<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import type { Word } from '../lib/types.ts';
  import { HSK_HUE, topicById, topicHue } from '../lib/data.ts';
  import { hskLevel } from '../lib/settings.svelte.ts';
  import { HUE_OF, hueVar } from '../lib/theme/themes.ts';
  import Phrases from '../lib/ui/Phrases.svelte';
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
  class="bubble glass-solid glass-arc"
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
  <!-- Tail outside the bubble box, drawn as one shape with the body's fill and alpha; its base overlaps the body by 4px
       to hide the body's ring, rim and arc, and only its two slanted sides are stroked. -->
  <svg class="tail" viewBox="0 0 15 20" aria-hidden="true"><polygon points="15,0 1.5,10 15,20" /><polyline points="12,1 1.5,10 12,19" /></svg>
  <div class="content" class:out={p.swapping}>
  <div class="meta">
    {#if topic}<span class="topic" style:--h={hueVar(topicHue(topic))}><Icon name={topic.icon} size="18px" /> {topic.title}</span>{/if}
    {#if level}<span class="hsk" style:--h={hueVar(HSK_HUE)}>HSK {level}</span>{/if}
  </div>

  <!-- Hover pinyin stays off until the meaning is revealed, so it cannot give the answer away. -->
  <div class="head" data-has-pinyin={p.revealed ? '' : undefined} data-hover-pinyin={p.revealed ? undefined : 'off'}>
    <button class="hanzi han {size}" onclick={p.onopen} title="Mở trong app">{p.word.hanzi}</button>
  </div>

  {#if p.revealed}
    <div class="reveal">
      <div class="pinyin"><Pinyin text={p.word.pinyin} syllables={p.word.syllables} /></div>
      <div class="vi"><Phrases text={p.word.vi} /></div>
      {#if p.showHanviet && p.word.hanviet}<div class="hv">Hán Việt: {p.word.hanviet}</div>{/if}
      {#if p.showExample && p.word.ex}
        <div class="ex"><span class="han">{p.word.ex.zh}</span><br /><span class="ex-vi">{p.word.ex.vi}</span></div>
      {/if}
    </div>
  {:else}
    <button class="guess glass-rim" onclick={p.onreveal}>Đoán nghĩa trước khi <b>xem đáp án</b></button>
  {/if}

  <div class="actions">
    <div class="marks">
      <button class="known glass-rim" onclick={p.onknown} title="Đánh dấu đã biết"><Icon name="done" /> Biết rồi</button>
      <button class="star glass-rim" class:on={p.starred} onclick={p.onstar} title="Lưu vào sổ tay" aria-label="Lưu vào sổ tay" aria-pressed={p.starred}><Icon name="nav-notebook" /></button>
    </div>
    <button
      class="speak glass-rim"
      class:off={!p.canSpeak}
      style:--h={hueVar(HUE_OF.listen)}
      onclick={p.canSpeak ? p.onspeak : p.onsetupvoice}
      title={p.canSpeak ? 'Nghe phát âm' : 'Chưa cài giọng đọc — bấm để cài'}
      aria-label="Nghe phát âm"
    ><Icon name="speaker" /></button>
  </div>
  </div>
</div>

<style>
  /* Frosted glass that reads on any desktop: opaque enough (UI-GLASS.md §2) with the bubble-border colour as its ring. */
  /* .bubble.glass-solid outranks the dark-theme outline rule in glass.css, so the ring is always the bubble-border colour. */
  .bubble.glass-solid {
    position: relative;
    width: 264px;
    /* 14px on the right and bottom: the speaker sits concentric with the bubble's corner. */
    padding: 10px 14px 14px;
    /* 6% primary in the fill, so the white top-left rim can show on a light bubble. Opaque: the tail's base lies over the
       body, and at 98 % that strip was denser than the body around it. */
    --glass-tint: color-mix(in srgb, var(--primary) var(--pet-tint), var(--bubble-bg));
    --glass-alpha: 100%;
    color: var(--bubble-text);
    border-radius: var(--radius);
    /* The 2px bubble-border ring on top, the glass rim just inside it. */
    --glass-rim-w: 3px;
    --glass-rim-top: 4px;
    box-shadow: inset 0 0 0 2px var(--bubble-border), var(--glass-rim), inset 0 8px 10px -8px rgb(var(--glass-white) / var(--pet-glow));
    /* One shadow for the body and the tail together: a box-shadow ran straight past the tail. */
    filter: drop-shadow(0 2px 4px rgb(0 0 0 / .22));
    text-align: center;
    cursor: grab;
    /* No overshoot past scale 1: Chrome can keep a will-change: transform layer at a raster scale it took during the
       pop, and one above 1 was then drawn downsampled, soft (the 11px label at 3.4:1 in a fresh window). */
    animation: pop 0.22s cubic-bezier(0.2, 1, 0.4, 1);
    transform-origin: top left;
  }
  /* The specular arc (glass-arc) sits inside the 2px ring. */
  .bubble { --arc-inset: 2px; --arc-r: var(--radius); --arc-tint: var(--bubble-border); }
  .bubble.right { transform-origin: top right; }
  .bubble :global(button) { cursor: pointer; }
  /* Tail on the side facing Tiểu Mai, level with her head: a 12×20 triangle just outside the box. */
  .tail {
    position: absolute;
    /* A straight run of edge (12px) below the corner arc, so corner and tail never merge into one bump; never below the
       last 30 px. */
    top: clamp(calc(var(--radius) + 12px), var(--tail-top, 26px), calc(100% - 30px));
    /* 4px over the body: the base covers the ring, the rim and the dark arc (2-3.5px in), so no line crosses the tail. */
    left: -11px;
    width: 15px;
    height: 20px;
    pointer-events: none;
  }
  .tail polygon { fill: color-mix(in srgb, var(--glass-tint) var(--glass-alpha), transparent); }
  .tail polyline { fill: none; stroke: var(--bubble-border); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .bubble.right .tail { left: auto; right: -11px; transform: scaleX(-1); }
  .bubble.notail .tail { display: none; }
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
  /* Small text in a hue is mixed toward the text colour so it keeps 4.5:1 on the bubble and on its tint. */
  /* Weight 700, as the HSK chip beside it. */
  .topic { color: color-mix(in srgb, var(--h) 75%, var(--bubble-text)); font-weight: 700; }
  /* Light: at 11px the thin strokes render lighter than that colour (stroke core 3.3:1 on the bubble face); 40 % of the
     text colour brings the core to 5:1. The icon follows the colour. */
  :global(:root[data-theme='light']) .topic { color: color-mix(in srgb, var(--h) 60%, var(--bubble-text)); }
  /* 14px and the label's colour: at the 11px line size the icon broke up into specks. */
  .topic { display: inline-flex; align-items: center; gap: 3px; }
  /* 18px box: the icon art has padding inside its sheet cell, and the drawn hand should be about 14px. */
  .topic :global(.icon) { margin: -3px 0; color: inherit; }
  /* Tinted from the bubble's own face (a fixed tint matched Biển xanh's blue face at 1.0:1), with a 1px rim as the
     bubble's other pills have. */
  .hsk {
    background: color-mix(in srgb, var(--h) 14%, var(--glass-tint));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--h) 35%, transparent);
    /* More of the text colour than the topic label: on the tinted chip 75 % fell to 3.8:1 (Matcha light). */
    color: color-mix(in srgb, var(--h) 55%, var(--bubble-text));
    font-weight: 700;
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
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--h) 16%, var(--bubble-bg));
    color: var(--h);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  /* The bubble's buttons share the glass rim (1px, not the bubble's deeper ring rim they would inherit) and a close shadow. */
  .speak, .guess, .marks button {
    --glass-rim-w: 1px;
    --glass-rim-top: 1px;
    box-shadow: var(--glass-rim), 0 1px 2px rgb(var(--glass-black) / .1), 0 2px 6px rgb(var(--glass-black) / .06);
  }
  .speak:hover, .guess:hover, .marks button:hover { --glass-rim-hi: var(--rim-hover); --glass-rim-mid: var(--rim-hover-mid); --glass-rim-top: 2px; }
  /* Dark: a 2px band read as a light outline around the pill; 1px, brightest on top. */
  :global(:root[data-theme='dark']) :is(.speak, .guess, .marks button):hover { --glass-rim-top: 1px; }
  .speak:active { transform: translateY(1px) scale(.96); --glass-rim-hi: var(--rim-press); --glass-rim-mid: var(--rim-press-mid); box-shadow: var(--glass-rim), inset 0 2px 4px rgb(var(--glass-black) / .18); }
  .speak:hover { background: var(--accent); }
  /* No voice yet: the muted colour on a neutral disc (3:1), not a faded icon. */
  .speak.off { color: var(--text-2); background: color-mix(in srgb, var(--text) 8%, transparent); }
  .speak.off:hover:not(:active) { background: color-mix(in srgb, var(--text) 18%, transparent); }
  /* The headword opens the word in the app: a primary tint on hover (the light surface tint matched the bubble), and it sinks. */
  .hanzi:hover { background: color-mix(in srgb, var(--primary) 12%, transparent); }
  .hanzi:active { transform: scale(.97); background: color-mix(in srgb, var(--primary) 18%, transparent); }
  /* Dark: the pressed buttons sink (an inner shadow in the background colour and a black wash); the lighter hover
     tints would read as lit. */
  :global(:root[data-theme='dark']) :is(.speak, .guess, .marks button):active { box-shadow: var(--glass-rim), inset 0 2px 6px color-mix(in srgb, var(--bg) 60%, transparent), inset 0 0 0 100vmax rgb(var(--glass-black) / .25); }
  /* The light accent hover would stay under the wash: a neutral pill presses from its resting fill. The guess and known
     pills too: their deeper hover tints under the wash came out as light as their resting faces (1-5 levels). */
  :global(:root[data-theme='dark']) .marks button:not(.known, .on):active { background: color-mix(in srgb, var(--text) 9%, var(--bubble-bg)); }
  :global(:root[data-theme='dark']) .guess:active { background: color-mix(in srgb, var(--primary) 12%, var(--bubble-bg)); }
  :global(:root[data-theme='dark']) .marks .known:active { background: color-mix(in srgb, var(--c) 16%, var(--bubble-bg)); }
  :global(:root[data-theme='dark']) .hanzi:active { background: transparent; box-shadow: inset 0 0 0 100vmax rgb(var(--glass-black) / .25); }
  .hanzi:focus-visible, .guess:focus-visible, .speak:focus-visible, .marks button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .reveal { animation: fade 0.25s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(3px); } }
  @media (prefers-reduced-motion: reduce) {
    .bubble, .reveal { animation: none; }
    .content { transition: none; }
  }
  .pinyin { font-size: 17px; margin-top: 1px; }
  .vi { font-weight: 800; font-size: 20px; margin-top: 3px; line-height: 1.25; }
  .hv { font-size: 15px; color: var(--text-2); margin-top: 3px; }
  /* Light: the thin 15px strokes rendered at 3.5-3.7:1 (stroke core), as the word page's Hán Việt label. */
  :global(:root[data-theme='light']) .hv { color: color-mix(in srgb, var(--text-2) 40%, var(--text)); font-weight: 500; }
  .ex { font-size: 12.5px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); line-height: 1.45; }
  .ex .han { font-size: 15px; }
  .ex-vi { color: var(--text-2); }
  /* Light: the thin 12.5px strokes render lighter than their colour (stroke core 3.6-3.7:1 at 80 % --text-2); half the
     text colour and weight 500 bring it to 4.9-5.3:1. */
  :global(:root[data-theme='light']) .ex-vi { color: color-mix(in srgb, var(--text-2) 50%, var(--text)); font-weight: 500; }
  /* The guess state's main action: a lightly primary-tinted pill, not a dashed placeholder. */
  .guess {
    border: 0;
    background: color-mix(in srgb, var(--primary) 12%, var(--bubble-bg));
    border-radius: 99px;
    padding: 5px 12px;
    font-size: 12.5px;
    color: var(--bubble-text);
    margin: 6px 0 2px;
  }
  .guess b { color: var(--primary-ink); }
  /* Light: on the hover tint Hoa anh đào's pink ink was 4.3:1 (stroke core); with 30 % of the text colour it holds 4.5. */
  :global(:root[data-theme='light']) .guess b { color: color-mix(in srgb, var(--primary-ink) 70%, var(--bubble-text)); }
  /* Its own layer from rest: created on press, the label switched to subpixel anti-aliasing (coloured fringes). The
     bubble has its own layer too: without it the pill's layer moved the headword and labels around it onto subpixel
     anti-aliasing in the guess state (max |R-B| 168 against 34 when revealed). */
  .guess { will-change: transform; }
  .bubble { will-change: transform; }
  /* Hover and press as the other bubble pills: a denser tint and a lift, then the pill sinks. */
  .guess:hover { background: color-mix(in srgb, var(--primary) 24%, var(--bubble-bg)); transform: translateY(-1px); box-shadow: var(--glass-rim), 0 2px 4px rgb(var(--glass-black) / .12), 0 6px 14px rgb(var(--glass-black) / .12); }
  /* No scale: the scaled layer is redrawn soft, and the label fell to 4.2-4.4:1 (as the switch, it only sinks 1px). */
  .guess:active { transform: translateY(1px); --glass-rim-hi: var(--rim-press); --glass-rim-mid: var(--rim-press-mid); box-shadow: var(--glass-rim), inset 0 2px 4px rgb(var(--glass-black) / .18); }
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }
  .marks { display: flex; gap: 6px; }
  .marks button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    /* Unsaved and other neutral pills: a light tint of the text colour, so the pill has a body on the light bubble. */
    background: color-mix(in srgb, var(--text) 9%, var(--bubble-bg));
    border-radius: 99px;
    padding: 3px 10px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text);
  }
  .marks button:hover { background: var(--accent); color: var(--text); transform: translateY(-1px); box-shadow: var(--glass-rim), 0 2px 4px rgb(var(--glass-black) / .12), 0 6px 14px rgb(var(--glass-black) / .12); }
  .marks button:active { transform: translateY(1px) scale(.96); --glass-rim-hi: var(--rim-press); --glass-rim-mid: var(--rim-press-mid); box-shadow: var(--glass-rim), inset 0 2px 4px rgb(var(--glass-black) / .18); }
  /* --good is lighter than the hues, so its label needs more of the text colour to keep 4.5:1. */
  .marks .known { --c: var(--good); color: color-mix(in srgb, var(--c) 60%, var(--bubble-text)); }
  .marks .star.on { --c: var(--hue-amber); color: var(--c); }
  .marks .known, .marks .star.on { background: color-mix(in srgb, var(--c) 16%, var(--bubble-bg)); }
  /* Dark: 16 % amber over the dark bubble is a muddy grey-brown. */
  :global(:root[data-theme='dark']) .marks .star.on { background: color-mix(in srgb, var(--c) 28%, var(--bubble-bg)); }
  /* Hover keeps the meaning colour of the label; the fill deepens and the pill lifts. */
  .marks .known:hover { background: color-mix(in srgb, var(--c) 26%, var(--bubble-bg)); color: color-mix(in srgb, var(--c) 60%, var(--bubble-text)); }
  .marks .star.on:hover { background: color-mix(in srgb, var(--c) 24%, var(--bubble-bg)); color: var(--c); }
  :global(:root[data-theme='dark']) .marks .star.on:hover { background: color-mix(in srgb, var(--c) 16%, var(--bubble-bg)); }
</style>

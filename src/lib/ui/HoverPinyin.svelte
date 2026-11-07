<script lang="ts">
  // Shows pinyin for any Chinese character under the pointer, unless the surrounding area
  // already displays pinyin ([data-has-pinyin]) or hides it on purpose ([data-hover-pinyin="off"]).
  import { onMount } from 'svelte';
  import { MAX_WORD_LEN } from '../data.ts';
  import { openByHanzi } from '../settings.svelte.ts';
  import { isHan, toSyllables, type Syllable } from '../pinyin.ts';
  import Pinyin from './Pinyin.svelte';

  /** The assistant window loads no pinyin-pro (PLAN §6): characters outside the dictionary get no tooltip there. */
  let { dictionaryOnly = false }: { dictionaryOnly?: boolean } = $props();

  /** x is the hovered character's centre; top/bottom its edges (viewport px). */
  interface Tip { x: number; top: number; bottom: number; text: string; pinyin: string; syllables: Syllable[]; hanviet?: string; vi?: string }
  let tip = $state<Tip | null>(null);
  let tipEl = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });

  // Above the character when it fits, otherwise below; always kept inside the window.
  $effect(() => {
    if (!tip || !tipEl) return;
    const gap = 8, margin = 4;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const above = tip.top - gap - h;
    const top = above >= margin ? above : Math.min(tip.bottom + gap, innerHeight - h - margin);
    const left = Math.min(Math.max(tip.x - w / 2, margin), innerWidth - w - margin);
    pos = { left, top };
  });
  let pinyinPro: typeof import('pinyin-pro').pinyin | undefined;
  let pinyinProLoading = false;
  const contextCache = new Map<string, string[]>();

  function caretAt(x: number, y: number): { node: Text; offset: number } | null {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const pos = d.caretPositionFromPoint?.(x, y);
    if (pos) return pos.offsetNode.nodeType === Node.TEXT_NODE ? { node: pos.offsetNode as Text, offset: pos.offset } : null;
    const r = d.caretRangeFromPoint?.(x, y);
    return r && r.startContainer.nodeType === Node.TEXT_NODE ? { node: r.startContainer as Text, offset: r.startOffset } : null;
  }

  /** The caret API returns the nearest insertion point; find the character actually under the pointer.
   * Vertically the whole line box counts, not just the glyph: with line-height above 1 the glyph box leaves
   * a band above and below it where the pointer is still on that line. */
  function charUnder(node: Text, offset: number, x: number, y: number): number | null {
    const range = document.createRange();
    const lineHeight = parseFloat(getComputedStyle(node.parentElement!).lineHeight);
    for (const i of [offset, offset - 1]) {
      if (i < 0 || i >= node.data.length) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      const band = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - r.height) / 2) : 0;
      if (x >= r.left && x <= r.right && y >= r.top - band && y <= r.bottom + band) return i;
    }
    return null;
  }

  function lookup(text: string, i: number): Tip | null {
    // Longest dictionary word covering position i.
    for (let len = Math.min(MAX_WORD_LEN, text.length); len >= 1; len--) {
      for (let start = Math.max(0, i - len + 1); start <= i && start + len <= text.length; start++) {
        const w = openByHanzi(text.slice(start, start + len));
        if (w) return { x: 0, top: 0, bottom: 0, text: w.hanzi, pinyin: w.pinyin, syllables: w.syllables, hanviet: w.hanviet, vi: w.vi };
      }
    }
    if (dictionaryOnly) return null;
    // pinyin-pro (~300 KB) is only for characters outside the dictionary: load it on first need.
    if (!pinyinPro) {
      if (!pinyinProLoading) { pinyinProLoading = true; import('pinyin-pro').then((m) => (pinyinPro = m.pinyin)); }
      return null;
    }
    let readings = contextCache.get(text);
    if (!readings) {
      readings = pinyinPro(text, { type: 'array', nonZh: 'consecutive' });
      contextCache.set(text, readings);
    }
    // pinyin-pro returns one entry per Han char (non-Han runs collapsed), so count Han chars before i.
    const hanBefore = [...text.slice(0, i)].filter(isHan).length;
    const nonHanRunsBefore = text.slice(0, i).split(/\p{Script=Han}+/u).filter(Boolean).length;
    const py = readings[hanBefore + nonHanRunsBefore];
    return py ? { x: 0, top: 0, bottom: 0, text: text[i], pinyin: py, syllables: toSyllables([py]) } : null;
  }

  let frame = 0;
  /** Latest pointer position: several moves can arrive within one frame, and the last one is where it is now. */
  let px = 0, py = 0;
  /** The text under the tip as it was shown: a tip whose text has changed (next question) is hidden. */
  let tipNode: Text | null = null, tipData = '';
  function onMove(e: PointerEvent) {
    px = e.clientX;
    py = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const x = px, y = py;
      const caret = caretAt(x, y);
      const el = caret?.node.parentElement;
      if (!caret || !el || el.closest('[data-has-pinyin], [data-hover-pinyin="off"]')) return (tip = null);
      const i = charUnder(caret.node, caret.offset, x, y);
      if (i === null || !isHan(caret.node.data[i])) return (tip = null);
      const found = lookup(caret.node.data, i);
      if (!found) return (tip = null);
      const range = document.createRange();
      range.setStart(caret.node, i);
      range.setEnd(caret.node, i + 1);
      const r = range.getBoundingClientRect();
      tip = { ...found, x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
      tipNode = caret.node;
      tipData = caret.node.data;
    });
  }

  // Only while a tip shows: content changing under it (Enter to the next question) hides it.
  $effect(() => {
    if (!tip) return;
    const mo = new MutationObserver(() => {
      if (!tipNode?.isConnected || tipNode.data !== tipData) tip = null;
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  });

  onMount(() => {
    document.addEventListener('pointermove', onMove, { passive: true });
    const hide = () => (tip = null);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', hide, true);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', hide, true);
    };
  });
</script>

{#if tip}
  <div class="tip" bind:this={tipEl} style:left="{pos.left}px" style:top="{pos.top}px" data-has-pinyin>
    <div class="py"><Pinyin text={tip.pinyin} syllables={tip.syllables} /></div>
    {#if tip.hanviet}<div class="hv">{tip.text} · {tip.hanviet}</div>{/if}
    {#if tip.vi}<div class="vi">{tip.vi}</div>{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    pointer-events: none;
    z-index: 1000;
    background: var(--surface);
    border: 2px solid var(--bubble-border);
    border-radius: 12px;
    padding: 5px 11px 6px;
    box-shadow: var(--shadow);
    text-align: center;
    max-width: 260px;
  }
  .py { font-size: 18px; }
  .hv { font-size: 12px; color: var(--text-2); }
  .vi { font-size: 13px; font-weight: 800; }
</style>

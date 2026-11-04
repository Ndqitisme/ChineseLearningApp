<script lang="ts">
  // Shows pinyin for any Chinese character under the pointer, unless the surrounding area
  // already displays pinyin ([data-has-pinyin]) or hides it on purpose ([data-hover-pinyin="off"]).
  import { onMount } from 'svelte';
  import { MAX_WORD_LEN, wordByHanzi } from '../../lib/data.ts';
  import { isHan, toSyllables, type Syllable } from '../../lib/pinyin.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';

  interface Tip { x: number; y: number; text: string; pinyin: string; syllables: Syllable[]; hanviet?: string; vi?: string }
  let tip = $state<Tip | null>(null);
  let pinyinPro: typeof import('pinyin-pro').pinyin | undefined;
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

  /** The caret API returns the nearest insertion point; find the character actually under the pointer. */
  function charUnder(node: Text, offset: number, x: number, y: number): number | null {
    const range = document.createRange();
    for (const i of [offset, offset - 1]) {
      if (i < 0 || i >= node.data.length) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    return null;
  }

  function lookup(text: string, i: number): Tip | null {
    // Longest dictionary word covering position i.
    for (let len = Math.min(MAX_WORD_LEN, text.length); len >= 1; len--) {
      for (let start = Math.max(0, i - len + 1); start <= i && start + len <= text.length; start++) {
        const w = wordByHanzi.get(text.slice(start, start + len));
        if (w) return { x: 0, y: 0, text: w.hanzi, pinyin: w.pinyin, syllables: w.syllables, hanviet: w.hanviet, vi: w.vi };
      }
    }
    if (!pinyinPro) return null;
    let readings = contextCache.get(text);
    if (!readings) {
      readings = pinyinPro(text, { type: 'array', nonZh: 'consecutive' });
      contextCache.set(text, readings);
    }
    // pinyin-pro returns one entry per Han char (non-Han runs collapsed), so count Han chars before i.
    const hanBefore = [...text.slice(0, i)].filter(isHan).length;
    const nonHanRunsBefore = text.slice(0, i).split(/\p{Script=Han}+/u).filter(Boolean).length;
    const py = readings[hanBefore + nonHanRunsBefore];
    return py ? { x: 0, y: 0, text: text[i], pinyin: py, syllables: toSyllables([py]) } : null;
  }

  let frame = 0;
  function onMove(e: PointerEvent) {
    if (frame) return;
    const { clientX: x, clientY: y } = e;
    frame = requestAnimationFrame(() => {
      frame = 0;
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
      tip = { ...found, x: r.left + r.width / 2, y: r.top };
    });
  }

  onMount(() => {
    import('pinyin-pro').then((m) => (pinyinPro = m.pinyin));
    document.addEventListener('pointermove', onMove, { passive: true });
    const hide = () => (tip = null);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('scroll', hide, true);
    };
  });
</script>

{#if tip}
  <div class="tip" style:left="{tip.x}px" style:top="{tip.y}px" data-has-pinyin>
    <div class="py"><Pinyin text={tip.pinyin} syllables={tip.syllables} /></div>
    {#if tip.hanviet}<div class="hv">{tip.text} · {tip.hanviet}</div>{/if}
    {#if tip.vi}<div class="vi">{tip.vi}</div>{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    transform: translate(-50%, calc(-100% - 8px));
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

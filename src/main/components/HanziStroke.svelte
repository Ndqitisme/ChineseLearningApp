<script lang="ts" module>
  import type { CharacterJson } from 'hanzi-writer';

  /** Stroke data ships with the app (public/strokes, Arphic Public License). */
  export function loadStrokes(char: string, onLoad: (data: CharacterJson) => void, onError: (e: unknown) => void) {
    fetch(`/strokes/${encodeURIComponent(char)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`no stroke data for ${char}`))))
      .then(onLoad, onError);
  }
</script>

<script lang="ts">
  import HanziWriter from 'hanzi-writer';
  import { onMount } from 'svelte';

  interface Props {
    char: string;
    size?: number;
    mode?: 'animate' | 'quiz' | 'static';
    showOutline?: boolean;
    oncomplete?: (mistakes: number) => void;
    onmistake?: () => void;
  }
  let { char, size = 160, mode = 'animate', showOutline = true, oncomplete, onmistake }: Props = $props();
  let el: HTMLDivElement;
  let writer: HanziWriter | undefined;

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  onMount(() => {
    writer = HanziWriter.create(el, char, {
      width: size,
      height: size,
      padding: 6,
      showOutline,
      strokeColor: css('--text'),
      outlineColor: css('--border'),
      radicalColor: css('--primary'),
      highlightColor: css('--accent'),
      drawingColor: css('--primary'),
      strokeAnimationSpeed: 1.2,
      delayBetweenStrokes: 180,
      showHintAfterMisses: 3,
      charDataLoader: loadStrokes,
    });
    if (mode === 'animate') writer.animateCharacter();
    if (mode === 'quiz') {
      writer.quiz({
        onMistake: () => onmistake?.(),
        onComplete: (s: { totalMistakes: number }) => oncomplete?.(s.totalMistakes),
      });
    }
    return () => { writer?.cancelQuiz?.(); el.replaceChildren(); };
  });

  export function replay() { writer?.animateCharacter(); }
  export function hint() { writer?.highlightStroke?.(0); }
</script>

<div
  class="stroke"
  bind:this={el}
  style:width="{size}px"
  style:height="{size}px"
  role="img"
  aria-label="Thứ tự nét chữ {char}"
  data-hover-pinyin="off"
></div>

<style>
  .stroke {
    background:
      linear-gradient(var(--border), var(--border)) center / 100% 1px no-repeat,
      linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat,
      var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 14px;
  }
</style>

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
    /** animate: play once on mount; sequence: show only the outline until play(); quiz: the learner draws. */
    mode?: 'animate' | 'sequence' | 'quiz' | 'static';
    showOutline?: boolean;
    /** quiz: play the stroke-order demo first, then let the learner draw. */
    demoFirst?: boolean;
    oncomplete?: (mistakes: number) => void;
    onmistake?: () => void;
  }
  let { char, size = 160, mode = 'animate', showOutline = true, demoFirst = false, oncomplete, onmistake }: Props = $props();
  let el: HTMLDivElement;
  let writer: HanziWriter | undefined;
  let alive = true;
  let nextStroke = 0;
  let demoing = false;

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function startQuiz() {
    nextStroke = 0;
    writer?.quiz({
      onMistake: () => onmistake?.(),
      onCorrectStroke: (s: { strokeNum: number }) => (nextStroke = s.strokeNum + 1),
      onComplete: (s: { totalMistakes: number }) => oncomplete?.(s.totalMistakes),
    });
  }

  onMount(() => {
    writer = HanziWriter.create(el, char, {
      width: size,
      height: size,
      padding: 6,
      showOutline,
      showCharacter: mode !== 'sequence',
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
      if (demoFirst) demo();
      else startQuiz();
    }
    return () => { alive = false; writer?.cancelQuiz?.(); el.replaceChildren(); };
  });

  /** Plays the stroke order; resolves when the last stroke is drawn. */
  export function play(): Promise<void> {
    return new Promise((resolve) => (writer ? writer.animateCharacter({ onComplete: () => resolve() }) : resolve()));
  }
  export function replay() { writer?.animateCharacter(); }

  /** Quiz mode: show how the character is written, then start (again) from the first stroke. */
  export async function demo() {
    if (!writer || demoing) return;
    demoing = true;
    writer.cancelQuiz();
    await play();
    await new Promise((r) => setTimeout(r, 700));
    if (!alive) return;
    await writer.hideCharacter({ duration: 300 });
    demoing = false;
    if (alive) startQuiz();
  }

  /** Quiz mode: flash the stroke the learner should draw next. */
  export function hint() { if (!demoing) writer?.highlightStroke(nextStroke); }
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

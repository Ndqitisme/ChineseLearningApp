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
  /** `#rrggbb` a mixed p (0–1) toward b in sRGB; non-hex input returns a. */
  const mix = (a: string, b: string, p: number) => {
    const hex = /^#([0-9a-f]{6})$/i;
    if (!hex.test(a) || !hex.test(b)) return a;
    const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
    return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('');
  };
  /** A colour token as rgb(): hanzi-writer reads only hex and rgb(), and --primary-fill is a color-mix. */
  const rgb = (name: string) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${name})`;
    el.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const m = c.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
    return m ? `rgb(${m.slice(1, 4).map((v) => Math.round(Number(v) * 255)).join(', ')})` : c;
  };
  // Strokes not yet drawn: in the quiz the outline is a faint tracing aid; elsewhere (the word page) it is the headword
  // itself while the animation runs, so it must read at 3:1.
  const outline = () => (mode === 'quiz' ? css('--border') : mix(css('--text-2'), css('--surface'), 0.7));

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
      outlineColor: outline(),
      // Drawn radical strokes, the learner's ink and the hint flash carry meaning on the board, so 3:1 against it and
      // against the outline: --primary-fill (Hoa anh đào's light pink was 2.7:1 and 2.1:1, the light accents under 2.2:1).
      // The ink is a 4px line whose core renders lighter than its colour, so it takes the deeper --primary-ink.
      radicalColor: rgb('--primary-fill'),
      highlightColor: rgb('--primary-fill'),
      drawingColor: rgb('--primary-ink'),
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
  class="stroke glass-rim"
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
      color-mix(in srgb, color-mix(in srgb, var(--primary) var(--glass-tint-mix), var(--surface)) 86%, transparent);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
    border-radius: var(--stroke-r, max(8px, calc(var(--radius) - 4px)));
    /* Card glass in every theme (86 % of the tinted surface, blurred backdrop), with the cards' directional rim and
       shadow: the white rim shows on the tint. */
    box-shadow: var(--glass-rim), var(--shadow);
  }
</style>

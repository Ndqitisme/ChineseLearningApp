<script lang="ts">
  // Flowers and leaves along the bottom of the word bubble, cut from a pre-rendered atlas in their natural colours.
  // Pet.svelte draws this behind the bubble, so whatever grows behind the bubble's edge is hidden by its glass.
  // Each sprite leans about its base in bursts (sway.ts); the transforms are written straight to the DOM so a burst
  // does not re-render. Each plant takes the pointer over its visible part: a passing pointer brushes it aside, and
  // a click or drag goes to the panel like one on the character.
  import { onMount } from 'svelte';
  import { MEADOW, atlasScale, boxWidth, brushWeights, hitBox, placeTransform, shearAbout, swayLeaves, SWAY_REF, type FrameProps } from './meadow.ts';
  import { createDragTracker, createSway, followWindow, frameLoop, frameWind, turnDeg } from './sway.ts';

  const urls = import.meta.glob<string>('./meadow@*x.png', { eager: true, query: '?url', import: 'default' });
  const scales = MEADOW.scales.filter((s) => urls[`./meadow@${s}x.png`]);
  const { sprites, atlas } = MEADOW;
  const hitBoxes = sprites.map(hitBox);

  let scale = $state(atlasScale(window.devicePixelRatio, scales));
  const href = $derived(urls[`./meadow@${scale}x.png`]);
  let root = $state<SVGSVGElement>();
  let { ondown, onmove, onup }: FrameProps = $props();
  /** Push per px/s of the pointer's sideways speed on a plant right under it: a 300 px/s pass leans it about 15°. */
  const BRUSH = 5.8;
  let brush: ((x: number, y: number, vx: number, now: number) => void) | undefined;
  let lastPointer: { x: number; y: number; t: number } | null = null;

  function onPointerMove(e: PointerEvent) {
    onmove?.(e);
    if (!root || e.buttons) return;
    const r = root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now();
    if (lastPointer && now - lastPointer.t < 150) {
      const vx = Math.max(-900, Math.min(900, (x - lastPointer.x) / Math.max((now - lastPointer.t) / 1000, 0.008)));
      brush?.(x, y, vx, now);
    }
    lastPointer = { x, y, t: now };
  }

  onMount(() => {
    // A resolution query matches only the current ratio, so it fires once when the window moves to another display.
    let dprQuery: MediaQueryList | undefined;
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', watchDpr);
      scale = atlasScale(window.devicePixelRatio, scales);
      dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', watchDpr);
    };
    watchDpr();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const sway = createSway(swayLeaves(sprites), root?.clientWidth || boxWidth(MEADOW.pad), SWAY_REF);
    const drag = createDragTracker();
    const follow = followWindow(drag);
    const loop = frameLoop((now) => {
      const following = follow.step(now);
      sway.push(...drag.felt(now));
      const moving = sway.step(now);
      const els = root?.querySelectorAll('g.sprite') ?? [];
      for (let i = 0; i < els.length; i++) els[i].setAttribute('transform', shearAbout(sprites[i], turnDeg(sway, i)));
      return moving || !drag.idle || following;
    });
    brush = (x, y, vx, now) => {
      if (reduced.matches || !root) return;
      const weights = brushWeights(sprites, { w: root.clientWidth, h: root.clientHeight }, x, y);
      let touched = false;
      weights.forEach((w, i) => { if (w > 0) { sway.kick(i, w * vx * BRUSH, 0, now); touched = true; } });
      if (touched) loop.wake();
    };
    const stop = frameWind.listen((e) => {
      if (reduced.matches) return;
      if (e.kind === 'gust') sway.gust(e.strength, performance.now());
      else follow.start(performance.now());
      loop.wake();
    });
    return () => { stop(); loop.stop(); dprQuery?.removeEventListener('change', watchDpr); };
  });
</script>

<svg class="skin" bind:this={root} aria-hidden="true" onpointerdown={ondown} onpointermove={onPointerMove} onpointerup={onup} onpointerleave={() => (lastPointer = null)}>
  {#each sprites as s, i (s.id)}
    <svg x="{s.ax * 100}%" y="{s.ay * 100}%" overflow="visible">
      <g class="sprite" transform={shearAbout(s, 0)}>
        <g transform={placeTransform(s)}>
          <svg width={s.w} height={s.h} viewBox="{s.src.x} {s.src.y} {s.src.w} {s.src.h}" preserveAspectRatio="none">
            <image {href} width={atlas.w} height={atlas.h} preserveAspectRatio="none" />
          </svg>
        </g>
      </g>
      <rect class="hit" x={hitBoxes[i].x} y={hitBoxes[i].y} width={hitBoxes[i].w} height={hitBoxes[i].h} />
    </svg>
  {/each}
</svg>

<style>
  .skin { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  /* Invisible, but it takes the pointer: Pet.svelte reports these as click-through holes in the transparent window. */
  .hit { fill: transparent; pointer-events: all; cursor: grab; }
</style>

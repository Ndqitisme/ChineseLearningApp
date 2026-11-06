<script lang="ts">
  // Draws the assistant on a WebGL canvas at devicePixelRatio and plays the motion spec through the
  // reference scheduler: idle is a held frame plus events, so between events no timer runs and no
  // frame is presented. The parent raises app events with emit(); the loop stops while hidden.
  import { onMount } from 'svelte';
  import { FRAME, loadRig } from './load.ts';
  import { RigPlayer, Timeline, startLoop, type Loop, type MotionSpec } from './rig-player.js';

  let { scale, mirror = false, hidden = false, onready, onlost }: {
    /** CSS px per frame px. */
    scale: number;
    mirror?: boolean;
    hidden?: boolean;
    /** The rig draws from now on; also after a rebuild (a monitor with another pixel ratio), when the
     * scheduler starts empty again, so the parent re-sends any held state such as sleep. */
    onready?: () => void;
    /** Nothing is drawn any more (the WebGL context was lost); onready follows if it comes back. */
    onlost?: () => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  let ready = $state(false);
  let timeline: Timeline | undefined, loop: Loop | undefined, player: RigPlayer | undefined;
  let spec: MotionSpec | undefined;
  // Timeline pre-rolls idle ticks for one hour and re-simulates its whole event log on every emit, so a pet
  // that runs for days gets a fresh one every half hour, at a moment when the frame is held.
  const FRESH_MS = 30 * 60_000;
  // Events raised before the atlas is decoded replay in order once the loop starts.
  let pending: [string, object | undefined][] = [];

  export function emit(name: string, data?: object) {
    if (!timeline || !loop || !player) { pending.push([name, data]); return; }
    if (loop.t() > FRESH_MS && !timeline.activity(loop.t()).busy) {
      loop.stop();
      timeline = new Timeline(spec!, { seed: Date.now() >>> 0 });
      loop = startLoop(player, timeline);
      loop.setHidden(hidden);
    }
    timeline.emit(loop.t(), name, data);
    loop.poke();
  }

  $effect(() => { loop?.setHidden(hidden); });

  onMount(() => {
    let gone = false, dprQuery: MediaQueryList | undefined, canvas: HTMLCanvasElement | undefined;
    const onDpr = () => { if (!gone) start(); };
    const onLost = (e: Event) => {
      e.preventDefault();   // lets the browser restore the context
      loop?.stop();
      ready = false;
      onlost?.();
    };
    const onRestored = () => { if (!gone) start(); };
    // Free the GPU side now: a dropped context otherwise keeps its textures until garbage collection,
    // which a mostly idle window rarely runs.
    const release = () => {
      loop?.stop();
      dprQuery?.removeEventListener('change', onDpr);
      if (!canvas) return;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas = undefined;
    };
    const start = () => {
      release();
      const assets = loaded!;
      // A fresh canvas per build: a WebGL context cannot be resized without keeping the old buffers alive.
      canvas = document.createElement('canvas');
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      host!.replaceChildren(canvas);
      const dpr = window.devicePixelRatio;
      spec = assets.spec;
      player = new RigPlayer({ rig: assets.rig, spec: assets.spec, atlas: assets.atlas, canvas, scale: dpr });
      timeline = new Timeline(assets.spec, { seed: Date.now() >>> 0 });
      loop = startLoop(player, timeline);
      loop.setHidden(hidden);
      for (const [name, data] of pending) timeline.emit(loop.t(), name, data);
      pending = [];
      loop.poke();
      dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
      dprQuery.addEventListener('change', onDpr);
      ready = true;
      onready?.();
    };
    let loaded: Awaited<ReturnType<typeof loadRig>> | undefined;
    loadRig().then((assets) => {
      if (gone) return;
      loaded = assets;
      start();
    }).catch((e) => console.error('assistant rig', e));
    return () => {
      gone = true;
      release();
    };
  });
</script>

<div class="rig" class:mirror bind:this={host} data-ready={ready || undefined} style:width="{FRAME.w * scale}px" style:height="{FRAME.h * scale}px"></div>

<style>
  .rig { position: relative; }
  .mirror { transform: scaleX(-1); }
  .rig :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>

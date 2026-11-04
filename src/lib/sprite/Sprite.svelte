<script lang="ts" module>
  import { LOOPING, type AnimationName, type Skin } from './skins.ts';

  /**
   * Drives frame changes with setTimeout only while an animation runs. Between animations
   * nothing is scheduled, so an idle sprite costs no frames at all.
   */
  export class SpritePlayer {
    frame = $state(0);
    current = $state<AnimationName>('idle');
    skin: Skin | null = null;
    #timer: ReturnType<typeof setTimeout> | undefined;

    setSkin(skin: Skin) {
      this.skin = skin;
      this.play(this.current === 'sleep' ? 'sleep' : 'idle');
    }

    play(name: AnimationName) {
      clearTimeout(this.#timer);
      const steps = this.skin?.animations[name] ?? this.skin?.animations.idle;
      this.current = name;
      if (!steps?.length) { this.frame = 0; return; }
      const loop = LOOPING.has(name);
      let i = 0;
      const step = () => {
        const [frame, ms] = steps[i];
        this.frame = frame;
        i++;
        if (ms === 0) return this.#finish(name);
        if (i >= steps.length) {
          if (!loop) return this.#finish(name);
          i = 0;
        }
        this.#timer = setTimeout(step, ms);
      };
      step();
    }

    #finish(name: AnimationName) {
      // Holding the last frame of sleep/drag keeps that state; everything else returns to idle.
      if (name !== 'sleep' && name !== 'drag') this.current = 'idle';
    }
  }
</script>

<script lang="ts">
  let { skin, scale, player, mirror = false }: { skin: Skin; scale: number; player: SpritePlayer; mirror?: boolean } = $props();
  const w = $derived(skin.frameW * scale);
  const h = $derived(skin.frameH * scale);
  const col = $derived(player.frame % skin.columns);
  const row = $derived(Math.floor(player.frame / skin.columns));
</script>

<div class="sprite" class:mirror style:width="{w}px" style:height="{h}px">
  <img
    src={skin.url}
    alt={skin.name}
    draggable="false"
    style:width="{w * skin.columns}px"
    style:height="{h * skin.rows}px"
    style:transform="translate3d({-col * w}px,{-row * h}px,0)"
  />
</div>

<style>
  .sprite {
    overflow: hidden;
    position: relative;
  }
  .mirror { transform: scaleX(-1); }
  img {
    display: block;
    will-change: transform;
    pointer-events: none;
    max-width: none;
  }
</style>

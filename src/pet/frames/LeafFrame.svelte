<script lang="ts">
  // A vine with small leaves around the word bubble. Drawn for this project, CC0 1.0.
  // Each leaf is its own <g>, turned about its pivot (leaves.ts); the corners hang off the far edges through nested SVGs.
  import { LEAF_LEAVES, LEAF_SHAPE } from './leaves.ts';

  /** Buds at the corner sprays, top-left coordinates, mirrored to the other corners. */
  const BUDS = [{ x: 9.5, y: 9.5, r: 2.6 }, { x: 15.5, y: 4.2, r: 1.7 }, { x: 4.2, y: 15.5, r: 1.7 }];
</script>

<div class="skin">
  <div class="vine"></div>
  <svg class="art" aria-hidden="true">
    <defs><path id="skin-leaf-leaf" d={LEAF_SHAPE.d} vector-effect="non-scaling-stroke" /></defs>
    {#each LEAF_LEAVES as l, i (i)}
      <svg x="{l.ax * 100}%" y="{l.ay * 100}%" overflow="visible">
        <g class="leaf" transform="translate({l.x} {l.y}) rotate({l.angle})"><use href="#skin-leaf-leaf" transform="scale({l.length})" /></g>
      </svg>
    {/each}
    {#each [[0, 0], [1, 0], [0, 1], [1, 1]] as [ax, ay] (`${ax}${ay}`)}
      <svg x="{ax * 100}%" y="{ay * 100}%" overflow="visible">
        {#each BUDS as b (b.x)}<circle class="bud" cx={ax ? -b.x : b.x} cy={ay ? -b.y : b.y} r={b.r} />{/each}
      </svg>
    {/each}
  </svg>
</div>

<style>
  /* Mid-tone fills with a darker edge: the frame sits on the bare desktop, which can be white or black. */
  .skin {
    position: absolute;
    inset: 0;
    --g: color-mix(in srgb, var(--hue-green) 75%, white);
    --g-edge: color-mix(in srgb, var(--hue-green) 62%, black);
  }
  :global(:root[data-theme='dark']) .skin { --g: color-mix(in srgb, var(--hue-green) 78%, black); --g-edge: color-mix(in srgb, var(--hue-green) 45%, black); }
  .vine {
    position: absolute;
    inset: 5px;
    border: 1.5px solid color-mix(in srgb, var(--g) 70%, var(--g-edge));
    border-radius: calc(var(--radius) + 6px);
  }
  /* Visible overflow: a turned leaf may reach 3px past the frame box, still inside the window's SHADOW_PAD. */
  .art { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .leaf { fill: var(--g); stroke: var(--g-edge); stroke-width: .7; stroke-linejoin: round; }
  .bud { fill: var(--bubble-border); stroke: color-mix(in srgb, var(--bubble-border) 50%, black); stroke-width: .7; }
</style>

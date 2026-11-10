<script lang="ts">
  // Four bamboo stalks lashed at the corners around the word bubble, with leaf sprays at two corners. Drawn for this
  // project, CC0 1.0. The stalks run in the outer 0-8px of the frame box, clear of the bubble's edge; each leaf is its
  // own <g>, turned about its pivot (leaves.ts).
  import { BAMBOO_LEAF_SHAPE, BAMBOO_LEAVES } from './leaves.ts';
</script>

<div class="skin">
  <i class="stalk v left"></i>
  <i class="stalk v right"></i>
  <i class="stalk h top"></i>
  <i class="stalk h bottom"></i>
  <svg class="art" aria-hidden="true">
    <defs><path id="skin-bamboo-leaf" d={BAMBOO_LEAF_SHAPE.d} vector-effect="non-scaling-stroke" /></defs>
    {#each [[0, 0], [1, 0], [0, 1], [1, 1]] as [ax, ay] (`${ax}${ay}`)}
      <svg x="{ax * 100}%" y="{ay * 100}%" overflow="visible">
        <path class="tie" transform="scale({ax ? -1 : 1} {ay ? -1 : 1})" d="M2 2L9 9M9 2L2 9" />
      </svg>
    {/each}
    {#each BAMBOO_LEAVES as l, i (i)}
      <svg x="{l.ax * 100}%" y="{l.ay * 100}%" overflow="visible">
        <g class="leaf" transform="translate({l.x} {l.y}) rotate({l.angle})"><use href="#skin-bamboo-leaf" transform="scale({l.length})" /></g>
      </svg>
    {/each}
  </svg>
</div>

<style>
  /* Mid-tone stalks with darker nodes and outline: the frame sits on the bare desktop, which can be white or black. */
  .skin {
    position: absolute;
    inset: 0;
    --stalk: color-mix(in srgb, color-mix(in srgb, var(--hue-green) 70%, var(--hue-amber)) 80%, white);
    --stalk-hi: color-mix(in srgb, var(--stalk) 55%, white);
    --node: color-mix(in srgb, var(--stalk) 45%, black);
    --g: color-mix(in srgb, var(--hue-green) 62%, white);
    --g-edge: color-mix(in srgb, var(--hue-green) 55%, black);
  }
  :global(:root[data-theme='dark']) .skin {
    --stalk: color-mix(in srgb, color-mix(in srgb, var(--hue-green) 70%, var(--hue-amber)) 75%, black);
    --stalk-hi: color-mix(in srgb, var(--stalk) 70%, white);
    --g: var(--hue-green);
    --g-edge: color-mix(in srgb, var(--hue-green) 40%, black);
  }
  .stalk { position: absolute; border-radius: 3px; box-shadow: 0 0 0 .75px var(--node); }
  /* A node ring every 34px over a lit-side gradient across the stalk. */
  .stalk.h {
    left: 0;
    right: 0;
    height: 5px;
    background:
      repeating-linear-gradient(90deg, transparent 0 32px, var(--node) 32px 33.5px, transparent 33.5px 34px),
      linear-gradient(180deg, var(--stalk-hi), var(--stalk) 45%, color-mix(in srgb, var(--stalk) 80%, black));
  }
  .stalk.v {
    top: 0;
    bottom: 0;
    width: 5px;
    background:
      repeating-linear-gradient(180deg, transparent 0 32px, var(--node) 32px 33.5px, transparent 33.5px 34px),
      linear-gradient(90deg, var(--stalk-hi), var(--stalk) 45%, color-mix(in srgb, var(--stalk) 80%, black));
  }
  .top { top: 3px; }
  .bottom { bottom: 3px; }
  .left { left: 3px; }
  .right { right: 3px; }
  /* Visible overflow: a turned leaf may reach 3px past the frame box, still inside the window's SHADOW_PAD. */
  .art { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .tie { fill: none; stroke: color-mix(in srgb, var(--bubble-border) 60%, black); stroke-width: 1.6; stroke-linecap: round; }
  .leaf { fill: var(--g); stroke: var(--g-edge); stroke-width: .7; stroke-linejoin: round; }
</style>

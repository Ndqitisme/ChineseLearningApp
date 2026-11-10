<script lang="ts">
  import { hueVar, type Hue } from '../theme/themes.ts';
  import type { IconName } from './icon-names.ts';

  let { name, size = '1.2em', label, hue }: { name: IconName; size?: string; label?: string; hue?: Hue } = $props();
</script>

<!-- The PNG is an alpha mask filled with the text colour, so the icon follows the theme. -->
<span
  class="icon"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  style:--src="url(/icons/{name}.png)"
  style:width={size}
  style:height={size}
  style:--hue={hue ? hueVar(hue) : undefined}
  class:hued={!!hue}
></span>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: -0.2em;
    background: currentColor;
    -webkit-mask: var(--src) center / contain no-repeat;
    mask: var(--src) center / contain no-repeat;
  }
  .hued { color: var(--hue); }
  /* Light: the hue mixed toward the text colour, further than hued small text: the thin strokes of a mask render
     lighter than their colour, and over the blue band behind a thin pill the plain violet fell to 2.2:1 (75 %: 2.6:1, 55 %: 2.95:1). */
  :global(:root[data-theme='light']) .hued { color: color-mix(in srgb, var(--hue) 40%, var(--text)); }
</style>

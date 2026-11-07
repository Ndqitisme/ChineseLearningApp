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
  style:color={hue ? hueVar(hue) : undefined}
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
</style>

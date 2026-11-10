<script lang="ts">
  import { glass } from './glass/glass.ts';

  /** On/off control: a glass track (lip profile) with a knob that takes the primary colour when on. */
  let { checked, onchange, disabled = false }: { checked: boolean; onchange: (on: boolean) => void; disabled?: boolean } = $props();
</script>

<span class="switch glass glass-focus" class:disabled aria-disabled={disabled || undefined} use:glass={{ profile: 'lip', specular: 0.5, blur: 0.2, bezel: 11 }}>
  <input type="checkbox" {checked} {disabled} onchange={(e) => onchange(e.currentTarget.checked)} />
  <i class="knob" aria-hidden="true"></i>
</span>

<style>
  .switch {
    display: inline-block;
    flex: none;
    width: var(--switch-w, 40px);
    height: 22px;
    border-radius: 99px;
    /* Off: a sunk track at 3:1 against the card in both looks; on: the primary colour. */
    --glass-tint: color-mix(in srgb, var(--text) var(--switch-off-mix), var(--surface));
    --glass-alpha: var(--switch-off-alpha);
    --glass-rim-mid: .35;
    --glass-rim-dark: 70%;
    cursor: pointer;
  }
  /* Hover in both states: a 1px lift, a wider close shadow and a brighter rim, as on the pills. */
  .switch:hover:not(.disabled) { --glass-rim-hi: var(--rim-hover); --glass-rim-mid: var(--rim-hover-mid); transform: translateY(-1px); --glass-shadow: 0 2px 4px rgb(var(--glass-black) / .14), 0 4px 10px rgb(var(--glass-black) / .12); }
  /* Hover deepens the off track; the on track, already opaque, mixes 14 % toward the text colour (darker in light themes,
     lighter in dark ones, so the knob keeps its contrast with it either way). */
  .switch:not(:has(:checked)):hover:not(.disabled) { --glass-alpha: calc(var(--switch-off-alpha) + 10%); }
  .switch:has(:checked):hover:not(.disabled) { --glass-tint: color-mix(in srgb, var(--primary-fill, var(--primary)) 86%, var(--text)); }
  :global(:root[data-theme='dark']) .switch:has(:checked):hover:not(.disabled) { --glass-tint: color-mix(in srgb, var(--primary-fill, var(--primary)) 65%, var(--text)); }
  /* Light: the white rim over the top edge leaves the fill as the boundary, so the fill itself is 3:1 on the card. */
  :global(:root) { --switch-off-mix: 60%; --switch-off-alpha: 72%; }
  :global(:root[data-theme='light']) { --switch-off-mix: 85%; --switch-off-alpha: 66%; }
  .switch:has(:checked) { --glass-tint: var(--primary-fill, var(--primary)); --glass-alpha: 100%; }
  /* Disabled: grey track and knob, also when checked; the change to and from it animates (200 ms). */
  .switch, .knob { transition: background .2s ease, opacity .2s ease, transform .18s cubic-bezier(.2, .9, .3, 1.2); }
  .switch.disabled { cursor: default; --glass-tint: var(--text-2); --glass-alpha: 30%; --glass-rim-hi: .4; --glass-rim-mid: .15; }
  .switch.disabled .knob { opacity: .55; }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }
  /* The knob is light glass in both looks: a highlight along its top and a small shadow under it. */
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--knob, var(--surface));
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .8), inset 0 -1px 0 rgb(var(--glass-black) / .08), 0 1px 3px rgb(var(--glass-black) / .35);
    pointer-events: none;
  }
  :global(:root[data-theme='dark']) .knob { --knob: var(--text); }
  /* Dark, on: the track is the light fill, so the knob turns dark to stay 3:1 against it. */
  :global(:root[data-theme='dark']) .switch:has(:checked):not(.disabled) .knob { --knob: var(--bg); }
  /* A primary halo round the knob on hover: the opaque on track cannot take the denser-glass cue the pills use. */
  .switch:hover:not(.disabled) .knob { transform: scale(1.08); box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .8), inset 0 -1px 0 rgb(var(--glass-black) / .08), 0 1px 3px rgb(var(--glass-black) / .35), 0 0 0 4px color-mix(in srgb, var(--primary) 28%, transparent); }
  .switch:has(:checked) .knob { transform: translateX(calc(var(--switch-w, 40px) - 22px)); }
  .switch:has(:checked):hover:not(.disabled) .knob { transform: translateX(calc(var(--switch-w, 40px) - 22px)) scale(1.08); }
  /* Press: the track sinks as the pills do (dim rim, inner shadow) and the knob drops its halo. No scale: the scaled
     refraction layer was rasterised soft, edges spread over 2–3px. */
  .switch:active:not(.disabled) { transform: translateY(1px); --glass-rim-hi: var(--rim-press); --glass-rim-mid: var(--rim-press-mid); --glass-shadow: inset 0 2px 5px rgb(var(--glass-black) / .22), 0 1px 1px rgb(var(--glass-black) / .08); }
  .switch:not(:has(:checked)):active:not(.disabled) { --glass-alpha: calc(var(--switch-off-alpha) + 20%); }
  /* Dark: a denser off track mixes further toward the light text colour; it keeps its density and sinks under the
     background-coloured shadow and the black wash of the other pressed faces. */
  :global(:root[data-theme='dark']) .switch:not(:has(:checked)):active:not(.disabled) { --glass-alpha: var(--switch-off-alpha);
    --glass-shadow: inset 0 2px 6px color-mix(in srgb, var(--bg) 60%, transparent), inset 0 0 0 100vmax rgb(var(--glass-black) / .4), 0 1px 1px rgb(var(--glass-black) / .08); }
  /* Dark, on: the light fill sinks under the background-coloured shadow and a 12 % wash (20 % blunted the knob's edge). */
  :global(:root[data-theme='dark']) .switch:has(:checked):active:not(.disabled) { --glass-tint: var(--primary-fill, var(--primary));
    --glass-shadow: inset 0 2px 6px color-mix(in srgb, var(--bg) 60%, transparent), inset 0 0 0 100vmax rgb(var(--glass-black) / .12), 0 1px 1px rgb(var(--glass-black) / .08); }
  .switch:active:not(.disabled) .knob { transform: none; box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .8), inset 0 -1px 0 rgb(var(--glass-black) / .08), 0 1px 2px rgb(var(--glass-black) / .3); }
  .switch:has(:checked):active:not(.disabled) .knob { transform: translateX(calc(var(--switch-w, 40px) - 22px)); }
  @media (prefers-reduced-transparency: reduce) {
    /* The track keeps its own boundary: the sunk fill, not the page's border colour. */
    /* Only the translucency goes: the directional rim stays on both tracks. */
    :global(:root) .switch:not(:has(:checked)) { box-shadow: var(--glass-rim), 0 0 0 1px color-mix(in srgb, var(--text) 60%, var(--surface)); }
    :global(:root) .switch:has(:checked) { box-shadow: var(--glass-rim), 0 0 0 1px color-mix(in srgb, var(--primary-fill, var(--primary)) 70%, var(--text)); }
    /* Dark: both tracks are lighter than the card, so they need no outer ring, and a light one outside the dark bottom and
       right rim lines lit the shadow side. */
    :global(:root[data-theme='dark']) .switch:not(:has(:checked)), :global(:root[data-theme='dark']) .switch:has(:checked) { box-shadow: var(--glass-rim); }
    /* Solid here: the light theme's darker mix would read as a dark "on" track. */
    :global(:root), :global(:root[data-theme='light']) { --switch-off-mix: 60%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .switch, .knob { transition: none; }
    .switch:hover:not(.disabled), .switch:active:not(.disabled) { transform: none; }
  }
</style>

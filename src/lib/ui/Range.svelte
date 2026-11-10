<script lang="ts">
  import { glass } from './glass/glass.ts';

  /** Slider: a glass track whose filled part takes the primary colour, with a round knob. */
  let { min, max, step = 1, value, oninput }: { min: number; max: number; step?: number; value: number; oninput: (v: number) => void } = $props();
  const frac = $derived((value - min) / (max - min));
</script>

<span class="range glass glass-focus" style:--p={frac} use:glass={{ specular: 0.4, blur: 0, bezel: 9 }}>
  <i class="fill" aria-hidden="true"></i>
  <input type="range" {min} {max} {step} {value} oninput={(e) => oninput(+e.currentTarget.value)} />
</span>

<style>
  /* The fill reaches 3:1 against the track: light themes pull it toward the text colour (the track is the mid grey that
     keeps 3:1 on the card), dark themes a lighter fill than the shared one (at 55 % it was 2.9:1 on the track). */
  .range { --range-fill: color-mix(in srgb, var(--primary-fill, var(--primary)) 40%, var(--text)); }
  :global(:root[data-theme='dark']) .range { --range-fill: color-mix(in srgb, var(--primary) 35%, white); }
  .range {
    display: inline-block;
    flex: none;
    width: 180px;
    height: 18px;
    border-radius: 99px;
    /* A sunk track at 3:1 against the card, so the range's end can be seen. */
    --glass-tint: color-mix(in srgb, var(--text) 60%, var(--surface));
    --glass-alpha: 72%;
    --glass-rim-mid: .35;
    --glass-rim-dark: 70%;
  }
  .range:hover { --glass-rim-hi: var(--rim-hover); --glass-rim-mid: .7; --glass-alpha: 84%; }
  /* Solid under reduced transparency: the same grey the 72 % track shows over the card (43 % text), not the full 60 %,
     which left the fill at 2.1–2.4:1 against it. */
  @media (prefers-reduced-transparency: reduce) { .range { --glass-tint: color-mix(in srgb, var(--text) 43%, var(--surface)); } }
  /* The shared ring (glass-focus) sits on the track, not on the hidden input. */
  .range input:focus-visible { outline: none; }
  .fill {
    position: absolute;
    inset: 0;
    /* The knob travels over the track minus its own width; the fill ends under its centre. */
    width: calc((100% - 18px) * var(--p) + 9px);
    border-radius: 99px;
    background: var(--range-fill);
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .35);
    pointer-events: none;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    appearance: none;
    background: none;
    cursor: pointer;
    outline: none;
  }
  input::-webkit-slider-runnable-track { height: 18px; background: none; }
  /* Light glass knob in both looks: highlight on top, a shadow under it. */
  input::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--knob, var(--surface));
    border: 2px solid var(--range-fill);
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .8), 0 1px 3px rgb(var(--glass-black) / .35);
  }
  :global(:root[data-theme='dark']) input::-webkit-slider-thumb { --knob: var(--bg); }
  .range:hover input::-webkit-slider-thumb { transform: scale(1.12); box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .9), 0 2px 5px rgb(var(--glass-black) / .4); }
  input::-moz-range-track { height: 18px; background: none; }
  input::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface);
    border: 2px solid var(--primary);
  }
</style>

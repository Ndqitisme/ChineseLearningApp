// Svelte action that turns an element into refracting glass: an SVG filter built from the element's
// own displacement and specular maps (maps.ts), applied through `backdrop-filter: url(#id)`.
// Only Chromium renders SVG backdrop filters; elsewhere, and under prefers-reduced-transparency,
// the action does nothing and glass.css paints the blur-and-rim or solid version.
import { glassMaps, type Profile } from './maps.ts';

export type GlassMode = 'refract' | 'fallback' | 'none';

/** Rim opacity of refracting glass in light themes. Over the calm field the bend moves the backdrop by 5 levels at
 *  most, in light and dark alike; what reads as bending is the rim lit along the bezel. */
export const LIGHT_SPECULAR = 0.9;
/** Light themes: opacity of the --primary-fill tint at the outer edge of the bezel. A white rim screened onto a
 *  near-white card adds a few levels at most; the tint is what shows the bezel there, and on the shadow side
 *  (bottom, right) it is the darker lip that dark themes get from the field. */
export const BEZEL_TINT = 0.18;

export interface GlassOptions {
  profile?: Profile;
  /** Set the filter only while hovered (dense grids): the map is still built at mount, so hover costs nothing. */
  hover?: boolean;
  /** false removes the filter (a card that is no longer selected). */
  when?: boolean;
  /** Backdrop blur inside the filter, px. */
  blur?: number;
  /** Backdrop saturation inside the filter. */
  saturate?: number;
  /** Rim opacity, 0–1; defaults to 0.4 in dark themes and LIGHT_SPECULAR in light ones. */
  specular?: number;
  /** Bezel width in px; defaults to the element's corner radius. */
  bezel?: number;
  /** Multiplies the bend (the filter's scale); 1 is the physical Snell value. */
  strength?: number;
}

/** Forced by `?glass=fallback|refract|none` in the window URL, or set by the window before the module loads. */
function detect(): GlassMode {
  const root = document.documentElement;
  const forced = root.dataset.glass ?? new URLSearchParams(location.search).get('glass');
  if (forced === 'refract' || forced === 'fallback' || forced === 'none') return forced;
  // navigator.userAgentData exists only in Chromium (WebView2); WKWebView and WebKitGTK never expose it.
  const chromium = 'userAgentData' in navigator;
  return chromium && CSS.supports('backdrop-filter', 'url(#g)') ? 'refract' : 'fallback';
}
export const glassMode: GlassMode = detect();
document.documentElement.dataset.glass = glassMode;

const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const isDark = () => document.documentElement.dataset.theme === 'dark';
/** Light and dark rims differ; every live filter is retinted when the theme flips. */
const live = new Set<() => void>();
new MutationObserver(() => { for (const f of live) f(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const SVG = 'http://www.w3.org/2000/svg';
let defs: SVGDefsElement | undefined;
let nextId = 0;
function defsEl(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  defs = document.createElementNS(SVG, 'defs');
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

const el = (name: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export function glass(node: HTMLElement, options: GlassOptions = {}) {
  if (glassMode !== 'refract') return;
  let opts = options;
  let filter: SVGFilterElement | undefined;
  let dispImg: SVGFEImageElement | undefined, specImg: SVGFEImageElement | undefined;
  let dispMap: SVGFEDisplacementMapElement | undefined, specAlpha: SVGFEColorMatrixElement | undefined;
  let tintFlood: SVGFEFloodElement | undefined;
  let scale = 0;
  let size = { w: 0, h: 0 };
  let timer = 0;
  let press = 0;
  const id = `glass-${++nextId}`;

  function radius(): number {
    const v = parseFloat(getComputedStyle(node).borderTopLeftRadius);
    return Number.isFinite(v) ? v : 0;
  }

  function build() {
    const r = node.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h) return;
    size = { w, h };
    const rad = radius();
    const bezel = Math.min(opts.bezel ?? Math.max(rad, 16), 32);
    const maps = glassMaps({ w, h, r: rad, profile: opts.profile ?? 'convex', bezel });
    scale = maps.scale * (opts.strength ?? 1);
    if (!filter) {
      filter = el('filter', {
        id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB',
      }) as SVGFilterElement;
      // No blur by default: the field behind the glass is already soft, so a blur would add a filter pass and change nothing.
      const blur = el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: opts.blur ?? 0, result: 'blurred' });
      const sat = el('feColorMatrix', { in: 'blurred', type: 'saturate', values: opts.saturate ?? 1.25, result: 'sat' });
      dispImg = el('feImage', { x: 0, y: 0, width: w, height: h, result: 'map' }) as SVGFEImageElement;
      dispMap = el('feDisplacementMap', { in: 'sat', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }) as SVGFEDisplacementMapElement;
      // Pixels the map pulled from outside the element are transparent; the plain backdrop fills them.
      const fill = el('feComposite', { in: 'bent', in2: 'sat', operator: 'over', result: 'glass' });
      // The map's blue channel is the bezel tint mask (maps.ts); the colour follows the theme through the CSS variable.
      const tintMask = el('feColorMatrix', { in: 'map', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'tintMask' });
      tintFlood = el('feFlood', { style: 'flood-color: var(--primary-fill)', result: 'tintColor' }) as SVGFEFloodElement;
      const tint = el('feComposite', { in: 'tintColor', in2: 'tintMask', operator: 'in', result: 'tint' });
      const tinted = el('feComposite', { in: 'tint', in2: 'glass', operator: 'over', result: 'tinted' });
      specImg = el('feImage', { x: 0, y: 0, width: w, height: h, result: 'rim' }) as SVGFEImageElement;
      specAlpha = el('feColorMatrix', { in: 'rim', type: 'matrix', values: alphaMatrix(0), result: 'rim2' }) as SVGFEColorMatrixElement;
      const blend = el('feBlend', { in: 'rim2', in2: 'tinted', mode: 'screen' });
      filter.append(blur, sat, dispImg, dispMap, fill, tintMask, tintFlood, tint, tinted, specImg, specAlpha, blend);
      retint();
      defsEl().append(filter);
    } else {
      filter.setAttribute('width', String(w));
      filter.setAttribute('height', String(h));
      for (const img of [dispImg!, specImg!]) { img.setAttribute('width', String(w)); img.setAttribute('height', String(h)); }
      dispMap!.setAttribute('scale', String(scale));
    }
    dispImg!.setAttribute('href', maps.displacement);
    specImg!.setAttribute('href', maps.specular);
    apply();
  }

  function retint() {
    const dark = isDark();
    specAlpha?.setAttribute('values', alphaMatrix(opts.specular ?? (dark ? 0.4 : LIGHT_SPECULAR)));
    // The switch track is an opaque fill of its own; a tint under it would only muddy the lip.
    tintFlood?.setAttribute('flood-opacity', String(dark || opts.profile === 'lip' ? 0 : BEZEL_TINT));
  }

  function apply() {
    const on = opts.when !== false && !reducedTransparency.matches && !!filter;
    node.style.setProperty('--glass-filter', on ? `url(#${id})` : '');
    node.classList.toggle('glass-hover', on && !!opts.hover);
    node.classList.toggle('glass-on', on && !opts.hover);
  }

  function scheduleBuild() {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const r = node.getBoundingClientRect();
      if (Math.round(r.width) !== size.w || Math.round(r.height) !== size.h) build();
    }, 80);
  }

  // Press: the glass sinks, so the bend shrinks. Only `scale` changes; the maps stay.
  function setScale(k: number) {
    dispMap?.setAttribute('scale', String(scale * k));
  }
  function sink(to: number) {
    cancelAnimationFrame(press);
    if (reducedMotion.matches) return setScale(to);
    const from = parseFloat(dispMap?.getAttribute('scale') ?? '0') / (scale || 1);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 120);
      setScale(from + (to - from) * p);
      if (p < 1) press = requestAnimationFrame(step);
    };
    press = requestAnimationFrame(step);
  }
  // Hover lifts the glass (a stronger bend); press sinks it.
  let hovered = false;
  // 1.2 keeps the clamped map monotonic (SLOPE 0.7 plus one level of rounding, × 1.2, stays under 1), so hover never folds the backdrop.
  const inert = () => node.matches(':disabled, [aria-disabled="true"]');
  const enter = () => { hovered = true; if (!inert()) sink(1.2); };
  const leave = () => { hovered = false; sink(1); };
  const down = () => { if (!inert()) sink(0.5); };
  const up = () => sink(hovered ? 1.2 : 1);
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);

  const ro = new ResizeObserver(scheduleBuild);
  ro.observe(node);
  live.add(retint);
  reducedTransparency.addEventListener('change', apply);
  build();

  return {
    update(next: GlassOptions) {
      opts = next;
      retint();
      apply();
    },
    destroy() {
      clearTimeout(timer);
      cancelAnimationFrame(press);
      ro.disconnect();
      live.delete(retint);
      reducedTransparency.removeEventListener('change', apply);
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      filter?.remove();
    },
  };
}

/** feColorMatrix that keeps RGB and multiplies alpha by `a`. */
function alphaMatrix(a: number): string {
  return `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${a} 0`;
}

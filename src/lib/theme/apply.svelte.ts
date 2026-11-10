import { settings } from '../settings.svelte.ts';
import { themeById, TOKENS, type Theme, type Token } from './themes.ts';

/** `#rrggbb` of `a` mixed `p` (0–1) toward `b`, straight sRGB like CSS color-mix(in srgb). Non-hex input returns `a`. */
function mixHex(a: string, b: string, p: number): string {
  const hex = /^#([0-9a-f]{6})$/i;
  if (!hex.test(a) || !hex.test(b)) return a;
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('');
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const ui = $state({ systemDark: systemDark.matches });
systemDark.addEventListener('change', (e) => (ui.systemDark = e.matches));

export const theme = {
  get current(): Theme { return themeById(settings.theme); },
  get dark(): boolean { return settings.mode === 'dark' || (settings.mode === 'system' && ui.systemDark); },
};

/** Keeps CSS variables, light/dark flag and the user's custom CSS in sync with settings. */
export function applyTheme() {
  $effect.root(() => {
    $effect(() => {
      const root = document.documentElement;
      const t = theme.current;
      const tokens = theme.dark ? t.dark : t.light;
      const overrides = settings.tokenOverrides[theme.dark ? 'dark' : 'light'];
      const value = (name: Token) => overrides[name] ?? tokens[name];
      for (const name of TOKENS) root.style.setProperty(`--${name}`, value(name));
      root.style.setProperty('--radius', `${t.radius}px`);
      // Muted text that sits on the page field, not in a card: 70% --text-2 toward --text, as a plain hex so
      // tooling that reads computed colours gets rgb(), not color(srgb).
      root.style.setProperty('--text-2-strong', mixHex(value('text-2'), value('text'), 0.7));
      root.dataset.theme = theme.dark ? 'dark' : 'light';
      root.dataset.themeId = t.id;
      root.style.colorScheme = theme.dark ? 'dark' : 'light';
    });
    $effect(() => {
      let el = document.getElementById('user-css');
      if (!el) {
        el = document.createElement('style');
        el.id = 'user-css';
        document.head.append(el);
      }
      el.textContent = settings.customCss;
    });
  });
}

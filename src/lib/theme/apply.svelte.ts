import { settings } from '../settings.svelte.ts';
import { themeById, TOKENS, type Theme } from './themes.ts';

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
      for (const name of TOKENS) root.style.setProperty(`--${name}`, overrides[name] ?? tokens[name]);
      root.style.setProperty('--radius', `${t.radius}px`);
      root.dataset.theme = theme.dark ? 'dark' : 'light';
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

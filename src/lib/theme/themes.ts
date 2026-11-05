import type { IconName } from '../ui/icon-names.ts';
// Design tokens. Every visual decision in the UI reads one of these CSS variables, so a theme
// (or the user's own overrides / custom CSS) can restyle any component.

export const TOKENS = [
  'bg', 'bg-2', 'surface', 'surface-2', 'border', 'text', 'text-2', 'primary', 'primary-2',
  'on-primary', 'accent', 'good', 'bad', 'shadow', 'bubble-bg', 'bubble-border', 'bubble-text',
  'tone1', 'tone2', 'tone3', 'tone4', 'tone5', 'pattern',
] as const;
export type Token = (typeof TOKENS)[number];
export type TokenSet = Record<Token, string>;

export type ThemeId = 'sakura' | 'matcha' | 'boba' | 'ocean' | 'night';
export interface Theme { id: ThemeId; name: string; icon: IconName; light: TokenSet; dark: TokenSet; radius: number }

const TONES_LIGHT = { tone1: '#e5484d', tone2: '#e08a00', tone3: '#2f9e44', tone4: '#3b6fd8', tone5: '#8a8f98' };
const TONES_DARK = { tone1: '#ff7b7f', tone2: '#ffb547', tone3: '#5fd27a', tone4: '#7ea6ff', tone5: '#a3a8b2' };
const dots = (c: string) =>
  `radial-gradient(${c} 1.2px, transparent 1.3px) 0 0 / 22px 22px`;

export const THEMES: Theme[] = [
  {
    id: 'sakura', name: 'Hoa anh đào', icon: 'theme-sakura', radius: 18,
    light: { bg: '#fff6f8', 'bg-2': '#ffeef2', surface: '#ffffff', 'surface-2': '#fff0f4', border: '#f6d3dd', text: '#3d2a33', 'text-2': '#8a6f7b',
      primary: '#ec6f97', 'primary-2': '#d9567f', 'on-primary': '#ffffff', accent: '#ffb3c7', good: '#2f9e44', bad: '#e5484d', shadow: '0 6px 24px rgba(217,86,127,.14)',
      'bubble-bg': '#ffffff', 'bubble-border': '#f3a6be', 'bubble-text': '#3d2a33', ...TONES_LIGHT, pattern: dots('#f9d6e0') },
    dark: { bg: '#1f1720', 'bg-2': '#281d29', surface: '#2c2130', 'surface-2': '#362839', border: '#4a3650', text: '#f8e9ef', 'text-2': '#c4a7b5',
      primary: '#ff8fb1', 'primary-2': '#ffa8c3', 'on-primary': '#2a1520', accent: '#7d3f58', good: '#5fd27a', bad: '#ff7b7f', shadow: '0 6px 24px rgba(0,0,0,.35)',
      'bubble-bg': '#2c2130', 'bubble-border': '#ff8fb1', 'bubble-text': '#f8e9ef', ...TONES_DARK, pattern: dots('#33263a') },
  },
  {
    id: 'matcha', name: 'Matcha', icon: 'theme-matcha', radius: 16,
    light: { bg: '#f5faf1', 'bg-2': '#ecf5e5', surface: '#ffffff', 'surface-2': '#eef7e8', border: '#d3e8c7', text: '#26331f', 'text-2': '#66785b',
      primary: '#5e9e4f', 'primary-2': '#4c873f', 'on-primary': '#ffffff', accent: '#c9e7b5', good: '#2f9e44', bad: '#e5484d', shadow: '0 6px 24px rgba(76,135,63,.13)',
      'bubble-bg': '#ffffff', 'bubble-border': '#9ccc86', 'bubble-text': '#26331f', ...TONES_LIGHT, pattern: dots('#dcecd1') },
    dark: { bg: '#151c13', 'bg-2': '#1b2418', surface: '#1f2a1c', 'surface-2': '#273424', border: '#34462f', text: '#e8f3e1', 'text-2': '#a6bb9a',
      primary: '#8fd07a', 'primary-2': '#a6dd94', 'on-primary': '#142011', accent: '#3d5a33', good: '#5fd27a', bad: '#ff7b7f', shadow: '0 6px 24px rgba(0,0,0,.35)',
      'bubble-bg': '#1f2a1c', 'bubble-border': '#8fd07a', 'bubble-text': '#e8f3e1', ...TONES_DARK, pattern: dots('#22301f') },
  },
  {
    id: 'boba', name: 'Trà sữa', icon: 'theme-boba', radius: 20,
    light: { bg: '#fbf6f0', 'bg-2': '#f5ece1', surface: '#fffdf9', 'surface-2': '#f7efe5', border: '#ead9c6', text: '#3a2a1f', 'text-2': '#86705e',
      primary: '#a8754f', 'primary-2': '#8f6140', 'on-primary': '#ffffff', accent: '#e9cfb4', good: '#2f9e44', bad: '#e5484d', shadow: '0 6px 24px rgba(122,81,54,.14)',
      'bubble-bg': '#fffdf9', 'bubble-border': '#d6b18f', 'bubble-text': '#3a2a1f', ...TONES_LIGHT, pattern: dots('#efe2d3') },
    dark: { bg: '#1c1612', 'bg-2': '#241c17', surface: '#2a211b', 'surface-2': '#342920', border: '#4a3a2e', text: '#f6ebe1', 'text-2': '#c2ab97',
      primary: '#e0a77c', 'primary-2': '#ebbb96', 'on-primary': '#24170e', accent: '#5e4532', good: '#5fd27a', bad: '#ff7b7f', shadow: '0 6px 24px rgba(0,0,0,.35)',
      'bubble-bg': '#2a211b', 'bubble-border': '#e0a77c', 'bubble-text': '#f6ebe1', ...TONES_DARK, pattern: dots('#30261f') },
  },
  {
    id: 'ocean', name: 'Biển xanh', icon: 'theme-ocean', radius: 14,
    light: { bg: '#f2f8fd', 'bg-2': '#e8f2fb', surface: '#ffffff', 'surface-2': '#ebf4fc', border: '#cfe2f3', text: '#1d2b3a', 'text-2': '#5f7489',
      primary: '#3d7cc9', 'primary-2': '#2f67ad', 'on-primary': '#ffffff', accent: '#bfe0f7', good: '#2f9e44', bad: '#e5484d', shadow: '0 6px 24px rgba(47,103,173,.13)',
      'bubble-bg': '#ffffff', 'bubble-border': '#8ebce8', 'bubble-text': '#1d2b3a', ...TONES_LIGHT, pattern: dots('#d8e8f6') },
    dark: { bg: '#0f1722', 'bg-2': '#141e2b', surface: '#182434', 'surface-2': '#1f2e42', border: '#2c3f57', text: '#e4eef8', 'text-2': '#9db2c7',
      primary: '#7cb4f2', 'primary-2': '#9ac6f6', 'on-primary': '#0b1626', accent: '#2a4a6e', good: '#5fd27a', bad: '#ff7b7f', shadow: '0 6px 24px rgba(0,0,0,.4)',
      'bubble-bg': '#182434', 'bubble-border': '#7cb4f2', 'bubble-text': '#e4eef8', ...TONES_DARK, pattern: dots('#1a2738') },
  },
  {
    id: 'night', name: 'Đêm sao', icon: 'theme-night', radius: 18,
    light: { bg: '#f6f5ff', 'bg-2': '#eeecff', surface: '#ffffff', 'surface-2': '#f0eeff', border: '#dcd8fb', text: '#272347', 'text-2': '#6c678f',
      primary: '#6c63c9', 'primary-2': '#5850b0', 'on-primary': '#ffffff', accent: '#ffe07a', good: '#2f9e44', bad: '#e5484d', shadow: '0 6px 24px rgba(88,80,176,.14)',
      'bubble-bg': '#ffffff', 'bubble-border': '#aaa3ef', 'bubble-text': '#272347', ...TONES_LIGHT, pattern: dots('#e2dffc') },
    dark: { bg: '#12112a', 'bg-2': '#181635', surface: '#1d1b3d', 'surface-2': '#25224b', border: '#363266', text: '#ecebff', 'text-2': '#a9a5d6',
      primary: '#a49cff', 'primary-2': '#bab4ff', 'on-primary': '#15133a', accent: '#ffe07a', good: '#5fd27a', bad: '#ff7b7f', shadow: '0 6px 24px rgba(0,0,0,.45)',
      'bubble-bg': '#1d1b3d', 'bubble-border': '#a49cff', 'bubble-text': '#ecebff', ...TONES_DARK, pattern: dots('#211f47') },
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

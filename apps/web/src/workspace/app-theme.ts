/**
 * Application appearance: the chrome's colour scheme and fonts, chosen by the viewer and kept in
 * this browser. Separate from the per-canvas palette (canvas-theme.ts), which travels with a board.
 *
 * A choice is applied by setting `data-theme` on <html> (light / dark / follow the system) and by
 * injecting one stylesheet that overrides the accent tokens and font families. The stylesheet
 * mirrors foundation.css's own cascade, so an accent follows light, dark and system exactly the way
 * the built-in tokens do, with no JavaScript media listening.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

/** The accent tokens one scheme sets, for one colour scheme (light or dark). */
type AccentTokens = {
  accent: string;
  accentHover: string;
  accentFg: string;
  accentSoft: string;
  accentText: string;
  focus: string;
};

export type AccentScheme = {
  id: string;
  name: string;
  /** The dot shown in the picker (its light-mode accent reads well on the picker surface). */
  swatch: string;
  light: AccentTokens;
  dark: AccentTokens;
};

/** Accent schemes. Evergreen is the built-in default; each keeps a light and a dark set. */
export const ACCENT_SCHEMES = [
  {
    id: 'evergreen',
    name: 'Evergreen',
    swatch: '#2d5445',
    light: {
      accent: '#2d5445',
      accentHover: '#386652',
      accentFg: '#f7faf3',
      accentSoft: '#e4ebe0',
      accentText: '#3d6a4b',
      focus: '#2d5445',
    },
    dark: {
      accent: '#cfe3c8',
      accentHover: '#e0eeda',
      accentFg: '#14211a',
      accentSoft: '#223029',
      accentText: '#a9cf9c',
      focus: '#a9cf9c',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatch: '#1f4e79',
    light: {
      accent: '#1f4e79',
      accentHover: '#28608f',
      accentFg: '#f3f8ff',
      accentSoft: '#e1ecf6',
      accentText: '#2b5e8c',
      focus: '#1f4e79',
    },
    dark: {
      accent: '#bcd7f2',
      accentHover: '#d2e6fb',
      accentFg: '#0f1b2a',
      accentSoft: '#1e2c3b',
      accentText: '#a3c6ea',
      focus: '#a3c6ea',
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    swatch: '#5b3f8c',
    light: {
      accent: '#5b3f8c',
      accentHover: '#6b4da1',
      accentFg: '#f7f3ff',
      accentSoft: '#ece3f6',
      accentText: '#6a4aa0',
      focus: '#5b3f8c',
    },
    dark: {
      accent: '#d9c4f2',
      accentHover: '#e6d6fb',
      accentFg: '#1c1430',
      accentSoft: '#2b2140',
      accentText: '#c3a7e8',
      focus: '#c3a7e8',
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    swatch: '#a23a63',
    light: {
      accent: '#a23a63',
      accentHover: '#b84875',
      accentFg: '#fff2f7',
      accentSoft: '#f7e1ea',
      accentText: '#a23a63',
      focus: '#a23a63',
    },
    dark: {
      accent: '#f2b2cc',
      accentHover: '#f9c6da',
      accentFg: '#2a0f1b',
      accentSoft: '#3a1c28',
      accentText: '#ec9fbf',
      focus: '#ec9fbf',
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    swatch: '#9a6a16',
    light: {
      accent: '#9a6a16',
      accentHover: '#b07e22',
      accentFg: '#fff8ea',
      accentSoft: '#f6ecd6',
      accentText: '#8a6012',
      focus: '#9a6a16',
    },
    dark: {
      accent: '#f0d08a',
      accentHover: '#f7dc9f',
      accentFg: '#241a07',
      accentSoft: '#342711',
      accentText: '#e8c67e',
      focus: '#e8c67e',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    swatch: '#a5452f',
    light: {
      accent: '#a5452f',
      accentHover: '#b85539',
      accentFg: '#fff4ef',
      accentSoft: '#f8e5dd',
      accentText: '#a84a33',
      focus: '#a5452f',
    },
    dark: {
      accent: '#f0b49f',
      accentHover: '#f7c6b3',
      accentFg: '#2a140d',
      accentSoft: '#3a221a',
      accentText: '#eca98f',
      focus: '#eca98f',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    swatch: '#3f4753',
    light: {
      accent: '#3f4753',
      accentHover: '#4d5663',
      accentFg: '#f6f8fb',
      accentSoft: '#e6e9ee',
      accentText: '#49525f',
      focus: '#3f4753',
    },
    dark: {
      accent: '#c7cedb',
      accentHover: '#d8dee8',
      accentFg: '#161a21',
      accentSoft: '#262b34',
      accentText: '#b4bcca',
      focus: '#b4bcca',
    },
  },
] as const satisfies readonly AccentScheme[];

export type FontScheme = {
  id: string;
  name: string;
  /** How the name reads in the picker, rendered in the scheme's own interface font. */
  note: string;
  /** CSS `font-family` values for the interface and for display headings. */
  ui: string;
  display: string;
};

/**
 * Font pairings. Every family is loaded up front in foundation.css, so switching never flashes.
 * `System` uses the platform UI font and loads nothing.
 */
export const FONT_SCHEMES = [
  {
    id: 'signal',
    name: 'Signal',
    note: 'DM Sans with Manrope headings',
    ui: "'DM Sans', system-ui, sans-serif",
    display: "'Manrope', var(--font-ui)",
  },
  {
    id: 'inter',
    name: 'Inter',
    note: 'Neutral and dense',
    ui: "'Inter', system-ui, sans-serif",
    display: "'Inter', var(--font-ui)",
  },
  {
    id: 'grotesk',
    name: 'Grotesk',
    note: 'Geometric character',
    ui: "'Space Grotesk', system-ui, sans-serif",
    display: "'Space Grotesk', var(--font-ui)",
  },
  {
    id: 'editorial',
    name: 'Editorial',
    note: 'Serif, for long reading',
    ui: "'Source Serif 4', Georgia, serif",
    display: "'Fraunces', Georgia, serif",
  },
  {
    id: 'system',
    name: 'System',
    note: "Your platform's own font",
    ui: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    display: 'var(--font-ui)',
  },
] as const satisfies readonly FontScheme[];

export type AppTheme = {
  mode: ThemeMode;
  accent: (typeof ACCENT_SCHEMES)[number]['id'];
  font: (typeof FONT_SCHEMES)[number]['id'];
};

export const DEFAULT_APP_THEME: AppTheme = { mode: 'system', accent: 'evergreen', font: 'signal' };

export const APP_THEME_KEY = 'opsis:app-theme:v1';
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export const accentOf = (theme: AppTheme): AccentScheme =>
  ACCENT_SCHEMES.find((scheme) => scheme.id === theme.accent) ?? ACCENT_SCHEMES[0];
export const fontOf = (theme: AppTheme): FontScheme =>
  FONT_SCHEMES.find((scheme) => scheme.id === theme.font) ?? FONT_SCHEMES[0];

/** Narrows a stored value to the modes, schemes and fonts this version knows. */
function known(value: Partial<AppTheme> | null | undefined): AppTheme {
  return {
    mode: MODES.includes(value?.mode as ThemeMode)
      ? (value!.mode as ThemeMode)
      : DEFAULT_APP_THEME.mode,
    accent: ACCENT_SCHEMES.find((s) => s.id === value?.accent)?.id ?? DEFAULT_APP_THEME.accent,
    font: FONT_SCHEMES.find((s) => s.id === value?.font)?.id ?? DEFAULT_APP_THEME.font,
  };
}

export function readAppTheme(): AppTheme {
  try {
    return known(JSON.parse(localStorage.getItem(APP_THEME_KEY) ?? 'null') as Partial<AppTheme>);
  } catch {
    return { ...DEFAULT_APP_THEME };
  }
}

export function writeAppTheme(theme: AppTheme) {
  try {
    localStorage.setItem(APP_THEME_KEY, JSON.stringify(theme));
  } catch {
    // A browser that refuses storage still gets the live change; it just will not persist.
  }
}

const accentRule = (selector: string, t: AccentTokens) =>
  `${selector}{--accent:${t.accent};--accent-hover:${t.accentHover};--accent-fg:${t.accentFg};` +
  `--accent-soft:${t.accentSoft};--accent-text:${t.accentText};--focus:${t.focus};}`;

/** The one stylesheet that carries a theme's accent and fonts, cascading like foundation.css. */
export function themeStylesheet(theme: AppTheme): string {
  const accent = accentOf(theme);
  const font = fontOf(theme);
  return [
    accentRule(':root', accent.light),
    `@media (prefers-color-scheme: dark){${accentRule(":root:not([data-theme='light'])", accent.dark)}}`,
    accentRule(":root[data-theme='dark']", accent.dark),
    accentRule(":root[data-theme='light']", accent.light),
    `:root{--font-ui:${font.ui};--font-display:${font.display};}`,
  ].join('\n');
}

const STYLE_ID = 'opsis-app-theme';

/** Applies the theme to the live document: the colour-scheme attribute and the override stylesheet. */
export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme.mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme.mode);

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    // Last in <head> so it overrides foundation.css at equal specificity.
    document.head.appendChild(style);
  }
  style.textContent = themeStylesheet(theme);
}

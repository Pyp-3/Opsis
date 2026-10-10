import { AppearanceSettingSchema, type AppearanceSetting } from '@opsis/schema';
import { accountSetting, saveAccountSetting } from './account-settings';
import { HEX_COLOUR, mix, shade, turnHue, untilReadable } from './theme-colour';

/**
 * Application appearance: the chrome's colour scheme, background palette, accent and fonts. It is
 * saved to the account, so it follows a person across browsers, and cached in this browser so the
 * next visit paints it before anyone signs in. Separate from the per-canvas palette
 * (canvas-theme.ts), which travels with a board.
 *
 * A choice is applied by setting `data-theme` on <html> (light / dark / follow the system) and by
 * injecting one stylesheet that overrides the colour tokens and font families. The stylesheet
 * mirrors foundation.css's own cascade, so a palette follows light, dark and system exactly the
 * way the built-in tokens do, with no JavaScript media listening.
 */

export type ThemeMode = AppearanceSetting['mode'];

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

/** The background tokens one palette sets, for one colour scheme (light or dark). */
type SurfaceTokens = {
  paper: string;
  surface: string;
  rail: string;
  sunken: string;
  hover: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  ink3: string;
};

export type SurfaceScheme = { id: string; name: string; light: SurfaceTokens; dark: SurfaceTokens };

/**
 * Background palettes: the page, panels, sidebar, lines and text. Sage is foundation.css's own
 * palette; each keeps body text (ink to ink-3) readable on every background it sets.
 */
export const SURFACE_SCHEMES = [
  {
    id: 'sage',
    name: 'Sage',
    light: {
      paper: '#fbfaf5',
      surface: '#ffffff',
      rail: '#f4f3ec',
      sunken: '#eef0e7',
      hover: '#e9ece3',
      line: '#e3e5dc',
      lineStrong: '#d2d8ca',
      ink: '#1f2d27',
      ink2: '#435047',
      ink3: '#5f6b62',
    },
    dark: {
      paper: '#111714',
      surface: '#171f1b',
      rail: '#131a16',
      sunken: '#1c2520',
      hover: '#222c26',
      line: '#26302b',
      lineStrong: '#334039',
      ink: '#e8ede6',
      ink2: '#bcc7bd',
      ink3: '#8f9b92',
    },
  },
  {
    id: 'neutral',
    name: 'Neutral',
    light: {
      paper: '#fafafa',
      surface: '#ffffff',
      rail: '#f3f3f4',
      sunken: '#eeeef0',
      hover: '#e8e8eb',
      line: '#e2e2e6',
      lineStrong: '#d0d0d6',
      ink: '#1d1d21',
      ink2: '#45454d',
      ink3: '#5f5f68',
    },
    dark: {
      paper: '#121214',
      surface: '#18181b',
      rail: '#141416',
      sunken: '#1e1e22',
      hover: '#242428',
      line: '#2a2a2f',
      lineStrong: '#38383f',
      ink: '#ececef',
      ink2: '#c2c2c9',
      ink3: '#93939c',
    },
  },
  {
    id: 'warm',
    name: 'Warm',
    light: {
      paper: '#fcf8f1',
      surface: '#fffdf9',
      rail: '#f6efe4',
      sunken: '#f1e9dc',
      hover: '#ece2d3',
      line: '#e6dccb',
      lineStrong: '#d8cab4',
      ink: '#2d241b',
      ink2: '#54473a',
      ink3: '#6a5c4d',
    },
    dark: {
      paper: '#17130f',
      surface: '#1e1914',
      rail: '#191510',
      sunken: '#25201a',
      hover: '#2b251e',
      line: '#312a22',
      lineStrong: '#40372c',
      ink: '#f0e9df',
      ink2: '#cdbfae',
      ink3: '#9f907e',
    },
  },
  {
    id: 'cool',
    name: 'Cool',
    light: {
      paper: '#f6f8fb',
      surface: '#ffffff',
      rail: '#eef2f7',
      sunken: '#e8edf4',
      hover: '#e2e8f0',
      line: '#dce3ec',
      lineStrong: '#c8d2df',
      ink: '#1b2533',
      ink2: '#414d5e',
      ink3: '#576375',
    },
    dark: {
      paper: '#0f141b',
      surface: '#151b24',
      rail: '#11171f',
      sunken: '#1b222c',
      hover: '#212935',
      line: '#262f3b',
      lineStrong: '#333e4d',
      ink: '#e6ebf2',
      ink2: '#bac4d2',
      ink3: '#8b97a8',
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    light: {
      paper: '#faf8fc',
      surface: '#ffffff',
      rail: '#f3f0f7',
      sunken: '#eeeaf3',
      hover: '#e8e3ef',
      line: '#e2dcea',
      lineStrong: '#d1c8de',
      ink: '#251f2e',
      ink2: '#4b4357',
      ink3: '#625a6f',
    },
    dark: {
      paper: '#141118',
      surface: '#1b1720',
      rail: '#16131a',
      sunken: '#221d28',
      hover: '#28222f',
      line: '#2e2735',
      lineStrong: '#3c3445',
      ink: '#ece8f1',
      ink2: '#c6bed0',
      ink3: '#978ea3',
    },
  },
] as const satisfies readonly SurfaceScheme[];

/** The picker's id for a colour the person chose themselves. */
export const CUSTOM_ACCENT = 'custom';

export type AppTheme = {
  mode: ThemeMode;
  /** A preset accent's id, or `custom` with `customAccent`. */
  accent: (typeof ACCENT_SCHEMES)[number]['id'] | typeof CUSTOM_ACCENT;
  customAccent?: string;
  surface: (typeof SURFACE_SCHEMES)[number]['id'];
  font: (typeof FONT_SCHEMES)[number]['id'];
};

export const DEFAULT_APP_THEME: AppTheme = {
  mode: 'system',
  accent: 'evergreen',
  surface: 'sage',
  font: 'signal',
};

export const APP_THEME_KEY = 'opsis:app-theme:v1';
/** The account whose saved appearance this browser's cached copy came from. */
const THEME_ACCOUNT_KEY = 'opsis:app-theme-account:v1';
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Every background a custom accent's text and fills must stay readable on. */
const LIGHT_BACKGROUNDS = SURFACE_SCHEMES.flatMap(({ light }) => [
  light.paper,
  light.surface,
  light.sunken,
]);
const DARK_BACKGROUNDS = SURFACE_SCHEMES.flatMap(({ dark }) => [
  dark.paper,
  dark.surface,
  dark.sunken,
]);

/**
 * Builds a full accent from one picked colour. Light mode darkens it until white-ish text reads
 * on it and it reads as text on every light background; dark mode lightens a pastel version the
 * same way. Soft fills are tints of the result.
 */
export function customAccent(hex: string): AccentScheme {
  const accent = untilReadable(hex, LIGHT_BACKGROUNDS, 4.5, -1);
  const accentFg = mix(accent, '#ffffff', 0.04);
  const accentSoft = mix(accent, '#ffffff', 0.13);
  const accentText = untilReadable(accent, [...LIGHT_BACKGROUNDS, accentSoft], 4.5, -1);
  const dark = untilReadable(shade(hex, 0.25), DARK_BACKGROUNDS, 9, 1);
  const darkSoft = mix(dark, '#171a1c', 0.13);
  const darkText = untilReadable(shade(dark, -0.08), [...DARK_BACKGROUNDS, darkSoft], 6, 1);
  return {
    id: CUSTOM_ACCENT,
    name: 'Custom',
    swatch: hex,
    light: {
      accent,
      accentHover: hoverOf(accent, accentFg),
      accentFg,
      accentSoft,
      accentText,
      focus: accent,
    },
    dark: {
      accent: dark,
      accentHover: shade(dark, 0.06),
      accentFg: untilReadable(mix(dark, '#000000', 0.12), [dark], 7, -1),
      accentSoft: darkSoft,
      accentText: darkText,
      focus: darkText,
    },
  };
}

/** A slightly lighter hover that keeps the button text readable. */
function hoverOf(accent: string, text: string): string {
  const lighter = shade(accent, 0.05);
  return untilReadable(lighter, [text], 4.5, -1);
}

/** The gradient on primary buttons and banners, its hover, and the text drawn on it. */
type Blend = { stops: [string, string, string]; hover: [string, string, string]; fg: string };

/**
 * An accent's gradient (Evergreen keeps foundation.css's own): from the accent through two neighbouring hues, each kept dark enough for
 * the button text, as Evergreen runs from green through teal to blue.
 */
export function blendOf(scheme: AccentScheme): Blend {
  const fg = scheme.light.accentFg;
  const readable = (colour: string) => untilReadable(colour, [fg], 4.5, -1);
  const stops = [0, 30, 50].map((turn) => readable(turnHue(scheme.light.accent, turn))) as [
    string,
    string,
    string,
  ];
  const hover = stops.map((stop) => readable(shade(stop, 0.05))) as [string, string, string];
  return { stops, hover, fg };
}

export const accentOf = (theme: AppTheme): AccentScheme =>
  theme.accent === CUSTOM_ACCENT && theme.customAccent && HEX_COLOUR.test(theme.customAccent)
    ? customAccent(theme.customAccent.toLowerCase())
    : (ACCENT_SCHEMES.find((scheme) => scheme.id === theme.accent) ?? ACCENT_SCHEMES[0]);
export const surfaceOf = (theme: AppTheme): SurfaceScheme =>
  SURFACE_SCHEMES.find((scheme) => scheme.id === theme.surface) ?? SURFACE_SCHEMES[0];
export const fontOf = (theme: AppTheme): FontScheme =>
  FONT_SCHEMES.find((scheme) => scheme.id === theme.font) ?? FONT_SCHEMES[0];

/** Narrows a stored value to the modes, palettes, accents and fonts this version knows. */
export function knownTheme(value: Partial<AppTheme> | null | undefined): AppTheme {
  const custom =
    value?.accent === CUSTOM_ACCENT &&
    typeof value.customAccent === 'string' &&
    HEX_COLOUR.test(value.customAccent);
  return {
    mode: MODES.includes(value?.mode as ThemeMode)
      ? (value!.mode as ThemeMode)
      : DEFAULT_APP_THEME.mode,
    ...(custom
      ? { accent: CUSTOM_ACCENT, customAccent: value.customAccent!.toLowerCase() }
      : {
          accent:
            ACCENT_SCHEMES.find((s) => s.id === value?.accent)?.id ?? DEFAULT_APP_THEME.accent,
        }),
    surface: SURFACE_SCHEMES.find((s) => s.id === value?.surface)?.id ?? DEFAULT_APP_THEME.surface,
    font: FONT_SCHEMES.find((s) => s.id === value?.font)?.id ?? DEFAULT_APP_THEME.font,
  };
}

export const sameTheme = (a: AppTheme, b: AppTheme) =>
  a.mode === b.mode &&
  a.accent === b.accent &&
  (a.customAccent ?? '') === (b.customAccent ?? '') &&
  a.surface === b.surface &&
  a.font === b.font;

export function readAppTheme(): AppTheme {
  try {
    return knownTheme(
      JSON.parse(localStorage.getItem(APP_THEME_KEY) ?? 'null') as Partial<AppTheme>,
    );
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

function cachedAccount(): string | null {
  try {
    return localStorage.getItem(THEME_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function cacheFor(theme: AppTheme, accountId: string) {
  writeAppTheme(theme);
  try {
    localStorage.setItem(THEME_ACCOUNT_KEY, accountId);
  } catch {
    // Without storage the account's look is still applied; it loads again next time.
  }
}

/**
 * Called once an account's settings have loaded. The account's saved look wins. An account with
 * none adopts a look chosen in this browser before appearance followed accounts, but never one
 * cached from another account; otherwise it starts from the default.
 */
export async function adoptAccountAppearance(accountId: string) {
  const saved = accountSetting('appearance');
  if (saved) {
    const theme = knownTheme(saved as Partial<AppTheme>);
    applyAppTheme(theme);
    cacheFor(theme, accountId);
    return;
  }
  const local = readAppTheme();
  const owner = cachedAccount();
  if (owner === null && !sameTheme(local, DEFAULT_APP_THEME)) {
    cacheFor(local, accountId);
    await saveAppearance(local).catch(() => undefined);
    return;
  }
  if (owner !== accountId) {
    applyAppTheme({ ...DEFAULT_APP_THEME });
    cacheFor({ ...DEFAULT_APP_THEME }, accountId);
  }
}

/** Saves the look to the signed-in account (cached here too); rejects if the account save fails. */
export async function saveAppearance(theme: AppTheme) {
  writeAppTheme(theme);
  await saveAccountSetting('appearance', AppearanceSettingSchema.parse(theme));
}

const accentRule = (selector: string, t: AccentTokens) =>
  `${selector}{--accent:${t.accent};--accent-hover:${t.accentHover};--accent-fg:${t.accentFg};` +
  `--accent-soft:${t.accentSoft};--accent-text:${t.accentText};--focus:${t.focus};}`;

const surfaceRule = (selector: string, t: SurfaceTokens) =>
  `${selector}{--paper:${t.paper};--surface:${t.surface};--rail:${t.rail};--sunken:${t.sunken};` +
  `--hover:${t.hover};--line:${t.line};--line-strong:${t.lineStrong};--ink:${t.ink};` +
  `--ink-2:${t.ink2};--ink-3:${t.ink3};}`;

const gridRule = (selector: string, [a, b]: [string, string]) =>
  `${selector}{--grid-green:color-mix(in srgb, ${a} 13%, transparent);` +
  `--grid-blue:color-mix(in srgb, ${b} 12%, transparent);}`;

/**
 * The workspace's stylesheets load after this one, so every selector carries an extra `html` to
 * outrank foundation.css's matching rule rather than relying on source order.
 */
const ROOT = 'html:root';

/** Writes one rule set for light and dark the way foundation.css cascades its own tokens. */
function cascade<T>(rule: (selector: string, tokens: T) => string, light: T, dark: T): string[] {
  return [
    rule(ROOT, light),
    `@media (prefers-color-scheme: dark){${rule(`${ROOT}:not([data-theme='light'])`, dark)}}`,
    rule(`${ROOT}[data-theme='dark']`, dark),
    rule(`${ROOT}[data-theme='light']`, light),
  ];
}

/** The one stylesheet that carries a theme's colours and fonts, cascading like foundation.css. */
export function themeStylesheet(theme: AppTheme): string {
  const accent = accentOf(theme);
  const surface = surfaceOf(theme);
  const font = fontOf(theme);
  const rules = cascade(accentRule, accent.light, accent.dark);
  // The defaults (Sage, Evergreen's gradient) are foundation.css's own tokens; leave them alone.
  if (surface.id !== DEFAULT_APP_THEME.surface)
    rules.push(...cascade(surfaceRule, surface.light, surface.dark));
  if (accent.id !== 'evergreen') {
    const blend = blendOf(accent);
    const gradient = (stops: readonly string[]) =>
      `linear-gradient(135deg, ${stops[0]} 0%, ${stops[1]} 52%, ${stops[2]} 100%)`;
    rules.push(
      `${ROOT}{--blend:${gradient(blend.stops)};--blend-hover:${gradient(blend.hover)};` +
        `--blend-fg:${blend.fg};}`,
      ...cascade(
        gridRule,
        [blend.stops[0], blend.stops[2]] as [string, string],
        [accent.dark.accentText, mix(blend.stops[2], '#ffffff', 0.5)] as [string, string],
      ),
    );
  }
  rules.push(`${ROOT}{--font-ui:${font.ui};--font-display:${font.display};}`);
  return rules.join('\n');
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

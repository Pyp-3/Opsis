// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENT_SCHEMES,
  APP_THEME_KEY,
  DEFAULT_APP_THEME,
  FONT_SCHEMES,
  SURFACE_SCHEMES,
  adoptAccountAppearance,
  applyAppTheme,
  blendOf,
  customAccent,
  knownTheme,
  readAppTheme,
  themeStylesheet,
  writeAppTheme,
  type AppTheme,
} from './app-theme';
import { contrast } from './theme-colour';
import { loadAccountSettings, resetAccountSettings } from './account-settings';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAccountSettings();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.getElementById('opsis-app-theme')?.remove();
});

describe('app theme', () => {
  it('every accent scheme defines a full light and dark token set', () => {
    const keys = Object.keys(ACCENT_SCHEMES[0].light);
    for (const scheme of ACCENT_SCHEMES) {
      expect(Object.keys(scheme.light)).toEqual(keys);
      expect(Object.keys(scheme.dark)).toEqual(keys);
      expect([...Object.values(scheme.light), ...Object.values(scheme.dark)].every(Boolean)).toBe(
        true,
      );
    }
  });

  it('falls back to the default for unknown stored ids', () => {
    localStorage.setItem(
      APP_THEME_KEY,
      JSON.stringify({
        mode: 'sideways',
        accent: 'chartreuse',
        surface: 'plaid',
        font: 'comic',
      }),
    );
    expect(readAppTheme()).toEqual(DEFAULT_APP_THEME);
  });

  it('round-trips a valid choice through storage', () => {
    const chosen: AppTheme = { mode: 'dark', accent: 'ocean', surface: 'warm', font: 'inter' };
    writeAppTheme(chosen);
    expect(readAppTheme()).toEqual(chosen);
  });

  it('sets data-theme only for a forced scheme and clears it for system', () => {
    applyAppTheme({ ...DEFAULT_APP_THEME, mode: 'dark' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyAppTheme({ ...DEFAULT_APP_THEME, mode: 'system' });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('injects one override stylesheet with the accent and fonts', () => {
    applyAppTheme({ mode: 'light', accent: 'ocean', surface: 'sage', font: 'inter' });
    const style = document.getElementById('opsis-app-theme');
    expect(style).not.toBeNull();
    const ocean = ACCENT_SCHEMES.find((s) => s.id === 'ocean')!;
    const inter = FONT_SCHEMES.find((s) => s.id === 'inter')!;
    expect(style!.textContent).toContain(`--accent:${ocean.light.accent}`);
    expect(style!.textContent).toContain(`--accent:${ocean.dark.accent}`);
    expect(style!.textContent).toContain(`--font-ui:${inter.ui}`);
    // Applying again reuses the same element rather than stacking stylesheets.
    applyAppTheme({ ...DEFAULT_APP_THEME });
    expect(document.querySelectorAll('#opsis-app-theme')).toHaveLength(1);
  });

  it('cascades the accent for system, forced dark and forced light', () => {
    const css = themeStylesheet({
      mode: 'system',
      accent: 'rose',
      surface: 'sage',
      font: 'signal',
    });
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain(":root[data-theme='light']");
  });

  it('keeps body text readable on every background palette', () => {
    for (const scheme of SURFACE_SCHEMES)
      for (const tokens of [scheme.light, scheme.dark])
        for (const text of [tokens.ink, tokens.ink2, tokens.ink3])
          for (const background of [tokens.paper, tokens.surface, tokens.rail, tokens.sunken])
            expect(
              contrast(text, background),
              `${scheme.id} ${text} on ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every preset accent readable on every background palette', () => {
    for (const scheme of ACCENT_SCHEMES)
      for (const surface of SURFACE_SCHEMES)
        for (const mode of ['light', 'dark'] as const)
          for (const background of [surface[mode].paper, surface[mode].surface])
            expect(
              contrast(scheme[mode].accentText, background),
              `${scheme.id} on ${surface.id} ${mode}`,
            ).toBeGreaterThanOrEqual(4.5);
  });

  it('only overrides the background tokens for a palette other than the default', () => {
    expect(themeStylesheet(DEFAULT_APP_THEME)).not.toContain('--paper');
    const cool = SURFACE_SCHEMES.find((s) => s.id === 'cool')!;
    const css = themeStylesheet({ ...DEFAULT_APP_THEME, surface: 'cool' });
    expect(css).toContain(`--paper:${cool.light.paper}`);
    expect(css).toContain(`--paper:${cool.dark.paper}`);
  });

  it('derives a readable accent from any picked colour', () => {
    const light = SURFACE_SCHEMES.flatMap(({ light }) => [
      light.paper,
      light.surface,
      light.sunken,
    ]);
    const dark = SURFACE_SCHEMES.flatMap(({ dark }) => [dark.paper, dark.surface, dark.sunken]);
    for (const picked of [
      '#ffff00',
      '#00ff00',
      '#000000',
      '#ffffff',
      '#ff0000',
      '#1e90ff',
      '#808080',
      '#3a1c4f',
    ]) {
      const scheme = customAccent(picked);
      for (const background of light) {
        expect(contrast(scheme.light.accent, background), picked).toBeGreaterThanOrEqual(4.5);
        expect(contrast(scheme.light.accentText, background), picked).toBeGreaterThanOrEqual(4.5);
      }
      for (const background of dark) {
        expect(contrast(scheme.dark.accent, background), picked).toBeGreaterThanOrEqual(4.5);
        expect(contrast(scheme.dark.accentText, background), picked).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(scheme.light.accentFg, scheme.light.accent), picked).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(scheme.light.accentFg, scheme.light.accentHover),
        picked,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(scheme.light.accentText, scheme.light.accentSoft),
        picked,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(scheme.dark.accentFg, scheme.dark.accent), picked).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(scheme.dark.accentText, scheme.dark.accentSoft),
        picked,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps each accent’s gradient readable and leaves Evergreen’s own gradient alone', () => {
    for (const scheme of [...ACCENT_SCHEMES, customAccent('#ffcc00')]) {
      const blend = blendOf(scheme);
      for (const stop of [...blend.stops, ...blend.hover])
        expect(contrast(blend.fg, stop), `${scheme.id} ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(themeStylesheet(DEFAULT_APP_THEME)).not.toContain('--blend');
    const css = themeStylesheet({ ...DEFAULT_APP_THEME, accent: 'violet' });
    expect(css).toContain('--blend:linear-gradient(135deg, #5b3f8c 0%');
    expect(css).toContain('--grid-green:color-mix(in srgb, #5b3f8c 13%');
  });

  it('keeps a custom colour only with a valid hex value', () => {
    expect(knownTheme({ accent: 'custom', customAccent: '#12AB9F' })).toMatchObject({
      accent: 'custom',
      customAccent: '#12ab9f',
    });
    expect(knownTheme({ accent: 'custom', customAccent: 'red' }).accent).toBe('evergreen');
    expect(knownTheme({ accent: 'ocean', customAccent: '#123456' })).not.toHaveProperty(
      'customAccent',
    );
  });
});

describe('appearance on the account', () => {
  const account = (values: Record<string, unknown>) => {
    const saved: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          saved.push({ url, body: JSON.parse(String(init.body)) });
          return new Response(null, { status: 204 });
        }
        return Response.json(url.endsWith('/usage') ? [] : { values });
      }),
    );
    return saved;
  };

  it('applies and caches the account’s saved look', async () => {
    const look: AppTheme = {
      mode: 'dark',
      accent: 'custom',
      customAccent: '#c0ffee',
      surface: 'dusk',
      font: 'inter',
    };
    account({ appearance: look });
    await loadAccountSettings();
    await adoptAccountAppearance('reader');
    expect(readAppTheme()).toEqual(look);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.getElementById('opsis-app-theme')!.textContent).toContain(
      `--paper:${SURFACE_SCHEMES.find((s) => s.id === 'dusk')!.dark.paper}`,
    );
  });

  it('copies a look chosen in this browser to an account that has none, once', async () => {
    const local: AppTheme = { ...DEFAULT_APP_THEME, surface: 'warm' };
    writeAppTheme(local);
    const saved = account({});
    await loadAccountSettings();
    await adoptAccountAppearance('reader');
    expect(saved).toEqual([{ url: '/v1/account/settings/appearance', body: { value: local } }]);
  });

  it('never gives one account’s cached look to another', async () => {
    account({ appearance: { ...DEFAULT_APP_THEME, accent: 'rose' } });
    await loadAccountSettings();
    await adoptAccountAppearance('first');
    resetAccountSettings();
    const saved = account({});
    await loadAccountSettings();
    await adoptAccountAppearance('second');
    expect(saved).toEqual([]);
    expect(readAppTheme()).toEqual(DEFAULT_APP_THEME);
  });
});

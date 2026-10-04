// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCENT_SCHEMES,
  APP_THEME_KEY,
  DEFAULT_APP_THEME,
  FONT_SCHEMES,
  applyAppTheme,
  readAppTheme,
  themeStylesheet,
  writeAppTheme,
  type AppTheme,
} from './app-theme';

afterEach(() => {
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
      JSON.stringify({ mode: 'sideways', accent: 'chartreuse', font: 'comic' }),
    );
    expect(readAppTheme()).toEqual(DEFAULT_APP_THEME);
  });

  it('round-trips a valid choice through storage', () => {
    const chosen: AppTheme = { mode: 'dark', accent: 'ocean', font: 'inter' };
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
    applyAppTheme({ mode: 'light', accent: 'ocean', font: 'inter' });
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
    const css = themeStylesheet({ mode: 'system', accent: 'rose', font: 'signal' });
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain(":root[data-theme='light']");
  });
});

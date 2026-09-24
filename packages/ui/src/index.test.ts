import { describe, expect, it } from 'vitest';
import {
  COLOR_TOKENS,
  PACKAGE_NAME,
  PALETTES,
  cssVariables,
  isColorToken,
  resolveColor,
} from './index';

/** WCAG relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('@opsis/ui tokens', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@opsis/ui');
  });

  it.each(Object.entries(PALETTES))('%s palette defines every token as hex', (_, palette) => {
    for (const token of COLOR_TOKENS) expect(palette[token]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it.each(Object.entries(PALETTES))('%s palette text meets WCAG AA', (_, palette) => {
    expect(contrast(palette['ui.text'], palette['ui.background'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['ui.cardText'], palette['ui.card'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['ui.textMuted'], palette['ui.surface'])).toBeGreaterThanOrEqual(4.5);
  });

  it('resolves known tokens and falls back for unknown ones', () => {
    expect(isColorToken('food.tomato')).toBe(true);
    expect(isColorToken('food.pizza')).toBe(false);
    expect(resolveColor('food.tomato', 'ui.card')).toBe(PALETTES.default['food.tomato']);
    expect(resolveColor('nope', 'ui.card', 'colorBlindSafe')).toBe(
      PALETTES.colorBlindSafe['ui.card'],
    );
    expect(resolveColor(undefined, 'ui.card')).toBe(PALETTES.default['ui.card']);
  });

  it('emits CSS custom properties', () => {
    expect(cssVariables()['--opsis-food-tomato']).toBe(PALETTES.default['food.tomato']);
  });
});

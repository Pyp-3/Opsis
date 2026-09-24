import { describe, expect, it } from 'vitest';
import { MESSAGES, createTranslator, en, format, t } from './i18n';

describe('@opsis/ui i18n', () => {
  it('fills placeholders and leaves unknown ones as written', () => {
    expect(format('{count} of {max}', { count: 3, max: 500 })).toBe('3 of 500');
    expect(format('Hi {name}')).toBe('Hi {name}');
  });

  it('translates through the English catalogue', () => {
    expect(t('toolbar.explode')).toBe('Explode');
    expect(t('input.counter', { count: 12, max: 500 })).toBe('12 of 500 characters');
  });

  it('accepts another catalogue with the same keys', () => {
    const shout = Object.fromEntries(
      Object.entries(en).map(([key, value]) => [key, value.toUpperCase()]),
    ) as typeof en;
    expect(createTranslator(shout)('toolbar.explode')).toBe('EXPLODE');
  });

  it('has no empty English strings', () => {
    for (const value of Object.values(MESSAGES.en)) expect(value.trim()).not.toBe('');
  });
});

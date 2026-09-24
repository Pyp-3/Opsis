import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('./', import.meta.url);
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: readFileSync(new URL(f, SRC), 'utf8') }));
const specifiers = (text: string) =>
  [...text.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1] ?? '');

describe('import boundaries', () => {
  it.each(sources)('$file never imports layout, explain or React', ({ text }) => {
    for (const spec of specifiers(text)) {
      expect(spec).not.toMatch(/@opsis\/(layout|explain)|pipeline\/(layout|explain)|^react|three/);
    }
  });

  it('uses the React-free primitives entry, never the package root', () => {
    const primitives = sources.flatMap(({ text }) =>
      specifiers(text).filter((s) => s.startsWith('@opsis/primitives')),
    );
    expect(primitives.length).toBeGreaterThan(0);
    expect(new Set(primitives)).toEqual(new Set(['@opsis/primitives/match']));
  });

  it('the React-free primitives entry loads no React module', async () => {
    const pure = readFileSync(new URL('../../../primitives/src/pure.ts', import.meta.url), 'utf8');
    for (const spec of specifiers(pure))
      expect(['./anchors', './catalog', './match', './meta']).toContain(spec);
    for (const dep of ['anchors', 'catalog', 'match', 'meta']) {
      const text = readFileSync(
        new URL(`../../../primitives/src/${dep}.ts`, import.meta.url),
        'utf8',
      );
      for (const spec of specifiers(text)) expect(spec).not.toMatch(/^react|three|render|registry/);
    }
  });
});

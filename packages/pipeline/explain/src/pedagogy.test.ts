import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIENCE_RULES, SHARED_WORDING_RULES } from './audience';
import { MISCONCEPTIONS } from './knowledge';

const doc = readFileSync(new URL('../../../../docs/PEDAGOGY.md', import.meta.url), 'utf8');

describe('docs/PEDAGOGY.md stays in sync with the explainer', () => {
  it.each(MISCONCEPTIONS.map((entry) => [entry.id, entry] as const))(
    '%s has an entry',
    (id, entry) => {
      expect(doc).toContain(`### ${id}:`);
      expect(entry.child.split(/\s+/u).length).toBeLessThanOrEqual(25);
    },
  );

  it('documents every audience wording rule', () => {
    for (const { rules } of Object.values(AUDIENCE_RULES)) {
      for (const rule of rules) expect(doc).toContain(rule);
    }
    for (const rule of SHARED_WORDING_RULES) expect(doc).toContain(rule);
  });
});

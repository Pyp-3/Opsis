import { describe, expect, it } from 'vitest';
import { loadGoldenCases } from './fixtures';

describe('golden fixtures', () => {
  it('contains 15 schema-valid structural cases', async () => {
    const cases = await loadGoldenCases();

    expect(cases).toHaveLength(15);
    expect(new Set(cases.map((testCase) => testCase.utterance)).size).toBe(15);
    expect(cases.map((testCase) => testCase.id)).toEqual(
      expect.arrayContaining(['01-sun-east', '02-sandwich-parts', '15-nonsense-fallback']),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '@opsis/schema';
import { matchEntity } from './primitives';

// No catalog keyword ties a 2D icon with a 3D-only model today, so the ranking is stubbed.
vi.mock('@opsis/primitives/match', async (original) => {
  const actual = await original<typeof import('@opsis/primitives/match')>();
  const ranks: Record<string, string[]> = {
    vessel: ['bowl', 'box', 'group_frame'],
    grip: ['hand', 'bowl'],
  };
  const rank = (lemma: string) =>
    (ranks[lemma] ?? []).map((id) => ({ id, score: 1, fallback: false }));
  return {
    ...actual,
    rankPrimitives: ({ lemma }: { lemma: string }) => rank(lemma),
    matchPrimitive: ({ lemma }: { lemma: string }) => rank(lemma)[0],
  };
});

const entity = (lemma: string): Entity => ({
  id: `e_${lemma}`,
  surface: lemma,
  lemma,
  kind: 'object',
  span: [0, lemma.length],
  summary: lemma,
});

describe('2D-first keyword tie-break (D-004)', () => {
  it('prefers tied primitives with a 2D icon and asks the LLM only among them', () => {
    expect(matchEntity(entity('vessel'))).toEqual({
      primitive: 'box',
      source: 'keyword',
      score: 1,
      tied: ['box', 'group_frame'],
    });
  });

  it('keeps registry order when no tied primitive has a 2D icon', () => {
    expect(matchEntity(entity('grip'))).toEqual({
      primitive: 'hand',
      source: 'keyword',
      score: 1,
      tied: ['hand', 'bowl'],
    });
  });
});

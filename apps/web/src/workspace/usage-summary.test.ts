import { describe, expect, it } from 'vitest';
import type { ReportedUsage, UsageRecord } from '@opsis/schema';
import { measuredLabel, usageByCollection } from './usage-summary';

const attempt = (input: number | null, cost: number | null): ReportedUsage => ({
  inputTokens: input,
  outputTokens: null,
  cachedInputTokens: null,
  cacheWriteTokens: null,
  estimatedCostUSD: cost,
});
const record = (boardId: string | undefined, attempts: ReportedUsage[]): UsageRecord => ({
  id: crypto.randomUUID(),
  at: 1,
  agent: 'claude',
  model: 'haiku',
  effort: 'low',
  purpose: 'diagram',
  ...(boardId ? { boardId } : {}),
  attempts,
});

describe('usage by collection', () => {
  const boards = [
    { id: 'a', collectionId: 'work' },
    { id: 'b', collectionId: null },
    { id: 'c', collectionId: 'gone' },
  ];
  const groups = usageByCollection(
    [
      record('a', [attempt(100, 0.01), attempt(null, null)]),
      record('a', [attempt(50, 0.02)]),
      record('b', [attempt(10, null)]),
      record('c', [attempt(1, 0)]),
      record('deleted', [attempt(5, 0.5)]),
      record(undefined, [attempt(5, 0.5)]),
    ],
    boards,
    [{ id: 'work', name: 'Work' }],
  );

  it('groups by current collection, unfiled boards and unknown boards', () => {
    expect(groups.map((group) => [group.name, group.requests])).toEqual([
      ['Work', 2],
      ['Unfiled', 2],
      ['Other or deleted boards', 2],
    ]);
  });

  it('keeps missing measurements distinct from zero', () => {
    const work = groups[0]!;
    expect(work.inputTokens).toEqual({ total: 150, unreported: 1 });
    expect(work.outputTokens).toEqual({ total: 0, unreported: 3 });
    expect(measuredLabel(work.outputTokens, work.attempts, String)).toBe('Unavailable');
    expect(measuredLabel(work.inputTokens, work.attempts, String)).toBe('150 (1 unreported)');
    // A reported zero cost stays a measured zero.
    expect(groups[1]!.estimatedCostUSD).toEqual({ total: 0, unreported: 1 });
  });
});

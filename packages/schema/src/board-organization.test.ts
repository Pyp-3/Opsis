import { describe, expect, it } from 'vitest';
import {
  BoardTagsRequestSchema,
  SmartCollectionRuleSchema,
  matchesSmartCollection,
  normalizeTags,
} from './board-organization';

const now = 100 * 86_400_000;
const board = {
  title: 'How DNS works',
  updatedAt: now - 2 * 86_400_000,
  visibility: 'public' as const,
  collectionId: '6f1f8f5e-8e8f-4d0b-9c39-0b3b39c6b0a1',
  tags: ['Networking', 'exam'],
  agent: 'claude',
};

describe('board organization', () => {
  it('normalizes tags without case-insensitive duplicates', () => {
    expect(normalizeTags([' Net ', 'net', '', 'Exam'])).toEqual(['Net', 'Exam']);
    expect(BoardTagsRequestSchema.parse({ tags: ['a', 'A'] })).toEqual({ tags: ['a'] });
    expect(BoardTagsRequestSchema.safeParse({ tags: ['x'.repeat(31)] }).success).toBe(false);
  });

  it('requires at least one condition in a rule', () => {
    expect(SmartCollectionRuleSchema.safeParse({}).success).toBe(false);
    expect(SmartCollectionRuleSchema.safeParse({ tagsAll: [] }).success).toBe(false);
    expect(SmartCollectionRuleSchema.safeParse({ agent: 'codex' }).success).toBe(true);
  });

  it('matches every condition, case-insensitively for tags and titles', () => {
    const matches = (rule: object) =>
      matchesSmartCollection(board, SmartCollectionRuleSchema.parse(rule), now);
    expect(matches({ tagsAll: ['networking', 'EXAM'] })).toBe(true);
    expect(matches({ tagsAll: ['networking', 'draft'] })).toBe(false);
    expect(matches({ tagsAny: ['draft', 'exam'] })).toBe(true);
    expect(matches({ visibility: 'private' })).toBe(false);
    expect(matches({ collection: 'unfiled' })).toBe(false);
    expect(matches({ collection: board.collectionId })).toBe(true);
    expect(matches({ updatedWithinDays: 1 })).toBe(false);
    expect(matches({ updatedWithinDays: 7, agent: 'claude', titleIncludes: 'dns' })).toBe(true);
    expect(matches({ agent: 'codex' })).toBe(false);
  });
});

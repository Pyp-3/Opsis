import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO } from './email-demo';
import type { BoardDocument } from './board';
import { foldText, searchBoards, SearchQuerySchema } from './board-search';

const email: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
const tweak = (patch: Partial<BoardDocument>): BoardDocument => ({ ...email, ...patch });
const first = email.nodes[0]!;

describe('board search', () => {
  it('folds case and accents', () => {
    expect(foldText('Résumé')).toBe('resume');
  });

  it('bounds queries', () => {
    expect(SearchQuerySchema.safeParse({ q: ' a ' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('requires every term within one concept and ranks labels above long text', () => {
    const board = tweak({
      title: 'Mail flow',
      nodes: [
        { ...first, id: 'a', label: 'Spam filter', summary: 'Checks messages.' },
        {
          ...first,
          id: 'b',
          label: 'Inbox',
          summary: 'Shows mail.',
          explanation: 'Anything the spam filter allowed lands here.',
        },
        { ...first, id: 'c', label: 'Outbox', summary: 'Spam only here.' },
      ],
      edges: [],
      groups: [],
    });
    const hits = searchBoards(
      [{ id: 'board-1', title: 'Mail flow', access: 'owner', board }],
      'SPAM filter',
    );
    expect(hits.map((hit) => hit.conceptId)).toEqual(['a', 'b']);
    expect(hits[0]).toMatchObject({
      field: 'label',
      boardTitle: 'Mail flow',
      label: 'Spam filter',
    });
    expect(hits[1]!.snippet).toContain('spam filter');
  });

  it('finds notes, sources, connections and the board itself', () => {
    const board = tweak({
      title: 'Résumé review',
      nodes: [
        {
          ...first,
          id: 'a',
          notes: 'Ask about the quarterly audit.',
          references: [{ title: 'Handbook', url: 'https://example.com/handbook' }],
        },
        { ...first, id: 'b', label: 'Reviewer' },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', label: 'escalates to' }],
      groups: [],
    });
    const search = (q: string) =>
      searchBoards([{ id: 'r', title: board.title, access: 'editor', board }], q);
    expect(search('quarterly audit')[0]).toMatchObject({ conceptId: 'a', field: 'notes' });
    expect(search('handbook')[0]).toMatchObject({ conceptId: 'a', field: 'source' });
    expect(search('escalates')[0]).toMatchObject({ conceptId: 'a', field: 'connection' });
    expect(search('resume')[0]).toMatchObject({ field: 'title', access: 'editor' });
    expect(search('resume')[0]!.conceptId).toBeUndefined();
  });

  it('skips empty boards and keeps the result limit', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      id: `b${index}`,
      title: `Network ${index}`,
      access: 'owner' as const,
      board: tweak({ title: `Network ${index}` }),
    }));
    expect(searchBoards([{ id: 'x', title: 'x', access: 'owner', board: null }], 'x')).toEqual([]);
    expect(searchBoards(many, 'network')).toHaveLength(50);
  });
});

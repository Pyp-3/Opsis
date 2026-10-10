import { describe, expect, it } from 'vitest';
import {
  addBoardPage,
  boardPage,
  boardPages,
  EMAIL_DEMO,
  updateBoardPage,
  withBoardPage,
  type BoardSnapshot,
} from '@opsis/schema';
import { mergeBoardSnapshots } from './board-sync';
const base: BoardSnapshot = {
  board: { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: { sender: { x: 1, y: 2 } } },
  past: [],
  future: [],
};
describe('board reconciliation', () => {
  it('merges edits on different pages, and edits to a page another view added pages around', () => {
    const paged: BoardSnapshot = {
      ...base,
      board: addBoardPage(
        base.board!,
        { id: 'second-page-0001', title: 'Second' },
        { firstPage: { id: 'first-page-00001', title: 'First' } },
      ),
    };
    const mine = structuredClone(paged),
      theirs = structuredClone(paged);
    const second = boardPage(mine.board!, 'second-page-0001');
    mine.board = withBoardPage(mine.board!, 'second-page-0001', {
      ...second,
      nodes: [{ ...EMAIL_DEMO.nodes[0]!, id: 'mine' }],
    });
    theirs.board!.nodes[0]!.label = 'Their label';
    theirs.board = updateBoardPage(theirs.board!, 'second-page-0001', { hidden: true });
    const merged = mergeBoardSnapshots(paged, mine, theirs).board!;
    expect(merged.nodes[0]!.label).toBe('Their label');
    expect(boardPage(merged, 'second-page-0001').nodes.map((n) => n.id)).toEqual(['mine']);
    expect(boardPages(merged)[1]!.hidden).toBe(true);
    // Another view turned the board into pages while this one edited it as one page.
    const single = structuredClone(base);
    single.board!.nodes[0]!.summary = 'My summary';
    const both = mergeBoardSnapshots(base, single, paged).board!;
    expect(boardPages(both).map((page) => page.id)).toEqual([
      'first-page-00001',
      'second-page-0001',
    ]);
    expect(both.nodes[0]!.summary).toBe('My summary');
  });
  it('merges independent edits, including separate fields on the same concept', () => {
    const mine = structuredClone(base),
      theirs = structuredClone(base);
    mine.board!.nodes[0]!.label = 'My label';
    theirs.board!.nodes[0]!.summary = 'Their summary';
    theirs.board!.positions.sender = { x: 50, y: 60 };
    const merged = mergeBoardSnapshots(base, mine, theirs);
    expect(merged.board!.nodes[0]!.label).toBe('My label');
    expect(merged.board!.nodes[0]!.summary).toBe('Their summary');
    expect(merged.board!.positions.sender).toEqual({ x: 50, y: 60 });
    expect(merged.past.at(-1)).toEqual(theirs.board);
  });
  it('preserves both additions and removes dangling edges after deletion', () => {
    const mine = structuredClone(base),
      theirs = structuredClone(base);
    mine.board!.nodes.push({ ...mine.board!.nodes[0]!, id: 'mine' });
    theirs.board!.nodes.push({ ...theirs.board!.nodes[0]!, id: 'theirs' });
    theirs.board!.nodes = theirs.board!.nodes.filter((n) => n.id !== 'sender');
    theirs.board!.edges = theirs.board!.edges.filter(
      (e) => e.source !== 'sender' && e.target !== 'sender',
    );
    const merged = mergeBoardSnapshots(base, mine, theirs);
    expect(merged.board!.nodes.map((n) => n.id)).toContain('mine');
    expect(merged.board!.nodes.map((n) => n.id)).toContain('theirs');
    expect(merged.board!.nodes.map((n) => n.id)).not.toContain('sender');
    expect(merged.board!.edges.some((e) => e.source === 'sender')).toBe(false);
    expect(merged.board!.positions.sender).toBeUndefined();
  });
  it('keeps the retried local field edit and the other version in undo history', () => {
    const mine = structuredClone(base),
      theirs = structuredClone(base);
    mine.board!.nodes[0]!.label = 'Mine';
    theirs.board!.nodes[0]!.label = 'Theirs';
    expect(mergeBoardSnapshots(base, mine, theirs).board!.nodes[0]!.label).toBe('Mine');
    expect(mergeBoardSnapshots(base, mine, theirs).past.at(-1)!.nodes[0]!.label).toBe('Theirs');
  });
  it('does not mutate any input and retains unknown-baseline recovery history', () => {
    const theirs = structuredClone(base),
      before = structuredClone(theirs);
    mergeBoardSnapshots(base, base, theirs);
    expect(theirs).toEqual(before);
    expect(mergeBoardSnapshots(null, base, theirs).past.at(-1)).toEqual(theirs.board);
  });
});

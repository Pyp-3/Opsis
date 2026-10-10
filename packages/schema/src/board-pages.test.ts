import { describe, expect, it } from 'vitest';
import {
  addBoardPage,
  boardBacklinks,
  boardPage,
  boardPages,
  changedBoardPage,
  compareBoards,
  createEmptyBoard,
  everyBoardPage,
  mapBoardPages,
  moveBoardPage,
  prepareCollectionImport,
  readerBoard,
  readerSnapshot,
  removeBoardPage,
  searchBoard,
  updateBoardPage,
  withBoardPage,
  BoardDocumentSchema,
  type BoardDocument,
} from './index';

const FIRST = 'first-page-0001';
const SECOND = 'second-page-002';
const THIRD = 'third-page-0003';
const concept = (id: string, label: string, linkedBoardId?: string) => ({
  id,
  label,
  icon: 'server' as const,
  summary: `${label} summary`,
  explanation: `${label} explanation`,
  kind: 'step' as const,
  ...(linkedBoardId ? { linkedBoardId } : {}),
});
const cover: BoardDocument = {
  ...createEmptyBoard('Pitch'),
  description: 'A pitch',
  nodes: [concept('idea', 'Idea')],
  positions: { idea: { x: 0, y: 0 } },
  look: { canvas: 'midnight', icon: 'gold' },
};
/** Cover, then Pricing (hidden), then Roadmap. */
function pitch() {
  let board = addBoardPage(
    cover,
    { id: SECOND, title: 'Pricing' },
    {
      firstPage: { id: FIRST, title: 'Cover' },
    },
  );
  board = addBoardPage(board, { id: THIRD, title: 'Roadmap' });
  board = withBoardPage(board, SECOND, {
    ...boardPage(board, SECOND),
    nodes: [concept('price', 'Secret price')],
    positions: { price: { x: 10, y: 10 } },
  });
  board = withBoardPage(board, THIRD, {
    ...boardPage(board, THIRD),
    nodes: [concept('launch', 'Launch')],
    positions: { launch: { x: 0, y: 0 } },
    drawings: [
      {
        id: 'note',
        shape: 'text',
        x: 0,
        y: 0,
        text: 'Q3',
        ink: 'gold',
        line: 'solid',
        strokeWidth: 2,
      },
    ],
  });
  return updateBoardPage(board, SECOND, { hidden: true });
}

describe('board pages', () => {
  it('keeps a board without pages as its own single page', () => {
    expect(boardPages(cover)).toEqual([]);
    expect(boardPage(cover, 'anything-at-all')).toBe(cover);
    expect(withBoardPage(cover, null, { ...cover, title: 'Renamed' }).title).toBe('Renamed');
  });

  it('adds pages after the first, which stays in the board fields', () => {
    const board = pitch();
    expect(BoardDocumentSchema.parse(board)).toEqual(board);
    expect(boardPages(board)).toEqual([
      { id: FIRST, title: 'Cover', hidden: false },
      { id: SECOND, title: 'Pricing', hidden: true },
      { id: THIRD, title: 'Roadmap', hidden: false },
    ]);
    expect(board.nodes.map((node) => node.id)).toEqual(['idea']);
    expect(board.pages?.[0]?.content).toBeUndefined();
    const roadmap = boardPage(board, THIRD);
    expect(roadmap.nodes.map((node) => node.id)).toEqual(['launch']);
    expect(roadmap.pages).toBeUndefined();
    // Board-level fields are shared by every page.
    expect(roadmap.look).toEqual(cover.look);
    expect(roadmap.title).toBe('Pitch');
    // The same input gives the same view, so canvas code can compare by identity.
    expect(boardPage(board, THIRD)).toBe(roadmap);
    // An unknown page shows the first.
    expect(boardPage(board, 'missing-page-id').nodes[0]?.id).toBe('idea');
  });

  it('writes a page back without touching the others, and applies board-level edits', () => {
    const board = pitch();
    const roadmap = boardPage(board, THIRD);
    const edited = withBoardPage(board, THIRD, {
      ...roadmap,
      title: 'Pitch v2',
      drawings: undefined,
      nodes: [...roadmap.nodes, concept('scale', 'Scale')],
    });
    expect(edited.title).toBe('Pitch v2');
    expect(boardPage(edited, THIRD).nodes.map((node) => node.id)).toEqual(['launch', 'scale']);
    expect(boardPage(edited, THIRD).drawings).toBeUndefined();
    expect(boardPage(edited, SECOND)).toEqual({ ...boardPage(board, SECOND), title: 'Pitch v2' });
    expect(withBoardPage(board, THIRD, roadmap)).toBe(board);
    expect(changedBoardPage(board, edited)).toBe(THIRD);
    expect(changedBoardPage(board, board)).toBeNull();
  });

  it('reorders, renames, renews links and removes pages', () => {
    let board = moveBoardPage(pitch(), THIRD, 0);
    expect(boardPages(board).map((page) => page.id)).toEqual([THIRD, FIRST, SECOND]);
    // The new first page's content moved into the board fields.
    expect(board.nodes[0]?.id).toBe('launch');
    expect(boardPage(board, FIRST).nodes[0]?.id).toBe('idea');
    expect(BoardDocumentSchema.safeParse(board).success).toBe(true);
    board = updateBoardPage(board, FIRST, { title: 'Opening', id: 'renewed-link-id' });
    expect(boardPages(board)[1]).toEqual({
      id: 'renewed-link-id',
      title: 'Opening',
      hidden: false,
    });
    expect(() => updateBoardPage(board, SECOND, { id: THIRD })).toThrow(/unique/);
    board = removeBoardPage(board, THIRD);
    expect(board.nodes[0]?.id).toBe('idea');
    expect(boardPages(board).map((page) => page.id)).toEqual(['renewed-link-id', SECOND]);
    expect(() => removeBoardPage(removeBoardPage(board, SECOND), 'renewed-link-id')).toThrow();
  });

  it('keeps at least one page visible', () => {
    const board = pitch();
    expect(() =>
      updateBoardPage(updateBoardPage(board, FIRST, { hidden: true }), THIRD, { hidden: true }),
    ).toThrow(/visible/);
    // Removing the only visible page shows the next one.
    const onlyHiddenLeft = removeBoardPage(
      removeBoardPage(updateBoardPage(board, FIRST, { hidden: true }), THIRD),
      SECOND,
    );
    expect(boardPages(onlyHiddenLeft)).toEqual([{ id: FIRST, title: 'Cover', hidden: false }]);
    const invalid = { ...board, pages: board.pages!.map((page) => ({ ...page, hidden: true })) };
    expect(BoardDocumentSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates every page like a board', () => {
    const board = pitch();
    const broken = structuredClone(board);
    broken.pages![2]!.content!.edges = [{ id: 'e', source: 'launch', target: 'gone', label: '' }];
    expect(BoardDocumentSchema.safeParse(broken).success).toBe(false);
    const misplaced = structuredClone(board);
    misplaced.pages![0]!.content = { nodes: [], edges: [], positions: {} };
    expect(BoardDocumentSchema.safeParse(misplaced).success).toBe(false);
    const duplicate = structuredClone(board);
    duplicate.pages![2]!.id = SECOND;
    expect(BoardDocumentSchema.safeParse(duplicate).success).toBe(false);
  });

  it('never gives viewers a hidden page unless they opened its link', () => {
    const board = pitch();
    const reader = readerBoard(board);
    expect(boardPages(reader).map((page) => page.id)).toEqual([FIRST, THIRD]);
    expect(JSON.stringify(reader)).not.toContain('Secret price');
    expect(JSON.stringify(reader)).not.toContain(SECOND);
    const linked = readerBoard(board, SECOND);
    expect(boardPages(linked).map((page) => page.id)).toEqual([FIRST, SECOND, THIRD]);
    // A hidden first page leaves the next visible page in the board fields.
    const hiddenCover = readerBoard(updateBoardPage(board, FIRST, { hidden: true }));
    expect(hiddenCover.nodes[0]?.id).toBe('launch');
    expect(JSON.stringify(hiddenCover)).not.toContain('Idea');
    expect(BoardDocumentSchema.safeParse(hiddenCover).success).toBe(true);
    // Undo history could hold hidden pages, so viewers never receive it.
    expect(readerSnapshot({ board, past: [board], future: [board] })).toEqual({
      board: reader,
      past: [],
      future: [],
    });
    expect(readerBoard(cover)).toBe(cover);
  });

  it('searches, scans links and remaps imports on every page', () => {
    const target = '2b7f2c1e-6c4b-4d8e-9a59-0d7d1b0c5a11';
    const board = mapBoardPages(pitch(), (page) => ({
      ...page,
      nodes: page.nodes.map((node) => ({ ...node, linkedBoardId: target })),
    }));
    expect(everyBoardPage(board).map(({ board: page }) => page.nodes[0]?.linkedBoardId)).toEqual([
      target,
      target,
      target,
    ]);
    const hits = searchBoard({ id: 'b', title: 'Pitch', access: 'owner', board }, 'launch');
    expect(hits[0]).toMatchObject({ conceptId: 'launch', pageId: THIRD });
    const entry = { id: 'b', title: 'Pitch', board };
    expect(boardBacklinks(target, [{ ...entry, fullAccess: true }]).map((l) => l.label)).toEqual([
      'Idea',
      'Secret price',
      'Launch',
    ]);
    expect(boardBacklinks(target, [{ ...entry, fullAccess: false }]).map((l) => l.label)).toEqual([
      'Idea',
      'Launch',
    ]);
    const source = '3c8a3d2f-7d5c-4e9f-8b6a-1e8e2c1d6b22';
    const imported = prepareCollectionImport(
      {
        format: 'opsis-collection',
        version: 1,
        name: 'Deck',
        boards: [
          { id: target, title: 'Target', tags: [], board: cover },
          { id: source, title: 'Pitch', tags: [], board },
        ],
      },
      ['4d9b4e3a-8e6d-4fa0-9c7b-2f9f3d2e7c33', '5eac5f4b-9f7e-40b1-8d8c-3a0a4e3f8d44'],
    );
    const copy = imported[1]!.snapshot.board!;
    expect(everyBoardPage(copy).map(({ board: page }) => page.nodes[0]?.linkedBoardId)).toEqual(
      Array(3).fill('4d9b4e3a-8e6d-4fa0-9c7b-2f9f3d2e7c33'),
    );
  });

  it('compares boards page by page', () => {
    const before = pitch();
    const after = updateBoardPage(
      withBoardPage(before, THIRD, {
        ...boardPage(before, THIRD),
        nodes: [{ ...boardPage(before, THIRD).nodes[0]!, label: 'Launch day' }],
      }),
      SECOND,
      { title: 'Prices', hidden: false },
    );
    const labels = compareBoards(before, after).map((difference) => difference.label);
    expect(labels).toEqual(['Page 2 (Prices)', 'Page 3 (Roadmap) · Concept launch']);
    // A board without pages compares as the other side's first page.
    expect(compareBoards(cover, before).map((difference) => difference.label)).toEqual([
      'Page 1 (Cover)',
      'Page 2 (Pricing)',
      'Page 2 (Pricing) · Concept price',
      'Page 2 (Pricing) · Position price',
      'Page 3 (Roadmap)',
      'Page 3 (Roadmap) · Concept launch',
      'Page 3 (Roadmap) · Position launch',
    ]);
  });
});

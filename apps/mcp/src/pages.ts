import { z } from 'zod';
import {
  addBoardPage,
  BoardPageIdSchema,
  boardPage,
  boardPages,
  moveBoardPage,
  removeBoardPage,
  updateBoardPage,
  withBoardPage,
  type BoardDocument,
  type BoardSnapshot,
} from '@opsis/schema';
import { CanvasError, boardOf, withEdit } from './canvas.js';

/**
 * Pages for agents: every board tool takes an optional `page` (its number or id), and edits that
 * page as if it were the whole board. The edit is still one undoable step on the board.
 */
export const PageRefSchema = z
  .union([z.number().int().min(1).max(30), BoardPageIdSchema])
  .describe(
    'Which page: its number (1 is the first) or its id from opsis_get_board. Defaults to page 1.',
  );
export type PageRef = z.infer<typeof PageRefSchema>;

/** Page ids are links to hidden pages, so they are random and unguessable. */
export const newPageId = () => crypto.randomUUID().replaceAll('-', '');

/** The page `ref` names, or null for a board without pages; unknown pages are an error. */
export function pageIdOf(board: BoardDocument, ref: PageRef | undefined): string | null {
  const pages = boardPages(board);
  if (ref === undefined || (!pages.length && ref === 1)) return pages[0]?.id ?? null;
  const page = typeof ref === 'number' ? pages[ref - 1] : pages.find((p) => p.id === ref);
  if (!page)
    throw new CanvasError(
      pages.length
        ? `No page ${JSON.stringify(ref)}. This board has ${pages.length} pages: ${pages
            .map((p, index) => `${index + 1} "${p.title}" (${p.id})`)
            .join(', ')}.`
        : 'This board has one page. Add more with opsis_add_page.',
    );
  return page.id;
}

/** The single-page document an agent reads and edits for `ref`. */
export function pageOf(board: BoardDocument, ref: PageRef | undefined) {
  return boardPage(board, pageIdOf(board, ref));
}

/**
 * Runs a single-page edit on one page of the board. The edit sees that page as an ordinary
 * board; its result is written back into the whole board as one undoable step.
 */
export function onPage<R>(
  snapshot: BoardSnapshot,
  ref: PageRef | undefined,
  change: (snapshot: BoardSnapshot) => { snapshot: BoardSnapshot; result: R },
): { snapshot: BoardSnapshot; result: R } {
  const board = boardOf(snapshot);
  const id = pageIdOf(board, ref);
  if (!id) return change(snapshot);
  const view = boardPage(board, id);
  const changed = change({ board: view, past: [], future: [] });
  const next = changed.snapshot.board;
  if (!next || next === view) return { snapshot, result: changed.result };
  return { snapshot: withEdit(snapshot, withBoardPage(board, id, next)), result: changed.result };
}

/** A board's pages for agents, marking the one being described. */
export function describePages(board: BoardDocument, shown: string | null) {
  const pages = boardPages(board);
  if (!pages.length) return {};
  return {
    pages: pages.map((page, index) => ({
      number: index + 1,
      id: page.id,
      title: page.title,
      ...(page.hidden ? { hiddenFromViewers: true } : {}),
      ...(page.id === shown ? { shownHere: true } : {}),
    })),
  };
}

function edited(snapshot: BoardSnapshot, change: (board: BoardDocument) => BoardDocument) {
  const board = boardOf(snapshot);
  try {
    return withEdit(snapshot, change(board));
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    throw new CanvasError(error instanceof Error ? error.message : 'Could not change the pages.');
  }
}

export function addPage(
  snapshot: BoardSnapshot,
  input: { title: string; after?: PageRef | undefined; hidden?: boolean | undefined },
) {
  const id = newPageId();
  const next = edited(snapshot, (board) => {
    const after = input.after === undefined ? null : pageIdOf(board, input.after);
    const added = addBoardPage(
      board,
      { id, title: input.title },
      { after, firstPage: { id: newPageId(), title: 'Page 1' } },
    );
    return input.hidden ? updateBoardPage(added, id, { hidden: true }) : added;
  });
  return { snapshot: next, id, number: boardPages(next.board).findIndex((p) => p.id === id) + 1 };
}

export function updatePage(
  snapshot: BoardSnapshot,
  ref: PageRef,
  patch: { title?: string | undefined; hidden?: boolean | undefined; moveTo?: number | undefined },
) {
  return edited(snapshot, (board) => {
    const id = pageIdOf(board, ref);
    if (!id) throw new CanvasError('This board has one page. Add more with opsis_add_page.');
    const changed = updateBoardPage(board, id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    });
    return patch.moveTo === undefined ? changed : moveBoardPage(changed, id, patch.moveTo - 1);
  });
}

export function removePage(snapshot: BoardSnapshot, ref: PageRef) {
  return edited(snapshot, (board) => {
    const id = pageIdOf(board, ref);
    if (!id || boardPages(board).length < 2)
      throw new CanvasError('A board needs at least one page.');
    return removeBoardPage(board, id);
  });
}

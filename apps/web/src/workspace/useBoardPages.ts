import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  boardPage,
  changedBoardPage,
  emptyPageContent,
  resolvePageId,
  withBoardPage,
  type BoardDocument,
} from '@opsis/schema';
import type { useBoardHistory } from './useBoardHistory';

type History = ReturnType<typeof useBoardHistory>;
const OPEN_PAGE = 'opsis:open-page';

/** Remembers the page this tab shows, so a reload returns to it. */
export function rememberPage(boardId: string, pageId: string | null) {
  try {
    if (pageId) sessionStorage.setItem(OPEN_PAGE, JSON.stringify({ boardId, pageId }));
    else sessionStorage.removeItem(OPEN_PAGE);
  } catch {
    // Remembering the page is a convenience only.
  }
}

/** The page this tab last showed of `boardId`, if any. */
export function rememberedPage(boardId: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(OPEN_PAGE) ?? 'null') as {
      boardId?: unknown;
      pageId?: unknown;
    } | null;
    return saved?.boardId === boardId && typeof saved.pageId === 'string' ? saved.pageId : null;
  } catch {
    return null;
  }
}
type Update = BoardDocument | null | ((board: BoardDocument | null) => BoardDocument | null);

/**
 * The canvas, chat and panels edit one page as an ordinary single-page document. This hook
 * shows them the open page and writes their edits back into the whole board, so every edit,
 * drag and undo still goes through the board's one history.
 */
export function useBoardPages(history: History, initialPage: string | null = null) {
  const [requested, setRequested] = useState<string | null>(initialPage);
  const full = history.board;
  const pageId = resolvePageId(full, requested);
  const pageRef = useRef(pageId);
  useEffect(() => {
    pageRef.current = pageId;
  }, [pageId]);
  const {
    boardRef: fullRef,
    setBoard: setFull,
    commit: commitFull,
    end: endFull,
    travel: travelFull,
  } = history;

  const view = (board: BoardDocument | null, page = pageRef.current) =>
    board ? boardPage(board, page) : null;
  /** A page edit as a whole-board edit; clearing a page of a paged board empties it. */
  const write = (
    board: BoardDocument | null,
    next: BoardDocument | null,
    page = pageRef.current,
  ) =>
    !board || !board.pages
      ? next
      : withBoardPage(board, page, next ?? { ...boardPage(board, page), ...emptyPageContent() });

  const boardRef = useMemo(
    () => ({
      get current() {
        return fullRef.current ? boardPage(fullRef.current, pageRef.current) : null;
      },
    }),
    [fullRef],
  );
  const setBoard = useCallback(
    (value: Update) =>
      setFull((board) => {
        const before = view(board);
        const next = typeof value === 'function' ? value(before) : value;
        return next === before ? board : write(board, next);
      }),
    // `view` and `write` only read refs.
    [setFull],
  );
  const commit = useCallback(
    (next: BoardDocument | null, before?: BoardDocument | null) => {
      const board = history.snapshotRef.current.board;
      commitFull(
        write(fullRef.current ?? board, next),
        before === undefined ? undefined : write(board, before),
      );
    },
    [commitFull, fullRef, history.snapshotRef],
  );
  /** An edit for one named page, wherever the reader is now (a chat answer to that page). */
  const commitTo = useCallback(
    (page: string | null, next: BoardDocument) => commitFull(write(fullRef.current, next, page)),
    [commitFull, fullRef],
  );
  const end = useCallback(
    (next?: BoardDocument | null) =>
      next === undefined ? endFull() : endFull(write(fullRef.current, next)),
    [endFull, fullRef],
  );
  /** Undo and redo turn to the page they changed, so the change is never out of sight. */
  const travel = useCallback(
    (redo = false) => {
      const before = fullRef.current;
      travelFull(redo);
      const changed = changedBoardPage(before, fullRef.current);
      if (changed && changed !== pageRef.current) setRequested(changed);
    },
    [travelFull, fullRef],
  );
  const openPage = useCallback((id: string | null) => setRequested(id), []);

  return {
    /** The whole board, every page included. */
    document: full,
    documentRef: fullRef,
    pageId,
    openPage,
    board: full ? boardPage(full, pageId) : null,
    boardRef,
    setBoard,
    commit,
    commitTo,
    end,
    travel,
  };
}

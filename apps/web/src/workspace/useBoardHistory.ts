import { useCallback, useRef, useState } from 'react';
import type { BoardDocument, BoardSnapshot } from '@opsis/schema';

export function useBoardHistory(initial: BoardSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const snapshotRef = useRef(snapshot);
  const boardRef = useRef(snapshot.board);
  const [preview, setPreview] = useState<{ board: BoardDocument | null } | null>(null);
  const transaction = useRef<BoardSnapshot | null>(null);
  const cancelledDrag = useRef(false);
  const replace = useCallback((next: BoardSnapshot) => {
    transaction.current = null;
    setPreview(null);
    snapshotRef.current = next;
    boardRef.current = next.board;
    setSnapshot(next);
  }, []);
  const commit = useCallback(
    (next: BoardDocument | null, before = snapshotRef.current.board) => {
      const current = snapshotRef.current;
      if (JSON.stringify(next) === JSON.stringify(before)) {
        replace(current);
        return;
      }
      replace({ board: next, past: [...current.past.slice(-39), before], future: [] });
    },
    [replace],
  );
  const begin = useCallback(() => {
    cancelledDrag.current = false;
    transaction.current = snapshotRef.current;
  }, []);
  const setBoard = useCallback(
    (value: BoardDocument | null | ((board: BoardDocument | null) => BoardDocument | null)) => {
      if (cancelledDrag.current) return;
      const next = typeof value === 'function' ? value(boardRef.current) : value;
      if (next === boardRef.current) return;
      if (!transaction.current) {
        commit(next);
        return;
      }
      boardRef.current = next;
      setPreview({ board: next });
    },
    [commit],
  );
  const end = useCallback(
    (next = boardRef.current) => {
      cancelledDrag.current = false;
      if (transaction.current) commit(next, transaction.current.board);
    },
    [commit],
  );
  const travel = useCallback(
    (redo = false) => {
      const current = snapshotRef.current;
      if (transaction.current) {
        replace(current);
        cancelledDrag.current = true;
        return;
      }
      const stack = redo ? current.future : current.past;
      if (!stack.length) return;
      replace({
        board: stack[stack.length - 1] ?? null,
        past: redo ? [...current.past.slice(-39), current.board] : current.past.slice(0, -1),
        future: redo ? current.future.slice(0, -1) : [...current.future.slice(-39), current.board],
      });
    },
    [replace],
  );
  return {
    snapshot,
    snapshotRef,
    board: preview ? preview.board : snapshot.board,
    boardRef,
    history: snapshot,
    replace,
    setBoard,
    commit,
    travel,
    begin,
    end,
  };
}

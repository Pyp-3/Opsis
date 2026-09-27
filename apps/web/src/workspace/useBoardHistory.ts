import { useCallback, useRef, useState } from 'react';
import type { BoardDocument, BoardSnapshot } from '@opsis/schema';

export function useBoardHistory(initial: BoardSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const snapshotRef = useRef(snapshot);
  const boardRef = useRef(snapshot.board);
  const replace = useCallback((next: BoardSnapshot) => {
    snapshotRef.current = next;
    boardRef.current = next.board;
    setSnapshot(next);
  }, []);
  const setBoard = useCallback(
    (value: BoardDocument | null | ((board: BoardDocument | null) => BoardDocument | null)) => {
      const current = snapshotRef.current;
      replace({ ...current, board: typeof value === 'function' ? value(current.board) : value });
    },
    [replace],
  );
  const commit = useCallback(
    (next: BoardDocument | null, before = boardRef.current) => {
      const current = snapshotRef.current;
      replace({ board: next, past: [...current.past.slice(-39), before], future: [] });
    },
    [replace],
  );
  const travel = useCallback(
    (redo = false) => {
      const current = snapshotRef.current;
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
    board: snapshot.board,
    boardRef,
    history: snapshot,
    replace,
    setBoard,
    commit,
    travel,
  };
}

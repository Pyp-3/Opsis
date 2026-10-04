import { BoardSnapshotSchema, type BoardDocument } from './board';

/** Copies retain spatial layout and content, with independent, empty undo history. */
export function copyBoardSnapshot(board: BoardDocument | null, title?: string) {
  return BoardSnapshotSchema.parse({
    board: board ? { ...board, title: title ?? `${board.title.slice(0, 93)} (copy)` } : null,
    past: [],
    future: [],
  });
}

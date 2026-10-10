import {
  appendBoardHistory,
  boardFromPages,
  boardPage,
  boardPages,
  BoardSnapshotSchema,
  withoutBrokenProcesses,
  type BoardSnapshot,
} from '@opsis/schema';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Apply only fields edited locally, preserving unrelated edits from another view. */
function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (same(base, local)) return remote;
  if (
    local &&
    remote &&
    typeof local === 'object' &&
    typeof remote === 'object' &&
    !Array.isArray(local) &&
    !Array.isArray(remote)
  ) {
    const b = (base ?? {}) as Record<string, unknown>;
    const l = local as Record<string, unknown>;
    const r = remote as Record<string, unknown>;
    return Object.fromEntries(
      [...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])].flatMap((key) => {
        const value = mergeValue(b[key], l[key], r[key]);
        return value === undefined ? [] : [[key, value]];
      }),
    );
  }
  return local;
}
export function mergeBoardSnapshots(
  base: BoardSnapshot | null,
  local: BoardSnapshot,
  remote: BoardSnapshot,
): BoardSnapshot {
  if (!base || !base.board || !local.board || !remote.board)
    return { ...local, past: appendBoardHistory(local.past, remote.board), future: [] };
  return BoardSnapshotSchema.parse({
    board: mergeBoards(base.board, local.board, remote.board),
    past: appendBoardHistory(local.past, remote.board),
    future: [],
  });
}

/**
 * Pages merge one by one, so edits to different pages are all kept. The page list itself (order,
 * titles, hidden pages) is taken from whichever side changed it, preferring this view's.
 */
function mergeBoards(base: Board, local: Board, remote: Board): Board {
  if (!base.pages && !local.pages && !remote.pages) return mergePage(base, local, remote);
  // A side without pages is a one-page board: that page is the first page of the paged side.
  const firstId = (local.pages ?? remote.pages ?? base.pages)![0]!.id;
  const list = (board: Board) =>
    board.pages ? boardPages(board) : [{ id: firstId, title: 'Page 1', hidden: false }];
  const pageOf = (board: Board, id: string) =>
    list(board).some((page) => page.id === id) ? boardPage(board, id) : undefined;
  const pages = same(list(base), list(local)) ? list(remote) : list(local);
  return boardFromPages(
    pages.map((page) => {
      const mine = pageOf(local, page.id);
      const theirs = pageOf(remote, page.id);
      return {
        ...page,
        board:
          mine && theirs
            ? mergePage(pageOf(base, page.id) ?? mine, mine, theirs)
            : (mine ?? theirs)!,
      };
    }),
  );
}

type Board = NonNullable<BoardSnapshot['board']>;
function mergePage(base: Board, local: Board, remote: Board): Board {
  const mergeItems = <T extends { id: string }>(before: T[], mine: T[], theirs: T[]): T[] => {
    const ids = [...new Set([...theirs.map((item) => item.id), ...mine.map((item) => item.id)])];
    return ids.flatMap((id) => {
      const value = mergeValue(
        before.find((item) => item.id === id),
        mine.find((item) => item.id === id),
        theirs.find((item) => item.id === id),
      );
      return value ? [value as T] : [];
    });
  };
  const board = structuredClone(mergeValue(base, local, remote)) as Board;
  board.nodes = withoutBrokenProcesses(mergeItems(base.nodes, local.nodes, remote.nodes));
  const ids = new Set(board.nodes.map((node) => node.id));
  if (board.groups)
    board.groups = board.groups.map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => ids.has(id)),
    }));
  board.edges = mergeItems(base.edges, local.edges, remote.edges).filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target),
  );
  board.positions = Object.fromEntries(
    Object.entries(board.positions).filter(([id]) => ids.has(id)),
  );
  if (board.pinnedNodeIds)
    board.pinnedNodeIds = board.pinnedNodeIds.filter((id) =>
      board.nodes.some((node) => node.id === id),
    );
  if (board.edgePorts) {
    const edges = new Set(board.edges.map((edge) => edge.id));
    board.edgePorts = Object.fromEntries(
      Object.entries(board.edgePorts).filter(([id]) => edges.has(id)),
    );
  }
  return board;
}

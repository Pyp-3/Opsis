import { BoardSnapshotSchema, type BoardSnapshot } from '@opsis/schema';

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
    return { ...local, past: [...local.past, remote.board].slice(-40), future: [] };
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
  const board = structuredClone(mergeValue(base.board, local.board, remote.board)) as NonNullable<
    BoardSnapshot['board']
  >;
  board.nodes = mergeItems(base.board.nodes, local.board.nodes, remote.board.nodes);
  const ids = new Set(board.nodes.map((node) => node.id));
  board.edges = mergeItems(base.board.edges, local.board.edges, remote.board.edges).filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target),
  );
  board.positions = Object.fromEntries(
    Object.entries(board.positions).filter(([id]) => ids.has(id)),
  );
  if (board.edgePorts) {
    const edges = new Set(board.edges.map((edge) => edge.id));
    board.edgePorts = Object.fromEntries(
      Object.entries(board.edgePorts).filter(([id]) => edges.has(id)),
    );
  }
  return BoardSnapshotSchema.parse({
    board,
    past: [...local.past, remote.board].slice(-40),
    future: [],
  });
}

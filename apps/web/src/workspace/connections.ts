import { BoardPortSchema, type BoardDocument, type BoardPort } from '@opsis/schema';

export const PORT_OFFSETS = {
  left: { x: 40, y: 44 },
  right: { x: 138, y: 44 },
  top: { x: 89, y: -5 },
  bottom: { x: 89, y: 93 },
} as const;

/** Unpinned edges choose the nearest sides as objects move; manual ports stay pinned. */
export function edgePorts(
  board: BoardDocument,
  edge: BoardDocument['edges'][number],
): { source: BoardPort; target: BoardPort } {
  const pinned = board.edgePorts?.[edge.id];
  if (pinned) return pinned;
  if (edge.source === edge.target) return { source: 'right', target: 'top' };
  const from = board.positions[edge.source] ?? { x: 0, y: 0 };
  const to = board.positions[edge.target] ?? { x: 0, y: 0 };
  const dx = to.x - from.x,
    dy = to.y - from.y;
  if (Math.abs(dy) > Math.abs(dx))
    return dy > 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
  return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
}

type Connection = {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
export function connectBoard(
  board: BoardDocument,
  connection: Connection,
  id: string,
): BoardDocument {
  const { source, target } = connection;
  if (
    !source ||
    !target ||
    ![source, target].every((nodeId) => board.nodes.some((node) => node.id === nodeId))
  )
    return board;
  const existing = board.edges.find((edge) => edge.id === id);
  if (!existing && board.edges.length >= 100) return board;
  const edge = { id, source, target, label: existing?.label ?? '' };
  const automatic = edgePorts({ ...board, edgePorts: {} }, edge);
  const sourcePort = BoardPortSchema.safeParse(connection.sourceHandle);
  const targetPort = BoardPortSchema.safeParse(connection.targetHandle);
  return {
    ...board,
    edges: existing
      ? board.edges.map((item) => (item.id === id ? edge : item))
      : [...board.edges, edge],
    edgePorts: {
      ...board.edgePorts,
      [id]: {
        source: sourcePort.success ? sourcePort.data : automatic.source,
        target: targetPort.success ? targetPort.data : automatic.target,
      },
    },
  };
}

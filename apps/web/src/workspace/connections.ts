import { BoardPortSchema, type BoardDocument, type BoardPort } from '@opsis/schema';
import { NODE_WIDTH } from './geometry';

export const PORT_OFFSETS = {
  left: { x: NODE_WIDTH / 2 - 24, y: 44 },
  right: { x: NODE_WIDTH / 2 + 24, y: 44 },
  top: { x: NODE_WIDTH / 2, y: 20 },
  bottom: { x: NODE_WIDTH / 2, y: 68 },
} as const;

export const isReturnEdge = (edge: BoardDocument['edges'][number]) =>
  ['response', 'feedback', 'retry'].includes(edge.kind ?? 'flow');
export const connectionLabel = (edge: BoardDocument['edges'][number]) =>
  edge.kind && edge.kind !== 'flow'
    ? `${edge.kind[0]!.toUpperCase()}${edge.kind.slice(1)}: ${edge.label}`
    : edge.label;

// High-contrast on the blueprint background; type labels/patterns also encode meaning.
export const CONNECTION_STYLES = {
  flow: { color: '#c4d7ed', dash: '' },
  request: { color: '#75d9f3', dash: '' },
  response: { color: '#f2cc79', dash: '8 4' },
  feedback: { color: '#d6b0fa', dash: '3 4' },
  retry: { color: '#ffad8f', dash: '10 3 2 3' },
} as const;
export const connectionStyle = (edge: BoardDocument['edges'][number]) =>
  CONNECTION_STYLES[edge.kind ?? 'flow'];

/** Unpinned edges choose the nearest sides as objects move; manual ports stay pinned. */
export function edgePorts(
  board: BoardDocument,
  edge: BoardDocument['edges'][number],
): { source: BoardPort; target: BoardPort } {
  const pinned = board.edgePorts?.[edge.id];
  if (pinned) return pinned;
  if (edge.source === edge.target) return { source: 'right', target: 'top' };
  if (isReturnEdge(edge)) return { source: 'left', target: 'left' };
  const from = board.positions[edge.source] ?? { x: 0, y: 0 };
  const to = board.positions[edge.target] ?? { x: 0, y: 0 };
  const dx = to.x - from.x,
    dy = to.y - from.y;
  if (Math.abs(dy) > Math.abs(dx))
    return dy > 0 ? { source: 'right', target: 'top' } : { source: 'left', target: 'left' };
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
  const edge = { ...existing, id, source, target, label: existing?.label ?? '' };
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

import {
  BoardPortSchema,
  withoutNarration,
  type BoardDocument,
  type BoardPort,
  type EdgeColor,
} from '@opsis/schema';
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
  edge.condition
    ? `If ${edge.condition}${edge.label ? ': ' + edge.label : ''}`
    : edge.kind && edge.kind !== 'flow'
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
export const EDGE_COLOR_VALUES: Record<EdgeColor, string> = {
  sky: '#75d9f3',
  amber: '#f2cc79',
  violet: '#d6b0fa',
  coral: '#ffad8f',
  mint: '#8fe3b4',
  rose: '#f6a3c7',
  ice: '#c4d7ed',
};
/** Type sets the dash pattern (meaning survives without colour); a chosen colour overrides hue. */
export const connectionStyle = (edge: BoardDocument['edges'][number]) => {
  const base = CONNECTION_STYLES[edge.kind ?? 'flow'];
  return edge.color ? { ...base, color: EDGE_COLOR_VALUES[edge.color] } : base;
};

/** Which sides face each other, using icon centres. Titles sit under icons, so arrows
 * into an object from above use its top, and arrows leaving downward use a side. */
function facingPorts(
  board: BoardDocument,
  edge: BoardDocument['edges'][number],
): { source: BoardPort; target: BoardPort } {
  const from = board.positions[edge.source] ?? { x: 0, y: 0 };
  const to = board.positions[edge.target] ?? { x: 0, y: 0 };
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const side = (toward: number): BoardPort => (toward < 0 ? 'left' : 'right');
  // Same row: straight across at icon height, but only when the objects are really side by
  // side; overlapping objects keep the vertical rule so their side ports never coincide.
  if (Math.abs(dy) < 96 && Math.abs(dx) > NODE_WIDTH * 0.6)
    return { source: side(dx), target: side(-dx) };
  if (dy > 0) return { source: Math.abs(dx) < NODE_WIDTH / 3 ? 'right' : side(dx), target: 'top' };
  // Upward: a clear diagonal climbs out of the top; a stacked return hugs one side as a C.
  if (Math.abs(dx) >= NODE_WIDTH * 0.75) return { source: 'top', target: side(-dx) };
  return { source: 'right', target: 'right' };
}

/**
 * For a reply (A→B answered by B→A), the edge it follows. Requests lead responses; between
 * two plain flows the lower id leads. Returns null for an edge that leads or has no partner.
 */
export function replyLead(
  board: BoardDocument,
  edge: BoardDocument['edges'][number],
): BoardDocument['edges'][number] | null {
  if (edge.source === edge.target) return null;
  const partner = board.edges.find(
    (other) => other.id !== edge.id && other.source === edge.target && other.target === edge.source,
  );
  if (!partner) return null;
  const leads =
    isReturnEdge(edge) !== isReturnEdge(partner) ? !isReturnEdge(edge) : edge.id < partner.id;
  return leads ? null : partner;
}

/**
 * Unpinned edges choose facing sides as objects move; manual ports stay pinned.
 * A reply mirrors its lead's sides, so the pair runs as two parallel lanes instead of a
 * second arrow circling the diagram.
 */
export function edgePorts(
  board: BoardDocument,
  edge: BoardDocument['edges'][number],
): { source: BoardPort; target: BoardPort } {
  const pinned = board.edgePorts?.[edge.id];
  if (pinned) return pinned;
  if (edge.source === edge.target) return { source: 'right', target: 'top' };
  const lead = replyLead(board, edge);
  if (lead) {
    const ports = board.edgePorts?.[lead.id] ?? facingPorts(board, lead);
    return { source: ports.target, target: ports.source };
  }
  return facingPorts(board, edge);
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
  const moved = existing && (existing.source !== source || existing.target !== target);
  // A reconnected arrow joins different objects, so its spoken line no longer fits.
  const edge = {
    ...(existing && moved ? withoutNarration(existing) : existing),
    id,
    source,
    target,
    label: existing?.label ?? '',
  };
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

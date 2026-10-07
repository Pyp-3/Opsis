import {
  BOARD_ICONS,
  BoardDocumentSchema,
  BoardEdgeKindSchema,
  EDGE_COLORS,
  createEmptyBoard,
  detachDrawings,
  recordBoardEdit,
  removeBoardNode,
  patchBoardNode,
  withoutBrokenProcesses,
  type BoardDocument,
  type BoardSnapshot,
  type DrawingScale,
} from '@opsis/schema';
import { z } from 'zod';

/** Matches the canvas's node footprint, so placed concepts land on its grid without overlap. */
const NODE_WIDTH = 224;
const ROW_STEP = 240;
const COLUMN_STEP = 304;

export const ConceptIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, digits, - and _ only.');
export const IconSchema = z.enum(BOARD_ICONS);
export const KindSchema = z.enum(['step', 'decision', 'note']);
export const ConceptFieldsSchema = {
  label: z.string().min(1).max(80).describe('Short name shown under the icon.'),
  summary: z.string().min(1).max(400).describe('One or two sentences shown first.'),
  explanation: z.string().min(1).max(3000).describe('The longer "How it works" text.'),
  icon: IconSchema.describe('A library icon; pick the closest match.'),
  kind: KindSchema.describe('step (default), decision or note.'),
};

export class CanvasError extends Error {}

/**
 * A compact, agent-readable view of a board: concepts with where they sit (the top-left of a
 * 224-unit-wide icon and label) and connections. Drawings are described by drawings.ts.
 */
export function describeBoard(id: string, revision: number, board: BoardDocument | null) {
  if (!board) return { id, revision, empty: true };
  return {
    id,
    revision,
    title: board.title,
    description: board.description,
    look: board.look ?? null,
    concepts: board.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      icon: node.icon,
      summary: node.summary,
      explanation: node.explanation,
      ...(board.positions[node.id] ? { position: board.positions[node.id] } : {}),
      ...(node.linkedBoardId ? { linkedBoardId: node.linkedBoardId } : {}),
      ...(node.confidence ? { confidence: node.confidence } : {}),
      ...(node.terminal ? { command: node.terminal.command } : {}),
    })),
    connections: board.edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      label: edge.label,
      ...(edge.kind ? { kind: edge.kind } : {}),
      ...(edge.color ? { color: edge.color } : {}),
    })),
  };
}

/** Validates an edited board and records the previous one so the reader can undo it. */
export function withEdit(snapshot: BoardSnapshot, next: BoardDocument): BoardSnapshot {
  const parsed = BoardDocumentSchema.safeParse(next);
  if (!parsed.success)
    throw new CanvasError(parsed.error.issues.map((issue) => issue.message).join(' '));
  return recordBoardEdit(snapshot, parsed.data);
}

export function boardOf(snapshot: BoardSnapshot) {
  return snapshot.board ?? createEmptyBoard();
}

function requireNode(board: BoardDocument, id: string) {
  const node = board.nodes.find((item) => item.id === id);
  if (!node)
    throw new CanvasError(
      `No concept "${id}". Known ids: ${board.nodes.map((item) => item.id).join(', ') || 'none'}.`,
    );
  return node;
}

function uniqueId(board: BoardDocument, label: string) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'concept';
  let id = base;
  for (let n = 2; board.nodes.some((node) => node.id === id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Where a new concept goes: below `after` (beside its other children), or below everything.
 * The reader can tidy up with "Arrange downward" on the canvas.
 */
export function placeConcept(board: BoardDocument, after?: string) {
  const taken = Object.values(board.positions);
  const free = (x: number, y: number) =>
    !taken.some((p) => Math.abs(p.x - x) < NODE_WIDTH && Math.abs(p.y - y) < ROW_STEP - 40);
  const anchor = after ? board.positions[after] : undefined;
  if (anchor) {
    const y = anchor.y + ROW_STEP;
    for (let step = 0; step < 12; step++) {
      // Try straight below, then alternate right and left.
      const offset = Math.ceil(step / 2) * COLUMN_STEP * (step % 2 ? 1 : -1);
      if (free(anchor.x + offset, y)) return { x: anchor.x + offset, y };
    }
  }
  if (!taken.length) return { x: 24, y: 24 };
  return {
    x: anchor?.x ?? Math.min(...taken.map((p) => p.x)),
    y: Math.max(...taken.map((p) => p.y)) + ROW_STEP,
  };
}

export type ConceptInput = {
  id?: string | undefined;
  label: string;
  summary: string;
  explanation?: string | undefined;
  icon?: z.infer<typeof IconSchema> | undefined;
  kind?: z.infer<typeof KindSchema> | undefined;
  after?: string | undefined;
  connectionLabel?: string | undefined;
};

export function addConcept(snapshot: BoardSnapshot, input: ConceptInput) {
  const board = boardOf(snapshot);
  if (board.nodes.length >= 50) throw new CanvasError('A canvas holds at most 50 concepts.');
  if (input.after) requireNode(board, input.after);
  const id = input.id ?? uniqueId(board, input.label);
  if (board.nodes.some((node) => node.id === id))
    throw new CanvasError(`A concept with id "${id}" already exists.`);
  const next: BoardDocument = {
    ...board,
    nodes: [
      ...board.nodes,
      {
        id,
        label: input.label,
        summary: input.summary,
        explanation: input.explanation ?? input.summary,
        icon: input.icon ?? 'lightbulb',
        kind: input.kind ?? 'step',
      },
    ],
    positions: { ...board.positions, [id]: placeConcept(board, input.after) },
    edges: input.after
      ? [
          ...board.edges,
          {
            id: uniqueEdgeId(board, input.after, id),
            source: input.after,
            target: id,
            label: input.connectionLabel ?? '',
          },
        ]
      : board.edges,
  };
  return { snapshot: withEdit(snapshot, next), id };
}

export type ConceptPatch = {
  linkedBoardId?: string | null | undefined;
  label?: string | undefined;
  summary?: string | undefined;
  explanation?: string | undefined;
  icon?: z.infer<typeof IconSchema> | undefined;
  kind?: z.infer<typeof KindSchema> | undefined;
};

export function updateConcept(snapshot: BoardSnapshot, id: string, patch: ConceptPatch) {
  const board = boardOf(snapshot);
  const node = requireNode(board, id);
  let updated = { ...node };
  if (patch.label !== undefined) updated.label = patch.label;
  if (patch.summary !== undefined) updated.summary = patch.summary;
  if (patch.explanation !== undefined) updated.explanation = patch.explanation;
  if (patch.icon !== undefined) updated.icon = patch.icon;
  if (patch.kind !== undefined) updated.kind = patch.kind;
  // Same rules as editing on the canvas: new words drop stale narration, a new icon the drawing.
  updated = patchBoardNode(node, updated, {
    narration: patch.label !== undefined || patch.summary !== undefined,
    drawing: patch.icon !== undefined && patch.icon !== node.icon,
  });
  if (patch.linkedBoardId === null) delete updated.linkedBoardId;
  else if (patch.linkedBoardId !== undefined) updated.linkedBoardId = patch.linkedBoardId;
  return withEdit(snapshot, {
    ...board,
    nodes: board.nodes.map((item) => (item.id === id ? updated : item)),
  });
}

export function removeConcept(snapshot: BoardSnapshot, id: string) {
  const board = boardOf(snapshot);
  requireNode(board, id);
  return withEdit(snapshot, removeBoardNode(board, id));
}

function uniqueEdgeId(board: BoardDocument, from: string, to: string) {
  let id = `${from}-to-${to}`.slice(0, 76);
  for (let n = 2; board.edges.some((edge) => edge.id === id); n++)
    id = `${from}-to-${to}`.slice(0, 72) + `-${n}`;
  return id;
}

export type ConnectionInput = {
  from: string;
  to: string;
  label?: string | undefined;
  kind?: z.infer<typeof BoardEdgeKindSchema> | undefined;
  color?: (typeof EDGE_COLORS)[number] | undefined;
};

export function connect(snapshot: BoardSnapshot, input: ConnectionInput) {
  const board = boardOf(snapshot);
  requireNode(board, input.from);
  requireNode(board, input.to);
  if (board.edges.length >= 100) throw new CanvasError('A canvas holds at most 100 connections.');
  const id = uniqueEdgeId(board, input.from, input.to);
  return {
    id,
    snapshot: withEdit(snapshot, {
      ...board,
      edges: [
        ...board.edges,
        {
          id,
          source: input.from,
          target: input.to,
          label: input.label ?? '',
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.color ? { color: input.color } : {}),
        },
      ],
    }),
  };
}

export function disconnect(snapshot: BoardSnapshot, id: string) {
  const board = boardOf(snapshot);
  if (!board.edges.some((edge) => edge.id === id)) throw new CanvasError(`No connection "${id}".`);
  return withEdit(snapshot, { ...board, edges: board.edges.filter((edge) => edge.id !== id) });
}

export function updateDetails(
  snapshot: BoardSnapshot,
  patch: {
    title?: string | undefined;
    description?: string | undefined;
    look?: { canvas: string; icon: string } | undefined;
    /** What one grid square measures; null returns to grid units. */
    drawingScale?: DrawingScale | null | undefined;
  },
) {
  const board = boardOf(snapshot);
  const next: BoardDocument = {
    ...board,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.look ? { look: patch.look } : {}),
    ...(patch.drawingScale ? { drawingScale: patch.drawingScale } : {}),
  };
  if (patch.drawingScale === null) delete next.drawingScale;
  return withEdit(snapshot, next);
}

export type DiagramInput = {
  title: string;
  description: string;
  concepts: (Omit<ConceptInput, 'after' | 'connectionLabel'> & { id: string })[];
  connections: (ConnectionInput & { id?: string | undefined })[];
};

/**
 * Replaces the whole diagram in one undoable step. Concepts that keep their id keep their
 * place, drawings and processes; new ones are placed in reading order.
 */
export function writeDiagram(snapshot: BoardSnapshot, input: DiagramInput) {
  const before = boardOf(snapshot);
  const nodes = input.concepts.map((concept) => {
    const previous = before.nodes.find((node) => node.id === concept.id);
    const fields = {
      id: concept.id,
      label: concept.label,
      summary: concept.summary,
      explanation: concept.explanation ?? concept.summary,
      icon: concept.icon ?? previous?.icon ?? 'lightbulb',
      kind: concept.kind ?? previous?.kind ?? 'step',
    };
    if (!previous) return fields;
    return patchBoardNode(previous, fields, {
      narration: previous.label !== fields.label || previous.summary !== fields.summary,
      drawing: previous.icon !== fields.icon,
    });
  });
  let board: BoardDocument = {
    ...before,
    title: input.title,
    description: input.description,
    nodes: withoutBrokenProcesses(nodes),
    edges: [],
    ...(before.groups
      ? {
          groups: before.groups.map((group) => ({
            ...group,
            nodeIds: group.nodeIds.filter((id) => nodes.some((node) => node.id === id)),
          })),
        }
      : {}),
    ...(before.pinnedNodeIds
      ? { pinnedNodeIds: before.pinnedNodeIds.filter((id) => nodes.some((node) => node.id === id)) }
      : {}),
    // A sketch attached to a concept the agent dropped stays where the reader drew it.
    ...(before.drawings
      ? {
          drawings: detachDrawings(
            before.drawings,
            new Set(nodes.map((node) => node.id)),
            before.positions,
          ),
        }
      : {}),
    positions: Object.fromEntries(
      Object.entries(before.positions).filter(([id]) => nodes.some((node) => node.id === id)),
    ),
  };
  board.edges = input.connections.map((edge) => ({
    id: edge.id ?? uniqueEdgeId(board, edge.from, edge.to),
    source: edge.from,
    target: edge.to,
    label: edge.label ?? '',
    ...(edge.kind ? { kind: edge.kind } : {}),
    ...(edge.color ? { color: edge.color } : {}),
  }));
  for (const node of board.nodes) {
    if (board.positions[node.id]) continue;
    const parent = board.edges.find(
      (edge) => edge.target === node.id && board.positions[edge.source],
    );
    board = {
      ...board,
      positions: { ...board.positions, [node.id]: placeConcept(board, parent?.source) },
    };
  }
  // Hand-picked arrow ports survive only on arrows that still join the same two concepts.
  const ports = Object.entries(before.edgePorts ?? {}).filter(([id]) => {
    const old = before.edges.find((edge) => edge.id === id);
    return board.edges.some(
      (edge) => edge.id === id && edge.source === old?.source && edge.target === old.target,
    );
  });
  if (ports.length) board.edgePorts = Object.fromEntries(ports);
  else delete board.edgePorts;
  return withEdit(snapshot, board);
}

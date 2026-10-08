import { z } from 'zod';
import {
  AGENT_SKETCH_LAYER,
  AgentDrawingSchema,
  FocusDrawingSchema,
  MAX_AGENT_DRAWINGS,
  absoluteDrawing,
  agentMayDraw,
  isDrawingEditable,
  type BoardDrawing,
  type DrawingLayer,
  type FocusDrawing,
} from './board-drawings';

/**
 * Drawing focus for chat. A chat agent normally sees only its own sketch layer. When the reader
 * selects drawings (or a concept with drawings attached) and then asks something, those drawings
 * become the focus of the request: the agent is shown them and may propose edits to exactly
 * those, which the reader reviews like any other change. A focus, a drawing tool in hand or a
 * request about sketching makes the agent work drawing-first.
 */

export const CHAT_PRIORITIES = ['diagram', 'drawing'] as const;
export type ChatPriority = (typeof CHAT_PRIORITIES)[number];
export const MAX_FOCUS_DRAWINGS = 60;

const drawingId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

/** The drawings a request is about, as the agent is shown them. */
export const ChatFocusSchema = z
  .object({
    /** The reader's own drawings the agent may change, with coordinates as stored. */
    drawings: z.array(FocusDrawingSchema).max(MAX_FOCUS_DRAWINGS),
    /** Selected drawings on the agent's own sketch layer, which it already sees. */
    sketchIds: z.array(drawingId).max(MAX_AGENT_DRAWINGS).optional(),
  })
  .strict();
export type ChatFocus = z.infer<typeof ChatFocusSchema>;

/** The agent's proposed changes to the focused drawings. */
export const FocusEditsSchema = z
  .object({
    /** Complete replacements for focused drawings, keeping their ids. */
    update: z.array(AgentDrawingSchema).max(MAX_FOCUS_DRAWINGS),
    /** Focused drawings to remove. */
    remove: z.array(drawingId).max(MAX_FOCUS_DRAWINGS),
  })
  .strict();
export type FocusEdits = z.infer<typeof FocusEditsSchema>;

type FocusBoard = {
  drawings?: readonly BoardDrawing[] | undefined;
  drawingLayers?: readonly DrawingLayer[] | undefined;
  positions: Readonly<Record<string, { x: number; y: number }>>;
};

const withoutLayer = (drawing: BoardDrawing): FocusDrawing => {
  const shown = { ...drawing };
  delete shown.layerId;
  delete shown.locked;
  return shown;
};

/**
 * What a request focuses on: the selected drawings, or else those attached to the selected
 * concept. Only drawings the reader may change are included; hidden or locked ones stay private.
 * Selected drawings on the agent's own layer are named by id, since the agent already sees them.
 */
export function chatFocusFor(
  board: FocusBoard | null | undefined,
  selection: { drawingIds?: readonly string[]; nodeId?: string | null },
): ChatFocus | undefined {
  const drawings = board?.drawings ?? [];
  const chosen = selection.drawingIds?.length
    ? drawings.filter((drawing) => selection.drawingIds!.includes(drawing.id))
    : selection.nodeId
      ? drawings.filter((drawing) => drawing.anchorId === selection.nodeId)
      : [];
  const usable = chosen.filter((drawing) => isDrawingEditable(drawing, board?.drawingLayers));
  const reader = usable
    .filter((drawing) => drawing.layerId !== AGENT_SKETCH_LAYER.id)
    .slice(0, MAX_FOCUS_DRAWINGS);
  const sketchIds = agentMayDraw(board ?? undefined)
    ? usable
        .filter((drawing) => drawing.layerId === AGENT_SKETCH_LAYER.id)
        .map((drawing) => drawing.id)
        .slice(0, MAX_AGENT_DRAWINGS)
    : [];
  if (!reader.length && !sketchIds.length) return undefined;
  return {
    drawings: reader.map(withoutLayer),
    ...(sketchIds.length ? { sketchIds } : {}),
  };
}

/** Requests about the shape of physical things, which read best as a sketch. */
const SPATIAL_REQUEST =
  /\b(sketch\w*|draw|draws|drawing|drawn|redraw\w*|blueprints?|floor ?plans?|site plans?|plan view|cross[- ]sections?|lay (?:it |them |this |that )?out|layouts? of|walls?|dimension lines?|to scale|piping|pipe runs?|cable runs?|enclosures?)\b/iu;

export type ChatPriorityReason = 'focus' | 'tool' | 'request' | 'none';

/**
 * Whether the agent should work drawing-first. Selected drawings or a drawing tool in hand say
 * the reader is working on the sketch; otherwise a request about physical layout does.
 */
export function chatPriority(input: {
  prompt: string;
  focus?: ChatFocus | undefined;
  /** A drawing tool (not the diagram pointer or selection) is active. */
  drawingTool?: boolean;
}): { priority: ChatPriority; reason: ChatPriorityReason } {
  if (input.focus && (input.focus.drawings.length || input.focus.sketchIds?.length))
    return { priority: 'drawing', reason: 'focus' };
  if (input.drawingTool) return { priority: 'drawing', reason: 'tool' };
  if (SPATIAL_REQUEST.test(input.prompt)) return { priority: 'drawing', reason: 'request' };
  return { priority: 'diagram', reason: 'none' };
}

/** Problems with an agent's focus edits; each must name a focused drawing and a real concept. */
export function focusEditProblems(
  edits: FocusEdits,
  focusIds: ReadonlySet<string>,
  nodeIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const ids = [...edits.update.map((drawing) => drawing.id), ...edits.remove];
  const outside = ids.filter((id) => !focusIds.has(id));
  if (outside.length)
    problems.push(
      `focusEdits may only change focused drawings; ${outside.slice(0, 5).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not in focus. Put new drawings in "drawings".`,
    );
  if (new Set(ids).size !== ids.length)
    problems.push('focusEdits must name each focused drawing at most once.');
  if (edits.update.some((drawing) => drawing.anchorId && !nodeIds.has(drawing.anchorId)))
    problems.push('A focused drawing can only move with an existing concept.');
  return problems;
}

/**
 * Applies focus edits to the reader's drawings. Each replacement keeps the original's layer and
 * place in the list; ids outside the focus are ignored. A replacement anchored to a concept the
 * board does not have stays where it would be drawn.
 */
export function applyFocusEdits<T extends FocusBoard>(
  board: T,
  focusIds: ReadonlySet<string>,
  edits: FocusEdits | undefined,
  nodeIds: ReadonlySet<string>,
): T {
  if (!edits || !board.drawings) return board;
  const removed = new Set(edits.remove.filter((id) => focusIds.has(id)));
  const drawings = board.drawings.flatMap((drawing): BoardDrawing[] => {
    if (!focusIds.has(drawing.id) || drawing.layerId === AGENT_SKETCH_LAYER.id) return [drawing];
    if (removed.has(drawing.id)) return [];
    const update = edits.update.find((item) => item.id === drawing.id);
    if (!update) return [drawing];
    const next: BoardDrawing = {
      ...update,
      ...(drawing.layerId ? { layerId: drawing.layerId } : {}),
    };
    return [
      next.anchorId && !nodeIds.has(next.anchorId)
        ? {
            ...absoluteDrawing(next, board.positions),
            ...(drawing.layerId ? { layerId: drawing.layerId } : {}),
          }
        : next,
    ];
  });
  const next = { ...board, drawings };
  if (!drawings.length) delete (next as FocusBoard).drawings;
  return next;
}

/** The reader's drawings: everything not on the agent's sketch layer. */
export function readerDrawingsOf(board: { drawings?: readonly BoardDrawing[] | undefined }) {
  return (board.drawings ?? []).filter((drawing) => drawing.layerId !== AGENT_SKETCH_LAYER.id);
}

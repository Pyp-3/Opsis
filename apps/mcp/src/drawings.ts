import {
  absoluteDrawing,
  anchorDrawing,
  BoardDrawingSchema,
  DRAWING_GRID_UNIT,
  DRAWING_LINE_STYLES,
  DRAWING_SHAPES,
  ILLUSTRATION_INKS,
  isDrawingEditable,
  layerOf,
  MAX_BOARD_DRAWINGS,
  MAX_DRAWING_LAYERS,
  MAX_DRAWING_POINTS,
  translateDrawing,
  type BoardDocument,
  type BoardDrawing,
  type BoardSnapshot,
  type DrawingLayer,
} from '@opsis/schema';
import { z } from 'zod';
import { CanvasError, ConceptIdSchema, boardOf, withEdit } from './canvas.js';

/**
 * Agent access to the reader's canvas drawings: blueprint shapes, labels and dimension lines.
 * Agents read and write absolute canvas coordinates; a drawing that moves with a concept is
 * converted to and from its stored, concept-relative form here. Locked drawings, and drawings
 * on locked or hidden layers, are the reader's to change: agents cannot edit or remove them.
 */

const coordinate = z.number().finite().min(-100_000).max(100_000);
const point = z.tuple([coordinate, coordinate]);
const LayerNameSchema = z.string().trim().min(1).max(40);

export const DrawingFieldsSchema = {
  points: z
    .array(point)
    .min(2)
    .max(MAX_DRAWING_POINTS)
    .optional()
    .describe('Line, arrow and dimension: exactly two [x, y] ends. Stroke: freehand samples.'),
  x: coordinate.optional().describe('Box/ellipse: left edge. Text: where it starts.'),
  y: coordinate.optional().describe('Box/ellipse: top edge. Text: top of its first line.'),
  width: z.number().finite().min(0).max(100_000).optional(),
  height: z.number().finite().min(0).max(100_000).optional(),
  text: z
    .string()
    .max(500)
    .optional()
    .describe('Text to write, or a dimension label instead of its measured length.'),
  fontSize: z.number().finite().min(8).max(96).optional().describe('Text size; default 16.'),
  ink: z.enum(ILLUSTRATION_INKS).optional().describe('Ink colour; default "ink".'),
  line: z
    .enum(DRAWING_LINE_STYLES)
    .optional()
    .describe('solid (default), dashed (hidden/proposed) or center (dash-dot centre line).'),
  strokeWidth: z.number().finite().min(0.5).max(16).optional().describe('Default 2.'),
  fill: z.boolean().optional().describe('A translucent fill, for boxes and ellipses.'),
};

export const DrawingInputSchema = z.object({
  shape: z.enum(DRAWING_SHAPES),
  ...DrawingFieldsSchema,
  movesWith: ConceptIdSchema.optional().describe(
    'A concept id this drawing follows when the concept is moved.',
  ),
  layer: LayerNameSchema.optional().describe(
    'Layer name; created (at the top) when the board has no layer by that name.',
  ),
});
export type DrawingInput = z.infer<typeof DrawingInputSchema>;

export const DrawingPatchSchema = {
  ...DrawingFieldsSchema,
  moveBy: point.optional().describe('Moves the drawing by [dx, dy].'),
  movesWith: ConceptIdSchema.nullable()
    .optional()
    .describe('A concept id to follow, or null to fix it to the canvas.'),
  layer: LayerNameSchema.nullable()
    .optional()
    .describe('Layer name (created if missing), or null for the base layer.'),
};
export type DrawingPatch = {
  [K in keyof typeof DrawingPatchSchema]?: z.infer<(typeof DrawingPatchSchema)[K]>;
};

const round = (value: number) => Math.round(value * 10) / 10;

/** A compact, absolute view of the board's drawings, layers and scale for agents. */
export function describeDrawings(board: BoardDocument) {
  const layers = board.drawingLayers ?? [];
  return {
    gridSquare: DRAWING_GRID_UNIT,
    scale: board.drawingScale ?? null,
    layers: layers.map((layer) => ({
      name: layer.name,
      ...(layer.hidden ? { hidden: true } : {}),
      ...(layer.locked ? { locked: true } : {}),
    })),
    drawings: (board.drawings ?? []).map((drawing) => {
      const absolute = absoluteDrawing(drawing, board.positions);
      const layer = layerOf(drawing, layers);
      const xs = absolute.points?.map(([x]) => x) ?? [];
      const ys = absolute.points?.map(([, y]) => y) ?? [];
      return {
        id: drawing.id,
        shape: drawing.shape,
        // A freehand stroke is summarised by its outline rather than every sample.
        ...(drawing.shape === 'stroke'
          ? {
              bounds: {
                x: round(Math.min(...xs)),
                y: round(Math.min(...ys)),
                width: round(Math.max(...xs) - Math.min(...xs)),
                height: round(Math.max(...ys) - Math.min(...ys)),
              },
            }
          : absolute.points
            ? { points: absolute.points.map(([x, y]) => [round(x), round(y)]) }
            : {
                x: round(absolute.x!),
                y: round(absolute.y!),
                ...(absolute.width !== undefined
                  ? { width: absolute.width, height: absolute.height }
                  : {}),
              }),
        ...(drawing.text ? { text: drawing.text } : {}),
        ...(drawing.fontSize ? { fontSize: drawing.fontSize } : {}),
        ink: drawing.ink,
        line: drawing.line,
        strokeWidth: drawing.strokeWidth,
        ...(drawing.fill ? { fill: true } : {}),
        ...(drawing.anchorId ? { movesWith: drawing.anchorId } : {}),
        ...(layer ? { layer: layer.name } : {}),
        ...(isDrawingEditable(drawing, layers) ? {} : { locked: true }),
      };
    }),
  };
}

function requireConcept(board: BoardDocument, id: string) {
  if (!board.nodes.some((node) => node.id === id))
    throw new CanvasError(
      `No concept "${id}". Known ids: ${board.nodes.map((node) => node.id).join(', ') || 'none'}.`,
    );
}

/** The layer with this name, adding it at the top when the board has none by that name. */
function layerNamed(layers: DrawingLayer[], name: string): DrawingLayer {
  const found = layers.find((layer) => layer.name.toLowerCase() === name.trim().toLowerCase());
  if (found) {
    if (found.locked || found.hidden)
      throw new CanvasError(
        `Layer "${found.name}" is ${found.locked ? 'locked' : 'hidden'}; the reader must ${found.locked ? 'unlock' : 'show'} it first.`,
      );
    return found;
  }
  if (layers.length >= MAX_DRAWING_LAYERS)
    throw new CanvasError(`A board holds at most ${MAX_DRAWING_LAYERS} drawing layers.`);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const base = slug ? `layer-${slug}` : 'layer';
  let id = base;
  for (let n = 2; layers.some((layer) => layer.id === id); n++) id = `${base}-${n}`;
  const layer = { id, name: name.trim() };
  layers.push(layer);
  return layer;
}

function uniqueDrawingId(board: BoardDocument, taken: Set<string>, shape: string) {
  let id = `${shape}-1`;
  for (let n = 2; taken.has(id) || board.drawings?.some((item) => item.id === id); n++)
    id = `${shape}-${n}`;
  taken.add(id);
  return id;
}

/** Validates one drawing, explaining the problem in the agent's terms. */
function validDrawing(drawing: BoardDrawing, index?: number): BoardDrawing {
  const parsed = BoardDrawingSchema.safeParse(drawing);
  if (parsed.success) return parsed.data;
  const where = index === undefined ? '' : `Drawing ${index + 1}: `;
  throw new CanvasError(where + parsed.error.issues.map((issue) => issue.message).join(' '));
}

function withLayers(board: BoardDocument, layers: DrawingLayer[]): BoardDocument {
  const next: BoardDocument = { ...board, drawingLayers: layers };
  if (!layers.length) delete next.drawingLayers;
  return next;
}

/** Adds drawings in one undoable step and returns their ids. */
export function addDrawings(snapshot: BoardSnapshot, inputs: readonly DrawingInput[]) {
  const board = boardOf(snapshot);
  const existing = board.drawings ?? [];
  if (existing.length + inputs.length > MAX_BOARD_DRAWINGS)
    throw new CanvasError(
      `A board holds at most ${MAX_BOARD_DRAWINGS} drawings; it has ${existing.length}.`,
    );
  const layers = [...(board.drawingLayers ?? [])];
  const taken = new Set<string>();
  const added = inputs.map((input, index) => {
    const drawing: BoardDrawing = {
      id: uniqueDrawingId(board, taken, input.shape),
      shape: input.shape,
      ink: input.ink ?? 'ink',
      line: input.line ?? 'solid',
      strokeWidth: input.strokeWidth ?? 2,
      ...(input.points ? { points: input.points.map(([x, y]) => [x, y] as [number, number]) } : {}),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
      ...(input.fill !== undefined ? { fill: input.fill } : {}),
      ...(input.layer ? { layerId: layerNamed(layers, input.layer).id } : {}),
    };
    validDrawing(drawing, index);
    if (!input.movesWith) return drawing;
    requireConcept(board, input.movesWith);
    return anchorDrawing(drawing, input.movesWith, board.positions);
  });
  return {
    ids: added.map((drawing) => drawing.id),
    snapshot: withEdit(snapshot, {
      ...withLayers(board, layers),
      drawings: [...existing, ...added],
    }),
  };
}

function requireEditable(board: BoardDocument, id: string) {
  const drawing = board.drawings?.find((item) => item.id === id);
  if (!drawing)
    throw new CanvasError(
      `No drawing "${id}". Known ids: ${board.drawings?.map((item) => item.id).join(', ') || 'none'}.`,
    );
  if (!isDrawingEditable(drawing, board.drawingLayers))
    throw new CanvasError(
      `Drawing "${id}" is locked or on a locked or hidden layer; the reader must unlock it first.`,
    );
  return drawing;
}

/** Changes one drawing's geometry, words, style, concept or layer in one undoable step. */
export function updateDrawing(snapshot: BoardSnapshot, id: string, patch: DrawingPatch) {
  const board = boardOf(snapshot);
  const stored = requireEditable(board, id);
  const layers = [...(board.drawingLayers ?? [])];
  let drawing = absoluteDrawing(stored, board.positions);
  if (patch.moveBy) drawing = translateDrawing(drawing, patch.moveBy[0], patch.moveBy[1]);
  if (patch.points) drawing.points = patch.points.map(([x, y]) => [x, y] as [number, number]);
  for (const key of ['x', 'y', 'width', 'height', 'fontSize'] as const)
    if (patch[key] !== undefined) drawing[key] = patch[key];
  if (patch.text !== undefined) {
    if (patch.text.trim()) drawing.text = patch.text;
    else delete drawing.text;
  }
  if (patch.ink) drawing.ink = patch.ink;
  if (patch.line) drawing.line = patch.line;
  if (patch.strokeWidth !== undefined) drawing.strokeWidth = patch.strokeWidth;
  if (patch.fill !== undefined) drawing.fill = patch.fill;
  if (patch.layer === null) delete drawing.layerId;
  else if (patch.layer) drawing.layerId = layerNamed(layers, patch.layer).id;
  validDrawing(drawing);
  const anchor = patch.movesWith === undefined ? (stored.anchorId ?? null) : patch.movesWith;
  if (anchor) requireConcept(board, anchor);
  const next = anchor ? anchorDrawing(drawing, anchor, board.positions) : drawing;
  return withEdit(snapshot, {
    ...withLayers(board, layers),
    drawings: board.drawings!.map((item) => (item.id === id ? next : item)),
  });
}

/** Removes drawings in one undoable step; nothing is removed if any of them is locked. */
export function removeDrawings(snapshot: BoardSnapshot, ids: readonly string[]) {
  const board = boardOf(snapshot);
  for (const id of ids) requireEditable(board, id);
  return withEdit(snapshot, {
    ...board,
    drawings: board.drawings!.filter((item) => !ids.includes(item.id)),
  });
}

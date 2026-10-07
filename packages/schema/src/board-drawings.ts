import { z } from 'zod';
import { ILLUSTRATION_INKS } from './illustration';

/**
 * Canvas drawings are freehand and illustrative marks a reader draws directly on a board:
 * sketches, outlines, walls, arrows, labels and dimension lines that turn a process flow into
 * a blueprint. They sit on the canvas beside the icons rather than inside one, so engineering
 * and architecture sketches can be combined with concepts and connections.
 *
 * Like icons and illustrations they are declarative, validated shapes, never markup. Points use
 * canvas coordinates. A drawing attached to a concept (`anchorId`) stores its coordinates
 * relative to that concept's position, so it moves with the concept when the concept is dragged
 * or rearranged.
 *
 * Drawings may sit on named layers that can be reordered, hidden or locked, and a single drawing
 * can be locked too. A board-level scale says what one grid square measures, so dimension lines
 * read in real units. Generation agents never receive or produce drawings; external agents edit
 * them only through the explicit MCP drawing tools, which respect locks.
 */

export const DRAWING_SHAPES = [
  'stroke',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'dimension',
] as const;
export type DrawingShape = (typeof DRAWING_SHAPES)[number];
/** Solid outlines, dashed hidden/proposed lines, and dash-dot centre lines. */
export const DRAWING_LINE_STYLES = ['solid', 'dashed', 'center'] as const;
export type DrawingLineStyle = (typeof DRAWING_LINE_STYLES)[number];

export const MAX_BOARD_DRAWINGS = 200;
export const MAX_DRAWING_POINTS = 400;
/** One fine grid square; dimension lines measure in these units unless labelled. */
export const DRAWING_GRID_UNIT = 24;

export const MAX_DRAWING_LAYERS = 12;

const coordinate = z.number().finite().min(-100_000).max(100_000);
const point = z.tuple([coordinate, coordinate]);
const drawingId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

/**
 * A named drawing layer. Layers paint in list order above the base layer (drawings without a
 * layer). A hidden layer is not drawn on the canvas or in exports; a locked one cannot be picked,
 * moved, erased or changed until it is unlocked.
 */
export const DrawingLayerSchema = z
  .object({
    id: drawingId,
    name: z.string().trim().min(1).max(40),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();
export type DrawingLayer = z.infer<typeof DrawingLayerSchema>;

/** What one fine grid square measures, e.g. 0.5 m; dimension lines read in this unit. */
export const DrawingScaleSchema = z
  .object({
    gridValue: z.number().finite().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(12),
  })
  .strict();
export type DrawingScale = z.infer<typeof DrawingScaleSchema>;

export const BoardDrawingSchema = z
  .object({
    id: drawingId,
    shape: z.enum(DRAWING_SHAPES),
    /** A freehand stroke's samples, or the two ends of a line, arrow or dimension. */
    points: z.array(point).min(2).max(MAX_DRAWING_POINTS).optional(),
    /** The top-left corner of a box or ellipse, or where a text begins. */
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: z.number().finite().min(0).max(100_000).optional(),
    height: z.number().finite().min(0).max(100_000).optional(),
    /** Text to write, or a dimension's label instead of its measured length. */
    text: z.string().max(500).optional(),
    fontSize: z.number().finite().min(8).max(96).optional(),
    ink: z.enum(ILLUSTRATION_INKS),
    /** A translucent fill in the same ink, for boxes and ellipses. */
    fill: z.boolean().optional(),
    strokeWidth: z.number().finite().min(0.5).max(16),
    line: z.enum(DRAWING_LINE_STYLES),
    /** The concept this drawing moves with; its coordinates are then relative to it. */
    anchorId: drawingId.optional(),
    /** The layer this drawing is on; the base layer when absent. */
    layerId: drawingId.optional(),
    /** A locked drawing can be picked, to unlock it, but not moved, erased or changed. */
    locked: z.boolean().optional(),
  })
  .strict()
  .superRefine((drawing, context) => {
    const problem = drawingShapeProblem(drawing);
    if (problem) context.addIssue({ code: 'custom', message: problem });
  });
export type BoardDrawing = z.infer<typeof BoardDrawingSchema>;

function drawingShapeProblem(drawing: z.infer<typeof BoardDrawingSchema>): string | null {
  switch (drawing.shape) {
    case 'stroke':
      return drawing.points ? null : 'A stroke needs points.';
    case 'line':
    case 'arrow':
    case 'dimension':
      return drawing.points?.length === 2 ? null : `A ${drawing.shape} needs exactly two points.`;
    case 'rect':
    case 'ellipse':
      return drawing.x === undefined ||
        drawing.y === undefined ||
        drawing.width === undefined ||
        drawing.height === undefined
        ? `A ${drawing.shape === 'rect' ? 'box' : 'ellipse'} needs x, y, width and height.`
        : null;
    case 'text':
      return drawing.x === undefined || drawing.y === undefined || !drawing.text?.trim()
        ? 'A text needs x, y and some text.'
        : null;
  }
}

/**
 * Board-level rules: unique drawing and layer IDs, anchors that name existing concepts and
 * layers that exist.
 */
export function drawingProblems(
  drawings: readonly BoardDrawing[],
  nodeIds: ReadonlySet<string>,
  layers: readonly DrawingLayer[] = [],
): string[] {
  const problems: string[] = [];
  if (new Set(drawings.map((drawing) => drawing.id)).size !== drawings.length)
    problems.push('Drawing IDs must be unique.');
  if (drawings.some((drawing) => drawing.anchorId && !nodeIds.has(drawing.anchorId)))
    problems.push('A drawing can only move with an existing concept.');
  const layerIds = new Set(layers.map((layer) => layer.id));
  if (layerIds.size !== layers.length) problems.push('Drawing layer IDs must be unique.');
  if (drawings.some((drawing) => drawing.layerId && !layerIds.has(drawing.layerId)))
    problems.push('A drawing can only be on an existing layer.');
  return problems;
}

type LayeredBoard = {
  drawings?: readonly BoardDrawing[] | undefined;
  drawingLayers?: readonly DrawingLayer[] | undefined;
};

/** The layer a drawing is on, or null for the base layer. */
export function layerOf(
  drawing: Pick<BoardDrawing, 'layerId'>,
  layers: readonly DrawingLayer[] | undefined,
): DrawingLayer | null {
  return (drawing.layerId && layers?.find((layer) => layer.id === drawing.layerId)) || null;
}

/**
 * The drawings shown on the canvas and in exports, bottom first: the base layer, then each
 * visible layer in order, each keeping the order its drawings were made in.
 */
export function visibleDrawings<T extends LayeredBoard>(board: T): BoardDrawing[] {
  const drawings = board.drawings ?? [];
  const layers = board.drawingLayers ?? [];
  return [
    ...drawings.filter((drawing) => !layerOf(drawing, layers)),
    ...layers
      .filter((layer) => !layer.hidden)
      .flatMap((layer) => drawings.filter((drawing) => drawing.layerId === layer.id)),
  ];
}

/** Whether a drawing can be picked on the canvas: visible and not on a locked layer. */
export function isDrawingPickable(drawing: BoardDrawing, layers?: readonly DrawingLayer[]) {
  const layer = layerOf(drawing, layers);
  return !layer?.hidden && !layer?.locked;
}

/** Whether a drawing may be moved, resized, restyled, erased or deleted. */
export function isDrawingEditable(drawing: BoardDrawing, layers?: readonly DrawingLayer[]) {
  return !drawing.locked && isDrawingPickable(drawing, layers);
}

/** Removes a layer; its drawings move to the base layer rather than being deleted. */
export function removeDrawingLayer<T extends LayeredBoard>(board: T, layerId: string): T {
  const layers = (board.drawingLayers ?? []).filter((layer) => layer.id !== layerId);
  const next: LayeredBoard = {
    ...board,
    drawings: board.drawings?.map((drawing) => {
      if (drawing.layerId !== layerId) return drawing;
      const moved = { ...drawing };
      delete moved.layerId;
      return moved;
    }),
    drawingLayers: layers,
  };
  if (!board.drawings) delete next.drawings;
  if (!layers.length) delete next.drawingLayers;
  return next as T;
}

type Position = { x: number; y: number };
type Positions = Readonly<Record<string, Position>>;

/** Where a drawing's coordinates are measured from: its concept, or the canvas origin. */
export function drawingOrigin(drawing: BoardDrawing, positions: Positions): Position {
  return (drawing.anchorId && positions[drawing.anchorId]) || { x: 0, y: 0 };
}

/** Moves a drawing's coordinates by an offset, keeping every other property. */
export function translateDrawing(drawing: BoardDrawing, dx: number, dy: number): BoardDrawing {
  return {
    ...drawing,
    ...(drawing.points
      ? { points: drawing.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
      : {}),
    ...(drawing.x !== undefined ? { x: drawing.x + dx } : {}),
    ...(drawing.y !== undefined ? { y: drawing.y + dy } : {}),
  };
}

/** The drawing in canvas coordinates, without an anchor. */
export function absoluteDrawing(drawing: BoardDrawing, positions: Positions): BoardDrawing {
  const origin = drawingOrigin(drawing, positions);
  const moved = translateDrawing(drawing, origin.x, origin.y);
  delete moved.anchorId;
  return moved;
}

/**
 * Attaches a drawing to a concept (or detaches it with `null`) without moving it on screen.
 * Attaching to a concept without a position leaves the drawing unchanged.
 */
export function anchorDrawing(
  drawing: BoardDrawing,
  anchorId: string | null,
  positions: Positions,
): BoardDrawing {
  const absolute = absoluteDrawing(drawing, positions);
  const target = anchorId ? positions[anchorId] : undefined;
  if (!anchorId) return absolute;
  if (!target) return drawing;
  return { ...translateDrawing(absolute, -target.x, -target.y), anchorId };
}

/**
 * Keeps drawings valid when concepts disappear: a drawing attached to a removed concept stays
 * where it was drawn, now fixed to the canvas. `positions` are those before the removal.
 */
export function detachDrawings(
  drawings: readonly BoardDrawing[] | undefined,
  remainingNodeIds: ReadonlySet<string>,
  positions: Positions,
): BoardDrawing[] | undefined {
  if (!drawings) return undefined;
  return drawings.map((drawing) =>
    drawing.anchorId && !remainingNodeIds.has(drawing.anchorId)
      ? absoluteDrawing(drawing, positions)
      : drawing,
  );
}

/** A rough text extent; the canvas uses the same estimate for hit-testing and export bounds. */
export function drawingTextSize(drawing: BoardDrawing) {
  const lines = (drawing.text ?? '').split('\n');
  const size = drawing.fontSize ?? 16;
  return {
    width: Math.max(...lines.map((line) => line.length)) * size * 0.6,
    height: lines.length * size * 1.25,
  };
}

/** Canvas-coordinate bounds including stroke width, for framing and export. */
export function drawingBounds(drawing: BoardDrawing, positions: Positions) {
  const absolute = absoluteDrawing(drawing, positions);
  const pad = absolute.strokeWidth + (absolute.shape === 'dimension' ? 24 : 4);
  let points: [number, number][];
  if (absolute.points) points = absolute.points;
  else if (absolute.shape === 'text') {
    const size = drawingTextSize(absolute);
    points = [
      [absolute.x!, absolute.y!],
      [absolute.x! + size.width, absolute.y! + size.height],
    ];
  } else
    points = [
      [absolute.x!, absolute.y!],
      [absolute.x! + absolute.width!, absolute.y! + absolute.height!],
    ];
  return {
    minX: Math.min(...points.map(([x]) => x)) - pad,
    minY: Math.min(...points.map(([, y]) => y)) - pad,
    maxX: Math.max(...points.map(([x]) => x)) + pad,
    maxY: Math.max(...points.map(([, y]) => y)) + pad,
  };
}

/**
 * What a dimension line says: its label, or its length in the board's scale (grid units, "u",
 * without one). Scaled lengths keep two decimals below ten, so small metric values stay exact.
 */
export function dimensionLabel(drawing: BoardDrawing, scale?: DrawingScale): string {
  if (drawing.text?.trim()) return drawing.text.trim();
  const [[x1, y1], [x2, y2]] = drawing.points as [[number, number], [number, number]];
  const squares = Math.hypot(x2 - x1, y2 - y1) / DRAWING_GRID_UNIT;
  if (!scale) return `${Number(squares.toFixed(1))} u`;
  const value = squares * scale.gridValue;
  return `${Number(value.toFixed(Math.abs(value) < 10 ? 2 : 1))} ${scale.unit.trim()}`;
}

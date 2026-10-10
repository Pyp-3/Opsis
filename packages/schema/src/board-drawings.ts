import { z } from 'zod';
import { ILLUSTRATION_INKS } from './illustration';
import {
  arcThrough,
  mapPath,
  MAX_PATH_DATA,
  pathDataProblem,
  samplePath,
  type PathPoint,
} from './drawing-path';

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
 * Beyond the simple shapes, a drawing can be a polygon (closed, fillable), an arc through three
 * points, or any SVG path (`d`, in canvas coordinates), so curves, pipes, plots and outlines are
 * drawn exactly. Fills may use their own ink, opacity and a hatch pattern; open shapes may end
 * in arrows, dots or bars; and drawings may share a `groupId` so they move as one piece.
 *
 * Drawings may sit on named layers that can be reordered, hidden or locked, and a single drawing
 * can be locked too. A board-level scale says what one grid square measures, so dimension lines
 * read in real units. Chat agents draw on their own layer (see `AGENT_SKETCH_LAYER`) and see the
 * reader's drawings only when the reader puts them in focus (see `chat-focus.ts`); external
 * agents edit them only through the explicit MCP drawing tools, which respect locks.
 */

export const DRAWING_SHAPES = [
  'stroke',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'dimension',
  'polygon',
  'arc',
  'path',
] as const;
export type DrawingShape = (typeof DRAWING_SHAPES)[number];
/** Solid outlines, dashed hidden/proposed lines, dash-dot centre lines and dotted lines. */
export const DRAWING_LINE_STYLES = ['solid', 'dashed', 'center', 'dotted'] as const;
export type DrawingLineStyle = (typeof DRAWING_LINE_STYLES)[number];

export const MAX_BOARD_DRAWINGS = 200;
export const MAX_DRAWING_POINTS = 400;
/** One fine grid square; dimension lines measure in these units unless labelled. */
export const DRAWING_GRID_UNIT = 24;

export const MAX_DRAWING_LAYERS = 12;

/** Hatching drawn over a fill: section cuts, materials and zones. */
export const DRAWING_HATCHES = ['diagonal', 'cross', 'horizontal', 'vertical', 'dots'] as const;
export type DrawingHatch = (typeof DRAWING_HATCHES)[number];
/** What an open shape ends in. */
export const DRAWING_MARKERS = ['none', 'arrow', 'dot', 'bar'] as const;
export type DrawingMarker = (typeof DRAWING_MARKERS)[number];
export const DRAWING_TEXT_ALIGNS = ['start', 'middle', 'end'] as const;
export type DrawingTextAlign = (typeof DRAWING_TEXT_ALIGNS)[number];

/** Shapes with an inside, which can be filled and hatched. */
export const FILLABLE_SHAPES: readonly DrawingShape[] = [
  'rect',
  'ellipse',
  'polygon',
  'arc',
  'path',
];
/** Shapes with two free ends, which can end in markers. */
export const OPEN_SHAPES: readonly DrawingShape[] = ['stroke', 'line', 'arrow', 'arc', 'path'];
/** Shapes stored as a list of points that are moved, turned and scaled one by one. */
export const POINT_SHAPES: readonly DrawingShape[] = [
  'stroke',
  'line',
  'arrow',
  'dimension',
  'polygon',
  'arc',
];

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

/** Shapes stored with a rotation about their centre; lines and strokes rotate their points. */
export const ROTATABLE_SHAPES: readonly DrawingShape[] = ['rect', 'ellipse', 'text'];

const BoardDrawingObject = z
  .object({
    id: drawingId,
    shape: z.enum(DRAWING_SHAPES),
    /**
     * A freehand stroke's samples; the two ends of a line, arrow or dimension; a polygon's
     * corners; or an arc's start, a point it passes through, and its end.
     */
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
    /** SVG path data in canvas coordinates, for a path. */
    d: z.string().max(MAX_PATH_DATA).optional(),
    /** A translucent fill in the same ink, for shapes with an inside. */
    fill: z.boolean().optional(),
    /** Fill in this ink instead (implies a fill). */
    fillInk: z.enum(ILLUSTRATION_INKS).optional(),
    /** How opaque the fill is; 0.16 when not given. */
    fillOpacity: z.number().finite().min(0.05).max(1).optional(),
    /** Hatching over the inside, in the fill's ink. */
    hatch: z.enum(DRAWING_HATCHES).optional(),
    /** How opaque the whole drawing is. */
    opacity: z.number().finite().min(0.1).max(1).optional(),
    strokeWidth: z.number().finite().min(0.5).max(16),
    line: z.enum(DRAWING_LINE_STYLES),
    /** What an open shape's first and last points end in; an arrow ends in an arrowhead. */
    startMarker: z.enum(DRAWING_MARKERS).optional(),
    endMarker: z.enum(DRAWING_MARKERS).optional(),
    /** Where a text's x is: its start (default), middle or end. */
    align: z.enum(DRAWING_TEXT_ALIGNS).optional(),
    bold: z.boolean().optional(),
    /** A paper-coloured box behind a text, so it reads over busy drawings. */
    background: z.boolean().optional(),
    /** Drawings with the same group move, turn and are selected together. */
    groupId: drawingId.optional(),
    /** The concept this drawing moves with; its coordinates are then relative to it. */
    anchorId: drawingId.optional(),
    /** The layer this drawing is on; the base layer when absent. */
    layerId: drawingId.optional(),
    /** A locked drawing can be picked, to unlock it, but not moved, erased or changed. */
    locked: z.boolean().optional(),
    /** Degrees clockwise about the centre, for boxes, ellipses and text. */
    rotation: z.number().finite().min(-360).max(360).optional(),
  })
  .strict();
const checkShape = (drawing: z.infer<typeof BoardDrawingObject>, context: z.RefinementCtx) => {
  const problem = drawingShapeProblem(drawing);
  if (problem) context.addIssue({ code: 'custom', message: problem });
};
export const BoardDrawingSchema = BoardDrawingObject.superRefine(checkShape);
export type BoardDrawing = z.infer<typeof BoardDrawingSchema>;

export const MAX_AGENT_DRAWINGS = 60;
/**
 * A drawing a chat agent proposes: the same declarative shapes, with fewer stroke samples. Its
 * layer and lock are the app's to set. `anchorId` names a concept whose top-left corner the
 * coordinates are measured from.
 */
export const AgentDrawingSchema = BoardDrawingObject.omit({ layerId: true, locked: true })
  .extend({ points: z.array(point).min(2).max(120).optional() })
  .superRefine(checkShape);
export type AgentDrawing = z.infer<typeof AgentDrawingSchema>;
/**
 * One of the reader's own drawings as a chat agent is shown it when the reader puts it in focus:
 * the stored shape without its layer or lock, so long strokes keep every sample.
 */
export const FocusDrawingSchema = BoardDrawingObject.omit({
  layerId: true,
  locked: true,
}).superRefine(checkShape);
export type FocusDrawing = z.infer<typeof FocusDrawingSchema>;

function drawingShapeProblem(drawing: z.infer<typeof BoardDrawingObject>): string | null {
  if (drawing.rotation && !ROTATABLE_SHAPES.includes(drawing.shape))
    return `A ${drawing.shape} is rotated by moving its points, not with rotation.`;
  if (drawing.shape === 'path' ? drawing.points : drawing.d !== undefined)
    return drawing.shape === 'path'
      ? 'A path uses d (SVG path data), not points.'
      : `Only a path has d (SVG path data); a ${drawing.shape} does not.`;
  switch (drawing.shape) {
    case 'stroke':
      return drawing.points ? null : 'A stroke needs points.';
    case 'polygon':
      return (drawing.points?.length ?? 0) >= 3 ? null : 'A polygon needs at least three points.';
    case 'arc':
      return drawing.points?.length === 3
        ? null
        : 'An arc needs three points: its start, a point it passes through, and its end.';
    case 'path':
      return drawing.d === undefined
        ? 'A path needs d (SVG path data).'
        : pathDataProblem(drawing.d);
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

/**
 * The drawing with its points, path and corner (x, y) mapped, keeping every other property.
 * Sizes and rotations are unchanged, so for boxes, ellipses and text only the corner moves.
 */
export function mapDrawingPoints<T extends BoardDrawing>(
  drawing: T,
  map: (point: PathPoint) => PathPoint,
): T {
  const corner =
    drawing.x !== undefined && drawing.y !== undefined ? map([drawing.x, drawing.y]) : null;
  return {
    ...drawing,
    ...(drawing.points ? { points: drawing.points.map((point) => map([point[0], point[1]])) } : {}),
    ...(drawing.d !== undefined ? { d: mapPath(drawing.d, map) } : {}),
    ...(corner ? { x: corner[0], y: corner[1] } : {}),
  };
}

/** Moves a drawing's coordinates by an offset, keeping every other property. */
export function translateDrawing<T extends BoardDrawing>(drawing: T, dx: number, dy: number): T {
  return mapDrawingPoints(drawing, ([x, y]) => [x + dx, y + dy]);
}

/** The points a path or arc is drawn through, as polylines for outlines and hit-testing. */
export function drawingPolylines(drawing: BoardDrawing): PathPoint[][] {
  if (drawing.shape === 'path' && drawing.d) return samplePath(drawing.d);
  if (drawing.shape === 'arc' && drawing.points?.length === 3) {
    const [start, through, end] = drawing.points as [PathPoint, PathPoint, PathPoint];
    const arc = arcThrough([start, through, end]);
    if (!arc) return [[start, end]];
    const direction = arc.sweep ? 1 : -1;
    const steps = Math.max(8, Math.ceil((arc.span / Math.PI) * 24));
    return [
      Array.from({ length: steps + 1 }, (_, n): PathPoint => {
        const angle = arc.start + (direction * arc.span * n) / steps;
        return [
          arc.centre[0] + arc.radius * Math.cos(angle),
          arc.centre[1] + arc.radius * Math.sin(angle),
        ];
      }),
    ];
  }
  if (drawing.shape === 'polygon' && drawing.points)
    return [[...drawing.points.map(([x, y]): PathPoint => [x, y]), [...drawing.points[0]!]]];
  return drawing.points ? [drawing.points.map(([x, y]): PathPoint => [x, y])] : [];
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
    width: Math.max(...lines.map((line) => line.length)) * size * (drawing.bold ? 0.64 : 0.6),
    height: lines.length * size * 1.25,
  };
}

/** Turns a point about a centre by `degrees` clockwise (canvas y points down). */
export function rotatePoint(
  [x, y]: readonly [number, number],
  [cx, cy]: readonly [number, number],
  degrees: number,
): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/** An angle in (-180, 180], at tenths of a degree; 0 means unrotated. */
export function normalizeRotation(degrees: number) {
  const turned = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const rounded = Math.round((turned === -180 ? 180 : turned) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * The unrotated box of a box, ellipse or text (text measured with `drawingTextSize`), with its
 * centre, in the drawing's own coordinates.
 */
export function drawingFrame(drawing: BoardDrawing) {
  const size =
    drawing.shape === 'text'
      ? drawingTextSize(drawing)
      : { width: drawing.width ?? 0, height: drawing.height ?? 0 };
  // Aligned text is anchored at its middle or end, so its box starts left of x.
  const shift =
    drawing.shape === 'text' && drawing.align && drawing.align !== 'start'
      ? size.width / (drawing.align === 'middle' ? 2 : 1)
      : 0;
  const x = (drawing.x ?? 0) - shift;
  const y = drawing.y ?? 0;
  return {
    x,
    y,
    ...size,
    centre: [x + size.width / 2, y + size.height / 2] as [number, number],
  };
}

/** The points that outline a drawing as painted: its samples, or a box's rotated corners. */
export function drawingOutlinePoints(drawing: BoardDrawing): [number, number][] {
  if (drawing.shape === 'path' || drawing.shape === 'arc') return drawingPolylines(drawing).flat();
  if (drawing.points) return drawing.points.map(([x, y]) => [x, y]);
  const frame = drawingFrame(drawing);
  const corners: [number, number][] = [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x + frame.width, frame.y + frame.height],
    [frame.x, frame.y + frame.height],
  ];
  const rotation = drawing.rotation ?? 0;
  return rotation ? corners.map((corner) => rotatePoint(corner, frame.centre, rotation)) : corners;
}

/** Canvas-coordinate bounds including stroke width, for framing and export. */
export function drawingBounds(drawing: BoardDrawing, positions: Positions) {
  const absolute = absoluteDrawing(drawing, positions);
  const pad = absolute.strokeWidth + (absolute.shape === 'dimension' ? 24 : 4);
  const points = drawingOutlinePoints(absolute);
  return {
    minX: Math.min(...points.map(([x]) => x)) - pad,
    minY: Math.min(...points.map(([, y]) => y)) - pad,
    maxX: Math.max(...points.map(([x]) => x)) + pad,
    maxY: Math.max(...points.map(([, y]) => y)) + pad,
  };
}

/**
 * Chat agents draw only on their own layer. A follow-up shows the agent that layer's drawings
 * and may replace them; the reader's drawings on other layers are never sent or changed. When
 * the reader hides or locks the agent's layer, the agent sees nothing and cannot change it.
 */
export const AGENT_SKETCH_LAYER: DrawingLayer = { id: 'agent-sketch', name: 'Agent sketch' };

type SketchBoard = LayeredBoard & { positions: Positions };

/** Whether a chat agent may see and replace its sketch on this board. */
export function agentMayDraw(board: LayeredBoard | undefined) {
  const layer = board?.drawingLayers?.find((item) => item.id === AGENT_SKETCH_LAYER.id);
  return !layer?.hidden && !layer?.locked;
}

/** The drawings on the agent's layer. */
export function agentSketchOf(board: LayeredBoard | undefined): BoardDrawing[] {
  return (board?.drawings ?? []).filter((drawing) => drawing.layerId === AGENT_SKETCH_LAYER.id);
}

/** The agent's own drawings as it is shown them, or undefined when it may not draw. */
export function sketchForAgent(board: LayeredBoard | undefined): AgentDrawing[] | undefined {
  if (!agentMayDraw(board)) return undefined;
  return agentSketchOf(board).map((drawing) => {
    const shown = { ...drawing };
    delete shown.layerId;
    delete shown.locked;
    return shown;
  });
}

/** Moves free-standing drawings as a group so their top-left corner is at `at`. */
export function placeSketch(
  drawings: readonly AgentDrawing[],
  at: { x: number; y: number },
): AgentDrawing[] {
  const free = drawings.filter((drawing) => !drawing.anchorId);
  if (!free.length) return [...drawings];
  const corners = free.flatMap((drawing) => drawingOutlinePoints(drawing));
  const dx = at.x - Math.min(...corners.map(([x]) => x));
  const dy = at.y - Math.min(...corners.map(([, y]) => y));
  return drawings.map((drawing) =>
    drawing.anchorId ? drawing : translateDrawing(drawing, dx, dy),
  );
}

/**
 * Replaces the agent's layer with its proposed drawings, leaving every other drawing alone.
 * `proposed` undefined (the agent left its sketch out) or a hidden/locked agent layer keeps the
 * board as it is. IDs that clash with the reader's drawings are renamed, anchors to concepts the
 * board does not have are dropped (keeping the drawing where it would be), and drawings beyond
 * the board's limit are left out.
 */
export function withAgentSketch<T extends SketchBoard>(
  board: T,
  proposed: readonly AgentDrawing[] | undefined,
  nodeIds: ReadonlySet<string>,
): T {
  if (!proposed || !agentMayDraw(board)) return board;
  const others = (board.drawings ?? []).filter(
    (drawing) => drawing.layerId !== AGENT_SKETCH_LAYER.id,
  );
  const taken = new Set(others.map((drawing) => drawing.id));
  const room = Math.max(0, MAX_BOARD_DRAWINGS - others.length);
  const sketch = proposed.slice(0, room).map((drawing): BoardDrawing => {
    let id = drawing.id;
    for (let n = 2; taken.has(id); n++) id = `${drawing.id.slice(0, 70)}-agent${n === 2 ? '' : n}`;
    taken.add(id);
    const placed: BoardDrawing = { ...drawing, id, layerId: AGENT_SKETCH_LAYER.id };
    return placed.anchorId && !nodeIds.has(placed.anchorId)
      ? { ...absoluteDrawing(placed, board.positions), layerId: AGENT_SKETCH_LAYER.id }
      : placed;
  });
  const layers = board.drawingLayers ?? [];
  const next: SketchBoard = {
    ...board,
    drawings: [...others, ...sketch],
    drawingLayers:
      sketch.length && !layers.some((layer) => layer.id === AGENT_SKETCH_LAYER.id)
        ? [...layers, AGENT_SKETCH_LAYER]
        : layers,
  };
  if (!next.drawings!.length) delete next.drawings;
  if (!next.drawingLayers!.length) delete next.drawingLayers;
  return next as T;
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

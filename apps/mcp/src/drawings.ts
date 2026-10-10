import {
  absoluteDrawing,
  anchorDrawing,
  BoardDrawingSchema,
  DRAWING_GRID_UNIT,
  DRAWING_HATCHES,
  DRAWING_LINE_STYLES,
  DRAWING_MARKERS,
  DRAWING_SHAPES,
  DRAWING_TEXT_ALIGNS,
  alignDrawings,
  distributeDrawings,
  drawingsBox,
  DRAWING_SYMBOL_NAMES,
  groupRotationCentre,
  mirrorDrawing,
  placeSymbol,
  repeatDrawings,
  rotateDrawingAbout,
  scaleDrawingAbout,
  ILLUSTRATION_INKS,
  isDrawingEditable,
  layerOf,
  MAX_BOARD_DRAWINGS,
  MAX_DRAWING_LAYERS,
  MAX_DRAWING_POINTS,
  MAX_PATH_DATA,
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
const GroupIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, digits, - and _ for group names.');

export const DrawingFieldsSchema = {
  points: z
    .array(point)
    .min(2)
    .max(MAX_DRAWING_POINTS)
    .optional()
    .describe(
      'Line, arrow and dimension: exactly two [x, y] ends. Stroke: freehand samples. Polygon: three or more corners (closed). Arc: [start, a point it passes through, end].',
    ),
  d: z
    .string()
    .max(MAX_PATH_DATA)
    .optional()
    .describe(
      'Path only: SVG path data in canvas coordinates (M, L, H, V, C, S, Q, T, A, Z; absolute or relative), for curves, pipes, plots and outlines.',
    ),
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
    .describe(
      'solid (default), dashed (hidden/proposed), center (dash-dot centre line) or dotted.',
    ),
  strokeWidth: z.number().finite().min(0.5).max(16).optional().describe('Default 2.'),
  fill: z
    .boolean()
    .optional()
    .describe('A translucent fill in the outline ink, for rect, ellipse, polygon, arc and path.'),
  rotation: z
    .number()
    .finite()
    .min(-360)
    .max(360)
    .optional()
    .describe('Degrees clockwise about the centre, for rect, ellipse and text only.'),
};

/** Optional styles; in an update, null clears one. */
const StyleFieldsSchema = {
  fillInk: z.enum(ILLUSTRATION_INKS).describe('Fill in this ink (implies a fill).'),
  fillOpacity: z.number().finite().min(0.05).max(1).describe('Fill opacity; default 0.16.'),
  hatch: z
    .enum(DRAWING_HATCHES)
    .describe('Hatching over the inside, in the fill ink: section cuts, materials, zones.'),
  opacity: z.number().finite().min(0.1).max(1).describe('Opacity of the whole drawing.'),
  startMarker: z
    .enum(DRAWING_MARKERS)
    .describe('What the first point ends in (stroke, line, arrow, arc, path).'),
  endMarker: z
    .enum(DRAWING_MARKERS)
    .describe('What the last point ends in; an arrow ends in "arrow" by default.'),
  align: z.enum(DRAWING_TEXT_ALIGNS).describe('Text: whether x is its start, middle or end.'),
  bold: z.boolean().describe('Text: bold.'),
  background: z.boolean().describe('Text: a backdrop so it reads over busy drawings.'),
  group: GroupIdSchema.describe(
    'A group name; drawings in a group are selected, moved and transformed together.',
  ),
};
type StyleKey = keyof typeof StyleFieldsSchema;
const STYLE_KEYS = Object.keys(StyleFieldsSchema) as StyleKey[];
const storedKey = (key: StyleKey) => (key === 'group' ? 'groupId' : key);

export const DrawingInputSchema = z.object({
  shape: z.enum(DRAWING_SHAPES),
  ...DrawingFieldsSchema,
  ...(Object.fromEntries(STYLE_KEYS.map((key) => [key, StyleFieldsSchema[key].optional()])) as {
    [K in StyleKey]: z.ZodOptional<(typeof StyleFieldsSchema)[K]>;
  }),
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
  ...(Object.fromEntries(
    STYLE_KEYS.map((key) => [key, StyleFieldsSchema[key].nullable().optional()]),
  ) as { [K in StyleKey]: z.ZodOptional<z.ZodNullable<(typeof StyleFieldsSchema)[K]>> }),
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
      const box = drawingsBox([absolute]);
      const bounds = {
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
      };
      return {
        id: drawing.id,
        shape: drawing.shape,
        // The painted box of every drawing, so agents can place things beside each other.
        bounds,
        // A freehand stroke is summarised by that box rather than every sample.
        ...(drawing.shape === 'stroke'
          ? {}
          : absolute.d !== undefined
            ? { d: absolute.d }
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
        ...(drawing.rotation ? { rotation: drawing.rotation } : {}),
        ...Object.fromEntries(
          STYLE_KEYS.flatMap((key) =>
            drawing[storedKey(key)] === undefined ? [] : [[key, drawing[storedKey(key)]]],
          ),
        ),
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

/** The optional styles an agent gave, under their stored names. */
function styles(input: Partial<Record<StyleKey, unknown>>): Partial<BoardDrawing> {
  return Object.fromEntries(
    STYLE_KEYS.flatMap((key) => (input[key] === undefined ? [] : [[storedKey(key), input[key]]])),
  ) as Partial<BoardDrawing>;
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
      ...(input.d !== undefined ? { d: input.d } : {}),
      ...styles(input),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
      ...(input.fill !== undefined ? { fill: input.fill } : {}),
      ...(input.rotation ? { rotation: input.rotation } : {}),
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
  if (patch.d !== undefined) drawing.d = patch.d;
  for (const key of STYLE_KEYS) {
    const value = patch[key];
    if (value === null) delete drawing[storedKey(key)];
    else if (value !== undefined) Object.assign(drawing, { [storedKey(key)]: value });
  }
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
  if (patch.rotation !== undefined) {
    if (patch.rotation) drawing.rotation = patch.rotation;
    else delete drawing.rotation;
  }
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

const PointSchema = point;
const TargetsSchema = {
  drawingIds: z.array(ConceptIdSchema).max(200).optional().describe('Drawings to include.'),
  groups: z
    .array(GroupIdSchema)
    .max(50)
    .optional()
    .describe('Groups to include whole (for example a placed symbol).'),
};

export const SymbolPlacementSchema = z.object({
  symbol: z.enum(DRAWING_SYMBOL_NAMES).describe('Symbol name; see opsis_list_symbols.'),
  x: coordinate.describe("Where the symbol's centre goes."),
  y: coordinate,
  width: z
    .number()
    .finite()
    .min(4)
    .max(4000)
    .optional()
    .describe('Width to draw it at; its height keeps the proportions. Default: natural size.'),
  rotation: z.number().finite().min(-360).max(360).optional().describe('Degrees clockwise.'),
  mirror: z
    .boolean()
    .optional()
    .describe('Mirror left to right (a door hinged on the other side).'),
  ink: z.enum(ILLUSTRATION_INKS).optional(),
  strokeWidth: z.number().finite().min(0.5).max(8).optional().describe('Line weight; default 2.'),
  label: z.string().max(200).optional().describe('Words written under it, such as "PT-101".'),
  movesWith: ConceptIdSchema.optional().describe('A concept id the symbol follows.'),
  layer: LayerNameSchema.optional(),
});
export type SymbolPlacementInput = z.infer<typeof SymbolPlacementSchema>;

export const TransformSchema = {
  ...TargetsSchema,
  moveBy: PointSchema.optional().describe('Move by [dx, dy].'),
  scale: z
    .union([z.number().finite(), PointSchema])
    .optional()
    .describe('Scale by a factor, or [sx, sy]; 2 doubles the size.'),
  mirror: z
    .enum(['horizontal', 'vertical'])
    .optional()
    .describe('horizontal: left becomes right; vertical: top becomes bottom.'),
  rotate: z.number().finite().min(-360).max(360).optional().describe('Degrees clockwise.'),
  about: z
    .union([z.enum(['together', 'each']), PointSchema])
    .optional()
    .describe(
      'What scale, mirror and rotate pivot on: the centre of everything chosen (together, the default), each drawing or group on its own centre (each), or an [x, y] point.',
    ),
  align: z
    .enum(['left', 'center', 'right', 'top', 'middle', 'bottom'])
    .optional()
    .describe('Line them up along an edge or centre line of their combined box.'),
  distribute: z
    .enum(['horizontal', 'vertical'])
    .optional()
    .describe('Space three or more drawings or groups evenly between the outermost ones.'),
};
type TransformInput = {
  [K in keyof typeof TransformSchema]?: z.infer<(typeof TransformSchema)[K]>;
};

/** Every editable drawing named directly or through its group. */
function targetsOf(
  board: BoardDocument,
  {
    drawingIds = [],
    groups = [],
  }: { drawingIds?: string[] | undefined; groups?: string[] | undefined },
) {
  const ids = new Set(drawingIds);
  for (const group of groups) {
    const members = (board.drawings ?? []).filter((drawing) => drawing.groupId === group);
    if (!members.length) throw new CanvasError(`No drawings in group "${group}".`);
    for (const member of members) ids.add(member.id);
  }
  if (!ids.size) throw new CanvasError('Name drawings with drawingIds or groups.');
  return [...ids].map((id) => requireEditable(board, id));
}

/** Replaces drawings by id, re-attaching each to the concept it moved with. */
function storeAbsolute(
  board: BoardDocument,
  originals: readonly BoardDrawing[],
  changed: readonly BoardDrawing[],
): BoardDrawing[] {
  const byId = new Map(
    changed.map((drawing, index) => {
      const anchor = originals[index]!.anchorId;
      const valid = validDrawing(drawing);
      return [drawing.id, anchor ? anchorDrawing(valid, anchor, board.positions) : valid];
    }),
  );
  return board.drawings!.map((item) => byId.get(item.id) ?? item);
}

/** Pieces that turn on their own centre with `about: "each"`: groups and single drawings. */
function piecesOf(drawings: readonly BoardDrawing[]) {
  const pieces = new Map<string, BoardDrawing[]>();
  for (const drawing of drawings) {
    const key = drawing.groupId ? `group:${drawing.groupId}` : `drawing:${drawing.id}`;
    pieces.set(key, [...(pieces.get(key) ?? []), drawing]);
  }
  return [...pieces.values()];
}

/**
 * Moves, scales, mirrors, turns, aligns or spaces drawings and groups in one undoable step,
 * applied in that order. Locked drawings cannot be transformed.
 */
export function transformDrawings(snapshot: BoardSnapshot, input: TransformInput) {
  const board = boardOf(snapshot);
  const originals = targetsOf(board, input);
  let drawings = originals.map((drawing) => absoluteDrawing(drawing, board.positions));
  const pivotOf = (piece: readonly BoardDrawing[]): [number, number] =>
    Array.isArray(input.about) ? [input.about[0], input.about[1]] : groupRotationCentre(piece);
  const eachPiece = (apply: (drawing: BoardDrawing, pivot: [number, number]) => BoardDrawing) => {
    const pieces = input.about === 'each' ? piecesOf(drawings) : [drawings];
    const moved = new Map<string, BoardDrawing>();
    for (const piece of pieces) {
      const pivot = pivotOf(piece);
      for (const drawing of piece) moved.set(drawing.id, apply(drawing, pivot));
    }
    drawings = drawings.map((drawing) => moved.get(drawing.id)!);
  };
  if (input.moveBy) {
    const [dx, dy] = input.moveBy;
    drawings = drawings.map((drawing) => translateDrawing(drawing, round(dx), round(dy)));
  }
  if (input.scale !== undefined) {
    const [sx, sy] = typeof input.scale === 'number' ? [input.scale, input.scale] : input.scale;
    if (!sx || !sy || Math.abs(sx) > 100 || Math.abs(sy) > 100)
      throw new CanvasError('Scale factors must be non-zero and at most 100.');
    eachPiece((drawing, pivot) => scaleDrawingAbout(drawing, sx, sy, pivot));
  }
  if (input.mirror) eachPiece((drawing, pivot) => mirrorDrawing(drawing, input.mirror!, pivot));
  if (input.rotate)
    eachPiece((drawing, pivot) => rotateDrawingAbout(drawing, input.rotate!, pivot));
  if (input.align) drawings = alignDrawings(drawings, input.align);
  if (input.distribute) drawings = distributeDrawings(drawings, input.distribute);
  return withEdit(snapshot, { ...board, drawings: storeAbsolute(board, originals, drawings) });
}

/** A group name not yet used on the board. */
function uniqueGroupId(board: BoardDocument, base: string, taken: Set<string>) {
  const used = new Set([
    ...(board.drawings ?? []).flatMap((drawing) => [drawing.groupId ?? '', drawing.id]),
    ...taken,
  ]);
  let id = `${base}-1`;
  for (let n = 2; used.has(id) || [...used].some((item) => item.startsWith(`${id}-`)); n++)
    id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Places symbols as grouped drawings in one undoable step; returns each group and its ids. */
export function placeSymbols(snapshot: BoardSnapshot, inputs: readonly SymbolPlacementInput[]) {
  const board = boardOf(snapshot);
  const layers = [...(board.drawingLayers ?? [])];
  const taken = new Set<string>();
  const placed = inputs.map((input) => {
    const groupId = uniqueGroupId(board, input.symbol, taken);
    const drawings = placeSymbol(
      input.symbol,
      {
        x: input.x,
        y: input.y,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        ...(input.mirror !== undefined ? { mirror: input.mirror } : {}),
        ...(input.ink ? { ink: input.ink } : {}),
        ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
        ...(input.label ? { label: input.label } : {}),
      },
      { groupId, idPrefix: groupId },
    ).map((drawing) => {
      const layered: BoardDrawing = input.layer
        ? { ...drawing, layerId: layerNamed(layers, input.layer).id }
        : drawing;
      if (!input.movesWith) return layered;
      requireConcept(board, input.movesWith);
      return anchorDrawing(layered, input.movesWith, board.positions);
    });
    return { group: groupId, drawingIds: drawings.map((drawing) => drawing.id), drawings };
  });
  const added = placed.flatMap((item) => item.drawings);
  const existing = board.drawings ?? [];
  if (existing.length + added.length > MAX_BOARD_DRAWINGS)
    throw new CanvasError(
      `A board holds at most ${MAX_BOARD_DRAWINGS} drawings; it has ${existing.length} and these symbols need ${added.length}.`,
    );
  return {
    placed: placed.map(({ group, drawingIds }) => ({ group, drawingIds })),
    snapshot: withEdit(snapshot, {
      ...withLayers(board, layers),
      drawings: [...existing, ...added],
    }),
  };
}

/**
 * Copies drawings and groups `count` times, each copy `step` further on, in one undoable step.
 * Copies keep the originals' concept and layer; grouped drawings form new groups.
 */
export function repeatBoardDrawings(
  snapshot: BoardSnapshot,
  input: { drawingIds?: string[]; groups?: string[]; count: number; step: [number, number] },
) {
  const board = boardOf(snapshot);
  const originals = targetsOf(board, input);
  const existing = board.drawings ?? [];
  if (existing.length + originals.length * input.count > MAX_BOARD_DRAWINGS)
    throw new CanvasError(
      `A board holds at most ${MAX_BOARD_DRAWINGS} drawings; it has ${existing.length}.`,
    );
  const takenIds = new Set<string>();
  const takenGroups = new Set<string>();
  const groupNames = new Map<string, string>();
  const copies = repeatDrawings(
    originals,
    input.count,
    input.step,
    (drawing) => uniqueDrawingId(board, takenIds, drawing.shape),
    (group, copy) => {
      const key = `${group}#${copy}`;
      if (!groupNames.has(key)) groupNames.set(key, uniqueGroupId(board, group, takenGroups));
      return groupNames.get(key)!;
    },
  ).map((drawing) => validDrawing(drawing));
  return {
    drawingIds: copies.map((drawing) => drawing.id),
    snapshot: withEdit(snapshot, { ...board, drawings: [...existing, ...copies] }),
  };
}

/** Puts drawings in one group (or takes them out with `null`) in one undoable step. */
export function groupBoardDrawings(
  snapshot: BoardSnapshot,
  drawingIds: readonly string[],
  group: string | null,
) {
  const board = boardOf(snapshot);
  for (const id of drawingIds) requireEditable(board, id);
  return withEdit(snapshot, {
    ...board,
    drawings: board.drawings!.map((drawing) => {
      if (!drawingIds.includes(drawing.id)) return drawing;
      const next = { ...drawing };
      if (group) next.groupId = group;
      else delete next.groupId;
      return next;
    }),
  });
}

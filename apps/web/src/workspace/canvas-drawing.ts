import {
  absoluteDrawing,
  anchorDrawing,
  drawingFrame,
  drawingOutlinePoints,
  drawingPolylines,
  mapDrawingPoints,
  rotatePoint,
  BoardDrawingSchema,
  drawingTextSize,
  isDrawingPickable,
  layerOf,
  MAX_BOARD_DRAWINGS,
  MAX_DRAWING_POINTS,
  translateDrawing,
  visibleDrawings,
  type BoardDrawing,
  type BoardDocument,
} from '@opsis/schema';

/**
 * Pure geometry for the reader's canvas drawings, shared by the live canvas, hit-testing and
 * SVG/PNG export. Every function takes canvas coordinates (an anchored drawing is first made
 * absolute with `absoluteDrawing`).
 */

export type Point = readonly [number, number];

/** Rectangle from a drag between two corners, in any direction. */
export function boxBetween([x1, y1]: Point, [x2, y2]: Point) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Drops samples closer than `spacing` to the last kept one, and caps the stroke's length. */
export function simplifyStroke(points: readonly Point[], spacing = 3): [number, number][] {
  const kept: [number, number][] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing)
      kept.push([round(point[0]), round(point[1])]);
  }
  const final = points[points.length - 1];
  const last = kept[kept.length - 1];
  if (final && last && (final[0] !== last[0] || final[1] !== last[1]) && kept.length > 1)
    kept[kept.length - 1] = [round(final[0]), round(final[1])];
  if (kept.length <= MAX_DRAWING_POINTS) return kept;
  const step = (kept.length - 1) / (MAX_DRAWING_POINTS - 1);
  return Array.from({ length: MAX_DRAWING_POINTS }, (_, i) => kept[Math.round(i * step)]!);
}

/** Canvas coordinates rounded to tenths keep saved boards compact. */
export const round = (value: number) => Math.round(value * 10) / 10;

/** The drawing with its coordinates rounded, as after a move. */
export function roundDrawing(drawing: BoardDrawing): BoardDrawing {
  return mapDrawingPoints(drawing, ([x, y]) => [round(x), round(y)]);
}

/** Drawings stored as points or a path, which are scaled and turned point by point. */
const pointBased = (drawing: BoardDrawing) => !!drawing.points || drawing.d !== undefined;
/** Shapes resized by dragging their two ends rather than a frame. */
const twoEnded = (drawing: BoardDrawing) =>
  drawing.shape === 'line' || drawing.shape === 'arrow' || drawing.shape === 'dimension';

/** Even-odd test of a point against closed outlines. */
function insideOutlines(point: Point, outlines: readonly (readonly Point[])[]) {
  let inside = false;
  for (const outline of outlines)
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, yi] = outline[i]!;
      const [xj, yj] = outline[j]!;
      if (
        yi > point[1] !== yj > point[1] &&
        point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
      )
        inside = !inside;
    }
  return inside;
}

function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a canvas point touches an (absolute) drawing, within `tolerance`. */
export function drawingContains(drawing: BoardDrawing, point: Point, tolerance: number): boolean {
  // A rotated box, ellipse or text is tested in its own, unrotated frame.
  if (drawing.rotation) point = rotatePoint(point, drawingFrame(drawing).centre, -drawing.rotation);
  const reach = tolerance + drawing.strokeWidth / 2;
  if (pointBased(drawing)) {
    const lines = drawingPolylines(drawing);
    for (const line of lines)
      for (let i = 1; i < line.length; i++)
        if (segmentDistance(point, line[i - 1]!, line[i]!) <= reach) return true;
    // A filled or hatched polygon, arc or path can be picked anywhere inside.
    const solid = drawing.fill || drawing.fillInk || drawing.hatch;
    return (
      !!solid &&
      (drawing.shape === 'polygon' || drawing.shape === 'arc' || drawing.shape === 'path') &&
      insideOutlines(point, lines)
    );
  }
  const x = drawing.x!;
  const y = drawing.y!;
  if (drawing.shape === 'text') {
    const size = drawingTextSize(drawing);
    const left = drawingFrame(drawing).x;
    return (
      point[0] >= left - reach &&
      point[0] <= left + size.width + reach &&
      point[1] >= y - reach &&
      point[1] <= y + size.height + reach
    );
  }
  const width = drawing.width!;
  const height = drawing.height!;
  if (drawing.shape === 'ellipse') {
    const rx = width / 2;
    const ry = height / 2;
    const cx = x + rx;
    const cy = y + ry;
    const inner = Math.hypot(
      (point[0] - cx) / Math.max(rx - reach, 1),
      (point[1] - cy) / Math.max(ry - reach, 1),
    );
    const outer = Math.hypot((point[0] - cx) / (rx + reach), (point[1] - cy) / (ry + reach));
    return outer <= 1 && (drawing.fill || inner >= 1);
  }
  const inside =
    point[0] >= x - reach &&
    point[0] <= x + width + reach &&
    point[1] >= y - reach &&
    point[1] <= y + height + reach;
  if (!inside) return false;
  if (drawing.fill) return true;
  return (
    point[0] <= x + reach ||
    point[0] >= x + width - reach ||
    point[1] <= y + reach ||
    point[1] >= y + height - reach
  );
}

/**
 * The topmost pickable drawing under a canvas point, in paint order (later layers and later
 * drawings above earlier ones). Hidden and locked layers are skipped.
 */
export function drawingAt(board: BoardDocument, point: Point, tolerance: number) {
  const drawings = visibleDrawings(board);
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i]!;
    if (!isDrawingPickable(drawing, board.drawingLayers)) continue;
    if (drawingContains(absoluteDrawing(drawing, board.positions), point, tolerance))
      return drawing;
  }
  return null;
}

/** A picked drawing and the other pickable drawings in its group, which select together. */
export function groupOf(board: BoardDocument, drawing: BoardDrawing): string[] {
  if (!drawing.groupId) return [drawing.id];
  return visibleDrawings(board)
    .filter(
      (item) => item.groupId === drawing.groupId && isDrawingPickable(item, board.drawingLayers),
    )
    .map((item) => item.id);
}

/** The axis-aligned box around an absolute drawing as painted, without stroke padding. */
export function drawingBox(drawing: BoardDrawing) {
  const points = drawingOutlinePoints(drawing);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Pickable drawings whose outline overlaps a dragged selection rectangle. */
export function drawingsInBox(board: BoardDocument, from: Point, to: Point): BoardDrawing[] {
  const area = boxBetween(from, to);
  return visibleDrawings(board).filter((drawing) => {
    if (!isDrawingPickable(drawing, board.drawingLayers)) return false;
    const box = drawingBox(absoluteDrawing(drawing, board.positions));
    return (
      box.x <= area.x + area.width &&
      box.x + box.width >= area.x &&
      box.y <= area.y + area.height &&
      box.y + box.height >= area.y
    );
  });
}

/**
 * Handles: both ends of a line, arrow or dimension; the eight compass points around a box,
 * ellipse or freehand stroke; the four corners of a text, which size its letters. Every shape
 * but a straight line also has a rotation handle above its top edge.
 */
export type ResizeHandle =
  'start' | 'end' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
const COMPASS: Exclude<ResizeHandle, 'start' | 'end' | 'rotate'>[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/** The unrotated frame a drawing is resized and rotated in, with its rotation. */
function frameOf(drawing: BoardDrawing) {
  if (pointBased(drawing)) {
    const box = drawingBox(drawing);
    return {
      ...box,
      centre: [box.x + box.width / 2, box.y + box.height / 2] as [number, number],
      rotation: 0,
    };
  }
  return { ...drawingFrame(drawing), rotation: drawing.rotation ?? 0 };
}

function compassPoint(
  frame: { x: number; y: number; width: number; height: number },
  handle: string,
): [number, number] {
  const x = handle.includes('w')
    ? frame.x
    : handle.includes('e')
      ? frame.x + frame.width
      : frame.x + frame.width / 2;
  const y = handle.includes('n')
    ? frame.y
    : handle.includes('s')
      ? frame.y + frame.height
      : frame.y + frame.height / 2;
  return [x, y];
}

/** The handle opposite another, which stays put while that one is dragged. */
const OPPOSITE: Record<string, string> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
};

/** `rotateOffset` is how far above the top edge the rotation handle sits, in canvas units. */
export function resizeHandles(
  drawing: BoardDrawing,
  rotateOffset = 24,
): { handle: ResizeHandle; at: Point }[] {
  if (twoEnded(drawing))
    return [
      { handle: 'start', at: drawing.points![0]! },
      { handle: 'end', at: drawing.points![1]! },
    ];
  const frame = frameOf(drawing);
  const turn = (at: [number, number]) =>
    frame.rotation ? rotatePoint(at, frame.centre, frame.rotation) : at;
  const handles = (drawing.shape === 'text' ? ['nw', 'ne', 'se', 'sw'] : COMPASS).map((handle) => ({
    handle: handle as ResizeHandle,
    at: turn(compassPoint(frame, handle)),
  }));
  return [
    ...handles,
    { handle: 'rotate', at: turn([frame.x + frame.width / 2, frame.y - rotateOffset]) },
  ];
}

/** The handle of an absolute drawing under a canvas point, if any. */
export function handleAt(
  drawing: BoardDrawing,
  point: Point,
  tolerance: number,
  rotateOffset = 24,
) {
  return (
    resizeHandles(drawing, rotateOffset).find(
      ({ at }) => Math.hypot(point[0] - at[0], point[1] - at[1]) <= tolerance,
    )?.handle ?? null
  );
}

/**
 * The absolute drawing after dragging one of its handles to `point`. A rotated shape is resized
 * in its own frame, keeping the opposite handle where it was. Dragging past the opposite side
 * flips the shape; `keepRatio` (Shift) keeps a corner drag in proportion. Freehand strokes scale
 * every sample within their outline, and a text's corners change its font size.
 */
export function resizeDrawing(
  drawing: BoardDrawing,
  handle: Exclude<ResizeHandle, 'rotate'>,
  point: Point,
  keepRatio = false,
): BoardDrawing {
  if (handle === 'start' || handle === 'end') {
    const [start, end] = drawing.points as [[number, number], [number, number]];
    const moved: [number, number] = [round(point[0]), round(point[1])];
    return { ...drawing, points: handle === 'start' ? [moved, end] : [start, moved] };
  }
  const frame = frameOf(drawing);
  const local = frame.rotation ? rotatePoint(point, frame.centre, -frame.rotation) : point;
  const fixed = compassPoint(frame, OPPOSITE[handle]!);
  if (drawing.shape === 'text') {
    // Letters scale with the distance from the fixed corner.
    const scale = Math.max(
      Math.abs(local[0] - fixed[0]) / Math.max(frame.width, 1),
      Math.abs(local[1] - fixed[1]) / Math.max(frame.height, 1),
    );
    const fontSize = Math.min(96, Math.max(8, Math.round((drawing.fontSize ?? 16) * scale)));
    const size = drawingTextSize({ ...drawing, fontSize });
    const left = handle.includes('w') ? fixed[0] - size.width : fixed[0];
    const top = handle.includes('n') ? fixed[1] - size.height : fixed[1];
    return placeInFrame(drawing, frame, { x: left, y: top, ...size }, { fontSize });
  }
  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.width;
  let bottom = frame.y + frame.height;
  if (handle.includes('w')) left = local[0];
  if (handle.includes('e')) right = local[0];
  if (handle.includes('n')) top = local[1];
  if (handle.includes('s')) bottom = local[1];
  if (keepRatio && handle.length === 2 && frame.width > 0 && frame.height > 0) {
    const scale = Math.max(
      Math.abs(right - left) / frame.width,
      Math.abs(bottom - top) / frame.height,
    );
    const width = frame.width * scale * Math.sign(right - left || 1);
    const height = frame.height * scale * Math.sign(bottom - top || 1);
    if (handle.includes('w')) left = right - width;
    else right = left + width;
    if (handle.includes('n')) top = bottom - height;
    else bottom = top + height;
  }
  if (pointBased(drawing)) {
    // Each point keeps its relative place; a flipped drag mirrors the shape.
    const mapX = (x: number) =>
      frame.width ? left + ((x - frame.x) / frame.width) * (right - left) : left;
    const mapY = (y: number) =>
      frame.height ? top + ((y - frame.y) / frame.height) * (bottom - top) : top;
    return mapDrawingPoints(drawing, ([x, y]) => [round(mapX(x)), round(mapY(y))]);
  }
  return placeInFrame(drawing, frame, boxBetween([left, top], [right, bottom]));
}

/**
 * Stores a box resized within a rotated frame: its centre is turned about the old centre, so
 * every point that stayed put in the frame stays put on the canvas.
 */
function placeInFrame(
  drawing: BoardDrawing,
  frame: ReturnType<typeof frameOf>,
  box: { x: number; y: number; width: number; height: number },
  extra: Partial<BoardDrawing> = {},
): BoardDrawing {
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  const [cx, cy] = frame.rotation ? rotatePoint(centre, frame.centre, frame.rotation) : centre;
  return {
    ...drawing,
    ...extra,
    x: round(cx - box.width / 2),
    y: round(cy - box.height / 2),
    ...(drawing.shape === 'text' ? {} : { width: round(box.width), height: round(box.height) }),
  };
}

/**
 * Copied drawings travel as JSON text, so they paste into another board or another tab, and
 * read as plain data anywhere else. Coordinates are absolute; anchors are kept so a paste on
 * the same board can keep following the same concepts.
 */
export const DRAWING_CLIPBOARD_KIND = 'opsis-drawings';

export function drawingClipboard(board: BoardDocument, ids: readonly string[]): string {
  const drawings = (board.drawings ?? [])
    .filter((drawing) => ids.includes(drawing.id))
    .map((drawing) => ({
      ...absoluteDrawing(drawing, board.positions),
      ...(drawing.anchorId ? { anchorId: drawing.anchorId } : {}),
      ...(drawing.layerId ? { layerId: drawing.layerId } : {}),
    }));
  return JSON.stringify({ kind: DRAWING_CLIPBOARD_KIND, version: 1, drawings });
}

/**
 * The valid drawings in copied text, or null when the text is not a drawing copy. Pasted text
 * may come from anywhere, so each drawing is validated like saved board data.
 */
export function readDrawingClipboard(text: string): BoardDrawing[] | null {
  let parsed: { kind?: unknown; drawings?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed?.kind !== DRAWING_CLIPBOARD_KIND || !Array.isArray(parsed.drawings)) return null;
  return parsed.drawings.slice(0, MAX_BOARD_DRAWINGS).flatMap((item) => {
    const drawing = BoardDrawingSchema.safeParse(item);
    return drawing.success ? [drawing.data] : [];
  });
}

/**
 * Adds copies of absolute drawings, offset by `offset`, with new IDs. A copy keeps following
 * its concept and stays on its layer when this board has them; otherwise it is fixed to the
 * canvas on the base layer. Copies are never locked. Returns null when they would not fit.
 */
export function pasteDrawings(
  board: BoardDocument,
  copied: readonly BoardDrawing[],
  offset: number,
  makeId: () => string,
): { board: BoardDocument; ids: string[] } | null {
  const existing = board.drawings ?? [];
  if (!copied.length || existing.length + copied.length > MAX_BOARD_DRAWINGS) return null;
  const pasted = copied.map((drawing) => {
    const copy: BoardDrawing = {
      ...translateDrawing(drawing, offset, offset),
      id: makeId(),
    };
    delete copy.anchorId;
    delete copy.locked;
    if (!layerOf(copy, board.drawingLayers)) delete copy.layerId;
    const anchored =
      drawing.anchorId && board.positions[drawing.anchorId]
        ? anchorDrawing(copy, drawing.anchorId, board.positions)
        : copy;
    return roundDrawing(anchored);
  });
  return {
    board: { ...board, drawings: [...existing, ...pasted] },
    ids: pasted.map((drawing) => drawing.id),
  };
}

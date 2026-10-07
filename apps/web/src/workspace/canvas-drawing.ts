import {
  absoluteDrawing,
  anchorDrawing,
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
  type DrawingLineStyle,
} from '@opsis/schema';

/**
 * Pure geometry for the reader's canvas drawings, shared by the live canvas, hit-testing and
 * SVG/PNG export. Every function takes canvas coordinates (an anchored drawing is first made
 * absolute with `absoluteDrawing`).
 */

export type Point = readonly [number, number];

export const LINE_DASHES: Record<DrawingLineStyle, string | undefined> = {
  solid: undefined,
  dashed: '10 7',
  center: '18 5 3 5',
};

/** A smooth path through freehand samples, using midpoints as quadratic curve ends. */
export function strokePath(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  if (rest.length < 2)
    return `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}`;
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const [x, y] = rest[i]!;
    const [nx, ny] = rest[i + 1]!;
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = rest[rest.length - 1]!;
  return `${d}L${last[0]} ${last[1]}`;
}

/** A filled arrowhead whose tip is `tip`, pointing away from `from`. */
export function arrowHead(from: Point, tip: Point, size: number): string {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (offset: number) =>
    `${tip[0] - size * Math.cos(angle + offset)} ${tip[1] - size * Math.sin(angle + offset)}`;
  return `M${tip[0]} ${tip[1]}L${wing(0.42)}L${wing(-0.42)}Z`;
}

/**
 * A dimension line: extension ticks at both ends, arrowheads pointing outwards to them, and
 * where its label sits (rotated to read left to right along the line).
 */
export function dimensionGeometry([start, end]: readonly [Point, Point], strokeWidth: number) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
  const nx = -(end[1] - start[1]) / length;
  const ny = (end[0] - start[0]) / length;
  const tick = 9;
  const ticks = [start, end]
    .map(([x, y]) => `M${x + nx * tick} ${y + ny * tick}L${x - nx * tick} ${y - ny * tick}`)
    .join('');
  const head = 7 + strokeWidth * 1.5;
  let angle = (Math.atan2(end[1] - start[1], end[0] - start[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return {
    line: `M${start[0]} ${start[1]}L${end[0]} ${end[1]}`,
    ticks,
    heads: arrowHead(end, start, head) + arrowHead(start, end, head),
    label: {
      x: (start[0] + end[0]) / 2 + nx * 12,
      y: (start[1] + end[1]) / 2 + ny * 12,
      angle,
    },
  };
}

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
  return {
    ...drawing,
    ...(drawing.points
      ? { points: drawing.points.map(([x, y]) => [round(x), round(y)] as [number, number]) }
      : {}),
    ...(drawing.x !== undefined ? { x: round(drawing.x) } : {}),
    ...(drawing.y !== undefined ? { y: round(drawing.y) } : {}),
  };
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
  const reach = tolerance + drawing.strokeWidth / 2;
  if (drawing.points) {
    for (let i = 1; i < drawing.points.length; i++)
      if (segmentDistance(point, drawing.points[i - 1]!, drawing.points[i]!) <= reach) return true;
    return false;
  }
  const x = drawing.x!;
  const y = drawing.y!;
  if (drawing.shape === 'text') {
    const size = drawingTextSize(drawing);
    return (
      point[0] >= x - reach &&
      point[0] <= x + size.width + reach &&
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

/** The outline of an absolute drawing's own geometry, without stroke padding. */
export function drawingBox(drawing: BoardDrawing) {
  if (drawing.points) {
    const xs = drawing.points.map(([x]) => x);
    const ys = drawing.points.map(([, y]) => y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  const size =
    drawing.shape === 'text'
      ? drawingTextSize(drawing)
      : { width: drawing.width!, height: drawing.height! };
  return { x: drawing.x!, y: drawing.y!, ...size };
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
 * Resize handles: both ends of a line, arrow or dimension; the eight compass points around a
 * box, ellipse or freehand stroke. Text is sized with its font size instead.
 */
export type ResizeHandle = 'start' | 'end' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function resizeHandles(drawing: BoardDrawing): { handle: ResizeHandle; at: Point }[] {
  if (drawing.shape === 'text') return [];
  if (drawing.shape !== 'stroke' && drawing.points)
    return [
      { handle: 'start', at: drawing.points[0]! },
      { handle: 'end', at: drawing.points[1]! },
    ];
  const { x, y, width, height } = drawingBox(drawing);
  const midX = x + width / 2;
  const midY = y + height / 2;
  return [
    { handle: 'nw', at: [x, y] },
    { handle: 'n', at: [midX, y] },
    { handle: 'ne', at: [x + width, y] },
    { handle: 'e', at: [x + width, midY] },
    { handle: 'se', at: [x + width, y + height] },
    { handle: 's', at: [midX, y + height] },
    { handle: 'sw', at: [x, y + height] },
    { handle: 'w', at: [x, midY] },
  ];
}

/** The resize handle of an absolute drawing under a canvas point, if any. */
export function handleAt(drawing: BoardDrawing, point: Point, tolerance: number) {
  return (
    resizeHandles(drawing).find(
      ({ at }) => Math.hypot(point[0] - at[0], point[1] - at[1]) <= tolerance,
    )?.handle ?? null
  );
}

/**
 * The absolute drawing after dragging one of its handles to `point`. Dragging past the opposite
 * side flips the shape; `keepRatio` (Shift) keeps a corner drag in proportion. Freehand strokes
 * scale every sample within their outline.
 */
export function resizeDrawing(
  drawing: BoardDrawing,
  handle: ResizeHandle,
  point: Point,
  keepRatio = false,
): BoardDrawing {
  if (handle === 'start' || handle === 'end') {
    const [start, end] = drawing.points as [[number, number], [number, number]];
    const moved: [number, number] = [round(point[0]), round(point[1])];
    return { ...drawing, points: handle === 'start' ? [moved, end] : [start, moved] };
  }
  const box = drawingBox(drawing);
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  if (handle.includes('w')) left = point[0];
  if (handle.includes('e')) right = point[0];
  if (handle.includes('n')) top = point[1];
  if (handle.includes('s')) bottom = point[1];
  if (keepRatio && handle.length === 2 && box.width > 0 && box.height > 0) {
    const scale = Math.max(Math.abs(right - left) / box.width, Math.abs(bottom - top) / box.height);
    const width = box.width * scale * Math.sign(right - left || 1);
    const height = box.height * scale * Math.sign(bottom - top || 1);
    if (handle.includes('w')) left = right - width;
    else right = left + width;
    if (handle.includes('n')) top = bottom - height;
    else bottom = top + height;
  }
  const next = boxBetween([left, top], [right, bottom]);
  if (drawing.shape === 'stroke') {
    // Each sample keeps its relative place; a flipped drag mirrors the stroke.
    const mapX = (x: number) =>
      box.width ? left + ((x - box.x) / box.width) * (right - left) : left;
    const mapY = (y: number) =>
      box.height ? top + ((y - box.y) / box.height) * (bottom - top) : top;
    return {
      ...drawing,
      points: drawing.points!.map(([x, y]) => [round(mapX(x)), round(mapY(y))]),
    };
  }
  return {
    ...drawing,
    x: round(next.x),
    y: round(next.y),
    width: round(next.width),
    height: round(next.height),
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

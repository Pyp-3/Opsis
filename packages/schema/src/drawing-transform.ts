import {
  drawingFrame,
  drawingOutlinePoints,
  drawingTextSize,
  mapDrawingPoints,
  normalizeRotation,
  rotatePoint,
  translateDrawing,
  type BoardDrawing,
} from './board-drawings';
import type { PathPoint } from './drawing-path';

/**
 * Moving, turning, scaling, mirroring and arranging several drawings at once, shared by the
 * canvas and agent tools. Every function takes and returns absolute drawings (canvas
 * coordinates, no anchor); callers convert anchored drawings with `absoluteDrawing` and back
 * with `anchorDrawing`. Coordinates are rounded to tenths, as the canvas saves them.
 */

type Point = readonly [number, number];
const round = (value: number) => Math.round(value * 10) / 10;
const roundPoint = ([x, y]: PathPoint): PathPoint => [round(x), round(y)];

/** Drawings stored as points or a path, which are transformed point by point. */
const pointBased = (drawing: BoardDrawing) => !!drawing.points || drawing.d !== undefined;

/** The axis-aligned box around absolute drawings as painted, without stroke padding. */
export function drawingsBox(drawings: readonly BoardDrawing[]) {
  const points = drawings.flatMap((drawing) => drawingOutlinePoints(drawing));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const boxCentre = (box: { x: number; y: number; width: number; height: number }) =>
  [box.x + box.width / 2, box.y + box.height / 2] as [number, number];

/** The centre a drawing turns about: the middle of its frame, or of its outline. */
export function rotationCentre(drawing: BoardDrawing): [number, number] {
  return pointBased(drawing) ? boxCentre(drawingsBox([drawing])) : drawingFrame(drawing).centre;
}

/** The centre of several drawings' combined outline, so a group turns as one piece. */
export function groupRotationCentre(drawings: readonly BoardDrawing[]): [number, number] {
  return boxCentre(drawingsBox(drawings));
}

/**
 * Places a box, ellipse or text so its frame is centred on `centre` with a new size. Aligned
 * text is anchored at its middle or end, so its stored x is shifted accordingly.
 */
function centredAt(
  drawing: BoardDrawing,
  centre: Point,
  size: { width: number; height: number },
  extra: Partial<BoardDrawing> = {},
): BoardDrawing {
  const next: BoardDrawing = { ...drawing, ...extra };
  const measured = next.shape === 'text' ? drawingTextSize(next) : size;
  const left = centre[0] - measured.width / 2;
  const shift =
    next.shape === 'text' && next.align && next.align !== 'start'
      ? measured.width / (next.align === 'middle' ? 2 : 1)
      : 0;
  next.x = round(left + shift);
  next.y = round(centre[1] - measured.height / 2);
  if (next.shape !== 'text') {
    next.width = round(measured.width);
    next.height = round(measured.height);
  }
  return next;
}

const withRotation = (drawing: BoardDrawing, degrees: number): BoardDrawing => {
  const rotation = normalizeRotation(degrees);
  const next: BoardDrawing = { ...drawing, rotation };
  if (!rotation) delete next.rotation;
  return next;
};

/** The drawing turned by `degrees` clockwise about its own centre. */
export function rotateDrawing(drawing: BoardDrawing, degrees: number): BoardDrawing {
  if (pointBased(drawing)) {
    const centre = rotationCentre(drawing);
    return mapDrawingPoints(drawing, (point) => roundPoint(rotatePoint(point, centre, degrees)));
  }
  return withRotation(drawing, (drawing.rotation ?? 0) + degrees);
}

/**
 * The drawing turned by `degrees` about `centre`. Its own centre travels around that point and
 * it turns by the same angle, so rotating every member of a group keeps their arrangement.
 */
export function rotateDrawingAbout(
  drawing: BoardDrawing,
  degrees: number,
  centre: Point,
): BoardDrawing {
  if (pointBased(drawing))
    return mapDrawingPoints(drawing, (point) => roundPoint(rotatePoint(point, centre, degrees)));
  const own = rotationCentre(drawing);
  const [cx, cy] = rotatePoint(own, centre, degrees);
  return rotateDrawing(translateDrawing(drawing, round(cx - own[0]), round(cy - own[1])), degrees);
}

/**
 * The drawing scaled by `sx`, `sy` about `centre`. Points and paths scale exactly. A box or
 * ellipse scales its width and height (in its own turned frame when rotated); text keeps its
 * proportions and changes its font size (8–96). Negative factors mirror (see `mirrorDrawing`).
 */
export function scaleDrawingAbout(
  drawing: BoardDrawing,
  sx: number,
  sy: number,
  centre: Point,
): BoardDrawing {
  const map = ([x, y]: PathPoint): PathPoint => [
    centre[0] + (x - centre[0]) * sx,
    centre[1] + (y - centre[1]) * sy,
  ];
  if (pointBased(drawing)) return mapDrawingPoints(drawing, (point) => roundPoint(map(point)));
  const frame = drawingFrame(drawing);
  const moved = map(frame.centre);
  if (drawing.shape === 'text') {
    const factor = Math.sqrt(Math.abs(sx * sy));
    const fontSize = Math.min(96, Math.max(8, Math.round((drawing.fontSize ?? 16) * factor)));
    return centredAt(drawing, moved, frame, { fontSize });
  }
  // In a turned frame, the factors apply along the shape's own axes.
  const quarter = Math.abs(Math.round((drawing.rotation ?? 0) / 90)) % 2 === 1;
  const [wx, hy] = quarter ? [sy, sx] : [sx, sy];
  return centredAt(drawing, moved, {
    width: frame.width * Math.abs(wx),
    height: frame.height * Math.abs(hy),
  });
}

/**
 * The drawing mirrored across a vertical line through `centre` (`horizontal`: left becomes right)
 * or a horizontal one (`vertical`: top becomes bottom). Points and paths are reflected; a turned
 * box or ellipse turns the other way; text moves but still reads forwards.
 */
export function mirrorDrawing(
  drawing: BoardDrawing,
  direction: 'horizontal' | 'vertical',
  centre: Point,
): BoardDrawing {
  const map = ([x, y]: PathPoint): PathPoint =>
    direction === 'horizontal' ? [2 * centre[0] - x, y] : [x, 2 * centre[1] - y];
  if (pointBased(drawing)) return mapDrawingPoints(drawing, (point) => roundPoint(map(point)));
  const frame = drawingFrame(drawing);
  const placed = centredAt(drawing, map(frame.centre), frame);
  return drawing.shape === 'text' ? placed : withRotation(placed, -(drawing.rotation ?? 0));
}

export type DrawingAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * Lines drawings up along one edge or centre line of their combined box; each moves as a whole.
 * Groups (see `groupId`) move together and align as one piece.
 */
export function alignDrawings(
  drawings: readonly BoardDrawing[],
  alignment: DrawingAlignment,
): BoardDrawing[] {
  const all = drawingsBox(drawings);
  return mapPieces(drawings, (piece) => {
    const box = drawingsBox(piece);
    const dx =
      alignment === 'left'
        ? all.x - box.x
        : alignment === 'right'
          ? all.x + all.width - (box.x + box.width)
          : alignment === 'center'
            ? all.x + all.width / 2 - (box.x + box.width / 2)
            : 0;
    const dy =
      alignment === 'top'
        ? all.y - box.y
        : alignment === 'bottom'
          ? all.y + all.height - (box.y + box.height)
          : alignment === 'middle'
            ? all.y + all.height / 2 - (box.y + box.height / 2)
            : 0;
    return [round(dx), round(dy)];
  });
}

/**
 * Spaces three or more drawings (or groups) evenly between the first and last along an axis,
 * with equal gaps between their boxes.
 */
export function distributeDrawings(
  drawings: readonly BoardDrawing[],
  axis: 'horizontal' | 'vertical',
): BoardDrawing[] {
  const pieces = piecesOf(drawings).map((piece) => ({ piece, box: drawingsBox(piece) }));
  if (pieces.length < 3) return [...drawings];
  const start = (box: ReturnType<typeof drawingsBox>) => (axis === 'horizontal' ? box.x : box.y);
  const length = (box: ReturnType<typeof drawingsBox>) =>
    axis === 'horizontal' ? box.width : box.height;
  pieces.sort((a, b) => start(a.box) - start(b.box));
  const first = pieces[0]!.box;
  const last = pieces[pieces.length - 1]!.box;
  const span = start(last) + length(last) - start(first);
  const gap = (span - pieces.reduce((sum, { box }) => sum + length(box), 0)) / (pieces.length - 1);
  // Pieces are keyed by their first drawing: `mapPieces` splits the drawings again.
  const offsets = new Map<string, number>();
  let cursor = start(first);
  for (const { piece, box } of pieces) {
    offsets.set(piece[0]!.id, round(cursor - start(box)));
    cursor += length(box) + gap;
  }
  return mapPieces(drawings, (piece) => {
    const offset = offsets.get(piece[0]!.id) ?? 0;
    return axis === 'horizontal' ? [offset, 0] : [0, offset];
  });
}

/** Drawings split into groups (shared `groupId`) and single drawings, in first-seen order. */
function piecesOf(drawings: readonly BoardDrawing[]): BoardDrawing[][] {
  const pieces: BoardDrawing[][] = [];
  const groups = new Map<string, BoardDrawing[]>();
  for (const drawing of drawings) {
    if (!drawing.groupId) {
      pieces.push([drawing]);
      continue;
    }
    let piece = groups.get(drawing.groupId);
    if (!piece) {
      piece = [];
      groups.set(drawing.groupId, piece);
      pieces.push(piece);
    }
    piece.push(drawing);
  }
  return pieces;
}

function mapPieces(
  drawings: readonly BoardDrawing[],
  offsetOf: (piece: BoardDrawing[]) => [number, number],
): BoardDrawing[] {
  const moved = new Map<BoardDrawing, BoardDrawing>();
  for (const piece of piecesOf(drawings)) {
    const [dx, dy] = offsetOf(piece);
    for (const drawing of piece)
      moved.set(drawing, dx || dy ? translateDrawing(drawing, dx, dy) : drawing);
  }
  return drawings.map((drawing) => moved.get(drawing)!);
}

/**
 * `count` copies of the drawings, each `step` further on than the last (an array of columns,
 * treads or fence posts). `idFor` names each copy; groups are copied as new groups.
 */
export function repeatDrawings(
  drawings: readonly BoardDrawing[],
  count: number,
  step: Point,
  idFor: (drawing: BoardDrawing, copy: number) => string,
  groupFor: (groupId: string, copy: number) => string,
): BoardDrawing[] {
  const copies: BoardDrawing[] = [];
  for (let copy = 1; copy <= count; copy++)
    for (const drawing of drawings) {
      const moved = translateDrawing(drawing, round(step[0] * copy), round(step[1] * copy));
      copies.push({
        ...moved,
        id: idFor(drawing, copy),
        ...(drawing.groupId ? { groupId: groupFor(drawing.groupId, copy) } : {}),
      });
    }
  return copies;
}

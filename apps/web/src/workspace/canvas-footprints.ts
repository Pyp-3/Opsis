import {
  absoluteDrawing,
  dimensionGeometry,
  dimensionLabel,
  drawingBounds,
  drawingFrame,
  rotatePoint,
  visibleDrawings,
  type BoardDocument,
  type BoardDrawing,
} from '@opsis/schema';
import { NODE_WIDTH, nodeHeight } from './geometry';

export type CanvasRect = { x: number; y: number; width: number; height: number };
export type DrawingFootprint = CanvasRect & { drawing: BoardDrawing; container: boolean };

export function overlaps(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function contains(outer: CanvasRect, inner: CanvasRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

export function nodeFootprint(
  node: BoardDocument['nodes'][number],
  at: { x: number; y: number },
): CanvasRect {
  return { ...at, width: NODE_WIDTH, height: nodeHeight(node) };
}

/** Use the SVG's font, not the UI theme's font. Tests/non-browser hosts retain the shared estimate. */
let measurementContext: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number, bold = false): number {
  if (typeof CanvasRenderingContext2D === 'undefined')
    return text.length * size * (bold ? 0.64 : 0.6);
  const context = (measurementContext ??= document.createElement('canvas').getContext('2d'));
  if (!context) return text.length * size * (bold ? 0.64 : 0.6);
  context.font = `${bold ? 700 : 400} ${size}px Inter, Arial, sans-serif`;
  return context.measureText(text).width;
}

/** Painted text, including alignment, rotation, halo and an optional backdrop. */
function textFootprint(drawing: BoardDrawing): CanvasRect {
  const frame = drawingFrame(drawing);
  const width = Math.max(
    ...drawing
      .text!.split('\n')
      .map((line) => textWidth(line, drawing.fontSize ?? 16, drawing.bold)),
  );
  const shift = drawing.align === 'middle' ? width / 2 : drawing.align === 'end' ? width : 0;
  const x = drawing.x! - shift;
  const y = drawing.y!;
  const corners: [number, number][] = [
    [x, y],
    [x + width, y],
    [x, y + frame.height],
    [x + width, y + frame.height],
  ];
  // SVG rotates about the shared frame centre, even when the real font width differs.
  if (drawing.background)
    corners.push(
      [frame.x - 6, frame.y - 3],
      [frame.x + frame.width + 6, frame.y - 3],
      [frame.x - 6, frame.y + frame.height + 3],
      [frame.x + frame.width + 6, frame.y + frame.height + 3],
    );
  const turned = corners.map((point) => rotatePoint(point, frame.centre, drawing.rotation ?? 0));
  return pointsFootprint(turned, 6);
}

function pointsFootprint(points: readonly [number, number][], pad: number): CanvasRect {
  const x = Math.min(...points.map(([x]) => x)) - pad;
  const y = Math.min(...points.map(([, y]) => y)) - pad;
  return {
    x,
    y,
    width: Math.max(...points.map(([x]) => x)) + pad - x,
    height: Math.max(...points.map(([, y]) => y)) + pad - y,
  };
}

/** Visible block interiors and words are obstacles; freehand/connector strokes are not solid walls. */
export function drawingFootprints(
  board: Pick<BoardDocument, 'drawings' | 'drawingLayers' | 'drawingScale' | 'positions'>,
): DrawingFootprint[] {
  return visibleDrawings(board).flatMap((drawing): DrawingFootprint[] => {
    const absolute = absoluteDrawing(drawing, board.positions);
    if (absolute.shape === 'text')
      return [{ ...textFootprint(absolute), drawing, container: false }];
    if (absolute.shape === 'dimension') {
      const { x, y, angle } = dimensionGeometry(
        absolute.points as [[number, number], [number, number]],
        absolute.strokeWidth,
      ).label;
      const width = textWidth(dimensionLabel(absolute, board.drawingScale), 12);
      const corners: [number, number][] = [
        [x - width / 2, y - 8],
        [x + width / 2, y - 8],
        [x - width / 2, y + 8],
        [x + width / 2, y + 8],
      ];
      return [
        {
          ...pointsFootprint(
            corners.map((point) => rotatePoint(point, [x, y], angle)),
            6,
          ),
          drawing,
          container: false,
        },
      ];
    }
    if (
      !['rect', 'ellipse', 'polygon'].includes(absolute.shape) &&
      !absolute.fill &&
      !absolute.fillInk &&
      !absolute.hatch
    )
      return [];
    const bounds = drawingBounds(drawing, board.positions);
    return [
      {
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        drawing,
        container: true,
      },
    ];
  });
}

/** A frame intentionally containing a concept is not an obstacle to that concept's connections. */
export function blocksNode(drawing: DrawingFootprint, node: CanvasRect): boolean {
  return !drawing.container || !contains(drawing, node);
}

/** A concept and the visible annotations that move with it occupy one placement footprint. */
export function nodeClusterFootprint(
  node: BoardDocument['nodes'][number],
  at: { x: number; y: number },
  drawings: readonly BoardDrawing[],
  scale?: BoardDocument['drawingScale'],
): CanvasRect {
  const own = nodeFootprint(node, at);
  const attached = drawingFootprints({
    positions: { [node.id]: at },
    drawings: drawings.filter((drawing) => drawing.anchorId === node.id),
    ...(scale ? { drawingScale: scale } : {}),
  });
  const x = Math.min(own.x, ...attached.map((item) => item.x));
  const y = Math.min(own.y, ...attached.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(own.x + own.width, ...attached.map((item) => item.x + item.width)) - x,
    height: Math.max(own.y + own.height, ...attached.map((item) => item.y + item.height)) - y,
  };
}

/** All painted drawings, including open strokes, plus any supplied visible concept/group boxes. */
export function canvasContentBounds(
  board: BoardDocument,
  nodes: readonly CanvasRect[],
): CanvasRect | null {
  const drawingBoxes = visibleDrawings(board).map((drawing) => {
    const bounds = drawingBounds(drawing, board.positions);
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    };
  });
  const boxes = [...nodes, ...drawingBoxes, ...drawingFootprints(board)];
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

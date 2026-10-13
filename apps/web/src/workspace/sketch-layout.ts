import {
  AGENT_SKETCH_LAYER,
  drawingBounds,
  isDrawingEditable,
  translateDrawing,
  visibleDrawings,
  type BoardDocument,
  type BoardDrawing,
} from '@opsis/schema';
import {
  blocksNode,
  contains,
  drawingFootprints,
  nodeFootprint,
  overlaps,
  type CanvasRect,
} from './canvas-footprints';

const CLEARANCE = 24;

/**
 * Resolve collisions by translating complete sketch pieces, never their individual labels or
 * strokes. All free-standing drawings form one piece (including connecting arrows); groups
 * and shared anchors join pieces, preserving containment and relative geometry.
 */
export function settleAgentSketch(board: BoardDocument): BoardDocument {
  const visible = visibleDrawings(board);
  const sketch = visible.filter((drawing) => drawing.layerId === AGENT_SKETCH_LAYER.id);
  if (!sketch.length) return board;
  const pieces: BoardDrawing[][] = [];
  for (const drawing of sketch) {
    const related = (piece: BoardDrawing[]) =>
      piece.some(
        (other) =>
          (!drawing.anchorId && !other.anchorId) ||
          (drawing.anchorId && drawing.anchorId === other.anchorId) ||
          (drawing.groupId && drawing.groupId === other.groupId),
      );
    const joined = pieces.filter(related);
    const piece = [drawing, ...joined.flat()];
    for (const match of joined) pieces.splice(pieces.indexOf(match), 1);
    pieces.push(piece);
  }
  const nodes = board.nodes.map((node) => nodeFootprint(node, board.positions[node.id]!));
  let drawings = board.drawings!;
  for (const piece of pieces) {
    if (piece.some((drawing) => !isDrawingEditable(drawing, board.drawingLayers))) continue;
    const ids = new Set(piece.map((drawing) => drawing.id));
    const footprints = drawingFootprints({ ...board, drawings: piece });
    const others = drawingFootprints({ ...board, drawings }).filter(
      (footprint) => !ids.has(footprint.drawing.id),
    );
    const collides = (dx: number, dy: number) =>
      footprints.some((footprint) => {
        const moved = { ...footprint, x: footprint.x + dx, y: footprint.y + dy };
        return (
          nodes.some((node) => blocksNode(moved, node) && overlaps(moved, node)) ||
          others.some(
            (other) =>
              overlaps(moved, other) &&
              !(other.container && contains(other, moved)) &&
              !(moved.container && contains(moved, other)),
          )
        );
      });
    if (!collides(0, 0)) continue;
    const bounds = piece.map((drawing) => drawingBounds(drawing, board.positions));
    const x = Math.min(...bounds.map((bound) => bound.minX), ...footprints.map((item) => item.x));
    const y = Math.min(...bounds.map((bound) => bound.minY), ...footprints.map((item) => item.y));
    const width =
      Math.max(
        ...bounds.map((bound) => bound.maxX),
        ...footprints.map((item) => item.x + item.width),
      ) - x;
    const height =
      Math.max(
        ...bounds.map((bound) => bound.maxY),
        ...footprints.map((item) => item.y + item.height),
      ) - y;
    const occupied: CanvasRect[] = [...nodes, ...others];
    // Prefer a nearby translation; a guaranteed outer-margin candidate bounds the search.
    const candidates = occupied
      .flatMap((obstacle) => [
        { dx: obstacle.x + obstacle.width + CLEARANCE - x, dy: 0 },
        { dx: obstacle.x - CLEARANCE - x - width, dy: 0 },
        { dx: 0, dy: obstacle.y + obstacle.height + CLEARANCE - y },
        { dx: 0, dy: obstacle.y - CLEARANCE - y - height },
      ])
      .sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - Math.abs(b.dx) - Math.abs(b.dy));
    candidates.push({
      dx: Math.max(...occupied.map((item) => item.x + item.width)) + CLEARANCE - x,
      dy: 0,
    });
    const offset = candidates.find(({ dx, dy }) => !collides(dx, dy));
    if (!offset) continue;
    drawings = drawings.map((drawing) =>
      ids.has(drawing.id) ? translateDrawing(drawing, offset.dx, offset.dy) : drawing,
    );
  }
  return drawings === board.drawings ? board : { ...board, drawings };
}

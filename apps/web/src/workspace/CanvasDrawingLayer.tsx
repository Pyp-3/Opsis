import { useMemo } from 'react';
import { useViewport, ViewportPortal } from '@xyflow/react';
import {
  absoluteDrawing,
  drawingFrame,
  isDrawingEditable,
  rotationCentre,
  visibleDrawings,
  type AgentDrawing,
  type BoardDocument,
  type BoardDrawing,
} from '@opsis/schema';
import { DrawingShape } from './DrawingShape';
import {
  boxBetween,
  drawingBox,
  resizeHandles,
  ROTATION_HANDLE_OFFSET,
  selectionRotationHandle,
  type Point,
} from './canvas-drawing';
import { lookOf, paletteOf } from './canvas-theme';

/**
 * The drawings, rendered as children of React Flow so they follow its pan and zoom. Lines and
 * shapes are painted between the grid and the diagram, so icons and arrows stay on top; words,
 * the selection outlines, resize handles and the shape being drawn are painted above it.
 * Hidden layers are not drawn.
 */
export function DrawingLayer({
  drawing,
  provisional,
}: {
  drawing: {
    board: BoardDocument | null;
    selection: readonly BoardDrawing[];
    selected: BoardDrawing | null;
    marquee: { from: Point; to: Point } | null;
    active: boolean;
    draft: BoardDrawing | null;
    rotationHandle?: Point | null;
  };
  /**
   * An agent's sketch drawings as they stream in, painted faintly above the board until the
   * answer is validated and reviewed. Ones attached to a concept not yet on the canvas wait.
   */
  provisional?: readonly AgentDrawing[] | undefined;
}) {
  const { x, y, zoom } = useViewport();
  const { board, selection, selected, marquee } = drawing;
  // A shape half-drawn when the board became read-only is dropped.
  const draft = drawing.active ? drawing.draft : null;
  const halo = paletteOf(lookOf(board)).deep;
  const scale = board?.drawingScale;
  const drawings = useMemo(
    () =>
      (board ? visibleDrawings(board) : []).map((item) => absoluteDrawing(item, board!.positions)),
    [board],
  );
  const streaming = useMemo(
    () =>
      (provisional ?? []).flatMap((item) =>
        item.anchorId && !board?.positions[item.anchorId]
          ? []
          : [absoluteDrawing(item as BoardDrawing, board?.positions ?? {})],
      ),
    [provisional, board],
  );
  if (!drawings.length && !streaming.length && !draft && !marquee) return null;
  const outlines = board ? selection.map((item) => absoluteDrawing(item, board.positions)) : [];
  const resizable =
    board && selected && drawing.active && isDrawingEditable(selected, board.drawingLayers)
      ? absoluteDrawing(selected, board.positions)
      : null;
  const rotation =
    board && drawing.active
      ? selectionRotationHandle(
          board,
          selection.map((item) => item.id),
          zoom,
        )
      : null;
  const rotationHandle = rotation ? (drawing.rotationHandle ?? rotation.at) : null;
  const area = marquee ? boxBetween(marquee.from, marquee.to) : null;
  return (
    <>
      <svg className="drawing-layer" aria-hidden="true">
        <g transform={`translate(${x} ${y}) scale(${zoom})`}>
          {drawings.map((item) => (
            <g key={item.id} data-drawing={item.id} data-shape={item.shape}>
              <DrawingShape drawing={item} halo={halo} part="shape" scale={scale} />
            </g>
          ))}
          {streaming.length > 0 && (
            <g className="drawing-provisional" opacity={0.55}>
              {streaming.map((item) => (
                <g key={item.id} data-provisional-drawing={item.id}>
                  <DrawingShape drawing={item} halo={halo} scale={scale} />
                </g>
              ))}
            </g>
          )}
        </g>
      </svg>
      <ViewportPortal>
        <svg className="drawing-labels" aria-hidden="true">
          {drawings.map((item) => (
            <g key={item.id} data-drawing-label={item.id} data-shape={item.shape}>
              <DrawingShape drawing={item} halo={halo} part="label" scale={scale} />
            </g>
          ))}
          {outlines.map((item) => (
            <SelectionOutline key={item.id} drawing={item} zoom={zoom} />
          ))}
          {rotationHandle && (
            <circle
              className="drawing-handle"
              data-handle="rotate-selection"
              cx={rotationHandle[0]}
              cy={rotationHandle[1]}
              r={5 / zoom}
              fill={halo}
              stroke="#ffffff"
              strokeWidth={1.5 / zoom}
            />
          )}
          {resizable &&
            resizeHandles(resizable, ROTATION_HANDLE_OFFSET / zoom).map(({ handle, at }) =>
              handle === 'rotate' ? (
                <g key={handle} className="drawing-handle" data-handle={handle}>
                  <circle
                    cx={at[0]}
                    cy={at[1]}
                    r={5 / zoom}
                    fill={halo}
                    stroke="#ffffff"
                    strokeWidth={1.5 / zoom}
                  />
                </g>
              ) : (
                <rect
                  key={handle}
                  className="drawing-handle"
                  data-handle={handle}
                  x={at[0] - 4 / zoom}
                  y={at[1] - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill="#ffffff"
                  stroke={halo}
                  strokeWidth={1.5 / zoom}
                />
              ),
            )}
          {area && (
            <rect
              className="drawing-marquee"
              x={area.x}
              y={area.y}
              width={area.width}
              height={area.height}
              fill="#ffffff"
              fillOpacity={0.06}
              stroke="#ffffff"
              strokeWidth={1 / zoom}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            />
          )}
          {draft && (
            <g className="drawing-draft">
              <DrawingShape drawing={draft} halo={halo} scale={scale} />
            </g>
          )}
        </svg>
      </ViewportPortal>
    </>
  );
}

function SelectionOutline({ drawing, zoom }: { drawing: BoardDrawing; zoom: number }) {
  // A rotated box, ellipse or text is outlined in its own frame, turned with it.
  const box = drawing.points ? drawingBox(drawing) : drawingFrame(drawing);
  const centre = rotationCentre(drawing);
  const pad = 6 + drawing.strokeWidth;
  return (
    <rect
      className="drawing-selection"
      data-locked={drawing.locked ? 'true' : undefined}
      transform={
        drawing.rotation ? `rotate(${drawing.rotation} ${centre[0]} ${centre[1]})` : undefined
      }
      x={box.x - pad}
      y={box.y - pad}
      width={box.width + pad * 2}
      height={box.height + pad * 2}
      fill="none"
      stroke="#ffffff"
      strokeWidth={1 / zoom}
      strokeDasharray={drawing.locked ? undefined : `${4 / zoom} ${4 / zoom}`}
    />
  );
}

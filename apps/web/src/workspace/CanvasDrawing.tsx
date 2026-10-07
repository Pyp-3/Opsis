import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useReactFlow, useViewport, ViewportPortal } from '@xyflow/react';
import {
  Circle,
  Eraser,
  MousePointer2,
  MoveUpRight,
  PenTool,
  Pencil,
  Ruler,
  Slash,
  Square,
  SquareDashedMousePointer,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  absoluteDrawing,
  anchorDrawing,
  translateDrawing,
  ILLUSTRATION_INKS,
  MAX_BOARD_DRAWINGS,
  type BoardDocument,
  type BoardDrawing,
  type DrawingLineStyle,
  type DrawingShape as DrawingKind,
  type IllustrationInk,
} from '@opsis/schema';
import { DrawingShape } from './DrawingShape';
import { INK_VALUES } from './Illustration';
import {
  boxBetween,
  drawingAt,
  round,
  roundDrawing,
  simplifyStroke,
  type Point,
} from './canvas-drawing';
import { lookOf, paletteOf } from './canvas-theme';
import { useRememberedOpen } from './useRememberedOpen';

/**
 * Freehand and illustrative drawing on the canvas, beside the icon diagram. In "diagram" mode
 * the canvas behaves as before (drawings are inert and sit beneath icons and arrows). Any other
 * tool lays a capture surface over the canvas: drawing tools add shapes, "select" picks, moves
 * and edits drawings, and the eraser removes them. Each finished shape, move or erasing sweep
 * is one undoable edit.
 */
export type DrawingTool = 'diagram' | 'select' | 'erase' | DrawingKind;

type DrawingStyle = {
  ink: IllustrationInk;
  line: DrawingLineStyle;
  strokeWidth: number;
  fill: boolean;
};

const TOOLS: { tool: DrawingTool; label: string; key: string; Icon: typeof Pencil }[] = [
  { tool: 'diagram', label: 'Diagram (move concepts)', key: 'Escape', Icon: MousePointer2 },
  { tool: 'select', label: 'Select drawings', key: 'v', Icon: SquareDashedMousePointer },
  { tool: 'stroke', label: 'Pen', key: 'p', Icon: Pencil },
  { tool: 'line', label: 'Line', key: 'l', Icon: Slash },
  { tool: 'arrow', label: 'Arrow', key: 'a', Icon: MoveUpRight },
  { tool: 'rect', label: 'Box', key: 'r', Icon: Square },
  { tool: 'ellipse', label: 'Ellipse', key: 'o', Icon: Circle },
  { tool: 'text', label: 'Text', key: 't', Icon: Type },
  { tool: 'dimension', label: 'Dimension', key: 'd', Icon: Ruler },
  { tool: 'erase', label: 'Eraser', key: 'e', Icon: Eraser },
];
const WEIGHTS = [
  { value: 1, label: 'Fine' },
  { value: 2, label: 'Medium' },
  { value: 4, label: 'Bold' },
];
const LINES: { value: DrawingLineStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'center', label: 'Centre line' },
];
const FONT_SIZES = [12, 16, 24, 36];
/** Straight shapes land on half a grid square, matching concepts that snap to whole squares. */
const SNAP = 12;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

type Gesture =
  | { kind: 'draw'; points: Point[] }
  | { kind: 'move'; id: string; last: Point; moved: boolean }
  | { kind: 'erase' };

export function useCanvasDrawing(options: {
  board: BoardDocument | null;
  boardRef: { current: BoardDocument | null };
  setBoard: (change: (board: BoardDocument | null) => BoardDocument | null) => void;
  commit: (board: BoardDocument | null) => void;
  begin: () => void;
  end: (board?: BoardDocument | null) => void;
  /** Whether the reader may change this board right now. */
  editable: boolean;
  /** Called when a drawing becomes selected, so concept/arrow selection can clear. */
  onSelect: () => void;
}) {
  const { board, boardRef, setBoard, commit, begin, end, editable, onSelect } = options;
  const [chosenTool, setToolState] = useState<DrawingTool>('diagram');
  // Viewing someone else's board, or a generation in flight, puts the pencil down.
  const tool = editable ? chosenTool : 'diagram';
  const [chosenId, setSelectedId] = useState<string | null>(null);
  const [style, setStyle] = useState<DrawingStyle>({
    ink: 'ink',
    line: 'solid',
    strokeWidth: 2,
    fill: false,
  });
  const [draft, setDraft] = useState<BoardDrawing | null>(null);
  const [open, setOpen] = useRememberedOpen('opsis:drawing-tools-open', false);
  // A drawing removed by undo or another edit is no longer selected.
  const selected = board?.drawings?.find((drawing) => drawing.id === chosenId) ?? null;
  const selectedId = selected?.id ?? null;
  const active = editable && tool !== 'diagram';

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) onSelect();
    },
    [onSelect],
  );
  const setTool = useCallback((next: DrawingTool) => {
    setToolState(next);
    setDraft(null);
    if (next !== 'select') setSelectedId(null);
  }, []);
  const changeDrawing = useCallback(
    (id: string, change: (drawing: BoardDrawing) => BoardDrawing | null) => {
      const current = boardRef.current;
      if (!current?.drawings) return;
      const drawings = current.drawings.flatMap((drawing) => {
        if (drawing.id !== id) return [drawing];
        const next = change(drawing);
        return next ? [next] : [];
      });
      commit({ ...current, drawings });
    },
    [boardRef, commit],
  );
  /** Restyles the selected drawing, and draws later shapes in the same style. */
  const restyle = useCallback(
    (patch: Partial<DrawingStyle>) => {
      setStyle((current) => ({ ...current, ...patch }));
      if (selectedId) changeDrawing(selectedId, (drawing) => ({ ...drawing, ...patch }));
    },
    [selectedId, changeDrawing],
  );
  const remove = useCallback(
    (id: string) => {
      changeDrawing(id, () => null);
      setSelectedId(null);
    },
    [changeDrawing],
  );
  const add = useCallback(
    (drawing: BoardDrawing) => {
      const current = boardRef.current;
      if (!current || (current.drawings?.length ?? 0) >= MAX_BOARD_DRAWINGS) return false;
      commit({ ...current, drawings: [...(current.drawings ?? []), drawing] });
      return true;
    },
    [boardRef, commit],
  );

  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        remove(selectedId);
        return;
      }
      if (event.key === 'Escape') {
        if (selectedId) setSelectedId(null);
        else if (tool !== 'diagram') setTool('diagram');
        return;
      }
      // Single-letter shortcuts only while the drawing tools are showing.
      if (!open) return;
      const shortcut = TOOLS.find((item) => item.key === event.key.toLowerCase());
      if (shortcut && shortcut.key !== 'Escape') setTool(shortcut.tool);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable, open, selectedId, tool, remove, setTool]);

  return {
    tool,
    setTool,
    active,
    open,
    setOpen,
    selected,
    select,
    style,
    restyle,
    draft,
    setDraft,
    changeDrawing,
    remove,
    add,
    board,
    boardRef,
    setBoard,
    begin,
    end,
    editable,
  };
}
export type CanvasDrawing = ReturnType<typeof useCanvasDrawing>;

/**
 * The drawings, rendered as children of React Flow so they follow its pan and zoom. Lines and
 * shapes are painted between the grid and the diagram, so icons and arrows stay on top; words,
 * the selection outline and the shape being drawn are painted above the diagram.
 */
export function DrawingLayer({ drawing }: { drawing: CanvasDrawing }) {
  const { x, y, zoom } = useViewport();
  const { board, selected } = drawing;
  // A shape half-drawn when the board became read-only is dropped.
  const draft = drawing.active ? drawing.draft : null;
  const halo = paletteOf(lookOf(board)).deep;
  const drawings = useMemo(
    () => (board?.drawings ?? []).map((item) => absoluteDrawing(item, board!.positions)),
    [board],
  );
  if (!drawings.length && !draft) return null;
  const outline = selected && board ? absoluteDrawing(selected, board.positions) : null;
  return (
    <>
      <svg className="drawing-layer" aria-hidden="true">
        <g transform={`translate(${x} ${y}) scale(${zoom})`}>
          {drawings.map((item) => (
            <g key={item.id} data-drawing={item.id} data-shape={item.shape}>
              <DrawingShape drawing={item} halo={halo} part="shape" />
            </g>
          ))}
        </g>
      </svg>
      <ViewportPortal>
        <svg className="drawing-labels" aria-hidden="true">
          {drawings.map((item) => (
            <g key={item.id} data-drawing-label={item.id} data-shape={item.shape}>
              <DrawingShape drawing={item} halo={halo} part="label" />
            </g>
          ))}
          {outline && <SelectionOutline drawing={outline} zoom={zoom} />}
          {draft && (
            <g className="drawing-draft">
              <DrawingShape drawing={draft} halo={halo} />
            </g>
          )}
        </svg>
      </ViewportPortal>
    </>
  );
}

function SelectionOutline({ drawing, zoom }: { drawing: BoardDrawing; zoom: number }) {
  const xs = drawing.points?.map(([x]) => x) ?? [drawing.x!, drawing.x! + (drawing.width ?? 0)];
  const ys = drawing.points?.map(([, y]) => y) ?? [drawing.y!, drawing.y! + (drawing.height ?? 0)];
  if (drawing.shape === 'text') {
    const size = drawing.fontSize ?? 16;
    const lines = drawing.text!.split('\n');
    xs.push(drawing.x! + Math.max(...lines.map((line) => line.length)) * size * 0.6);
    ys.push(drawing.y! + lines.length * size * 1.25);
  }
  const pad = 6 + drawing.strokeWidth;
  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  return (
    <rect
      className="drawing-selection"
      x={left}
      y={top}
      width={Math.max(...xs) + pad - left}
      height={Math.max(...ys) + pad - top}
      fill="none"
      stroke="#ffffff"
      strokeWidth={1 / zoom}
      strokeDasharray={`${4 / zoom} ${4 / zoom}`}
    />
  );
}

/** Builds the shape a drag from `start` to `end` describes for the current tool. */
function shapeFor(
  tool: DrawingKind,
  points: Point[],
  style: DrawingStyle,
  constrain: boolean,
  free: boolean,
): BoardDrawing | null {
  const base = {
    id: crypto.randomUUID(),
    shape: tool,
    ink: style.ink,
    line: style.line,
    strokeWidth: style.strokeWidth,
  };
  if (tool === 'stroke') {
    const simplified = simplifyStroke(points);
    return simplified.length >= 2 ? { ...base, points: simplified } : null;
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const fix = (value: number) => (free ? round(value) : snap(value));
  const start: [number, number] = [fix(first[0]), fix(first[1])];
  let end: [number, number] = [fix(last[0]), fix(last[1])];
  if (constrain && tool !== 'rect' && tool !== 'ellipse') {
    // Shift: horizontal, vertical or 45°.
    const angle = Math.round(Math.atan2(end[1] - start[1], end[0] - start[0]) / (Math.PI / 4));
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    end = [
      round(start[0] + length * Math.cos((angle * Math.PI) / 4)),
      round(start[1] + length * Math.sin((angle * Math.PI) / 4)),
    ];
  }
  if (tool === 'rect' || tool === 'ellipse') {
    if (constrain) {
      // Shift: a square or circle.
      const side = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
      end = [
        start[0] + Math.sign(end[0] - start[0] || 1) * side,
        start[1] + Math.sign(end[1] - start[1] || 1) * side,
      ];
    }
    const box = boxBetween(start, end);
    return box.width >= 4 || box.height >= 4 ? { ...base, ...box, fill: style.fill } : null;
  }
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 4) return null;
  return { ...base, points: [start, end] };
}

/**
 * The drawing palette, the style/inspector panel and, while a tool is active, the surface that
 * captures pointer input. Placed inside the canvas, after React Flow.
 */
export function DrawingControls({ drawing }: { drawing: CanvasDrawing }) {
  // The zoom is read when needed, so panning does not re-render the controls.
  const flow = useReactFlow();
  const gesture = useRef<Gesture | null>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  // Set when a text is placed, so its field takes focus once the panel shows it.
  const focusText = useRef(false);
  const {
    tool,
    setTool,
    active,
    open,
    setOpen,
    selected,
    select,
    style,
    restyle,
    setDraft,
    changeDrawing,
    remove,
    add,
    board,
    boardRef,
    setBoard,
    begin,
    end,
    editable,
  } = drawing;
  useEffect(() => {
    if (focusText.current && selected) {
      focusText.current = false;
      textInput.current?.focus();
      textInput.current?.select();
    }
  }, [selected]);
  if (!board || !editable) return null;

  const at = (event: ReactPointerEvent): Point => {
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    return [point.x, point.y];
  };
  const tolerance = () => 6 / flow.getZoom();
  const eraseAt = (point: Point) =>
    setBoard((current) => {
      if (!current) return current;
      const hit = drawingAt(current, point, tolerance());
      return hit
        ? { ...current, drawings: current.drawings!.filter((item) => item.id !== hit.id) }
        : current;
    });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // No text selection while dragging, and no focus change that would undo focusing new text.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    const current = boardRef.current;
    if (!current) return;
    if (tool === 'select') {
      const hit = drawingAt(current, point, tolerance());
      select(hit?.id ?? null);
      if (hit) {
        begin();
        gesture.current = { kind: 'move', id: hit.id, last: point, moved: false };
      }
    } else if (tool === 'erase') {
      begin();
      gesture.current = { kind: 'erase' };
      eraseAt(point);
    } else if (tool === 'text') {
      const created: BoardDrawing = {
        id: crypto.randomUUID(),
        shape: 'text',
        x: snap(point[0]),
        y: snap(point[1]),
        text: 'Text',
        fontSize: 16,
        ink: style.ink,
        line: 'solid',
        strokeWidth: style.strokeWidth,
      };
      if (add(created)) {
        setTool('select');
        select(created.id);
        focusText.current = true;
      }
    } else if (tool !== 'diagram') {
      gesture.current = { kind: 'draw', points: [point] };
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    const point = at(event);
    if (current.kind === 'erase') eraseAt(point);
    else if (current.kind === 'move') {
      const dx = point[0] - current.last[0];
      const dy = point[1] - current.last[1];
      current.last = point;
      current.moved = true;
      setBoard((board) =>
        board
          ? {
              ...board,
              drawings: board.drawings?.map((item) =>
                item.id === current.id ? translateDrawing(item, dx, dy) : item,
              ),
            }
          : board,
      );
    } else if (current.kind === 'draw' && tool !== 'diagram' && tool !== 'select') {
      current.points.push(point);
      setDraft(shapeFor(tool as DrawingKind, current.points, style, event.shiftKey, event.altKey));
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    if (current.kind === 'move') {
      // Moves are stored at tenths of a unit, like newly drawn shapes.
      end(
        current.moved && boardRef.current
          ? {
              ...boardRef.current,
              drawings: boardRef.current.drawings?.map((item) =>
                item.id === current.id ? roundDrawing(item) : item,
              ),
            }
          : undefined,
      );
    } else if (current.kind === 'erase') end();
    else if (current.kind === 'draw') {
      setDraft(null);
      const shape = shapeFor(
        tool as DrawingKind,
        [...current.points, at(event)],
        style,
        event.shiftKey,
        event.altKey,
      );
      if (shape) add(shape);
    }
  };

  const concepts = board.nodes;
  const editsText = selected?.shape === 'text' || selected?.shape === 'dimension';
  const filled = selected
    ? selected.shape === 'rect' || selected.shape === 'ellipse'
    : tool === 'rect' || tool === 'ellipse';
  const shown = selected ?? style;
  const showPanel = !!selected || (tool !== 'diagram' && tool !== 'erase' && tool !== 'select');

  return (
    <>
      {active && (
        <div
          className={`drawing-capture is-${tool}`}
          data-testid="drawing-surface"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            if (gesture.current?.kind !== 'draw' && gesture.current) end();
            gesture.current = null;
            setDraft(null);
          }}
        />
      )}
      <div
        className={`drawing-tools ${open ? '' : 'is-collapsed'}`}
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation="vertical"
      >
        {open ? (
          <>
            {TOOLS.map(({ tool: item, label, key, Icon }) => (
              <button
                key={item}
                aria-label={label}
                title={`${label} (${key === 'Escape' ? 'Esc' : key.toUpperCase()})`}
                aria-pressed={tool === item}
                onClick={() => setTool(item)}
              >
                <Icon size={16} />
              </button>
            ))}
            <span />
            <button
              aria-label="Hide drawing tools"
              title="Put the drawing tools away"
              aria-expanded
              onClick={() => {
                setTool('diagram');
                setOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <button
            aria-label="Show drawing tools"
            title="Draw on the canvas: sketches, shapes, text and dimensions"
            aria-expanded={false}
            onClick={() => setOpen(true)}
          >
            <PenTool size={16} />
          </button>
        )}
      </div>
      {open && showPanel && (
        <section
          className="drawing-panel"
          aria-label={selected ? 'Selected drawing' : 'Drawing style'}
        >
          <div className="drawing-inks" role="radiogroup" aria-label="Ink">
            {ILLUSTRATION_INKS.map((ink) => (
              <button
                key={ink}
                role="radio"
                aria-checked={shown.ink === ink}
                aria-label={`${ink} ink`}
                title={ink}
                style={{ background: INK_VALUES[ink] }}
                onClick={() => restyle({ ink })}
              />
            ))}
          </div>
          <div className="drawing-options">
            <label>
              Line
              <select
                aria-label="Line style"
                value={shown.line}
                onChange={(event) => restyle({ line: event.target.value as DrawingLineStyle })}
              >
                {LINES.map((line) => (
                  <option key={line.value} value={line.value}>
                    {line.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Weight
              <select
                aria-label="Line weight"
                value={shown.strokeWidth}
                onChange={(event) => restyle({ strokeWidth: Number(event.target.value) })}
              >
                {WEIGHTS.map((weight) => (
                  <option key={weight.value} value={weight.value}>
                    {weight.label}
                  </option>
                ))}
                {!WEIGHTS.some((weight) => weight.value === shown.strokeWidth) && (
                  <option value={shown.strokeWidth}>{shown.strokeWidth}</option>
                )}
              </select>
            </label>
            {filled && (
              <label className="drawing-check">
                <input
                  type="checkbox"
                  checked={!!shown.fill}
                  onChange={(event) => restyle({ fill: event.target.checked })}
                />
                Fill
              </label>
            )}
          </div>
          {selected && editsText && (
            <label className="drawing-text">
              {selected.shape === 'text' ? 'Text' : 'Label (blank shows the length)'}
              <textarea
                ref={textInput}
                rows={selected.shape === 'text' ? 2 : 1}
                maxLength={500}
                // Text drawings need some text; an emptied one keeps its last words.
                defaultValue={selected.text ?? ''}
                key={selected.id}
                onBlur={(event) => {
                  const text = event.target.value;
                  if (selected.shape === 'text' && !text.trim()) {
                    event.target.value = selected.text ?? '';
                    return;
                  }
                  if (text !== (selected.text ?? ''))
                    changeDrawing(selected.id, (item) => {
                      const next: BoardDrawing = { ...item, text };
                      if (!text.trim()) delete next.text;
                      return next;
                    });
                }}
              />
            </label>
          )}
          {selected?.shape === 'text' && (
            <label>
              Size
              <select
                aria-label="Text size"
                value={selected.fontSize ?? 16}
                onChange={(event) =>
                  changeDrawing(selected.id, (item) => ({
                    ...item,
                    fontSize: Number(event.target.value),
                  }))
                }
              >
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected && (
            <>
              <label>
                Moves with
                <select
                  aria-label="Moves with"
                  value={selected.anchorId ?? ''}
                  onChange={(event) =>
                    changeDrawing(selected.id, (item) =>
                      anchorDrawing(item, event.target.value || null, board.positions),
                    )
                  }
                >
                  <option value="">Canvas (stays put)</option>
                  {concepts.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="drawing-delete" onClick={() => remove(selected.id)}>
                <Trash2 size={14} /> Delete drawing
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}

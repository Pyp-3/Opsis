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
  Copy,
  Eraser,
  Layers,
  Lock,
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
  drawingOrigin,
  isDrawingEditable,
  isDrawingPickable,
  translateDrawing,
  visibleDrawings,
  ILLUSTRATION_INKS,
  MAX_BOARD_DRAWINGS,
  type BoardDocument,
  type BoardDrawing,
  type DrawingLayer as BoardDrawingLayer,
  type DrawingLineStyle,
  type DrawingShape as DrawingKind,
  type IllustrationInk,
} from '@opsis/schema';
import { DrawingShape } from './DrawingShape';
import { DrawingLayersPanel, useDrawingLayers } from './DrawingLayersPanel';
import { INK_VALUES } from './Illustration';
import {
  boxBetween,
  drawingAt,
  drawingBox,
  drawingClipboard,
  drawingsInBox,
  handleAt,
  pasteDrawings,
  readDrawingClipboard,
  resizeDrawing,
  resizeHandles,
  round,
  roundDrawing,
  simplifyStroke,
  type Point,
  type ResizeHandle,
} from './canvas-drawing';
import { lookOf, paletteOf } from './canvas-theme';
import { useRememberedOpen } from './useRememberedOpen';

/**
 * Freehand and illustrative drawing on the canvas, beside the icon diagram. In "diagram" mode
 * the canvas behaves as before (drawings are inert and sit beneath icons and arrows). Any other
 * tool lays a capture surface over the canvas: drawing tools add shapes, "select" picks, moves,
 * resizes and edits drawings, and the eraser removes them. Each finished shape, move, resize,
 * paste or erasing sweep is one undoable edit.
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
/** Pasted and duplicated drawings land one grid square down and right of their source. */
const PASTE_OFFSET = SNAP * 2;
const LIMIT_NOTICE = `A board holds at most ${MAX_BOARD_DRAWINGS} drawings.`;
const plural = (count: number) => `${count} drawing${count === 1 ? '' : 's'}`;

type Gesture =
  | { kind: 'draw'; points: Point[] }
  | { kind: 'move'; ids: string[]; last: Point; moved: boolean }
  | {
      kind: 'resize';
      id: string;
      handle: ResizeHandle;
      original: BoardDrawing;
      origin: { x: number; y: number };
    }
  | { kind: 'marquee'; from: Point; base: string[] }
  | { kind: 'erase' };

const inTextField = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]');

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
  const [chosenIds, setChosenIds] = useState<readonly string[]>([]);
  const [style, setStyle] = useState<DrawingStyle>({
    ink: 'ink',
    line: 'solid',
    strokeWidth: 2,
    fill: false,
  });
  const [draft, setDraft] = useState<BoardDrawing | null>(null);
  const [marquee, setMarquee] = useState<{ from: Point; to: Point } | null>(null);
  const [open, setOpen] = useRememberedOpen('opsis:drawing-tools-open', false);
  const [notice, setNotice] = useState('');
  const layers = useDrawingLayers({ board, boardRef, commit, onNotice: setNotice });
  const setLayersOpen = layers.setOpen;
  const clipboard = useRef<{ text: string; pastes: number } | null>(null);
  // Drawings removed by undo or another edit, or on a layer since hidden or locked, are no
  // longer selected.
  const selection = useMemo(
    () =>
      (board?.drawings ?? []).filter(
        (drawing) =>
          chosenIds.includes(drawing.id) && isDrawingPickable(drawing, board?.drawingLayers),
      ),
    [board, chosenIds],
  );
  const selectedIds = useMemo(() => selection.map((drawing) => drawing.id), [selection]);
  const selected = selection.length === 1 ? selection[0]! : null;
  const active = editable && tool !== 'diagram';

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const select = useCallback(
    (ids: readonly string[]) => {
      setChosenIds(ids);
      if (ids.length) onSelect();
    },
    [onSelect],
  );
  const setTool = useCallback(
    (next: DrawingTool) => {
      setToolState(next);
      setDraft(null);
      setMarquee(null);
      if (next !== 'select') setChosenIds([]);
      if (next !== 'select' && next !== 'diagram') setLayersOpen(false);
    },
    [setLayersOpen],
  );
  /**
   * Changes several drawings in one undoable edit. Locked drawings, and those on locked layers,
   * are left alone unless `includeLocked` (for unlocking them).
   */
  const changeDrawings = useCallback(
    (
      ids: readonly string[],
      change: (drawing: BoardDrawing) => BoardDrawing | null,
      includeLocked = false,
    ) => {
      const current = boardRef.current;
      if (!current?.drawings) return;
      const drawings = current.drawings.flatMap((drawing) => {
        if (!ids.includes(drawing.id)) return [drawing];
        const allowed = includeLocked
          ? isDrawingPickable(drawing, current.drawingLayers)
          : isDrawingEditable(drawing, current.drawingLayers);
        if (!allowed) return [drawing];
        const next = change(drawing);
        return next ? [next] : [];
      });
      commit({ ...current, drawings });
    },
    [boardRef, commit],
  );
  const changeDrawing = useCallback(
    (id: string, change: (drawing: BoardDrawing) => BoardDrawing | null) =>
      changeDrawings([id], change),
    [changeDrawings],
  );
  /** Restyles the selected drawings, and draws later shapes in the same style. */
  const restyle = useCallback(
    (patch: Partial<DrawingStyle>) => {
      setStyle((current) => ({ ...current, ...patch }));
      if (!selectedIds.length) return;
      changeDrawings(selectedIds, (drawing) => {
        const next = { ...drawing, ...patch };
        // Only boxes and ellipses are filled.
        if (patch.fill !== undefined && drawing.shape !== 'rect' && drawing.shape !== 'ellipse')
          next.fill = drawing.fill;
        if (next.fill === undefined) delete next.fill;
        return next;
      });
    },
    [selectedIds, changeDrawings],
  );
  const removeSelected = useCallback(() => {
    changeDrawings(selectedIds, () => null);
    setChosenIds([]);
  }, [changeDrawings, selectedIds]);
  const add = useCallback(
    (drawing: BoardDrawing) => {
      const current = boardRef.current;
      if (!current) return false;
      if ((current.drawings?.length ?? 0) >= MAX_BOARD_DRAWINGS) {
        setNotice(LIMIT_NOTICE);
        return false;
      }
      const placed = layers.drawOn ? { ...drawing, layerId: layers.drawOn } : drawing;
      commit({ ...current, drawings: [...(current.drawings ?? []), placed] });
      return true;
    },
    [boardRef, commit, layers.drawOn],
  );
  /** Adds the copied drawings as one edit and selects them; false when the text is not ours. */
  const pasteText = useCallback(
    (text: string) => {
      const copied = readDrawingClipboard(text);
      if (!copied) return false;
      const current = boardRef.current;
      if (!current || !copied.length) return true;
      if (clipboard.current?.text !== text) clipboard.current = { text, pastes: 0 };
      clipboard.current.pastes += 1;
      const pasted = pasteDrawings(current, copied, PASTE_OFFSET * clipboard.current.pastes, () =>
        crypto.randomUUID(),
      );
      if (!pasted) {
        setNotice(LIMIT_NOTICE);
        return true;
      }
      commit(pasted.board);
      setOpen(true);
      setToolState('select');
      select(pasted.ids);
      setNotice(`Pasted ${plural(pasted.ids.length)}.`);
      return true;
    },
    [boardRef, commit, setOpen, select],
  );
  const copySelection = useCallback(() => {
    const current = boardRef.current;
    if (!current || !selectedIds.length) return null;
    const text = drawingClipboard(current, selectedIds);
    clipboard.current = { text, pastes: 0 };
    return text;
  }, [boardRef, selectedIds]);
  const duplicate = useCallback(() => {
    const current = boardRef.current;
    if (!current || !selectedIds.length) return;
    const pasted = pasteDrawings(
      current,
      readDrawingClipboard(drawingClipboard(current, selectedIds)) ?? [],
      PASTE_OFFSET,
      () => crypto.randomUUID(),
    );
    if (!pasted) {
      setNotice(LIMIT_NOTICE);
      return;
    }
    commit(pasted.board);
    select(pasted.ids);
  }, [boardRef, commit, select, selectedIds]);
  const selectAll = useCallback(() => {
    const current = boardRef.current;
    if (!current) return;
    select(
      visibleDrawings(current)
        .filter((drawing) => isDrawingPickable(drawing, current.drawingLayers))
        .map((drawing) => drawing.id),
    );
  }, [boardRef, select]);

  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (inTextField(event.target)) return;
      if (event.altKey) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'a' && open && tool === 'select') {
          event.preventDefault();
          selectAll();
        } else if (key === 'd' && selectedIds.length) {
          event.preventDefault();
          duplicate();
        }
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === 'Escape') {
        if (selectedIds.length) setChosenIds([]);
        else if (tool !== 'diagram') setTool('diagram');
        return;
      }
      // Single-letter shortcuts only while the drawing tools are showing.
      if (!open) return;
      const shortcut = TOOLS.find((item) => item.key === event.key.toLowerCase());
      if (shortcut && shortcut.key !== 'Escape') setTool(shortcut.tool);
    };
    // Copy, cut and paste use the clipboard events, which need no permission and leave text
    // fields and selected page text to the browser.
    const onCopy = (event: ClipboardEvent) => {
      if (inTextField(event.target) || window.getSelection()?.toString()) return;
      const text = copySelection();
      if (!text || !event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      if (event.type === 'cut') removeSelected();
      setNotice(`${event.type === 'cut' ? 'Cut' : 'Copied'} ${plural(selectedIds.length)}.`);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (inTextField(event.target)) return;
      if (pasteText(event.clipboardData?.getData('text/plain') ?? '')) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [
    editable,
    open,
    selectedIds,
    tool,
    removeSelected,
    setTool,
    selectAll,
    duplicate,
    copySelection,
    pasteText,
  ]);

  return {
    tool,
    setTool,
    active,
    open,
    setOpen,
    selection,
    selected,
    selectedIds,
    select,
    style,
    restyle,
    draft,
    setDraft,
    marquee,
    setMarquee,
    changeDrawing,
    changeDrawings,
    removeSelected,
    duplicate,
    add,
    layers,
    notice,
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
 * the selection outlines, resize handles and the shape being drawn are painted above it.
 * Hidden layers are not drawn.
 */
export function DrawingLayer({ drawing }: { drawing: CanvasDrawing }) {
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
  if (!drawings.length && !draft && !marquee) return null;
  const outlines = board ? selection.map((item) => absoluteDrawing(item, board.positions)) : [];
  const resizable =
    board && selected && drawing.active && isDrawingEditable(selected, board.drawingLayers)
      ? absoluteDrawing(selected, board.positions)
      : null;
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
          {resizable &&
            resizeHandles(resizable).map(({ handle, at }) => (
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
            ))}
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
  const box = drawingBox(drawing);
  const pad = 6 + drawing.strokeWidth;
  return (
    <rect
      className="drawing-selection"
      data-locked={drawing.locked ? 'true' : undefined}
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
 * The drawing palette, the style/inspector or layers panel and, while a tool is active, the
 * surface that captures pointer input. Placed inside the canvas, after React Flow.
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
    selection,
    selected,
    selectedIds,
    select,
    style,
    restyle,
    setDraft,
    setMarquee,
    changeDrawing,
    changeDrawings,
    removeSelected,
    duplicate,
    add,
    layers,
    notice,
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
      return hit && isDrawingEditable(hit, current.drawingLayers)
        ? { ...current, drawings: current.drawings!.filter((item) => item.id !== hit.id) }
        : current;
    });
  const editableIds = (current: BoardDocument, ids: readonly string[]) =>
    (current.drawings ?? [])
      .filter((item) => ids.includes(item.id) && isDrawingEditable(item, current.drawingLayers))
      .map((item) => item.id);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // No text selection while dragging, and no focus change that would undo focusing new text.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    const current = boardRef.current;
    if (!current) return;
    if (tool === 'select') {
      // A handle of the one selected drawing resizes it.
      if (selected && isDrawingEditable(selected, current.drawingLayers)) {
        const original = absoluteDrawing(selected, current.positions);
        const handle = handleAt(original, point, 8 / flow.getZoom());
        if (handle) {
          begin();
          gesture.current = {
            kind: 'resize',
            id: selected.id,
            handle,
            original,
            origin: drawingOrigin(selected, current.positions),
          };
          return;
        }
      }
      const hit = drawingAt(current, point, tolerance());
      if (!hit) {
        // An empty spot starts a selection rectangle; Shift adds to the selection.
        const base = event.shiftKey ? [...selectedIds] : [];
        if (!event.shiftKey) select([]);
        gesture.current = { kind: 'marquee', from: point, base };
        setMarquee({ from: point, to: point });
        return;
      }
      if (event.shiftKey) {
        select(
          selectedIds.includes(hit.id)
            ? selectedIds.filter((id) => id !== hit.id)
            : [...selectedIds, hit.id],
        );
        return;
      }
      // Dragging one of several selected drawings moves them all.
      const ids = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
      if (!selectedIds.includes(hit.id)) select([hit.id]);
      const movable = editableIds(current, ids);
      if (movable.length) {
        begin();
        gesture.current = { kind: 'move', ids: movable, last: point, moved: false };
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
        select([created.id]);
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
    else if (current.kind === 'marquee') setMarquee({ from: current.from, to: point });
    else if (current.kind === 'resize') {
      const fix = (value: number) => (event.altKey ? round(value) : snap(value));
      const resized = resizeDrawing(
        current.original,
        current.handle,
        [fix(point[0]), fix(point[1])],
        event.shiftKey,
      );
      setBoard((board) =>
        board
          ? {
              ...board,
              drawings: board.drawings?.map((item) => {
                if (item.id !== current.id) return item;
                const stored = roundDrawing(
                  translateDrawing(resized, -current.origin.x, -current.origin.y),
                );
                return item.anchorId ? { ...stored, anchorId: item.anchorId } : stored;
              }),
            }
          : board,
      );
    } else if (current.kind === 'move') {
      const dx = point[0] - current.last[0];
      const dy = point[1] - current.last[1];
      current.last = point;
      current.moved = true;
      setBoard((board) =>
        board
          ? {
              ...board,
              drawings: board.drawings?.map((item) =>
                current.ids.includes(item.id) ? translateDrawing(item, dx, dy) : item,
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
                current.ids.includes(item.id) ? roundDrawing(item) : item,
              ),
            }
          : undefined,
      );
    } else if (current.kind === 'resize' || current.kind === 'erase') end();
    else if (current.kind === 'marquee') {
      setMarquee(null);
      const latest = boardRef.current;
      if (!latest) return;
      const picked = drawingsInBox(latest, current.from, at(event)).map((item) => item.id);
      select([...new Set([...current.base, ...picked])]);
    } else if (current.kind === 'draw') {
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
  const boardLayers: readonly BoardDrawingLayer[] = board.drawingLayers ?? [];
  const changeable = selection.filter((item) => isDrawingEditable(item, boardLayers));
  const allLocked = selection.length > 0 && selection.every((item) => item.locked);
  const single = selected && changeable.includes(selected) ? selected : null;
  const editsText = single?.shape === 'text' || single?.shape === 'dimension';
  const filled = selection.length
    ? selection.some((item) => item.shape === 'rect' || item.shape === 'ellipse')
    : tool === 'rect' || tool === 'ellipse';
  const shown = changeable[0] ?? selection[0] ?? style;
  const drawingTool = tool !== 'diagram' && tool !== 'erase' && tool !== 'select';
  const showPanel = !layers.open && (selection.length > 0 || drawingTool);
  const styleDisabled = selection.length > 0 && !changeable.length;
  const sharedAnchor = changeable.every((item) => item.anchorId === changeable[0]?.anchorId)
    ? (changeable[0]?.anchorId ?? '')
    : 'mixed';
  const sharedLayer = selection.every((item) => item.layerId === selection[0]?.layerId)
    ? (selection[0]?.layerId ?? '')
    : 'mixed';
  const openLayers = boardLayers.filter((layer) => !layer.hidden && !layer.locked);
  const panelName = selected
    ? 'Selected drawing'
    : selection.length
      ? 'Selected drawings'
      : 'Drawing style';

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
            const current = gesture.current;
            if (current && current.kind !== 'draw' && current.kind !== 'marquee') end();
            gesture.current = null;
            setDraft(null);
            setMarquee(null);
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
              aria-label="Layers and scale"
              title="Drawing layers and the board's scale"
              aria-pressed={layers.open}
              onClick={() => layers.setOpen(!layers.open)}
            >
              <Layers size={16} />
            </button>
            <button
              aria-label="Hide drawing tools"
              title="Put the drawing tools away"
              aria-expanded
              onClick={() => {
                setTool('diagram');
                layers.setOpen(false);
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
      {notice && (
        <p className="drawing-notice" role="status">
          {notice}
        </p>
      )}
      {open && layers.open && <DrawingLayersPanel board={board} layers={layers} />}
      {open && showPanel && (
        <section className="drawing-panel" aria-label={panelName}>
          {selection.length > 1 && (
            <p className="drawing-count">
              {plural(selection.length)} selected
              {changeable.length < selection.length &&
                ` · ${selection.length - changeable.length} locked`}
            </p>
          )}
          {selected?.locked && (
            <p className="drawing-count">
              <Lock size={12} aria-hidden /> Locked: unlock it to move or change it.
            </p>
          )}
          <fieldset className="drawing-fieldset" disabled={styleDisabled}>
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
          </fieldset>
          {single && editsText && (
            <label className="drawing-text">
              {single.shape === 'text' ? 'Text' : 'Label (blank shows the length)'}
              <textarea
                ref={textInput}
                rows={single.shape === 'text' ? 2 : 1}
                maxLength={500}
                // Text drawings need some text; an emptied one keeps its last words.
                defaultValue={single.text ?? ''}
                key={single.id}
                onBlur={(event) => {
                  const text = event.target.value;
                  if (single.shape === 'text' && !text.trim()) {
                    event.target.value = single.text ?? '';
                    return;
                  }
                  if (text !== (single.text ?? ''))
                    changeDrawing(single.id, (item) => {
                      const next: BoardDrawing = { ...item, text };
                      if (!text.trim()) delete next.text;
                      return next;
                    });
                }}
              />
            </label>
          )}
          {single?.shape === 'text' && (
            <label>
              Size
              <select
                aria-label="Text size"
                value={single.fontSize ?? 16}
                onChange={(event) =>
                  changeDrawing(single.id, (item) => ({
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
          {!selection.length && (
            <label>
              Draw on
              <select
                aria-label="Draw on layer"
                value={layers.drawOn ?? ''}
                onChange={(event) => layers.setDrawOn(event.target.value || null)}
              >
                <option value="">Base layer</option>
                {openLayers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!selection.length && tool === 'dimension' && (
            <p className="drawing-count">
              Scale:{' '}
              {board.drawingScale
                ? `1 grid square = ${board.drawingScale.gridValue} ${board.drawingScale.unit}`
                : 'grid units (u)'}
              .{' '}
              <button className="drawing-link" onClick={() => layers.setOpen(true)}>
                Set scale
              </button>
            </p>
          )}
          {changeable.length > 0 && (
            <>
              <label>
                Moves with
                <select
                  aria-label="Moves with"
                  value={sharedAnchor}
                  onChange={(event) =>
                    changeDrawings(
                      changeable.map((item) => item.id),
                      (item) => anchorDrawing(item, event.target.value || null, board.positions),
                    )
                  }
                >
                  {sharedAnchor === 'mixed' && (
                    <option value="mixed" disabled>
                      Mixed
                    </option>
                  )}
                  <option value="">Canvas (stays put)</option>
                  {concepts.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Layer
                <select
                  aria-label="Layer"
                  value={sharedLayer}
                  onChange={(event) =>
                    changeDrawings(
                      changeable.map((item) => item.id),
                      (item) => {
                        const next = { ...item };
                        if (event.target.value) next.layerId = event.target.value;
                        else delete next.layerId;
                        return next;
                      },
                    )
                  }
                >
                  {sharedLayer === 'mixed' && (
                    <option value="mixed" disabled>
                      Mixed
                    </option>
                  )}
                  <option value="">Base layer</option>
                  {openLayers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {selection.length > 0 && (
            <>
              <label className="drawing-check">
                <input
                  type="checkbox"
                  checked={allLocked}
                  onChange={(event) =>
                    changeDrawings(
                      selectedIds,
                      (item) => {
                        const next = { ...item };
                        if (event.target.checked) next.locked = true;
                        else delete next.locked;
                        return next;
                      },
                      true,
                    )
                  }
                />
                Lock (no moving or changes)
              </label>
              <div className="drawing-actions">
                <button className="drawing-delete" onClick={duplicate}>
                  <Copy size={14} /> Duplicate
                </button>
                {changeable.length > 0 && (
                  <button className="drawing-delete" onClick={removeSelected}>
                    <Trash2 size={14} />{' '}
                    {selected ? 'Delete drawing' : `Delete ${plural(changeable.length)}`}
                  </button>
                )}
              </div>
              <p className="drawing-hint">
                Shift+click adds to the selection · Ctrl/⌘ C, X, V copy, cut and paste · Ctrl/⌘ D
                duplicates
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}

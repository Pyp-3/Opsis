// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBoard, type BoardDocument, type BoardDrawing } from '@opsis/schema';
import { DrawingControls, useCanvasDrawing } from './CanvasDrawing';
import { DrawingLayer } from './CanvasDrawingLayer';
import { useBoardHistory } from './useBoardHistory';

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    getZoom: () => 2,
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y: y / 2 }),
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 2 }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'setPointerCapture');
  localStorage.clear();
});

const shape: BoardDrawing = {
  id: 'attached',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 40,
  height: 20,
  ink: 'ink',
  line: 'solid',
  strokeWidth: 2,
  anchorId: 'concept',
};
const initial: BoardDocument = {
  ...createEmptyBoard(),
  positions: { concept: { x: 100, y: 200 } },
  drawingLayers: [
    { id: 'hidden', name: 'Hidden', hidden: true },
    { id: 'locked', name: 'Locked', locked: true },
  ],
  drawings: [
    shape,
    { ...shape, id: 'free', anchorId: undefined, x: 200, y: 200 },
    { ...shape, id: 'locked', x: 1000, locked: true },
    { ...shape, id: 'hidden', x: 2000, layerId: 'hidden' },
    { ...shape, id: 'locked-layer', x: 3000, layerId: 'locked' },
  ],
};

function setup() {
  let history!: ReturnType<typeof useBoardHistory>;
  function Canvas() {
    history = useBoardHistory({ board: initial, past: [], future: [] });
    const drawing = useCanvasDrawing({ ...history, editable: true, onSelect: () => {} });
    return (
      <>
        <DrawingLayer drawing={drawing} />
        <DrawingControls drawing={drawing} />
        <button onClick={() => history.travel()}>Undo test edit</button>
        <button onClick={() => history.travel(true)}>Redo test edit</button>
      </>
    );
  }
  const view = render(<Canvas />);
  fireEvent.click(screen.getByRole('button', { name: 'Show drawing tools' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select drawings' }));
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
  const surface = screen.getByTestId('drawing-surface');
  const handle = view.container.querySelector('[data-handle="rotate-selection"]')!;
  const start = {
    clientX: Number(handle.getAttribute('cx')) * 2,
    clientY: Number(handle.getAttribute('cy')) * 2,
    button: 0,
  };
  return { ...view, surface, start, history: () => history };
}

describe('selection rotation gestures', () => {
  it('rotates original drawings as one undoable edit, preserving attachments and locks', () => {
    const view = setup();
    expect(view.start).toEqual({ clientX: 340, clientY: 376, button: 0 });
    fireEvent.pointerDown(view.surface, view.start);
    // Two move events must use the original geometry, rather than compounding rotations.
    fireEvent.pointerMove(view.surface, { clientX: 380, clientY: 390 });
    fireEvent.pointerMove(view.surface, { clientX: 384, clientY: 420 });
    expect(view.history().snapshot.past).toHaveLength(0);
    fireEvent.pointerUp(view.surface, { clientX: 384, clientY: 420 });
    const result = view.history().board!;
    expect(result.drawings![0]).toMatchObject({ anchorId: 'concept', x: 50, y: -50, rotation: 90 });
    expect(result.drawings![1]).toMatchObject({ x: 150, y: 250, rotation: 90 });
    expect(result.drawings!.slice(2)).toEqual(initial.drawings!.slice(2));
    expect(view.history().snapshot.past).toEqual([initial]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo test edit' }));
    expect(view.history().board).toEqual(initial);
    fireEvent.click(screen.getByRole('button', { name: 'Redo test edit' }));
    expect(view.history().board).toEqual(result);
  });

  it('snaps the group delta to 15 degrees with Shift and ends a cancelled pointer gesture', () => {
    const view = setup();
    fireEvent.pointerDown(view.surface, view.start);
    const radians = ((-90 + 23) * Math.PI) / 180;
    fireEvent.pointerMove(view.surface, {
      clientX: (170 + 22 * Math.cos(radians)) * 2,
      clientY: (210 + 22 * Math.sin(radians)) * 2,
      shiftKey: true,
    });
    expect(view.history().board!.drawings![0]!.rotation).toBe(30);
    expect(view.history().board!.drawings![1]!.rotation).toBe(30);
    fireEvent.pointerCancel(view.surface);
    expect(view.history().snapshot.past).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo test edit' }));
    expect(view.history().board).toEqual(initial);
  });
});

// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_DEMO, type BoardDocument, type BoardDrawing } from '@opsis/schema';
import type { ComponentProps } from 'react';
import { DrawingLayer } from './CanvasDrawingLayer';

type DrawingState = ComponentProps<typeof DrawingLayer>['drawing'];

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 10, y: 20, zoom: 2 }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(cleanup);

const shape: BoardDrawing = {
  id: 'visible',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 40,
  height: 30,
  ink: 'ink',
  line: 'solid',
  strokeWidth: 2,
};
const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: { sender: { x: 100, y: 200 } },
  drawingLayers: [{ id: 'hidden', name: 'Hidden', hidden: true }],
  drawings: [shape, { ...shape, id: 'hidden-shape', layerId: 'hidden' }],
};
const drawing = (overrides: Partial<DrawingState> = {}): DrawingState => ({
  board,
  selection: [],
  selected: null,
  marquee: null,
  active: true,
  draft: null,
  ...overrides,
});

describe('canvas drawing layer', () => {
  it('hides saved layers and waits for a provisional drawing’s anchor to appear', () => {
    const { container } = render(
      <DrawingLayer
        drawing={drawing()}
        provisional={[
          { ...shape, id: 'anchored-preview', anchorId: 'sender' },
          { ...shape, id: 'waiting-preview', anchorId: 'missing' },
        ]}
      />,
    );
    expect(container.querySelector('[data-drawing="visible"]')).not.toBeNull();
    expect(container.querySelector('[data-drawing="hidden-shape"]')).toBeNull();
    const preview = container.querySelector('[data-provisional-drawing="anchored-preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('rect')?.getAttribute('x')).toBe('100');
    expect(preview?.querySelector('rect')?.getAttribute('y')).toBe('200');
    expect(container.querySelector('[data-provisional-drawing="waiting-preview"]')).toBeNull();
  });

  it('renders a group handle for editable members and hides it for read-only or locked selections', () => {
    const second = { ...shape, id: 'second', x: 100 };
    const groupBoard = { ...board, drawings: [shape, second] };
    const selection = { board: groupBoard, selection: [shape, second] };
    const { container, rerender } = render(<DrawingLayer drawing={drawing(selection)} />);
    const handle = container.querySelector('[data-handle="rotate-selection"]')!;
    expect(handle.getAttribute('cx')).toBe('70');
    expect(handle.getAttribute('cy')).toBe('-12');
    expect(handle.getAttribute('r')).toBe('2.5');
    expect(container.querySelector('[data-handle="rotate"]')).toBeNull();
    rerender(<DrawingLayer drawing={drawing({ ...selection, active: false })} />);
    expect(container.querySelector('[data-handle="rotate-selection"]')).toBeNull();
    const locked = [shape, second].map((item) => ({ ...item, locked: true }));
    rerender(
      <DrawingLayer
        drawing={drawing({ board: { ...groupBoard, drawings: locked }, selection: locked })}
      />,
    );
    expect(container.querySelector('[data-handle="rotate-selection"]')).toBeNull();
  });

  it('drops unfinished drawings and resize controls when editing becomes unavailable', () => {
    const selection = { selection: [shape], selected: shape, draft: shape };
    const { container, rerender } = render(<DrawingLayer drawing={drawing(selection)} />);
    expect(container.querySelector('.drawing-draft')).not.toBeNull();
    expect(container.querySelector('[data-handle]')).not.toBeNull();
    rerender(<DrawingLayer drawing={drawing({ ...selection, active: false })} />);
    expect(container.querySelector('.drawing-draft')).toBeNull();
    expect(container.querySelector('[data-handle]')).toBeNull();
    expect(container.querySelector('[data-drawing="visible"]')).not.toBeNull();
  });
});

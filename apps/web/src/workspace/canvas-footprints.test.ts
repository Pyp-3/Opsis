import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, drawingFrame, type BoardDocument } from '@opsis/schema';
import { canvasContentBounds, contains, drawingFootprints } from './canvas-footprints';

const ink = { ink: 'sky', line: 'solid', strokeWidth: 2 } as const;
function fixture(): BoardDocument {
  return { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
}

describe('painted canvas footprints', () => {
  it('accounts for aligned multiline text, rotation, backdrops and concept anchors', () => {
    const board = fixture();
    board.positions.sender = { x: 100, y: 200 };
    board.drawings = [
      {
        id: 'text',
        shape: 'text',
        anchorId: 'sender',
        x: 50,
        y: 20,
        text: 'Wide caption\nSecond line',
        align: 'end',
        rotation: 90,
        bold: true,
        background: true,
        ...ink,
      },
    ];
    const frame = drawingFrame({ ...board.drawings[0]!, x: 150, y: 220 });
    const box = drawingFootprints(board)[0]!;
    expect(box.container).toBe(false);
    expect(box.width).toBeGreaterThan(frame.height);
    expect(box.height).toBeGreaterThan(frame.width);
    expect(box.x + box.width / 2).toBeCloseTo(frame.centre[0]);
    expect(box.y + box.height / 2).toBeCloseTo(frame.centre[1]);
  });

  it('does not reserve hidden layers or turn open connector strokes into solid walls', () => {
    const board = fixture();
    board.drawingLayers = [{ id: 'hidden', name: 'Hidden', hidden: true }];
    board.drawings = [
      {
        id: 'hidden-text',
        shape: 'text',
        x: 5000,
        y: 5000,
        text: 'Hidden',
        layerId: 'hidden',
        ...ink,
      },
      {
        id: 'arrow',
        shape: 'arrow',
        points: [
          [0, 0],
          [100, 100],
        ],
        ...ink,
      },
    ];
    expect(drawingFootprints(board)).toEqual([]);
    const bounds = canvasContentBounds(board, []);
    expect(bounds).not.toBeNull();
    expect(contains(bounds!, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(bounds!.width).toBeLessThan(150);
  });

  it('includes long dimension captions and visible concepts in Fit/export bounds', () => {
    const board = fixture();
    expect(canvasContentBounds(board, [])).toBeNull();
    board.drawings = [
      {
        id: 'dimension',
        shape: 'dimension',
        points: [
          [100, 100],
          [110, 100],
        ],
        text: 'A very long measurement caption',
        ...ink,
      },
    ];
    const caption = drawingFootprints(board)[0]!;
    const bounds = canvasContentBounds(board, [{ x: -500, y: -600, width: 224, height: 150 }])!;
    expect(caption.width).toBeGreaterThan(200);
    expect(contains(bounds, caption)).toBe(true);
    expect(bounds.x).toBe(-500);
    expect(bounds.y).toBe(-600);
  });
});

import { describe, expect, it } from 'vitest';
import { BoardDocumentSchema, type BoardDocument } from './board';
import {
  anchorDrawing,
  absoluteDrawing,
  BoardDrawingSchema,
  dimensionLabel,
  drawingBounds,
  type BoardDrawing,
} from './board-drawings';
import { createEmptyBoard, removeBoardNode } from './board-operations';
import { selectBoardChanges } from './board-review';

const ink = { ink: 'sky', line: 'solid', strokeWidth: 2 } as const;
const wall: BoardDrawing = {
  id: 'wall',
  shape: 'line',
  points: [
    [0, 0],
    [240, 0],
  ],
  ...ink,
};

function boardWith(drawings: BoardDrawing[]): BoardDocument {
  return {
    ...createEmptyBoard('Plan'),
    nodes: [
      {
        id: 'pump',
        label: 'Pump',
        icon: 'lightbulb',
        summary: 'Moves water.',
        explanation: 'Moves water.',
        kind: 'step',
      },
    ],
    positions: { pump: { x: 100, y: 50 } },
    drawings,
  };
}

describe('canvas drawings', () => {
  it('accepts each shape with its required geometry and rejects incomplete ones', () => {
    const valid: BoardDrawing[] = [
      {
        id: 'a',
        shape: 'stroke',
        points: [
          [0, 0],
          [3, 4],
          [8, 1],
        ],
        ...ink,
      },
      wall,
      {
        id: 'b',
        shape: 'arrow',
        points: [
          [0, 0],
          [10, 10],
        ],
        ...ink,
      },
      { id: 'c', shape: 'rect', x: 0, y: 0, width: 50, height: 20, fill: true, ...ink },
      { id: 'd', shape: 'ellipse', x: 0, y: 0, width: 50, height: 20, ...ink },
      { id: 'e', shape: 'text', x: 0, y: 0, text: 'Plant room', ...ink },
      {
        id: 'f',
        shape: 'dimension',
        points: [
          [0, 0],
          [120, 0],
        ],
        ...ink,
        line: 'center',
      },
    ];
    for (const drawing of valid) expect(BoardDrawingSchema.parse(drawing)).toEqual(drawing);
    for (const drawing of [
      {
        id: 'g',
        shape: 'line',
        points: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        ...ink,
      },
      { id: 'h', shape: 'rect', x: 0, y: 0, width: 5, ...ink },
      { id: 'i', shape: 'text', x: 0, y: 0, text: '  ', ...ink },
      { id: 'j', shape: 'stroke', ...ink },
      {
        id: 'k',
        shape: 'stroke',
        points: [
          [0, 0],
          [1, 1],
        ],
        ...ink,
        html: '<script>',
      },
    ])
      expect(BoardDrawingSchema.safeParse(drawing).success).toBe(false);
  });

  it('requires unique IDs and anchors on existing concepts', () => {
    expect(BoardDocumentSchema.safeParse(boardWith([wall])).success).toBe(true);
    expect(BoardDocumentSchema.safeParse(boardWith([wall, wall])).success).toBe(false);
    expect(
      BoardDocumentSchema.safeParse(boardWith([{ ...wall, anchorId: 'missing' }])).success,
    ).toBe(false);
  });

  it('attaches and detaches without moving the drawing on screen', () => {
    const board = boardWith([wall]);
    const attached = anchorDrawing(wall, 'pump', board.positions);
    expect(attached).toMatchObject({
      anchorId: 'pump',
      points: [
        [-100, -50],
        [140, -50],
      ],
    });
    expect(absoluteDrawing(attached, board.positions).points).toEqual(wall.points);
    // Moving the concept moves the attached drawing with it.
    expect(absoluteDrawing(attached, { pump: { x: 124, y: 50 } }).points).toEqual([
      [24, 0],
      [264, 0],
    ]);
    expect(anchorDrawing(attached, null, board.positions)).toEqual(wall);
  });

  it('keeps a drawing in place when its concept is removed or rejected', () => {
    const board = boardWith([anchorDrawing(wall, 'pump', { pump: { x: 100, y: 50 } })]);
    const removed = removeBoardNode(board, 'pump');
    expect(BoardDocumentSchema.parse(removed).drawings).toEqual([wall]);
    const candidate = { ...board, nodes: [], positions: {} };
    const reviewed = selectBoardChanges(board, candidate, ['nodes:pump']);
    expect(reviewed.drawings).toEqual([wall]);
  });

  it('measures dimension lines in grid units unless labelled', () => {
    const dimension: BoardDrawing = {
      id: 'd',
      shape: 'dimension',
      points: [
        [0, 0],
        [0, 60],
      ],
      ...ink,
    };
    expect(dimensionLabel(dimension)).toBe('2.5 u');
    expect(dimensionLabel({ ...dimension, text: ' 3.2 m ' })).toBe('3.2 m');
    expect(drawingBounds(dimension, {}).maxY).toBeGreaterThan(60);
  });
});

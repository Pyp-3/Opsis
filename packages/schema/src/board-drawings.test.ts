import { describe, expect, it } from 'vitest';
import { BoardDocumentSchema, type BoardDocument } from './board';
import {
  anchorDrawing,
  absoluteDrawing,
  BoardDrawingSchema,
  dimensionLabel,
  drawingBounds,
  isDrawingEditable,
  isDrawingPickable,
  removeDrawingLayer,
  visibleDrawings,
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

  it('reads unlabelled dimensions in the board scale', () => {
    const dimension: BoardDrawing = {
      id: 'd',
      shape: 'dimension',
      points: [
        [0, 0],
        [72, 0],
      ],
      ...ink,
    };
    expect(dimensionLabel(dimension, { gridValue: 0.5, unit: 'm' })).toBe('1.5 m');
    expect(dimensionLabel(dimension, { gridValue: 250, unit: 'mm' })).toBe('750 mm');
    expect(dimensionLabel(dimension, { gridValue: 1 / 3, unit: 'ft' })).toBe('1 ft');
    expect(dimensionLabel({ ...dimension, text: 'Door' }, { gridValue: 2, unit: 'm' })).toBe(
      'Door',
    );
    const board = { ...boardWith([dimension]), drawingScale: { gridValue: 0.5, unit: 'm' } };
    expect(BoardDocumentSchema.parse(board).drawingScale).toEqual({ gridValue: 0.5, unit: 'm' });
    expect(
      BoardDocumentSchema.safeParse({ ...board, drawingScale: { gridValue: 0, unit: 'm' } })
        .success,
    ).toBe(false);
  });

  it('paints layers in order, leaves hidden ones out and protects locked ones', () => {
    const base = { ...wall, id: 'base' };
    const walls = { ...wall, id: 'walls', layerId: 'structure' };
    const notes = { ...wall, id: 'notes', layerId: 'notes' };
    const board: BoardDocument = {
      ...boardWith([notes, walls, base]),
      drawingLayers: [
        { id: 'structure', name: 'Structure', locked: true },
        { id: 'notes', name: 'Notes' },
      ],
    };
    expect(BoardDocumentSchema.parse(board).drawingLayers).toHaveLength(2);
    expect(visibleDrawings(board).map((item) => item.id)).toEqual(['base', 'walls', 'notes']);
    expect(isDrawingPickable(walls, board.drawingLayers)).toBe(false);
    expect(isDrawingEditable({ ...base, locked: true }, board.drawingLayers)).toBe(false);
    expect(isDrawingPickable({ ...base, locked: true }, board.drawingLayers)).toBe(true);
    const hidden = {
      ...board,
      drawingLayers: [board.drawingLayers![0]!, { id: 'notes', name: 'Notes', hidden: true }],
    };
    expect(visibleDrawings(hidden).map((item) => item.id)).toEqual(['base', 'walls']);

    // A layer's drawings move to the base layer when it is deleted.
    const removed = removeDrawingLayer(board, 'structure');
    expect(removed.drawingLayers).toEqual([{ id: 'notes', name: 'Notes' }]);
    expect(removed.drawings!.find((item) => item.id === 'walls')!.layerId).toBeUndefined();
    expect(removeDrawingLayer(removed, 'notes').drawingLayers).toBeUndefined();

    const problems = (candidate: BoardDocument) =>
      BoardDocumentSchema.safeParse(candidate).error?.issues.map((issue) => issue.message);
    expect(problems({ ...board, drawingLayers: [] })).toContain(
      'A drawing can only be on an existing layer.',
    );
    expect(
      problems({
        ...board,
        drawingLayers: [...board.drawingLayers!, { id: 'notes', name: 'Again' }],
      }),
    ).toContain('Drawing layer IDs must be unique.');
  });
});

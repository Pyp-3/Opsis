import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument, type BoardDrawing } from '@opsis/schema';
import { routeBoard, crosses, overlaps } from './routing';
import { drawingFootprints } from './canvas-footprints';

const ink = { ink: 'gold', line: 'solid', strokeWidth: 2 } as const;
function fixture(): BoardDocument {
  return {
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    nodes: EMAIL_DEMO.nodes.slice(0, 2),
    positions: { sender: { x: 0, y: 0 }, app: { x: 420, y: 0 } },
    edges: [{ id: 'connection', source: 'sender', target: 'app', label: 'Mobile admission' }],
    edgePorts: { connection: { source: 'right', target: 'left' } },
  };
}
function expectAvoids(board: BoardDocument) {
  const route = routeBoard(board).connection!;
  for (const box of drawingFootprints(board).filter((drawing) => !drawing.container)) {
    for (let index = 1; index < route.points.length; index++)
      expect(crosses(route.points[index - 1]!, route.points[index]!, box), box.drawing.id).toBe(
        false,
      );
    expect(overlaps(route.label!, box), box.drawing.id).toBe(false);
  }
  return route;
}

describe('drawing-aware connection routing', () => {
  it('routes around drawing words instead of crossing them', () => {
    const board = fixture();
    const original = routeBoard(board);
    board.drawings = [{ id: 'warning', shape: 'text', x: 272, y: 32, text: 'BLOCK', ...ink }];
    expect(expectAvoids(board).path).not.toBe(original.connection!.path);
  });

  it('reserves drawing text when placing a connection label', () => {
    const board = fixture();
    const old = routeBoard(board).connection!.label!;
    board.drawings = [
      { id: 'note', shape: 'text', x: old.x, y: old.y, text: 'Existing drawing text', ...ink },
    ];
    expectAvoids(board);
  });

  it('invalidates cached routes after a drawing moves or becomes visible, without mutating drawings', () => {
    const board = fixture();
    const clear = routeBoard(board);
    const text: BoardDrawing = {
      id: 'note',
      shape: 'text',
      x: 272,
      y: 32,
      text: 'BLOCK',
      layerId: 'notes',
      ...ink,
    };
    board.drawings = [text];
    board.drawingLayers = [{ id: 'notes', name: 'Notes' }];
    const blocked = routeBoard(board);
    expect(blocked.connection!.path).not.toBe(clear.connection!.path);
    expect(routeBoard({ ...board, description: 'Different prose' })).toBe(blocked);
    const hidden = { ...board, drawingLayers: [{ id: 'notes', name: 'Notes', hidden: true }] };
    expect(routeBoard(hidden).connection!.path).toBe(clear.connection!.path);
    const moved = { ...board, drawings: [{ ...text, x: 1200 }] };
    expect(routeBoard(moved).connection!.path).toBe(clear.connection!.path);
    expect(board.drawings).toEqual([text]);
  });

  it('routes around an unrelated block but allows connections inside their containing frame', () => {
    const board = fixture();
    const original = routeBoard(board).connection!;
    board.drawings = [{ id: 'block', shape: 'rect', x: 272, y: 25, width: 70, height: 55, ...ink }];
    const rectangle = drawingFootprints(board)[0]!;
    const avoiding = routeBoard(board).connection!;
    expect(avoiding.path).not.toBe(original.path);
    for (let index = 1; index < avoiding.points.length; index++)
      expect(crosses(avoiding.points[index - 1]!, avoiding.points[index]!, rectangle)).toBe(false);
    board.drawings = [
      { id: 'frame', shape: 'rect', x: -100, y: -100, width: 1000, height: 400, ...ink },
    ];
    const contained = routeBoard(board).connection!;
    expect(contained.path).toBe(original.path);
    expect(contained.label).not.toBeNull();
  });

  it('keeps dimension labels and rotated captions clear while preserving port endpoints', () => {
    const board = fixture();
    const original = routeBoard(board).connection!;
    board.drawings = [
      {
        id: 'dimension',
        shape: 'dimension',
        points: [
          [270, 64],
          [340, 64],
        ],
        text: 'NO SHELL',
        ...ink,
      },
      { id: 'caption', shape: 'text', x: 340, y: 64, text: 'private', rotation: 90, ...ink },
    ];
    const routed = expectAvoids(board);
    expect(routed.points[0]).toEqual(original.points[0]);
    expect(routed.points.at(-1)).toEqual(original.points.at(-1));
  });
});

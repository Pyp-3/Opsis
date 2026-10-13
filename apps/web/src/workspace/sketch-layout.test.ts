import { describe, expect, it } from 'vitest';
import {
  AGENT_SKETCH_LAYER,
  EMAIL_DEMO,
  absoluteDrawing,
  type BoardDocument,
  type BoardDrawing,
} from '@opsis/schema';
import { layoutBoard } from './model';
import { settleAgentSketch } from './sketch-layout';
import { blocksNode, drawingFootprints, nodeFootprint, overlaps } from './canvas-footprints';

const ink = { ink: 'sky', line: 'solid', strokeWidth: 2 } as const;
function fixture(): BoardDocument {
  return {
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    nodes: EMAIL_DEMO.nodes.slice(0, 2),
    edges: [],
    positions: { sender: { x: 24, y: 24 }, app: { x: 24, y: 324 } },
    drawingLayers: [AGENT_SKETCH_LAYER],
  };
}
const sketch: BoardDrawing[] = [
  {
    id: 'frame',
    shape: 'rect',
    x: 64,
    y: 24,
    width: 320,
    height: 430,
    groupId: 'lane',
    layerId: 'agent-sketch',
    ...ink,
  },
  {
    id: 'box',
    shape: 'rect',
    x: 80,
    y: 64,
    width: 150,
    height: 90,
    groupId: 'lane',
    layerId: 'agent-sketch',
    ...ink,
  },
  {
    id: 'label',
    shape: 'text',
    x: 90,
    y: 80,
    text: 'Reverse-engineer APK',
    groupId: 'lane',
    layerId: 'agent-sketch',
    ...ink,
  },
  {
    id: 'connector',
    shape: 'arrow',
    points: [
      [150, 164],
      [150, 220],
    ],
    layerId: 'agent-sketch',
    ...ink,
  },
];

function expectClear(board: BoardDocument) {
  for (const drawing of drawingFootprints(board))
    for (const node of board.nodes) {
      const box = nodeFootprint(node, board.positions[node.id]!);
      if (blocksNode(drawing, box)) expect(overlaps(drawing, box), drawing.drawing.id).toBe(false);
    }
}

describe('collision-aware sketch placement', () => {
  it('moves a complete follow-up sketch off concept icons and labels without distorting it', async () => {
    const previous = fixture();
    const proposed = sketch.map((original) => {
      const drawing = { ...original };
      delete drawing.layerId;
      return drawing;
    });
    const result = await layoutBoard({ ...previous, drawings: proposed }, 'codex', previous);
    expectClear(result);
    expect(result.positions).toEqual(previous.positions);
    const frame = result.drawings!.find((drawing) => drawing.id === 'frame')!;
    const dx = frame.x! - sketch[0]!.x!;
    const dy = frame.y! - sketch[0]!.y!;
    expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
    for (const before of sketch) {
      const after = result.drawings!.find((drawing) => drawing.id === before.id)!;
      expect(after).toMatchObject({ shape: before.shape, layerId: before.layerId });
      if (before.x !== undefined) expect(after.x).toBeCloseTo(before.x + dx);
      if (before.y !== undefined) expect(after.y).toBeCloseTo(before.y + dy);
      if (before.points)
        expect(after.points).toEqual(before.points.map(([x, y]) => [x + dx, y + dy]));
    }
    expect(proposed[0]!.x).toBe(64);
  });

  it('keeps deliberate containment and clear layouts stable', () => {
    const board = fixture();
    board.drawings = [{ ...sketch[0]!, x: 0, y: 0, width: 500, height: 600 }];
    expect(settleAgentSketch(board)).toBe(board);
    board.drawings = sketch.map((drawing) => ({ ...drawing, x: (drawing.x ?? 0) + 1000 }));
    board.drawings = board.drawings.filter((drawing) => drawing.shape !== 'arrow');
    expect(settleAgentSketch(board)).toBe(board);
  });

  it('keeps anchored annotations attached while moving a colliding group together', () => {
    const board = fixture();
    board.drawings = [
      { ...sketch[1]!, anchorId: 'sender', x: 0, y: 300 },
      { ...sketch[2]!, anchorId: 'sender', x: 10, y: 310 },
    ];
    const result = settleAgentSketch(board);
    expectClear(result);
    const [box, label] = result.drawings!;
    expect(box!.anchorId).toBe('sender');
    expect(label!.anchorId).toBe('sender');
    expect(label!.x! - box!.x!).toBe(10);
    expect(label!.y! - box!.y!).toBe(10);
    expect(absoluteDrawing(label!, result.positions).x).toBe(
      result.positions.sender!.x + label!.x!,
    );
  });

  it.each(['drawing', 'layer', 'hidden'])('does not move a %s-locked or hidden sketch', (kind) => {
    const board = fixture();
    board.drawings = sketch.map((drawing) => ({
      ...drawing,
      ...(kind === 'drawing' && drawing.id === 'label' ? { locked: true } : {}),
    }));
    board.drawingLayers = [
      {
        ...AGENT_SKETCH_LAYER,
        ...(kind === 'layer' ? { locked: true } : {}),
        ...(kind === 'hidden' ? { hidden: true } : {}),
      },
    ];
    expect(settleAgentSketch(board)).toBe(board);
  });

  it('Arrange preserves drawing ownership, IDs, locks and reader geometry', async () => {
    const board = fixture();
    board.pinnedNodeIds = ['sender'];
    const reader = { ...sketch[1]!, id: 'reader', layerId: 'reader-layer', locked: true };
    board.drawings = [reader, { ...sketch[2]!, locked: true }];
    board.drawingLayers!.push({ id: 'reader-layer', name: 'Reader' });
    const result = await layoutBoard(board, board.agent, board, 900, 'pinned');
    expect(result.positions.sender).toEqual(board.positions.sender);
    expect(result.drawings).toEqual(board.drawings);
    expect(result.drawingLayers).toEqual(board.drawingLayers);
  });

  it('new concepts avoid existing visible reader text and blocks without moving old concepts', async () => {
    const board = fixture();
    board.drawingLayers!.push({ id: 'reader-layer', name: 'Reader' });
    board.drawings = [
      { ...sketch[1]!, layerId: 'reader-layer', x: 24, y: 500, width: 224, height: 130 },
      { ...sketch[2]!, layerId: 'reader-layer', x: 40, y: 520 },
    ];
    const graph = {
      ...board,
      drawings: undefined,
      nodes: [...board.nodes, { ...board.nodes[0]!, id: 'added' }],
      edges: [{ id: 'addition', source: 'app', target: 'added', label: 'Next' }],
    };
    const result = await layoutBoard(graph, 'codex', board);
    expect(result.positions.sender).toEqual(board.positions.sender);
    expect(result.positions.app).toEqual(board.positions.app);
    expect(result.drawings).toEqual(board.drawings);
    const added = nodeFootprint(
      result.nodes.find((node) => node.id === 'added')!,
      result.positions.added!,
    );
    for (const drawing of drawingFootprints(result)) expect(overlaps(drawing, added)).toBe(false);
  });
});

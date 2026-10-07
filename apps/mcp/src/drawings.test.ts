import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument, type BoardSnapshot } from '@opsis/schema';
import { CanvasError, updateDetails } from './canvas.js';
import { addDrawings, describeDrawings, removeDrawings, updateDrawing } from './drawings.js';

const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(
    EMAIL_DEMO.nodes.map((node, i) => [node.id, { x: 100, y: 100 + i * 240 }]),
  ),
};
const start: BoardSnapshot = { board, past: [], future: [] };
const sender = EMAIL_DEMO.nodes[0]!.id;

describe('agent drawing tools', () => {
  it('adds a blueprint in one undoable step, on named layers and following concepts', () => {
    const { snapshot, ids } = addDrawings(start, [
      { shape: 'rect', x: 0, y: 0, width: 480, height: 240, layer: 'Walls' },
      { shape: 'rect', x: 0, y: 0, width: 48, height: 48, layer: 'walls' },
      {
        shape: 'dimension',
        points: [
          [0, 260],
          [480, 260],
        ],
      },
      { shape: 'text', x: 110, y: 90, text: 'Pump', movesWith: sender, ink: 'coral' },
    ]);
    expect(ids).toEqual(['rect-1', 'rect-2', 'dimension-1', 'text-1']);
    expect(snapshot.past).toEqual([board]);
    const next = snapshot.board!;
    // Layer names match without regard to case; one layer is created.
    expect(next.drawingLayers).toEqual([{ id: 'layer-walls', name: 'Walls' }]);
    // A drawing that follows a concept is stored relative to it but read back absolute.
    expect(next.drawings![3]).toMatchObject({ x: 10, y: -10, anchorId: sender });
    expect(describeDrawings(next).drawings[3]).toMatchObject({
      x: 110,
      y: 90,
      movesWith: sender,
    });
    expect(describeDrawings(next).drawings[0]).toMatchObject({ layer: 'Walls', ink: 'ink' });
  });

  it('explains invalid shapes, unknown concepts and the drawing limit', () => {
    expect(() => addDrawings(start, [{ shape: 'line', points: [[0, 0]] as never }])).toThrow(
      CanvasError,
    );
    expect(() => addDrawings(start, [{ shape: 'rect', x: 0, y: 0 }])).toThrow(
      /Drawing 1: A box needs x, y, width and height/,
    );
    expect(() =>
      addDrawings(start, [{ shape: 'text', x: 0, y: 0, text: 'Hi', movesWith: 'nowhere' }]),
    ).toThrow(/No concept "nowhere"/);
    const many = Array.from({ length: 201 }, () => ({
      shape: 'rect' as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }));
    expect(() => addDrawings(start, many)).toThrow(/at most 200 drawings/);
  });

  it('updates and removes drawings but leaves locked ones to the reader', () => {
    const { snapshot } = addDrawings(start, [
      { shape: 'rect', x: 0, y: 0, width: 96, height: 48 },
      { shape: 'text', x: 0, y: 0, text: 'Keep' },
    ]);
    const moved = updateDrawing(snapshot, 'rect-1', {
      moveBy: [24, 24],
      width: 120,
      fill: true,
      movesWith: sender,
    });
    expect(describeDrawings(moved.board!).drawings[0]).toMatchObject({
      x: 24,
      y: 24,
      width: 120,
      fill: true,
      movesWith: sender,
    });
    const detached = updateDrawing(moved, 'rect-1', { movesWith: null, layer: 'Notes' });
    expect(detached.board!.drawings![0]).toMatchObject({ x: 24, y: 24, layerId: 'layer-notes' });
    expect(detached.board!.drawings![0]).not.toHaveProperty('anchorId');

    const locked: BoardSnapshot = {
      ...detached,
      board: {
        ...detached.board!,
        drawings: detached.board!.drawings!.map((item) =>
          item.id === 'text-1' ? { ...item, locked: true } : item,
        ),
      },
    };
    expect(describeDrawings(locked.board!).drawings[1]).toMatchObject({ locked: true });
    expect(() => updateDrawing(locked, 'text-1', { text: 'Changed' })).toThrow(/locked/);
    expect(() => removeDrawings(locked, ['rect-1', 'text-1'])).toThrow(/locked/);
    expect(removeDrawings(locked, ['rect-1']).board!.drawings!.map((item) => item.id)).toEqual([
      'text-1',
    ]);
    const lockedLayer: BoardSnapshot = {
      ...detached,
      board: {
        ...detached.board!,
        drawingLayers: [{ id: 'layer-notes', name: 'Notes', locked: true }],
      },
    };
    expect(() => removeDrawings(lockedLayer, ['rect-1'])).toThrow(/locked/);
    expect(() =>
      addDrawings(lockedLayer, [{ shape: 'text', x: 0, y: 0, text: 'x', layer: 'Notes' }]),
    ).toThrow(/Layer "Notes" is locked/);
    expect(() => updateDrawing(snapshot, 'missing', {})).toThrow(/No drawing "missing"/);
  });

  it('sets and clears the board scale', () => {
    const scaled = updateDetails(start, { drawingScale: { gridValue: 0.5, unit: 'm' } });
    expect(describeDrawings(scaled.board!).scale).toEqual({ gridValue: 0.5, unit: 'm' });
    expect(updateDetails(scaled, { drawingScale: null }).board).not.toHaveProperty('drawingScale');
    expect(updateDetails(scaled, { title: 'Kept' }).board!.drawingScale).toEqual({
      gridValue: 0.5,
      unit: 'm',
    });
  });
});

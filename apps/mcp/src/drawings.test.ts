import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument, type BoardSnapshot } from '@opsis/schema';
import { CanvasError, updateDetails } from './canvas.js';
import {
  addDrawings,
  describeDrawings,
  groupBoardDrawings,
  placeSymbols,
  removeDrawings,
  repeatBoardDrawings,
  transformDrawings,
  updateDrawing,
} from './drawings.js';

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

describe('agent shapes, symbols and transforms', () => {
  it('adds paths, polygons and arcs with styles, and clears a style with null', () => {
    const { snapshot, ids } = addDrawings(start, [
      { shape: 'path', d: 'M0 0C40 -40 80 40 120 0', endMarker: 'arrow', line: 'dotted' },
      {
        shape: 'polygon',
        points: [
          [0, 100],
          [80, 100],
          [40, 160],
        ],
        fillInk: 'coral',
        hatch: 'cross',
        group: 'zone',
      },
      {
        shape: 'arc',
        points: [
          [0, 200],
          [40, 160],
          [80, 200],
        ],
      },
    ]);
    expect(ids).toEqual(['path-1', 'polygon-1', 'arc-1']);
    const shown = describeDrawings(snapshot.board!).drawings;
    expect(shown[0]).toMatchObject({
      d: 'M0 0C40 -40 80 40 120 0',
      endMarker: 'arrow',
      line: 'dotted',
    });
    expect(shown[0]!.bounds).toMatchObject({ x: 0, width: 120 });
    expect(shown[1]).toMatchObject({ fillInk: 'coral', hatch: 'cross', group: 'zone' });
    expect(snapshot.board!.drawings![1]!.groupId).toBe('zone');
    const cleared = updateDrawing(snapshot, 'polygon-1', { hatch: null, group: null });
    expect(cleared.board!.drawings![1]).not.toHaveProperty('hatch');
    expect(cleared.board!.drawings![1]).not.toHaveProperty('groupId');
    expect(() => addDrawings(start, [{ shape: 'path', d: 'not a path' }])).toThrow(CanvasError);
  });

  it('places labelled symbols as uniquely named groups that follow concepts', () => {
    const { snapshot, placed } = placeSymbols(start, [
      { symbol: 'valve', x: 300, y: 300, label: 'V-1', layer: 'Piping' },
      { symbol: 'valve', x: 400, y: 300, movesWith: sender },
    ]);
    expect(placed.map((item) => item.group)).toEqual(['valve-1', 'valve-2']);
    const drawings = snapshot.board!.drawings!;
    expect(drawings.filter((drawing) => drawing.groupId === 'valve-1')).toHaveLength(3);
    expect(drawings.find((drawing) => drawing.groupId === 'valve-1')!.layerId).toBe('layer-piping');
    expect(drawings.find((drawing) => drawing.groupId === 'valve-2')!.anchorId).toBe(sender);
    expect(snapshot.past).toEqual([board]);
    // A third valve does not reuse a group name already on the board.
    const again = placeSymbols(snapshot, [{ symbol: 'valve', x: 0, y: 0 }]);
    expect(again.placed[0]!.group).toBe('valve-3');
  });

  it('transforms groups as one piece, about their shared centre or each their own', () => {
    const { snapshot } = placeSymbols(start, [
      { symbol: 'resistor', x: 100, y: 100 },
      { symbol: 'resistor', x: 300, y: 100 },
    ]);
    const before = describeDrawings(snapshot.board!).drawings;
    const moved = transformDrawings(snapshot, { groups: ['resistor-1'], moveBy: [0, 48] });
    const after = describeDrawings(moved.board!).drawings;
    expect(after[0]!.bounds.y).toBe(before[0]!.bounds.y + 48);
    expect(after[1]).toEqual(before[1]);
    // Turned together, the two resistors swap from a row to a column.
    const column = describeDrawings(
      transformDrawings(snapshot, { groups: ['resistor-1', 'resistor-2'], rotate: 90 }).board!,
    ).drawings;
    expect(column[0]!.bounds.x).toBe(column[1]!.bounds.x);
    // Turned each on its own centre, they stay in a row.
    const each = describeDrawings(
      transformDrawings(snapshot, {
        groups: ['resistor-1', 'resistor-2'],
        rotate: 90,
        about: 'each',
      }).board!,
    ).drawings;
    expect(each[0]!.bounds.y).toBe(each[1]!.bounds.y);
    const aligned = describeDrawings(
      transformDrawings(moved, { groups: ['resistor-1', 'resistor-2'], align: 'top' }).board!,
    ).drawings;
    expect(aligned[0]!.bounds.y).toBe(aligned[1]!.bounds.y);
    expect(() => transformDrawings(snapshot, {})).toThrow('Name drawings');
    expect(() => transformDrawings(snapshot, { groups: ['nope'] })).toThrow('No drawings in group');
  });

  it('repeats, groups and refuses locked drawings', () => {
    const { snapshot } = addDrawings(start, [{ shape: 'rect', x: 0, y: 0, width: 24, height: 24 }]);
    const repeated = repeatBoardDrawings(snapshot, {
      drawingIds: ['rect-1'],
      count: 3,
      step: [48, 0],
    });
    expect(repeated.drawingIds).toEqual(['rect-2', 'rect-3', 'rect-4']);
    expect(repeated.snapshot.board!.drawings!.map((drawing) => drawing.x)).toEqual([
      0, 48, 96, 144,
    ]);
    const grouped = groupBoardDrawings(repeated.snapshot, ['rect-1', 'rect-2'], 'posts');
    expect(grouped.board!.drawings!.filter((drawing) => drawing.groupId === 'posts')).toHaveLength(
      2,
    );
    const locked: BoardSnapshot = {
      ...grouped,
      board: {
        ...grouped.board!,
        drawings: grouped.board!.drawings!.map((drawing) =>
          drawing.id === 'rect-2' ? { ...drawing, locked: true } : drawing,
        ),
      },
    };
    expect(() => transformDrawings(locked, { groups: ['posts'], moveBy: [1, 1] })).toThrow(
      'locked',
    );
  });
});

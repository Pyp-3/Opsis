import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createEmptyBoard, EMAIL_DEMO, type BoardDrawing } from '@opsis/schema';
import { layoutBoard, withoutIllustrations } from './model';
import {
  drawingAt,
  drawingClipboard,
  drawingContains,
  drawingsInBox,
  handleAt,
  pasteDrawings,
  readDrawingClipboard,
  resizeDrawing,
  resizeHandles,
  rotateDrawing,
  rotateDrawingAbout,
  groupRotationCentre,
  simplifyStroke,
  strokePath,
} from './canvas-drawing';
import { DrawingShape } from './DrawingShape';
import { boardSvg } from './export';

const ink = { ink: 'mint', line: 'solid', strokeWidth: 2 } as const;
const box: BoardDrawing = { id: 'box', shape: 'rect', x: 0, y: 0, width: 100, height: 60, ...ink };

describe('canvas drawing geometry', () => {
  it('keeps sketches and explicit board links when chat regenerates the diagram', async () => {
    const destination = '00000000-0000-4000-8000-000000000001';
    const previous = await layoutBoard(EMAIL_DEMO, 'demo');
    previous.nodes[0]!.linkedBoardId = destination;
    previous.drawings = [box];
    const next = await layoutBoard({ ...EMAIL_DEMO, title: 'Chat revision' }, 'demo', previous);
    expect(next.nodes[0]!.linkedBoardId).toBe(destination);
    expect(next.drawings).toEqual([box]);
  });
  it('keeps drawing layers and the scale through regeneration, sending only the scale', async () => {
    const previous = await layoutBoard(EMAIL_DEMO, 'demo');
    previous.drawings = [{ ...box, layerId: 'plan' }];
    previous.drawingLayers = [{ id: 'plan', name: 'Plan', locked: true }];
    previous.drawingScale = { gridValue: 0.5, unit: 'm' };
    const next = await layoutBoard({ ...EMAIL_DEMO, title: 'Again' }, 'demo', previous);
    expect(next.drawingLayers).toEqual(previous.drawingLayers);
    expect(next.drawingScale).toEqual(previous.drawingScale);
    const sent = withoutIllustrations(previous);
    expect(sent).not.toHaveProperty('drawingLayers');
    expect(sent).not.toHaveProperty('drawings');
    // Dimension labels in an agent's sketch should use the board's units.
    expect(sent.drawingScale).toEqual({ gridValue: 0.5, unit: 'm' });
  });

  it('places an agent sketch on its own layer and shows the agent only that sketch', async () => {
    const free = { ...box, id: 'room', x: 0, y: 0 };
    const label: BoardDrawing = {
      id: 'label',
      shape: 'text',
      anchorId: 'outgoing',
      x: 0,
      y: -24,
      text: 'Servers',
      ...ink,
    };
    // A new diagram: the free-standing part is placed beside it as a group.
    const fresh = await layoutBoard({ ...EMAIL_DEMO, drawings: [free, label] }, 'claude');
    const right = Math.max(...Object.values(fresh.positions).map((at) => at.x)) + 224;
    const room = fresh.drawings!.find((item) => item.id === 'room')!;
    expect(room).toMatchObject({ layerId: 'agent-sketch' });
    expect(room.x).toBe(right + 96);
    expect(fresh.drawingLayers).toEqual([{ id: 'agent-sketch', name: 'Agent sketch' }]);
    expect(fresh.drawings!.find((item) => item.id === 'label')!.anchorId).toBe('outgoing');

    // A follow-up keeps the reader's drawings, renames a clashing id and sends only the sketch.
    const previous = { ...fresh, drawings: [box, ...fresh.drawings!] };
    expect(withoutIllustrations(previous).drawings!.map((item) => item.id)).toEqual([
      'room',
      'label',
    ]);
    expect(withoutIllustrations(previous).drawings![0]).not.toHaveProperty('layerId');
    const next = await layoutBoard(
      { ...EMAIL_DEMO, drawings: [{ ...label, id: 'box', text: 'Mail servers' }] },
      'claude',
      previous,
    );
    expect(next.drawings!.map((item) => [item.id, item.layerId])).toEqual([
      ['box', undefined],
      ['box-agent', 'agent-sketch'],
    ]);
    // Leaving the sketch out keeps it; a locked agent layer is neither shown nor changed.
    const unchanged = await layoutBoard(EMAIL_DEMO, 'claude', previous);
    expect(unchanged.drawings).toEqual(previous.drawings);
    const locked = {
      ...previous,
      drawingLayers: [{ id: 'agent-sketch', name: 'Agent sketch', locked: true }],
    };
    expect(withoutIllustrations(locked)).not.toHaveProperty('drawings');
    const ignored = await layoutBoard({ ...EMAIL_DEMO, drawings: [] }, 'claude', locked);
    expect(ignored.drawings).toEqual(previous.drawings);
  });
  it('hits outlines, filled interiors and lines within a tolerance', () => {
    expect(drawingContains(box, [50, 1], 4)).toBe(true);
    expect(drawingContains(box, [50, 30], 4)).toBe(false);
    expect(drawingContains({ ...box, fill: true }, [50, 30], 4)).toBe(true);
    const line: BoardDrawing = {
      id: 'l',
      shape: 'line',
      points: [
        [0, 0],
        [100, 100],
      ],
      ...ink,
    };
    expect(drawingContains(line, [52, 48], 4)).toBe(true);
    expect(drawingContains(line, [80, 20], 4)).toBe(false);
  });

  it('picks the topmost drawing, following anchored drawings to their concept', () => {
    const board = {
      ...createEmptyBoard(),
      nodes: [
        {
          id: 'n',
          label: 'N',
          icon: 'lightbulb' as const,
          summary: 'S',
          explanation: 'E',
          kind: 'step' as const,
        },
      ],
      positions: { n: { x: 500, y: 500 } },
      drawings: [box, { ...box, id: 'top', fill: true }, { ...box, id: 'moved', anchorId: 'n' }],
    };
    expect(drawingAt(board, [50, 30], 4)?.id).toBe('top');
    expect(drawingAt(board, [550, 501], 4)?.id).toBe('moved');
    expect(drawingAt(board, [300, 300], 4)).toBeNull();
  });

  it('thins dense freehand samples and keeps the final point', () => {
    const points = Array.from({ length: 100 }, (_, i) => [i * 0.5, 0] as const);
    const simplified = simplifyStroke(points);
    expect(simplified.length).toBeLessThan(20);
    expect(simplified.at(-1)).toEqual([49.5, 0]);
    expect(strokePath(simplified)).toMatch(/^M0 0Q/);
  });

  it('draws text as escaped text and exports drawings with the board', () => {
    const text: BoardDrawing = { id: 't', shape: 'text', x: 0, y: 0, text: '<b>Hall</b>', ...ink };
    const markup = renderToStaticMarkup(
      createElement(DrawingShape, { drawing: text, halo: '#000' }),
    );
    expect(markup).toContain('&lt;b&gt;Hall&lt;/b&gt;');
    expect(markup).not.toContain('<b>');
    const svg = boardSvg({ ...createEmptyBoard(), drawings: [box, text] });
    expect(svg).toContain('<rect x="0" y="0" width="100" height="60"');
    expect(svg).toContain('&lt;b&gt;Hall');
  });

  it('resizes boxes from any handle, keeping proportion on request, and moves line ends', () => {
    expect(handleAt(box, [100, 60], 5)).toBe('se');
    expect(handleAt(box, [50, 30], 5)).toBeNull();
    expect(resizeDrawing(box, 'se', [148, 90])).toMatchObject({ width: 148, height: 90 });
    expect(resizeDrawing(box, 'w', [-20, 10])).toMatchObject({ x: -20, width: 120, height: 60 });
    // Dragging past the opposite side flips rather than inverting the box.
    expect(resizeDrawing(box, 'e', [-40, 0])).toMatchObject({ x: -40, width: 40 });
    expect(resizeDrawing(box, 'se', [200, 70], true)).toMatchObject({ width: 200, height: 120 });
    const line: BoardDrawing = {
      id: 'l',
      shape: 'dimension',
      points: [
        [0, 0],
        [48, 0],
      ],
      ...ink,
    };
    expect(handleAt(line, [48, 1], 4)).toBe('end');
    expect(resizeDrawing(line, 'end', [96, 24]).points).toEqual([
      [0, 0],
      [96, 24],
    ]);
    const stroke: BoardDrawing = {
      id: 's',
      shape: 'stroke',
      points: [
        [0, 0],
        [10, 20],
        [20, 0],
      ],
      ...ink,
    };
    expect(resizeDrawing(stroke, 'se', [40, 40]).points).toEqual([
      [0, 0],
      [20, 40],
      [40, 0],
    ]);
  });

  it('selects pickable drawings that a dragged rectangle overlaps', () => {
    const board = createEmptyBoard('Plan');
    const far = { ...box, id: 'far', x: 500, y: 500 };
    const locked = { ...box, id: 'locked', x: 20, layerId: 'fixed' };
    board.drawings = [box, far, locked];
    board.drawingLayers = [{ id: 'fixed', name: 'Fixed', locked: true }];
    expect(drawingsInBox(board, [-10, -10], [30, 30]).map((item) => item.id)).toEqual(['box']);
    expect(drawingAt(board, [120, 1], 4)).toBeNull();
  });

  it('copies drawings as validated text and pastes offset copies with new ids', () => {
    const board = createEmptyBoard('Plan');
    board.nodes = [{ ...EMAIL_DEMO.nodes[0]!, id: 'pump' }];
    board.positions = { pump: { x: 100, y: 100 } };
    const anchored = { ...box, id: 'anchored', x: 10, y: 10, anchorId: 'pump', locked: true };
    board.drawings = [box, anchored];
    const text = drawingClipboard(board, ['anchored']);
    const copied = readDrawingClipboard(text)!;
    expect(copied).toEqual([{ ...anchored, x: 110, y: 110 }]);
    let next = 0;
    const pasted = pasteDrawings(board, copied, 24, () => `copy-${++next}`)!;
    expect(pasted.ids).toEqual(['copy-1']);
    // A copy on the same board keeps following its concept, is offset and is never locked.
    expect(pasted.board.drawings![2]).toEqual({
      ...box,
      id: 'copy-1',
      x: 34,
      y: 34,
      anchorId: 'pump',
    });
    // Elsewhere it is fixed to the canvas on the base layer.
    const other = createEmptyBoard('Elsewhere');
    expect(
      pasteDrawings(other, [{ ...copied[0]!, layerId: 'gone' }], 0, () => 'x')!.board.drawings,
    ).toEqual([{ ...box, id: 'x', x: 110, y: 110 }]);
    expect(readDrawingClipboard('{"kind":"opsis-drawings","drawings":[{"id":"bad"}]}')).toEqual([]);
    expect(readDrawingClipboard('plain words')).toBeNull();
    const full = createEmptyBoard('Full');
    full.drawings = Array.from({ length: 200 }, (_, index) => ({ ...box, id: `d${index}` }));
    expect(pasteDrawings(full, copied, 24, () => 'x')).toBeNull();
  });

  it('exports visible layers in order with dimensions in the board scale', () => {
    const board = createEmptyBoard('Plan');
    board.drawings = [
      { ...box, id: 'hidden', width: 137, layerId: 'draft' },
      {
        id: 'size',
        shape: 'dimension',
        points: [
          [0, 0],
          [48, 0],
        ],
        ...ink,
      },
    ];
    board.drawingLayers = [{ id: 'draft', name: 'Draft', hidden: true }];
    board.drawingScale = { gridValue: 1.5, unit: 'm' };
    const svg = boardSvg(board);
    expect(svg).toContain('>3 m<');
    expect(svg).not.toContain('width="137"');
    expect(boardSvg({ ...board, drawingLayers: [{ id: 'draft', name: 'Draft' }] })).toContain(
      'width="137"',
    );
  });

  it('rotates boxes about their centre and turns the points of lines and strokes', () => {
    const turned = rotateDrawing(box, 90);
    expect(turned.rotation).toBe(90);
    expect(rotateDrawing(turned, 270)).not.toHaveProperty('rotation');
    expect(rotateDrawing(box, -200).rotation).toBe(160);
    // The turned box is hit where it is painted, not where it stood.
    expect(drawingContains(turned, [50, 1], 2)).toBe(false);
    expect(drawingContains(turned, [20, 30], 2)).toBe(true);
    const line: BoardDrawing = {
      id: 'l',
      shape: 'line',
      points: [
        [0, 0],
        [40, 0],
      ],
      ...ink,
    };
    expect(rotateDrawing(line, 90).points).toEqual([
      [20, -20],
      [20, 20],
    ]);
    expect(rotateDrawing(line, 90)).not.toHaveProperty('rotation');
    // The rotation handle sits above the top edge and turns with the shape.
    const handle = resizeHandles(turned, 24).find((item) => item.handle === 'rotate')!;
    expect(handle.at[0]).toBeCloseTo(104);
    expect(handle.at[1]).toBeCloseTo(30);
  });

  it('turns several drawings together about the centre of their combined outline', () => {
    // A 100×60 box at the origin and a line to its right, spanning x 0–200, y 0–60.
    const line: BoardDrawing = {
      id: 'l',
      shape: 'line',
      points: [
        [160, 0],
        [200, 0],
      ],
      ...ink,
    };
    const centre = groupRotationCentre([box, line]);
    expect(centre).toEqual([100, 30]);
    // The box's centre (50, 30) travels to (100, -20) and the box turns by the same angle.
    const turnedBox = rotateDrawingAbout(box, 90, centre);
    expect(turnedBox).toMatchObject({ x: 50, y: -50, width: 100, height: 60, rotation: 90 });
    expect(rotateDrawingAbout(line, 90, centre).points).toEqual([
      [130, 90],
      [130, 130],
    ]);
    // A full turn in quarters brings the group back where it started.
    let back = box;
    for (let i = 0; i < 4; i++) back = rotateDrawingAbout(back, 90, centre);
    expect(back).toEqual(box);
  });

  it('resizes a rotated box in its own frame, keeping the opposite corner in place', () => {
    const turned = { ...box, rotation: 90 };
    const corner = (drawing: BoardDrawing, which: string) =>
      resizeHandles(drawing).find((item) => item.handle === which)!.at;
    const fixed = corner(turned, 'nw');
    const dragged = corner(turned, 'se');
    const resized = resizeDrawing(turned, 'se', [dragged[0], dragged[1] + 40]);
    expect(resized).toMatchObject({ width: 140, height: 60, rotation: 90 });
    const after = corner(resized, 'nw');
    expect(after[0]).toBeCloseTo(fixed[0]);
    expect(after[1]).toBeCloseTo(fixed[1]);
  });

  it('sizes text letters from its corner handles', () => {
    const text: BoardDrawing = {
      id: 't',
      shape: 'text',
      x: 0,
      y: 0,
      text: 'Pump',
      fontSize: 16,
      ...ink,
    };
    expect(resizeHandles(text).map((item) => item.handle)).toEqual([
      'nw',
      'ne',
      'se',
      'sw',
      'rotate',
    ]);
    const bigger = resizeDrawing(text, 'se', [76.8, 40]);
    expect(bigger).toMatchObject({ x: 0, y: 0, fontSize: 32 });
    expect(resizeDrawing(text, 'se', [1, 1]).fontSize).toBe(8);
    // Dragging the top-left corner keeps the bottom-right corner where it was.
    const fromTop = resizeDrawing(text, 'nw', [-38.4, -20]);
    expect(fromTop.fontSize).toBe(32);
    expect(fromTop.x).toBeCloseTo(-38.4);
    expect(fromTop.y).toBeCloseTo(-20);
  });
});

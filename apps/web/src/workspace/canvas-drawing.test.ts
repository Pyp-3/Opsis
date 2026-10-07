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
  it('keeps drawing layers and the scale through regeneration, and never sends them', async () => {
    const previous = await layoutBoard(EMAIL_DEMO, 'demo');
    previous.drawings = [{ ...box, layerId: 'plan' }];
    previous.drawingLayers = [{ id: 'plan', name: 'Plan', locked: true }];
    previous.drawingScale = { gridValue: 0.5, unit: 'm' };
    const next = await layoutBoard({ ...EMAIL_DEMO, title: 'Again' }, 'demo', previous);
    expect(next.drawingLayers).toEqual(previous.drawingLayers);
    expect(next.drawingScale).toEqual(previous.drawingScale);
    const sent = withoutIllustrations(previous);
    expect(sent).not.toHaveProperty('drawingLayers');
    expect(sent).not.toHaveProperty('drawingScale');
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
});

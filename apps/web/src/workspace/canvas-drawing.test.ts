import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createEmptyBoard, EMAIL_DEMO, type BoardDrawing } from '@opsis/schema';
import { layoutBoard } from './model';
import { drawingAt, drawingContains, simplifyStroke, strokePath } from './canvas-drawing';
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
});

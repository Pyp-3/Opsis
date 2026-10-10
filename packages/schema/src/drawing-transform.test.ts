import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument } from './board';
import { createEmptyBoard } from './board-operations';
import { drawingFrame, type BoardDrawing } from './board-drawings';
import { boardPreviewSvg, previewSvgProblem } from './board-preview';
import { DRAWING_SYMBOLS, placeSymbol } from './drawing-symbols';
import { drawingSvg } from './drawing-svg';
import {
  alignDrawings,
  distributeDrawings,
  drawingsBox,
  mirrorDrawing,
  repeatDrawings,
  rotateDrawingAbout,
  scaleDrawingAbout,
} from './drawing-transform';

const style = { ink: 'ink', line: 'solid', strokeWidth: 2 } as const;
const box = (
  id: string,
  x: number,
  y: number,
  extra: Partial<BoardDrawing> = {},
): BoardDrawing => ({
  id,
  shape: 'rect',
  x,
  y,
  width: 40,
  height: 20,
  ...style,
  ...extra,
});

describe('drawing transforms', () => {
  it('scales points, paths, boxes and text about a centre', () => {
    const path: BoardDrawing = { id: 'p', shape: 'path', d: 'M0 0L10 10', ...style };
    expect(scaleDrawingAbout(path, 2, 3, [0, 0]).d).toBe('M0 0L20 30');
    // A box keeps its centre's place relative to the pivot and grows about it.
    expect(scaleDrawingAbout(box('b', 0, 0), 2, 2, [0, 0])).toMatchObject({
      x: 0,
      y: 0,
      width: 80,
      height: 40,
    });
    // A quarter-turned box applies the factors along its own axes.
    expect(scaleDrawingAbout(box('r', 0, 0, { rotation: 90 }), 1, 2, [20, 10])).toMatchObject({
      width: 80,
      height: 20,
    });
    const words: BoardDrawing = {
      id: 't',
      shape: 'text',
      x: 0,
      y: 0,
      text: 'Hi',
      fontSize: 16,
      ...style,
    };
    expect(scaleDrawingAbout(words, 2, 2, [0, 0]).fontSize).toBe(32);
  });

  it('mirrors shapes and turns turned boxes the other way, keeping text readable', () => {
    const line: BoardDrawing = {
      id: 'l',
      shape: 'arrow',
      points: [
        [0, 0],
        [30, 10],
      ],
      ...style,
    };
    expect(mirrorDrawing(line, 'horizontal', [50, 0]).points).toEqual([
      [100, 0],
      [70, 10],
    ]);
    expect(mirrorDrawing(box('b', 0, 0, { rotation: 30 }), 'vertical', [0, 50])).toMatchObject({
      x: 0,
      y: 80,
      rotation: -30,
    });
    const words: BoardDrawing = {
      id: 't',
      shape: 'text',
      x: 0,
      y: 0,
      text: 'Hi',
      ...style,
      rotation: 10,
    };
    expect(mirrorDrawing(words, 'horizontal', [100, 0]).rotation).toBe(10);
  });

  it('turns a group about a shared centre, keeping its arrangement', () => {
    const turned = rotateDrawingAbout(box('b', 100, 0), 90, [0, 0]);
    // The box's centre (120, 10) travels to (-10, 120) and the box turns a quarter.
    expect(drawingFrame(turned).centre).toEqual([-10, 120]);
    expect(turned.rotation).toBe(90);
  });

  it('aligns and evenly spaces drawings, moving groups as one piece', () => {
    const drawings = [
      box('a', 0, 0),
      box('b', 100, 30),
      box('c1', 300, 10, { groupId: 'g' }),
      box('c2', 300, 50, { groupId: 'g' }),
    ];
    const left = alignDrawings(drawings, 'left');
    expect(left.map((drawing) => drawing.x)).toEqual([0, 0, 0, 0]);
    const top = alignDrawings(drawings, 'top');
    // The group's top edge moves to 0; its second member keeps its 40 offset.
    expect(top.map((drawing) => drawing.y)).toEqual([0, 0, 0, 40]);
    const spaced = distributeDrawings(
      [box('a', 0, 0), box('b', 50, 0), box('c', 300, 0)],
      'horizontal',
    );
    // Gaps between boxes become equal: (340 - 120) / 2 = 110.
    expect(spaced.map((drawing) => drawing.x)).toEqual([0, 150, 300]);
  });

  it('repeats drawings with new ids and new groups for each copy', () => {
    const copies = repeatDrawings(
      [box('post', 0, 0, { groupId: 'g' })],
      3,
      [48, 0],
      (drawing, copy) => `${drawing.id}-${copy}`,
      (group, copy) => `${group}-${copy}`,
    );
    expect(copies.map((drawing) => [drawing.id, drawing.x, drawing.groupId])).toEqual([
      ['post-1', 48, 'g-1'],
      ['post-2', 96, 'g-2'],
      ['post-3', 144, 'g-3'],
    ]);
  });
});

describe('drawing symbols', () => {
  it('places every symbol as valid drawings in one group, centred where asked', () => {
    for (const symbol of DRAWING_SYMBOLS) {
      const drawings = placeSymbol(
        symbol.name,
        { x: 500, y: 300 },
        { groupId: 'g', idPrefix: 's' },
      );
      expect(drawings.every((drawing) => drawing.groupId === 'g')).toBe(true);
      expect(new Set(drawings.map((drawing) => drawing.id)).size).toBe(drawings.length);
      const area = drawingsBox(drawings);
      expect(Math.abs(area.x + area.width / 2 - 500)).toBeLessThan(symbol.width / 2 + 1);
      expect(Math.abs(area.y + area.height / 2 - 300)).toBeLessThan(symbol.height / 2 + 1);
    }
  });

  it('sizes, turns, mirrors and labels a symbol', () => {
    const door = placeSymbol('door', { x: 0, y: 0, width: 96 }, { groupId: 'g', idPrefix: 'd' });
    expect(drawingsBox(door).width).toBeCloseTo(96, 0);
    const resistor = placeSymbol(
      'resistor',
      { x: 0, y: 0, rotation: 90 },
      { groupId: 'g', idPrefix: 'r' },
    );
    const upright = drawingsBox(resistor);
    expect(upright.height).toBeGreaterThan(upright.width);
    const labelled = placeSymbol(
      'valve',
      { x: 0, y: 0, label: 'V-101', ink: 'sky' },
      { groupId: 'g', idPrefix: 'v' },
    );
    expect(labelled.at(-1)).toMatchObject({
      shape: 'text',
      text: 'V-101',
      align: 'middle',
      ink: 'sky',
    });
    expect(() => placeSymbol('teapot', { x: 0, y: 0 }, { groupId: 'g', idPrefix: 't' })).toThrow(
      'Unknown symbol',
    );
  });
});

describe('drawing markup', () => {
  it('paints fills, hatching, markers, text styles and opacity', () => {
    const hatched = drawingSvg(
      {
        id: 'zone',
        shape: 'polygon',
        points: [
          [0, 0],
          [40, 0],
          [20, 30],
        ],
        ...style,
        fillInk: 'coral',
        fillOpacity: 0.4,
        hatch: 'diagonal',
        opacity: 0.5,
      },
      { halo: '#000' },
    );
    expect(hatched).toContain('<pattern id="opsis-hatch-zone"');
    expect(hatched).toContain('fill="url(#opsis-hatch-zone)"');
    expect(hatched).toContain('fill-opacity="0.4"');
    expect(hatched).toMatch(/^<g opacity="0.5">/);
    // An arrow keeps its arrowhead; a line gains the markers it is given.
    const arrow = drawingSvg(
      {
        id: 'a',
        shape: 'arrow',
        points: [
          [0, 0],
          [50, 0],
        ],
        ...style,
      },
      { halo: '#000' },
    );
    expect(arrow.match(/<path/g)).toHaveLength(2);
    const ended = drawingSvg(
      {
        id: 'l',
        shape: 'line',
        points: [
          [0, 0],
          [50, 0],
        ],
        ...style,
        startMarker: 'dot',
        endMarker: 'bar',
      },
      { halo: '#000' },
    );
    expect(ended.match(/<path/g)).toHaveLength(3);
    const words = drawingSvg(
      {
        id: 't',
        shape: 'text',
        x: 10,
        y: 0,
        text: 'A & <B>',
        align: 'middle',
        bold: true,
        background: true,
        ...style,
      },
      { halo: '#000' },
    );
    expect(words).toContain('text-anchor="middle"');
    expect(words).toContain('font-weight="700"');
    expect(words).toMatch(/^<rect/);
    expect(words).toContain('A &amp; &lt;B&gt;');
  });
});

describe('board preview', () => {
  const board: BoardDocument = {
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    positions: { sender: { x: 0, y: 0 } },
    drawings: [
      { id: 'wall', shape: 'path', d: 'M0 300C100 250 200 350 300 300', ...style },
      { id: 'note', shape: 'text', x: 0, y: 400, text: 'Pump <room>', ...style },
    ],
  } as BoardDocument;

  it('pictures concepts, connections and drawings with rulers, safely', () => {
    const preview = boardPreviewSvg(board);
    expect(previewSvgProblem(preview.svg)).toBeNull();
    expect(preview.svg).toContain('d="M0 300C100 250 200 350 300 300"');
    expect(preview.svg).toContain('Pump &lt;room&gt;');
    expect(preview.svg).toContain(EMAIL_DEMO.nodes.find((node) => node.id === 'sender')!.label);
    expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(1400);
    const region = boardPreviewSvg(board, {
      region: { x: 0, y: 250, width: 300, height: 100 },
      maxSize: 600,
    });
    expect(region.svg).toContain('viewBox="0 250 300 100"');
    expect(region.width).toBe(600);
    expect(boardPreviewSvg(createEmptyBoard()).svg).toContain('<svg');
  });

  it('refuses markup a rasteriser could use to load something', () => {
    const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    expect(previewSvgProblem(wrap('<rect x="0" y="0" width="1" height="1"/>'))).toBeNull();
    for (const bad of [
      wrap('<image href="file:///etc/passwd"/>'),
      wrap('<use xlink:href="#a"/>'),
      wrap('<script>alert(1)</script>'),
      wrap('<foreignObject></foreignObject>'),
      wrap('<rect fill="url(http://example.com/a)"/>'),
      wrap('<rect onload="x()"/>'),
      '<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///etc/passwd">]>' + wrap(''),
      '<html></html>',
    ])
      expect(previewSvgProblem(bad)).not.toBeNull();
  });
});

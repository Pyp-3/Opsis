import { describe, expect, it } from 'vitest';
import {
  arcPathData,
  arcThrough,
  mapPath,
  normalizePath,
  pathDataProblem,
  samplePath,
  serializePath,
} from './drawing-path';
import {
  BoardDrawingSchema,
  drawingOutlinePoints,
  drawingPolylines,
  translateDrawing,
  type BoardDrawing,
} from './board-drawings';

const style = { ink: 'ink', line: 'solid', strokeWidth: 2 } as const;

describe('drawing paths', () => {
  it('normalises relative, shorthand and arc commands to absolute curves', () => {
    expect(serializePath(normalizePath('m10 10 h20 v10 l-5 5 z')!)).toBe(
      'M10 10L30 10L30 20L25 25Z',
    );
    // S reflects the previous control point; T the previous quadratic one.
    expect(serializePath(normalizePath('M0 0C10 0 20 10 30 10S50 20 60 20')!)).toBe(
      'M0 0C10 0 20 10 30 10C40 10 50 20 60 20',
    );
    expect(serializePath(normalizePath('M0 0Q10 10 20 0T40 0')!)).toBe(
      'M0 0Q10 10 20 0Q30 -10 40 0',
    );
    // A semicircle becomes cubic curves that still end where the arc did.
    const arc = normalizePath('M0 0A10 10 0 0 1 20 0')!;
    expect(arc.slice(1).every((segment) => segment.command === 'C')).toBe(true);
    expect(arc.at(-1)).toMatchObject({ to: [20, 0] });
    // Flags written without spaces are read one digit each.
    expect(normalizePath('M0 0a10 10 0 0120 0')).toEqual(arc);
  });

  it('rejects anything that is not path data', () => {
    for (const bad of ['L0 0', 'M0 0 X5', 'M0 0 L1', '<script>', 'M0 0 A1 1 0 2 1 5 5', ''])
      expect(normalizePath(bad)).toBeNull();
    expect(pathDataProblem('M0 0' + 'L1 1'.repeat(601))).toMatch(/at most 600 segments/);
    expect(pathDataProblem('M0 0L10 10')).toBeNull();
  });

  it('transforms exactly and samples each subpath', () => {
    expect(mapPath('M0 0C10 0 20 10 30 10', ([x, y]) => [x + 5, y * 2])).toBe(
      'M5 0C15 0 25 20 35 20',
    );
    const lines = samplePath('M0 0L10 0M0 10Q5 20 10 10Z', 4);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([
      [0, 0],
      [10, 0],
    ]);
    // The quadratic peaks halfway, then the close returns to its start.
    expect(lines[1]![2]).toEqual([5, 15]);
    expect(lines[1]!.at(-1)).toEqual([0, 10]);
  });

  it('draws an arc through its middle point, or a line when the points are in a line', () => {
    const arc = arcThrough([
      [0, 0],
      [50, -50],
      [100, 0],
    ])!;
    expect(arc.centre.map(Math.round)).toEqual([50, 0]);
    expect(arc.radius).toBeCloseTo(50);
    expect(
      arcPathData([
        [0, 0],
        [50, -50],
        [100, 0],
      ]),
    ).toBe('M0 0A50 50 0 0 1 100 0');
    // Passing below instead sweeps the other way.
    expect(
      arcPathData([
        [0, 0],
        [50, 50],
        [100, 0],
      ]),
    ).toBe('M0 0A50 50 0 0 0 100 0');
    // A long way round is the large arc.
    expect(
      arcPathData([
        [0, 0],
        [50, 60],
        [10, -20],
      ]),
    ).toMatch(/ 1 [01] 10 -20$/);
    expect(
      arcPathData([
        [0, 0],
        [5, 5],
        [10, 10],
      ]),
    ).toBe('M0 0L10 10');
  });
});

describe('polygon, arc and path drawings', () => {
  it('validates each shape’s geometry', () => {
    const ok = (drawing: object) =>
      BoardDrawingSchema.safeParse({ id: 'd', ...style, ...drawing }).success;
    expect(
      ok({
        shape: 'polygon',
        points: [
          [0, 0],
          [10, 0],
          [5, 8],
        ],
      }),
    ).toBe(true);
    expect(
      ok({
        shape: 'polygon',
        points: [
          [0, 0],
          [10, 0],
        ],
      }),
    ).toBe(false);
    expect(
      ok({
        shape: 'arc',
        points: [
          [0, 0],
          [5, 5],
          [10, 0],
        ],
      }),
    ).toBe(true);
    expect(
      ok({
        shape: 'arc',
        points: [
          [0, 0],
          [10, 0],
        ],
      }),
    ).toBe(false);
    expect(ok({ shape: 'path', d: 'M0 0C10 0 10 10 20 10' })).toBe(true);
    expect(ok({ shape: 'path', d: 'oops' })).toBe(false);
    expect(
      ok({
        shape: 'path',
        points: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBe(false);
    expect(
      ok({
        shape: 'line',
        points: [
          [0, 0],
          [1, 1],
        ],
        d: 'M0 0L1 1',
      }),
    ).toBe(false);
    expect(
      ok({
        shape: 'polygon',
        points: [
          [0, 0],
          [10, 0],
          [5, 8],
        ],
        fillInk: 'coral',
        fillOpacity: 0.4,
        hatch: 'cross',
        opacity: 0.5,
        groupId: 'pump-1',
      }),
    ).toBe(true);
    expect(
      ok({
        shape: 'line',
        points: [
          [0, 0],
          [1, 1],
        ],
        endMarker: 'dot',
        line: 'dotted',
      }),
    ).toBe(true);
    expect(
      ok({
        shape: 'line',
        points: [
          [0, 0],
          [1, 1],
        ],
        hatch: 'stripes',
      }),
    ).toBe(false);
  });

  it('moves paths with every other shape and outlines curves where they are drawn', () => {
    const path: BoardDrawing = { id: 'p', shape: 'path', d: 'M0 0Q50 100 100 0', ...style };
    expect(translateDrawing(path, 10, 20).d).toBe('M10 20Q60 120 110 20');
    const outline = drawingOutlinePoints(path);
    expect(Math.max(...outline.map(([, y]) => y))).toBeCloseTo(50);
    const arc: BoardDrawing = {
      id: 'a',
      shape: 'arc',
      points: [
        [0, 0],
        [50, -50],
        [100, 0],
      ],
      ...style,
    };
    expect(Math.min(...drawingOutlinePoints(arc).map(([, y]) => y))).toBeCloseTo(-50);
    const polygon: BoardDrawing = {
      id: 'g',
      shape: 'polygon',
      points: [
        [0, 0],
        [10, 0],
        [5, 8],
      ],
      ...style,
    };
    // A polygon's outline closes back to its first corner.
    expect(drawingPolylines(polygon)[0]!.at(-1)).toEqual([0, 0]);
  });
});

import { expect, it } from 'vitest';
import { EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { readingViewport } from './geometry';
import { routeBoard } from './routing';
const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(
    EMAIL_DEMO.nodes.map((node, index) => [node.id, { x: 24, y: index * 240 }]),
  ),
};
it('frames a small screen at readable scale and avoids shrinking wide boards to illegibility', () => {
  expect(readingViewport([{ x: 0, y: 0 }], 320, 500)).toEqual({ x: 48, y: 100, zoom: 1 });
  const wide = readingViewport(
    [
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
    ],
    360,
    600,
  );
  expect(wide.zoom).toBe(0.8);
  expect(wide.x).toBeGreaterThan(0);
});
it('reuses routes for non-geometric changes, invalidating ports, conditions and text footprints', () => {
  const routes = routeBoard(board);
  expect(
    routeBoard({
      ...board,
      description: 'New explanation',
      nodes: board.nodes.map((node) => ({ ...node, explanation: 'Changed' })),
    }),
  ).toBe(routes);
  expect(
    routeBoard({
      ...board,
      edges: board.edges.map((edge) => ({ ...edge, condition: 'accepted' })),
    }),
  ).not.toBe(routes);
  expect(
    routeBoard({ ...board, positions: { ...board.positions, sender: { x: 100, y: 100 } } }),
  ).not.toBe(routes);
});

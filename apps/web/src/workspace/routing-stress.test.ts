import { describe, expect, it } from 'vitest';
import { DNS_DEMO, EMAIL_DEMO, BoardGraphSchema } from '@opsis/schema';
import opusFixture from '../../../../fixtures/boards/opus-parcel.json';
import { layoutBoard } from './model';
import { routeBoard, crosses } from './routing';
import { edgePorts, PORT_OFFSETS } from './connections';
import { NODE_WIDTH, nodeHeight } from './geometry';

describe('routing under small drags', () => {
  it('handles the 50-node/100-edge limit without losing endpoints or labels', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      ...EMAIL_DEMO.nodes[0]!,
      id: `n${i}`,
      label: `Concept ${i}`,
    }));
    const edges = nodes.slice(1).flatMap((node, i) => [
      { id: `q${i}`, source: `n${i}`, target: node.id, label: 'Request', kind: 'request' as const },
      {
        id: `r${i}`,
        source: node.id,
        target: `n${i}`,
        label: 'Response',
        kind: 'response' as const,
      },
    ]);
    const board = {
      ...EMAIL_DEMO,
      version: 2 as const,
      agent: 'demo' as const,
      nodes,
      edges: [
        ...edges,
        { id: 'loop0', source: 'n0', target: 'n0', label: 'Self retry', kind: 'retry' as const },
        {
          id: 'loop49',
          source: 'n49',
          target: 'n49',
          label: 'Self feedback',
          kind: 'feedback' as const,
        },
      ],
      positions: Object.fromEntries(
        nodes.map((node, i) => [node.id, { x: (i % 5) * 400, y: Math.floor(i / 5) * 260 }]),
      ),
    };
    const original = JSON.stringify(board);
    const routes = routeBoard(board);
    expect(Object.keys(routes)).toHaveLength(100);
    for (const edge of board.edges) {
      expect(routes[edge.id]!.label).not.toBeNull();
      expect(routes[edge.id]!.path).not.toMatch(/NaN|Infinity/);
      expect(routes[edge.id]!.points.length).toBeGreaterThan(1);
    }
    expect(JSON.stringify(board)).toBe(original);
  }, 30000);
  for (const [name, graph] of [
    ['dns', DNS_DEMO],
    ['email', EMAIL_DEMO],
    ['opus', BoardGraphSchema.parse(opusFixture)],
  ] as const) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [12, -12],
      [-24, 24],
      [24, 24],
      [-48, -24],
    ]) {
      it(`${name}: each object can move ${dx},${dy} without losing routes or hitting text`, async () => {
        const initial = await layoutBoard(graph, 'demo', undefined, 1100);
        for (const node of initial.nodes) {
          const board = {
            ...initial,
            positions: {
              ...initial.positions,
              [node.id]: {
                x: initial.positions[node.id]!.x + dx!,
                y: initial.positions[node.id]!.y + dy!,
              },
            },
          };
          const routes = routeBoard(board);
          expect(Object.keys(routes)).toHaveLength(board.edges.length);
          for (const edge of board.edges) {
            const route = routes[edge.id]!;
            const ports = edgePorts(board, edge);
            for (const [point, id, port] of [
              [route.points[0]!, edge.source, ports.source],
              [route.points.at(-1)!, edge.target, ports.target],
            ] as const) {
              expect(point).toEqual({
                x: board.positions[id]!.x + PORT_OFFSETS[port].x,
                y: board.positions[id]!.y + PORT_OFFSETS[port].y,
              });
            }
            expect(route.path).not.toMatch(/NaN|Infinity/);
            expect(route.label, `${node.id} moved; ${edge.id} label missing`).not.toBeNull();
            for (const other of board.nodes) {
              const p = board.positions[other.id]!;
              const own = other.id === edge.source || other.id === edge.target;
              const box = {
                x: p.x,
                y: p.y + (own ? 90 : 0),
                width: NODE_WIDTH,
                height: nodeHeight(other) - (own ? 90 : 0),
              };
              for (let i = 1; i < route.points.length; i++)
                expect(
                  crosses(route.points[i - 1]!, route.points[i]!, box),
                  `${node.id} moved; ${edge.id} crosses ${other.id}`,
                ).toBe(false);
            }
          }
        }
      });
    }
  }
});

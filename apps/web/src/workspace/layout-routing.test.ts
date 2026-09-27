import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO, DNS_DEMO, BoardGraphSchema, type BoardGraph } from '@opsis/schema';
import { layoutBoard, NODE_HEIGHT, NODE_WIDTH } from './model';
import { crosses, overlaps, routeBoard } from './routing';
import { wrapLabel, nodeHeight } from './geometry';
import { PORT_OFFSETS, edgePorts, connectBoard } from './connections';

const chain = (count: number): BoardGraph => ({
  title: 'DNS query resolution',
  description: '',
  nodes: Array.from({ length: count }, (_, i) => ({
    ...EMAIL_DEMO.nodes[0]!,
    id: `node${i}`,
    label: `DNS stage ${i}: a longer explanation of the server role`,
  })),
  edges: Array.from({ length: count - 1 }, (_, i) => ({
    id: `edge${i}`,
    source: `node${i}`,
    target: `node${i + 1}`,
    label: 'Query or referral to the next server',
  })),
});

describe('readable downward layout', () => {
  it('shows DNS replies to the requester with distinct, labelled routes', async () => {
    expect(BoardGraphSchema.safeParse(DNS_DEMO).success).toBe(true);
    const board = await layoutBoard(DNS_DEMO, 'demo', undefined, 900);
    const routes = routeBoard(board);
    const entries = Object.entries(routes);
    for (let i = 0; i < entries.length; i++) {
      const [id, route] = entries[i]!;
      for (const [otherId, other] of entries.slice(i + 1)) {
        for (let a = 1; a < route.points.length; a++) {
          const p = route.points[a - 1]!,
            q = route.points[a]!;
          for (let b = 1; b < other.points.length; b++) {
            const r = other.points[b - 1]!,
              s = other.points[b]!;
            const overlap =
              p.x === q.x && r.x === s.x && p.x === r.x
                ? Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) -
                  Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y))
                : p.y === q.y && r.y === s.y && p.y === r.y
                  ? Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) -
                    Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x))
                  : 0;
            expect(overlap, `${id} overlaps ${otherId}`).toBeLessThanOrEqual(16);
          }
        }
      }
    }
    for (const edge of board.edges) {
      expect(routes[edge.id]!.label, edge.id).not.toBeNull();
      if (edge.kind === 'request') {
        const response = board.edges.find(
          (reply) =>
            reply.source === edge.target &&
            reply.target === edge.source &&
            reply.kind === 'response',
        );
        expect(response).toBeDefined();
        expect(routes[edge.id]!.path).not.toBe(routes[response!.id]!.path);
      }
    }
    expect(board.edges.some((edge) => edge.source === 'root' && edge.target === 'tld')).toBe(false);
  });
  it('grows downward instead of stretching a long chain to the right', async () => {
    const board = await layoutBoard(chain(12), 'demo', undefined, 900);
    expect(new Set(Object.values(board.positions).map((p) => p.x)).size).toBe(1);
    for (const edge of board.edges)
      expect(board.positions[edge.target]!.y - board.positions[edge.source]!.y).toBeGreaterThan(
        nodeHeight(board.nodes.find((node) => node.id === edge.source)!) + 48,
      );
    expect(Math.max(...Object.values(board.positions).map((p) => p.y))).toBeLessThan(12 * 280);
  });
  it('wraps a wide fan-out into additional rows within a bounded width', async () => {
    const graph = chain(10);
    graph.edges = graph.edges.map((edge) => ({ ...edge, source: 'node0' }));
    const board = await layoutBoard(graph, 'demo', undefined, 900);
    const points = Object.values(board.positions);
    expect(
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) + NODE_WIDTH,
    ).toBeLessThan(650);
    points.forEach((p, i) =>
      points
        .slice(i + 1)
        .forEach((q) =>
          expect(
            overlaps(
              { ...p, width: NODE_WIDTH, height: NODE_HEIGHT },
              { ...q, width: NODE_WIDTH, height: NODE_HEIGHT },
            ),
          ).toBe(false),
        ),
    );
    expect(new Set(points.map((p) => p.y)).size).toBeGreaterThan(3);
  });
  it('routes bypasses and returns outside concepts, with labels off the arrows', async () => {
    const graph = chain(8);
    graph.edges.push(
      {
        id: 'cache',
        source: 'node1',
        target: 'node7',
        label: 'Cache hit: skip recursive resolution',
      },
      { id: 'retry', source: 'node6', target: 'node2', label: 'Retry after a transient error' },
    );
    const board = await layoutBoard(graph, 'demo', undefined, 900);
    const routes = routeBoard(board);
    const nodeBoxes = board.nodes.map((node) => ({
      id: node.id,
      ...board.positions[node.id]!,
      width: NODE_WIDTH,
      height: nodeHeight(node),
    }));
    const labels = Object.values(routes)
      .map((route) => route.label)
      .filter((label) => label !== null);
    expect(labels).toHaveLength(graph.edges.length);
    for (const [id, route] of Object.entries(routes)) {
      const edge = board.edges.find((item) => item.id === id)!;
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1]!,
          b = route.points[i]!;
        for (const box of nodeBoxes) {
          const own = box.id === edge.source || box.id === edge.target;
          const obstacle = own ? { ...box, y: box.y + 90, height: box.height - 90 } : box;
          expect(crosses(a, b, obstacle), `Arrow crosses ${box.id}`).toBe(false);
        }
        for (const label of labels) expect(crosses(a, b, label)).toBe(false);
      }
    }
    labels.forEach((label, i) => {
      nodeBoxes.forEach((node) => expect(overlaps(label, node)).toBe(false));
      labels.slice(i + 1).forEach((other) => expect(overlaps(label, other)).toBe(false));
    });
  });
  it('wraps long names without losing text', () => {
    const text = 'Authoritative DNS server for the destination domain';
    expect(wrapLabel(text).join(' ')).toBe(text);
    expect(wrapLabel('x'.repeat(80)).every((line) => line.length <= 28)).toBe(true);
  });
  it('keeps return edges distinct without reversing the primary layout', async () => {
    const graph = chain(3);
    const primary = await layoutBoard(graph, 'demo');
    graph.edges.push({
      id: 'reply',
      source: 'node1',
      target: 'node0',
      label: 'Answer',
      kind: 'response',
    });
    const board = await layoutBoard(graph, 'demo');
    expect(board.positions.node0).toEqual(primary.positions.node0);
    expect(board.positions.node1!.y).toBeLessThan(board.positions.node2!.y);
    expect(board.positions.node0!.y).toBeLessThan(board.positions.node1!.y);
    const routes = routeBoard(board);
    expect(routes.reply!.path).not.toBe(routes.edge0!.path);
    expect(routes.reply!.lines.join(' ')).toBe('Response: Answer');
    expect(routes.reply!.label).not.toBeNull();
    const reconnected = connectBoard(board, { source: 'node2', target: 'node0' }, 'reply');
    expect(reconnected.edges.find((edge) => edge.id === 'reply')?.kind).toBe('response');
  });
  it('attaches every port to the icon before and after dragging, never below its text', async () => {
    const board = await layoutBoard(chain(2), 'demo');
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      for (const shift of [0, 157]) {
        board.positions.node0 = { x: 24 + shift, y: 24 + shift };
        board.edgePorts = { edge0: { source: side, target: side } };
        const edge = board.edges[0]!;
        const route = routeBoard(board).edge0!;
        const ports = edgePorts(board, edge);
        for (const [point, id, port] of [
          [route.points[0]!, edge.source, ports.source],
          [route.points[route.points.length - 1]!, edge.target, ports.target],
        ] as const) {
          expect(point).toEqual({
            x: board.positions[id]!.x + PORT_OFFSETS[port].x,
            y: board.positions[id]!.y + PORT_OFFSETS[port].y,
          });
          expect(point.y - board.positions[id]!.y).toBeLessThan(90);
        }
      }
    }
  });
});

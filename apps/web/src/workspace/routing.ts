import type { BoardDocument, BoardPort } from '@opsis/schema';
import { edgePorts, PORT_OFFSETS, connectionLabel } from './connections';
import { NODE_WIDTH, wrapLabel, nodeHeight } from './geometry';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type RoutedEdge = { points: Point[]; path: string; label: Rect | null; lines: string[] };
const inflate = (rect: Rect, amount: number): Rect => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});
export function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export function crosses(a: Point, b: Point, rect: Rect): boolean {
  if (a.x !== b.x && a.y !== b.y) {
    const xs = [(rect.x - a.x) / (b.x - a.x), (rect.x + rect.width - a.x) / (b.x - a.x)].sort(
      (x, y) => x - y,
    );
    const ys = [(rect.y - a.y) / (b.y - a.y), (rect.y + rect.height - a.y) / (b.y - a.y)].sort(
      (x, y) => x - y,
    );
    return Math.max(0, xs[0]!, ys[0]!) < Math.min(1, xs[1]!, ys[1]!);
  }
  if (a.x === b.x)
    return (
      a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    );
  return (
    a.y > rect.y &&
    a.y < rect.y + rect.height &&
    Math.max(a.x, b.x) > rect.x &&
    Math.min(a.x, b.x) < rect.x + rect.width
  );
}
const segments = (points: Point[]) =>
  points.slice(1).map((point, index) => [points[index]!, point] as const);
const length = (points: Point[]) =>
  segments(points).reduce((sum, [a, b]) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0);
function simplify(points: Point[]) {
  const unique = points.filter(
    (p, i) => !i || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y,
  );
  return unique.filter(
    (p, i) =>
      !i ||
      i === unique.length - 1 ||
      !(
        (unique[i - 1]!.x === p.x && unique[i + 1]!.x === p.x) ||
        (unique[i - 1]!.y === p.y && unique[i + 1]!.y === p.y)
      ),
  );
}
function roundedPath(points: Point[]): string {
  const first = points[0]!;
  let path = `M${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!,
      corner = points[i]!,
      next = points[i + 1]!;
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(10, before / 2, after / 2);
    if (!radius) continue;
    const a = {
      x: corner.x - ((corner.x - previous.x) * radius) / before,
      y: corner.y - ((corner.y - previous.y) * radius) / before,
    };
    const b = {
      x: corner.x + ((next.x - corner.x) * radius) / after,
      y: corner.y + ((next.y - corner.y) * radius) / after,
    };
    path += ` L${a.x},${a.y} Q${corner.x},${corner.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${path} L${last.x},${last.y}`;
}
function exitPoint(position: Point, port: BoardPort): Point {
  const offset = PORT_OFFSETS[port];
  if (port === 'left') return { x: position.x - 28, y: position.y + offset.y };
  if (port === 'right') return { x: position.x + NODE_WIDTH + 28, y: position.y + offset.y };
  if (port === 'top') return { x: position.x + offset.x, y: position.y - 28 };
  // Turn below the icon but above its title, before joining the outer corridor.
  return { x: position.x + NODE_WIDTH + 28, y: position.y + 80 };
}

function attachment(position: Point, port: BoardPort, slot: number, count: number): Point[] {
  const offset = PORT_OFFSETS[port];
  const anchor = { x: position.x + offset.x, y: position.y + offset.y };
  const spread = (slot - (count - 1) / 2) * Math.min(12, 40 / Math.max(1, count - 1));
  if (port === 'left' || port === 'right') {
    const direction = port === 'left' ? -1 : 1;
    const fan = { x: anchor.x + direction * 14, y: anchor.y + spread };
    return [anchor, fan, { x: exitPoint(position, port).x + direction * slot * 16, y: fan.y }];
  }
  if (port === 'top')
    return [
      anchor,
      { x: anchor.x + spread, y: anchor.y - 14 },
      { x: anchor.x + spread, y: position.y - 28 - slot * 16 },
    ];
  return port === 'bottom'
    ? [
        anchor,
        {
          x: anchor.x + spread,
          y: position.y + 76 + slot * Math.min(6, 12 / Math.max(1, count - 1)),
        },
        {
          x: position.x + NODE_WIDTH + 28 + slot * 16,
          y: position.y + 76 + slot * Math.min(6, 12 / Math.max(1, count - 1)),
        },
      ]
    : [anchor, exitPoint(position, port)];
}

function labelPosition(
  points: Point[],
  lines: string[],
  obstacles: Rect[],
  usedPaths: Point[][],
): Rect | null {
  if (!lines.length) return null;
  const width =
    Math.ceil(
      Math.max(
        ...lines.map((line) =>
          [...line].reduce((units, char) => units + (char.charCodeAt(0) > 255 ? 2 : 1), 0),
        ),
      ) * 7.5,
    ) + 16;
  const height = lines.length * 16 + 12;
  const candidates: Rect[] = [];
  for (const [a, b] of segments(points).sort((a, b) => length([...b]) - length([...a]))) {
    for (const fraction of [0.5, 0.3, 0.7]) {
      const x = a.x + (b.x - a.x) * fraction,
        y = a.y + (b.y - a.y) * fraction;
      if (a.x === b.x && Math.abs(a.y - b.y) >= height + 16) {
        candidates.push(
          { x: x + 12, y: y - height / 2, width, height },
          { x: x - width - 12, y: y - height / 2, width, height },
        );
      } else if (a.y === b.y && Math.abs(a.x - b.x) >= width + 16) {
        candidates.push(
          { x: x - width / 2, y: y + 12, width, height },
          { x: x - width / 2, y: y - height - 12, width, height },
        );
      }
    }
  }
  return (
    candidates.find(
      (rect) =>
        !obstacles.some((node) => overlaps(rect, node)) &&
        ![points, ...usedPaths].some((path) =>
          segments(path).some(([a, b]) => crosses(a, b, inflate(rect, 5))),
        ),
    ) ?? null
  );
}

/** Orthogonal corridors outside full icon/text footprints. Labels have their own reserved boxes. */
export function routeBoard(board: BoardDocument): Record<string, RoutedEdge> {
  const rectangles = board.nodes.map((node) => ({
    ...(board.positions[node.id] ?? { x: 0, y: 0 }),
    width: NODE_WIDTH,
    height: nodeHeight(node),
  }));
  const occupiedLabels: Rect[] = [];
  const usedPaths: Point[][] = [];
  const result: Record<string, RoutedEdge> = {};
  const minX = Math.min(...rectangles.map((r) => r.x));
  const maxX = Math.max(...rectangles.map((r) => r.x + r.width));
  const attachments = new Map<string, string[]>();
  for (const edge of [...board.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const ports = edgePorts(board, edge);
    for (const end of ['source', 'target'] as const) {
      const key = `${edge[end]}:${ports[end]}`;
      attachments.set(key, [...(attachments.get(key) ?? []), `${edge.id}:${end}`]);
    }
  }
  // Short connections first: reserve their labels before routing long bypasses/returns.
  const edges = [...board.edges].sort((a, b) => {
    const distance = (edge: typeof a) => {
      const from = board.positions[edge.source],
        to = board.positions[edge.target];
      return from && to ? Math.abs(from.x - to.x) + Math.abs(from.y - to.y) : 0;
    };
    return distance(a) - distance(b) || a.id.localeCompare(b.id);
  });
  for (const edge of edges) {
    const from = board.positions[edge.source],
      to = board.positions[edge.target];
    if (!from || !to) continue;
    const ports = edgePorts(board, edge);
    const stub = (end: 'source' | 'target', position: Point) => {
      const peers = attachments.get(`${edge[end]}:${ports[end]}`)!;
      return attachment(position, ports[end], peers.indexOf(`${edge.id}:${end}`), peers.length);
    };
    const sourceStub = stub('source', from);
    const targetStub = stub('target', to);
    const start = sourceStub[sourceStub.length - 1]!,
      end = targetStub[targetStub.length - 1]!;
    const candidates: Point[][] = [];
    const add = (middle: Point[]) =>
      candidates.push([...sourceStub, ...middle, ...[...targetStub].reverse()]);
    add([{ x: start.x, y: end.y }]);
    add([{ x: end.x, y: start.y }]);
    add([
      { x: start.x, y: (start.y + end.y) / 2 },
      { x: end.x, y: (start.y + end.y) / 2 },
    ]);
    const lanes = new Set([start.x, end.x, (start.x + end.x) / 2]);
    rectangles.forEach((rect) => {
      lanes.add(rect.x - 40);
      lanes.add(rect.x + rect.width + 40);
    });
    for (let lane = 0; lane < Math.min(24, Math.max(8, board.edges.length)); lane++) {
      lanes.add(minX - 64 - lane * 40);
      lanes.add(maxX + 64 + lane * 40);
    }
    for (const x of lanes)
      add([
        { x, y: start.y },
        { x, y: end.y },
      ]);
    // Escape a row before crossing it: a single L/Z can cut through a sibling
    // when several actors occupy the same layer (e.g. DNS servers).
    for (const x of lanes) {
      for (const y of [
        from.y - 32,
        from.y + nodeHeight(board.nodes.find((node) => node.id === edge.source)!) + 32,
      ])
        add([
          { x: start.x, y },
          { x, y },
          { x, y: end.y },
        ]);
      for (const y of [
        to.y - 32,
        to.y + nodeHeight(board.nodes.find((node) => node.id === edge.target)!) + 32,
      ])
        add([
          { x, y: start.y },
          { x, y },
          { x: end.x, y },
        ]);
    }
    if (['left', 'right'].includes(ports.source) || ['left', 'right'].includes(ports.target)) {
      const rows = new Set(rectangles.flatMap((rect) => [rect.y - 48, rect.y + rect.height + 48]));
      for (const y of rows)
        add([
          { x: start.x, y },
          { x: end.x, y },
        ]);
    }
    const obstacles = [
      ...rectangles.map((rect) => inflate(rect, 12)),
      ...occupiedLabels.map((rect) => inflate(rect, 8)),
    ];
    const lines = wrapLabel(connectionLabel(edge), 24);
    let best: { score: number; points: Point[]; label: Rect | null } | undefined;
    for (const points of candidates) {
      // The first/last stubs intentionally connect the icon's side through its own footprint.
      const middle = points.slice(sourceStub.length - 1, points.length - targetStub.length + 1);
      const collisions = segments(middle).reduce(
        (n, [a, b]) => n + obstacles.filter((rect) => crosses(a, b, rect)).length,
        0,
      );
      const clean = simplify(points);
      const label = labelPosition(clean, lines, obstacles, usedPaths);
      const shared = segments(clean).reduce(
        (sum, [a, b]) =>
          sum +
          usedPaths.reduce(
            (n, path) =>
              n +
              segments(path).filter(([c, d]) => {
                if (a.x === b.x && c.x === d.x && a.x === c.x)
                  return (
                    Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
                      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
                    16
                  );
                if (a.y === b.y && c.y === d.y && a.y === c.y)
                  return (
                    Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
                      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
                    16
                  );
                return false;
              }).length,
            0,
          ),
        0,
      );
      const score =
        collisions * 1e7 +
        (lines.length && !label ? 1e6 : 0) +
        shared * 2e6 +
        segments(clean).reduce(
          (sum, [a, b]) =>
            sum +
            usedPaths.reduce(
              (total, path) =>
                total +
                segments(path).filter(([c, d]) => {
                  if (a.x === b.x && c.y === d.y)
                    return (
                      a.x > Math.min(c.x, d.x) &&
                      a.x < Math.max(c.x, d.x) &&
                      c.y > Math.min(a.y, b.y) &&
                      c.y < Math.max(a.y, b.y)
                    );
                  if (a.y === b.y && c.x === d.x)
                    return (
                      c.x > Math.min(a.x, b.x) &&
                      c.x < Math.max(a.x, b.x) &&
                      a.y > Math.min(c.y, d.y) &&
                      a.y < Math.max(c.y, d.y)
                    );
                  return false;
                }).length,
              0,
            ),
          0,
        ) *
          2500 +
        length(clean) +
        clean.length * 15;
      if (!best || score < best.score) best = { score, points: clean, label };
    }
    const chosen = best!;
    usedPaths.push(chosen.points);
    if (chosen.label) occupiedLabels.push(chosen.label);
    result[edge.id] = {
      points: chosen.points,
      path: roundedPath(chosen.points),
      label: chosen.label,
      lines,
    };
  }
  return result;
}

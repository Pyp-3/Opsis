import type { BoardDocument, BoardPort } from '@opsis/schema';
import { edgePorts, PORT_OFFSETS, connectionLabel, isReturnEdge, replyLead } from './connections';
import { NODE_WIDTH, wrapLabel, nodeHeight } from './geometry';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type RoutedEdge = {
  points: Point[];
  path: string;
  label: Rect | null;
  lines: string[];
  callout?: string;
};

/** Clearance kept between arrows and every object footprint (icon + wrapped title). */
const PAD = 16;
/** Cost of one turn, in pixels of extra length. High enough that arrows prefer straight runs. */
const BEND = 70;
/** Crossing another arrow is allowed but should only win over a real detour. */
const CROSS = 90;
/** Running on top of another arrow; nudging separates survivors into parallel lanes. */
const SHARE = 30;
/** Spacing of parallel lanes after nudging. */
const LANE = 10;

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
const length = (points: readonly Point[]) =>
  segments([...points]).reduce((sum, [a, b]) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0);

/** Drop duplicate points and collinear midpoints. */
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
    const radius = Math.min(12, before / 2, after / 2);
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

type Footprint = Rect & { id: string };

/**
 * The fixed part of a connection next to its object: the port on the icon, a short fan-out
 * so several arrows on one side stay distinct, and the exit just outside the footprint.
 * Bottom ports turn below the icon (above the title) because the title sits underneath.
 */
function stub(box: Footprint, port: BoardPort, slot: number, count: number): Point[] {
  const offset = PORT_OFFSETS[port];
  const anchor = { x: box.x + offset.x, y: box.y + offset.y };
  const spread = (slot - (count - 1) / 2) * Math.min(12, 40 / Math.max(1, count - 1));
  if (port === 'left' || port === 'right') {
    const direction = port === 'left' ? -1 : 1;
    const exitX = port === 'left' ? box.x - PAD : box.x + box.width + PAD;
    return [
      anchor,
      { x: anchor.x + direction * 14, y: anchor.y + spread },
      { x: exitX, y: anchor.y + spread },
    ];
  }
  if (port === 'top')
    return [
      anchor,
      { x: anchor.x + spread, y: anchor.y - 14 },
      { x: anchor.x + spread, y: box.y - PAD },
    ];
  const turnY = box.y + 78 + spread / 4;
  return [anchor, { x: anchor.x + spread, y: turnY }, { x: box.x + box.width + PAD, y: turnY }];
}

// Direction indices: 0 right, 1 down, 2 left, 3 up.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const outward = (port: BoardPort) =>
  port === 'right' ? 0 : port === 'left' ? 2 : port === 'top' ? 3 : 0;

class Heap {
  private items: { f: number; order: number; state: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(item: { f: number; order: number; state: number }) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (Heap.less(items[parent]!, items[i]!)) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < items.length && Heap.less(items[l]!, items[m]!)) m = l;
        if (r < items.length && Heap.less(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top;
  }
  private static less(a: { f: number; order: number }, b: { f: number; order: number }) {
    return a.f < b.f || (a.f === b.f && a.order < b.order);
  }
}

/** Existing arrows, indexed by their exact line so A* can price overlaps and crossings. */
class Occupancy {
  private horizontalLines: number[] = [];
  private verticalLines: number[] = [];
  horizontal = new Map<number, [number, number][]>();
  vertical = new Map<number, [number, number][]>();
  add(points: Point[]) {
    for (const [a, b] of segments(points)) {
      if (a.y === b.y && a.x !== b.x) this.push(this.horizontal, a.y, a.x, b.x);
      else if (a.x === b.x && a.y !== b.y) this.push(this.vertical, a.x, a.y, b.y);
    }
    this.horizontalLines = [...this.horizontal.keys()].sort((a, b) => a - b);
    this.verticalLines = [...this.vertical.keys()].sort((a, b) => a - b);
  }
  private push(map: Map<number, [number, number][]>, key: number, a: number, b: number) {
    const list = map.get(key) ?? [];
    list.push([Math.min(a, b), Math.max(a, b)]);
    map.set(key, list);
  }
  /** Cost of moving from a to b (adjacent grid points on one axis). */
  cost(a: Point, b: Point): number {
    let cost = 0;
    const along = a.y === b.y ? this.horizontal.get(a.y) : this.vertical.get(a.x);
    const [lo, hi] =
      a.y === b.y
        ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
        : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (const [s, e] of along ?? []) {
      const shared = Math.min(hi, e) - Math.max(lo, s);
      if (shared > 0) cost += SHARE + shared * 0.5;
    }
    // Include crossings inside a grid segment, not only at its destination.
    const across = a.y === b.y ? this.vertical : this.horizontal;
    const lines = a.y === b.y ? this.verticalLines : this.horizontalLines;
    const at = a.y === b.y ? b.y : b.x;
    const arrival = a.y === b.y ? b.x : b.y;
    let lower = 0,
      upper = lines.length;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (lines[middle]! < lo) lower = middle + 1;
      else upper = middle;
    }
    for (let index = lower; index < lines.length && lines[index]! <= hi; index++) {
      const coordinate = lines[index]!;
      if ((coordinate > lo && coordinate < hi) || coordinate === arrival)
        for (const [s, e] of across.get(coordinate)!) if (at > s && at < e) cost += CROSS;
    }
    return cost;
  }
}

function search(
  start: Point,
  startDirection: number,
  goal: Point,
  goalDirection: number,
  boxes: Rect[],
  xsBase: number[],
  ysBase: number[],
  occupancy: Occupancy,
): Point[] | null {
  // Objects that contain an end (hand-overlapped objects) must not trap the search.
  const blocking = boxes.filter(
    (box) =>
      !(
        start.x > box.x &&
        start.x < box.x + box.width &&
        start.y > box.y &&
        start.y < box.y + box.height
      ) &&
      !(
        goal.x > box.x &&
        goal.x < box.x + box.width &&
        goal.y > box.y &&
        goal.y < box.y + box.height
      ),
  );
  const xs = [...new Set([...xsBase, start.x, goal.x])].sort((a, b) => a - b);
  const ys = [...new Set([...ysBase, start.y, goal.y])].sort((a, b) => a - b);
  const W = xs.length,
    H = ys.length;
  const rowBlocks = new Map<number, [number, number][]>();
  const colBlocks = new Map<number, [number, number][]>();
  const blocks = (horizontal: boolean, at: number) => {
    const cache = horizontal ? rowBlocks : colBlocks;
    let list = cache.get(at);
    if (!list) {
      list = blocking
        .filter((box) =>
          horizontal ? at > box.y && at < box.y + box.height : at > box.x && at < box.x + box.width,
        )
        .map((box) => (horizontal ? [box.x, box.x + box.width] : [box.y, box.y + box.height]));
      cache.set(at, list);
    }
    return list;
  };
  const free = (a: Point, b: Point) => {
    const horizontal = a.y === b.y;
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    return blocks(horizontal, horizontal ? a.y : a.x).every(([s, e]) => hi <= s || lo >= e);
  };
  const sx = xs.indexOf(start.x),
    sy = ys.indexOf(start.y),
    gx = xs.indexOf(goal.x),
    gy = ys.indexOf(goal.y);
  const index = (x: number, y: number, d: number) => (y * W + x) * 4 + d;
  const best = new Float64Array(W * H * 4).fill(Infinity);
  const parent = new Int32Array(W * H * 4).fill(-1);
  // Geometry and occupancy are fixed within this search. Cache each directed step
  // once across the four possible incoming directions, including blocked steps.
  const steps = new Float64Array(W * H * 4).fill(-1);
  const heap = new Heap();
  let order = 0;
  const h = (x: number, y: number) => Math.abs(xs[x]! - goal.x) + Math.abs(ys[y]! - goal.y);
  const first = index(sx, sy, startDirection);
  best[first] = 0;
  heap.push({ f: h(sx, sy), order: order++, state: first });
  let found = -1;
  while (heap.size) {
    const { state, f } = heap.pop();
    const d = state & 3;
    const cell = state >> 2;
    const x = cell % W,
      y = (cell - x) / W;
    const g = best[state]!;
    if (f - h(x, y) > g + 1e-6) continue;
    if (x === gx && y === gy) {
      // The turn into the port was already priced on arrival, so the first pop is optimal.
      found = state;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue;
      const nx = x + DX[nd]!,
        ny = y + DY[nd]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const stepIndex = cell * 4 + nd;
      let distance = steps[stepIndex]!;
      if (distance === -1) {
        const a = { x: xs[x]!, y: ys[y]! },
          b = { x: xs[nx]!, y: ys[ny]! };
        distance = free(a, b)
          ? Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + occupancy.cost(a, b)
          : Infinity;
        steps[stepIndex] = distance;
      }
      if (!Number.isFinite(distance)) continue;
      const step = distance + (nd === d ? 0 : BEND);
      const next = index(nx, ny, nd);
      const total = g + step + (nx === gx && ny === gy && nd !== goalDirection ? BEND : 0);
      if (total < best[next]!) {
        best[next] = total;
        parent[next] = state;
        heap.push({ f: total + h(nx, ny), order: order++, state: next });
      }
    }
  }
  if (found < 0) return null;
  const path: Point[] = [];
  for (let state = found; state >= 0; state = parent[state]!) {
    const cell = state >> 2;
    const x = cell % W;
    path.push({ x: xs[x]!, y: ys[(cell - x) / W]! });
    if (state === first) break;
  }
  return path.reverse();
}

function labelSize(lines: string[]) {
  const width =
    Math.ceil(
      Math.max(
        ...lines.map((line) =>
          [...line].reduce((units, char) => units + (char.charCodeAt(0) > 255 ? 2 : 1), 0),
        ),
      ) * 7.5,
    ) + 16;
  return { width, height: lines.length * 16 + 12 };
}

function labelPosition(
  points: Point[],
  lines: string[],
  obstacles: Rect[],
  paths: Point[][],
): Rect | null {
  if (!lines.length) return null;
  const { width, height } = labelSize(lines);
  const candidates: Rect[] = [];
  // Prefer the middle of the longest runs, then move outwards along the arrow. A label may
  // overhang a short run; it only has to stay clear of objects, other labels and lines.
  for (const [a, b] of segments(points)
    .slice(1, -1)
    .sort((a, b) => length(b) - length(a))) {
    for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
      const x = a.x + (b.x - a.x) * fraction,
        y = a.y + (b.y - a.y) * fraction;
      for (const gap of [8, 20, 36, 56]) {
        if (a.x === b.x)
          candidates.push(
            { x: x + gap, y: y - height / 2, width, height },
            { x: x - width - gap, y: y - height / 2, width, height },
          );
        else
          candidates.push(
            { x: x - width / 2, y: y + gap, width, height },
            { x: x - width / 2, y: y - height - gap, width, height },
          );
      }
    }
  }
  return (
    candidates.find(
      (rect) =>
        !obstacles.some((box) => overlaps(rect, box)) &&
        !paths.some((path) => segments(path).some(([a, b]) => crosses(a, b, inflate(rect, 5)))),
    ) ?? null
  );
}

/** Shift an orthogonal polyline sideways by d, keeping every corner square. */
function offsetPolyline(points: Point[], d: number): Point[] {
  const normals = segments(points).map(([a, b]) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (-(b.y - a.y) / len) * d, y: ((b.x - a.x) / len) * d };
  });
  return points.map((p, i) => {
    const before = normals[i - 1],
      after = normals[i];
    if (!before) return { x: p.x + after!.x, y: p.y + after!.y };
    if (!after) return { x: p.x + before.x, y: p.y + before.y };
    const collinear = before.x === after.x && before.y === after.y;
    return collinear
      ? { x: p.x + after.x, y: p.y + after.y }
      : { x: p.x + before.x + after.x, y: p.y + before.y + after.y };
  });
}

/**
 * Separate arrows that share a line into parallel lanes. Only segments between the two
 * stubs move, and only perpendicular to themselves, so every arrow stays orthogonal and
 * attached to its ports. A nudge that would touch an object is reduced or skipped.
 */
function nudge(
  routes: { points: Point[]; stubs: [number, number]; fixed?: boolean }[],
  boxes: Footprint[],
  ends: string[][],
) {
  type Ref = {
    route: number;
    i: number;
    vertical: boolean;
    at: number;
    lo: number;
    hi: number;
    key: number;
  };
  const refs: Ref[] = [];
  routes.forEach((route, r) => {
    if (route.fixed) return;
    const { points } = route;
    const [from, to] = route.stubs;
    for (let i = from; i < to; i++) {
      const a = points[i]!,
        b = points[i + 1]!;
      const vertical = a.x === b.x;
      // A segment touching a stub exit may only slide along that stub's direction.
      const stubBefore = i === from ? [points[i - 1]!, a] : null;
      const stubAfter = i + 1 === to ? [b, points[i + 2]!] : null;
      const perpendicular = (s: Point[] | null) =>
        !s || (vertical ? s[0]!.y === s[1]!.y : s[0]!.x === s[1]!.x);
      if (!perpendicular(stubBefore) || !perpendicular(stubAfter)) continue;
      const prev = points[i - 1]!,
        next = points[i + 2]!;
      refs.push({
        route: r,
        i,
        vertical,
        at: vertical ? a.x : a.y,
        lo: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
        hi: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
        key: vertical ? (prev.x + next.x) / 2 : (prev.y + next.y) / 2,
      });
    }
  });
  const groups = new Map<string, Ref[]>();
  for (const ref of refs) {
    const id = `${ref.vertical ? 'v' : 'h'}${ref.at}`;
    groups.set(id, [...(groups.get(id) ?? []), ref]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.lo - b.lo);
    // Cluster segments whose ranges overlap on this line.
    const clusters: Ref[][] = [];
    let end = -Infinity;
    for (const ref of group) {
      if (ref.lo < end && clusters.length) clusters[clusters.length - 1]!.push(ref);
      else clusters.push([ref]);
      end = Math.max(end, ref.hi);
    }
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      cluster.sort((a, b) => a.key - b.key || a.route - b.route);
      cluster.forEach((ref, j) => {
        const offset = (j - (cluster.length - 1) / 2) * LANE;
        if (!offset) return;
        const points = routes[ref.route]!.points;
        for (const scale of [1, 0.5]) {
          const moved = points.map((p, k) =>
            k === ref.i || k === ref.i + 1
              ? ref.vertical
                ? { x: p.x + offset * scale, y: p.y }
                : { x: p.x, y: p.y + offset * scale }
              : p,
          );
          const touched = segments(moved).slice(Math.max(0, ref.i - 1), ref.i + 2);
          const own = ends[ref.route]!;
          const clear = touched.every(([a, b]) =>
            boxes.every((box) => {
              const rect = own.includes(box.id)
                ? { ...box, y: box.y + 90, height: box.height - 90 }
                : box;
              return !crosses(a, b, rect);
            }),
          );
          if (clear) {
            routes[ref.route]!.points = moved;
            break;
          }
        }
      });
    }
  }
}

/** Orthogonal arrows that route around objects with few turns, then share corridors as lanes. */
const routeCache = new Map<string, Record<string, RoutedEdge>>();
export function routeBoard(board: BoardDocument): Record<string, RoutedEdge> {
  // Descriptions, drawings, selections and colour changes do not alter geometry.
  const key = JSON.stringify({
    nodes: board.nodes.map((node) => [node.id, nodeHeight(node)]),
    positions: board.positions,
    ports: board.edgePorts,
    edges: board.edges.map((edge) => [
      edge.id,
      edge.source,
      edge.target,
      edge.kind,
      connectionLabel(edge),
    ]),
  });
  const cached = routeCache.get(key);
  if (cached) return cached;
  const result = computeRoutes(board);
  if (routeCache.size >= 4) routeCache.delete(routeCache.keys().next().value!);
  routeCache.set(key, result);
  return result;
}
function computeRoutes(board: BoardDocument): Record<string, RoutedEdge> {
  const boxes: Footprint[] = board.nodes.map((node) => ({
    id: node.id,
    ...(board.positions[node.id] ?? { x: 0, y: 0 }),
    width: NODE_WIDTH,
    height: nodeHeight(node),
  }));
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const padded = boxes.map((box) => inflate(box, PAD));
  // Candidate corridors: object edges plus the middle of every gap between them.
  const axis = (values: number[], margin: number) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const mids = sorted.slice(1).map((v, i) => (v + sorted[i]!) / 2);
    return [...new Set([...sorted, ...mids, sorted[0]! - margin, sorted.at(-1)! + margin])];
  };
  const xsBase = boxes.length
    ? axis(
        padded.flatMap((r) => [r.x, r.x + r.width]),
        48,
      )
    : [];
  const ysBase = boxes.length
    ? axis(
        padded.flatMap((r) => [r.y, r.y + r.height]),
        48,
      )
    : [];

  // Order arrows on each side by where their other end is, so fans never cross at the port.
  const ports = new Map(board.edges.map((edge) => [edge.id, edgePorts(board, edge)]));
  // A reply drawn as a parallel twin of its lead: same sides, mirrored direction.
  const twins = new Map<string, string>();
  for (const edge of board.edges) {
    const lead = replyLead(board, edge);
    const p = ports.get(edge.id)!,
      q = lead && ports.get(lead.id);
    if (lead && q && p.source === q.target && p.target === q.source) twins.set(lead.id, edge.id);
  }
  const twinIds = new Set(twins.values());
  const attachments = new Map<string, { id: string; key: number }[]>();
  for (const edge of board.edges) {
    if (twinIds.has(edge.id)) continue;
    const p = ports.get(edge.id)!;
    for (const end of ['source', 'target'] as const) {
      const other = byId.get(edge[end === 'source' ? 'target' : 'source'])!;
      const side = p[end];
      if (!other) continue;
      const key = side === 'left' || side === 'right' ? other.y : other.x;
      const list = attachments.get(`${edge[end]}:${side}`) ?? [];
      list.push({ id: `${edge.id}:${end}`, key: key + (end === 'source' ? 0.1 : 0) });
      attachments.set(`${edge[end]}:${side}`, list);
    }
  }
  for (const list of attachments.values())
    list.sort((a, b) => a.key - b.key || a.id.localeCompare(b.id));

  // Stable order: forward flow first by topology distance, returns last. A one-pixel drag
  // never reshuffles which arrow claims a corridor.
  const indexOf = new Map(board.nodes.map((node, i) => [node.id, i]));
  const edges = [...board.edges]
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target) && !twinIds.has(edge.id))
    .sort(
      (a, b) =>
        Number(isReturnEdge(a)) - Number(isReturnEdge(b)) ||
        Math.abs(indexOf.get(a.source)! - indexOf.get(a.target)!) -
          Math.abs(indexOf.get(b.source)! - indexOf.get(b.target)!) ||
        a.id.localeCompare(b.id),
    );
  const occupancy = new Occupancy();
  const routed: { id: string; points: Point[]; stubs: [number, number]; fixed?: boolean }[] = [];
  const clearOf = (points: Point[], ends: string[]) =>
    segments(points)
      .slice(1, -1)
      .every(([a, b]) =>
        boxes.every(
          (box) =>
            !crosses(
              a,
              b,
              ends.includes(box.id) ? { ...box, y: box.y + 90, height: box.height - 90 } : box,
            ),
        ),
      );
  for (const edge of edges) {
    const p = ports.get(edge.id)!;
    const stubFor = (end: 'source' | 'target') => {
      const peers = attachments.get(`${edge[end]}:${p[end]}`)!;
      return stub(
        byId.get(edge[end])!,
        p[end],
        peers.findIndex((peer) => peer.id === `${edge.id}:${end}`),
        peers.length,
      );
    };
    const from = stubFor('source');
    const to = stubFor('target');
    const start = from[2]!,
      goal = to[2]!;
    const startDirection = outward(p.source);
    const goalDirection = (outward(p.target) + 2) & 3;
    const middle = search(
      start,
      startDirection,
      goal,
      goalDirection,
      padded,
      xsBase,
      ysBase,
      occupancy,
    ) ?? [start, { x: goal.x, y: start.y }, goal];
    const inner = simplify(middle);
    const points = [from[0]!, from[1]!, ...inner, to[1]!, to[0]!];
    occupancy.add(inner);
    const twinId = twins.get(edge.id);
    const twin = twinId && board.edges.find((item) => item.id === twinId);
    if (!twin) {
      routed.push({ id: edge.id, points, stubs: [2, points.length - 3] });
      continue;
    }
    // Parallel copies never cross each other, so a request and its reply read as one channel.
    const body = points.slice(1, -1);
    const copy = [LANE, -LANE]
      .map((d) => [points.at(-1)!, ...offsetPolyline(body, d).reverse(), points[0]!])
      .find((candidate) => clearOf(candidate, [edge.source, edge.target]));
    if (copy) {
      routed.push({ id: edge.id, points, stubs: [2, points.length - 3], fixed: true });
      routed.push({ id: twin.id, points: copy, stubs: [2, copy.length - 3], fixed: true });
      occupancy.add(copy.slice(1, -1));
      continue;
    }
    routed.push({ id: edge.id, points, stubs: [2, points.length - 3] });
    // No room for a twin lane: the reply gets its own route.
    const tp = ports.get(twin.id)!;
    const back = [
      stub(byId.get(twin.source)!, tp.source, 0, 1),
      stub(byId.get(twin.target)!, tp.target, 0, 1),
    ];
    const route = search(
      back[0]![2]!,
      outward(tp.source),
      back[1]![2]!,
      (outward(tp.target) + 2) & 3,
      padded,
      xsBase,
      ysBase,
      occupancy,
    ) ?? [back[0]![2]!, back[1]![2]!];
    const reply = [back[0]![0]!, back[0]![1]!, ...simplify(route), back[1]![1]!, back[1]![0]!];
    occupancy.add(simplify(route));
    routed.push({ id: twin.id, points: reply, stubs: [2, reply.length - 3] });
  }
  nudge(
    routed,
    boxes,
    routed.map((route) => {
      const edge = board.edges.find((item) => item.id === route.id)!;
      return [edge.source, edge.target];
    }),
  );

  // Labels are placed once every arrow is final, so none can land on a later line.
  const paths = routed.map((route) => route.points);
  const placed: Rect[] = [];
  const result: Record<string, RoutedEdge> = {};
  const nodeObstacles = boxes.map((box) => inflate(box, 6));
  for (const route of routed) {
    const edge = board.edges.find((item) => item.id === route.id)!;
    const points = route.points.filter(
      (p, i) => !i || p.x !== route.points[i - 1]!.x || p.y !== route.points[i - 1]!.y,
    );
    const lines = wrapLabel(connectionLabel(edge), 24);
    let label = labelPosition(
      points,
      lines,
      [...nodeObstacles, ...placed.map((r) => inflate(r, 6))],
      paths,
    );
    let callout: string | undefined;
    // Dense boards must not silently lose text: fall back to a dotted leader to a free margin.
    if (!label && lines.length) {
      const { width, height } = labelSize(lines);
      const [a, b] = segments(points).sort((a, b) => length(b) - length(a))[0]!;
      const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const free = (rect: Rect) =>
        !nodeObstacles.some((box) => overlaps(rect, box)) &&
        !placed.some((r) => overlaps(inflate(r, 6), rect)) &&
        !paths.some((path) => segments(path).some(([p, q]) => crosses(p, q, inflate(rect, 5))));
      let spot: Rect | undefined;
      for (let radius = 60; !spot && radius <= 600; radius += 30)
        for (let step = 0; step < 16 && !spot; step++) {
          const angle = (step / 16) * Math.PI * 2;
          const rect = {
            x: anchor.x + Math.cos(angle) * radius - width / 2,
            y: anchor.y + Math.sin(angle) * radius - height / 2,
            width,
            height,
          };
          if (free(rect)) spot = rect;
        }
      label = spot ?? {
        x: Math.min(...boxes.map((box) => box.x), ...paths.flat().map((p) => p.x)) - width - 24,
        y: anchor.y - height / 2,
        width,
        height,
      };
      const cx = Math.max(label.x, Math.min(anchor.x, label.x + label.width));
      const cy = Math.max(label.y, Math.min(anchor.y, label.y + label.height));
      callout = `M${anchor.x},${anchor.y} L${cx},${cy}`;
    }
    if (label) placed.push(label);
    result[edge.id] = {
      points,
      path: roundedPath(points),
      label,
      lines,
      ...(callout ? { callout } : {}),
    };
  }
  return result;
}

/**
 * SVG path data for canvas drawings. A path drawing stores ordinary SVG path commands in canvas
 * coordinates. To move, turn, scale or mirror it, the path is first normalised to absolute
 * moves, lines, cubic and quadratic curves (arcs become cubic curves), whose control points
 * transform exactly under any affine map. The same normal form is sampled into polylines for
 * hit-testing, outlines and export bounds, so every host treats a path the same way.
 */

export type PathPoint = [number, number];
export type PathSegment =
  | { command: 'M'; to: PathPoint }
  | { command: 'L'; to: PathPoint }
  | { command: 'C'; c1: PathPoint; c2: PathPoint; to: PathPoint }
  | { command: 'Q'; c1: PathPoint; to: PathPoint }
  | { command: 'Z' };

/** Path data: SVG commands and numbers only, starting with a move. */
export const PATH_DATA_PATTERN = /^\s*[Mm][MmLlHhVvCcSsQqTtAaZz0-9.,\seE+-]*$/u;
export const MAX_PATH_DATA = 4000;
export const MAX_PATH_SEGMENTS = 600;

const ARGUMENTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

/** Splits path data into commands with their numbers; arc flags may be written without spaces. */
function tokenize(d: string): { command: string; values: number[] }[] | null {
  const groups: { command: string; values: number[] }[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/u.test(d[i]!)) i++;
  };
  const number = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/uy;
  skip();
  while (i < d.length) {
    const command = d[i]!;
    if (!/[MmLlHhVvCcSsQqTtAaZz]/u.test(command)) return null;
    i++;
    const values: number[] = [];
    const arity = ARGUMENTS[command.toUpperCase()] ?? 0;
    for (;;) {
      skip();
      if (i >= d.length || /[A-Za-z]/u.test(d[i]!)) break;
      // An arc's two flags are single digits that may touch the next number.
      const slot = values.length % 7;
      if (command.toUpperCase() === 'A' && (slot === 3 || slot === 4)) {
        if (d[i] !== '0' && d[i] !== '1') return null;
        values.push(Number(d[i]));
        i++;
        continue;
      }
      number.lastIndex = i;
      const match = number.exec(d);
      if (!match) return null;
      values.push(Number(match[0]));
      i = number.lastIndex;
    }
    if (arity === 0 ? values.length : !values.length || values.length % arity) return null;
    groups.push({ command, values });
  }
  return groups;
}

/** An SVG arc as cubic curves (SVG 1.1 implementation notes F.6.5–F.6.6). */
function arcToCubics(
  from: PathPoint,
  [rxIn, ryIn, angle, large, sweep, x, y]: number[],
): PathSegment[] {
  const to: PathPoint = [x!, y!];
  let rx = Math.abs(rxIn!);
  let ry = Math.abs(ryIn!);
  if (!rx || !ry || (from[0] === x && from[1] === y)) return [{ command: 'L', to }];
  const phi = ((angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - x!) / 2;
  const dy = (from[1] - y!) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const sign = large === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const factor = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + x!) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + y!) / 2;
  const vectorAngle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = vectorAngle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = vectorAngle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (theta: number, radiusX: number, radiusY: number): PathPoint => [
    cx + radiusX * Math.cos(theta) * cos - radiusY * Math.sin(theta) * sin,
    cy + radiusX * Math.cos(theta) * sin + radiusY * Math.sin(theta) * cos,
  ];
  const derivative = (theta: number): PathPoint => [
    -rx * Math.sin(theta) * cos - ry * Math.cos(theta) * sin,
    -rx * Math.sin(theta) * sin + ry * Math.cos(theta) * cos,
  ];
  const segments: PathSegment[] = [];
  for (let n = 0; n < parts; n++) {
    const a = start + n * step;
    const b = a + step;
    const p0 = point(a, rx, ry);
    const p3 = n === parts - 1 ? to : point(b, rx, ry);
    const d0 = derivative(a);
    const d1 = derivative(b);
    segments.push({
      command: 'C',
      c1: [p0[0] + k * d0[0], p0[1] + k * d0[1]],
      c2: [p3[0] - k * d1[0], p3[1] - k * d1[1]],
      to: p3,
    });
  }
  return segments;
}

/**
 * Path data as absolute moves, lines, cubic and quadratic curves and closes, or null when it is
 * not valid SVG path data. H/V become lines, S/T become full curves and arcs become cubics.
 */
export function normalizePath(d: string): PathSegment[] | null {
  if (!PATH_DATA_PATTERN.test(d)) return null;
  const groups = tokenize(d);
  if (!groups?.length || groups[0]!.command.toUpperCase() !== 'M') return null;
  const segments: PathSegment[] = [];
  let current: PathPoint = [0, 0];
  let start: PathPoint = [0, 0];
  let lastCubic: PathPoint | null = null;
  let lastQuad: PathPoint | null = null;
  for (const { command, values } of groups) {
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const at = (x: number, y: number): PathPoint =>
      relative ? [current[0] + x, current[1] + y] : [x, y];
    if (upper === 'Z') {
      segments.push({ command: 'Z' });
      current = start;
      lastCubic = lastQuad = null;
      continue;
    }
    const arity = ARGUMENTS[upper]!;
    for (let i = 0; i < values.length; i += arity) {
      const v = values.slice(i, i + arity);
      let cubic: PathPoint | null = null;
      let quad: PathPoint | null = null;
      switch (upper) {
        case 'M': {
          const to = at(v[0]!, v[1]!);
          // Further pairs after a move are lines.
          segments.push(i ? { command: 'L', to } : { command: 'M', to });
          if (!i) start = to;
          current = to;
          break;
        }
        case 'L':
        case 'T': {
          const to = at(v[0]!, v[1]!);
          if (upper === 'T') {
            const c1: PathPoint = lastQuad
              ? [2 * current[0] - lastQuad[0], 2 * current[1] - lastQuad[1]]
              : current;
            segments.push({ command: 'Q', c1, to });
            quad = c1;
          } else segments.push({ command: 'L', to });
          current = to;
          break;
        }
        case 'H':
        case 'V': {
          const value = v[0]!;
          const to: PathPoint =
            upper === 'H'
              ? [relative ? current[0] + value : value, current[1]]
              : [current[0], relative ? current[1] + value : value];
          segments.push({ command: 'L', to });
          current = to;
          break;
        }
        case 'C':
        case 'S': {
          const c1: PathPoint =
            upper === 'C'
              ? at(v[0]!, v[1]!)
              : lastCubic
                ? [2 * current[0] - lastCubic[0], 2 * current[1] - lastCubic[1]]
                : current;
          const rest = upper === 'C' ? v.slice(2) : v;
          const c2 = at(rest[0]!, rest[1]!);
          const to = at(rest[2]!, rest[3]!);
          segments.push({ command: 'C', c1, c2, to });
          cubic = c2;
          current = to;
          break;
        }
        case 'Q': {
          const c1 = at(v[0]!, v[1]!);
          const to = at(v[2]!, v[3]!);
          segments.push({ command: 'Q', c1, to });
          quad = c1;
          current = to;
          break;
        }
        case 'A': {
          const to = at(v[5]!, v[6]!);
          segments.push(...arcToCubics(current, [...v.slice(0, 5), to[0], to[1]]));
          current = to;
          break;
        }
      }
      lastCubic = cubic;
      lastQuad = quad;
    }
  }
  return segments.every((segment) =>
    segment.command === 'Z'
      ? true
      : [
          segment.to,
          ...('c1' in segment ? [segment.c1] : []),
          ...('c2' in segment ? [segment.c2] : []),
        ].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  )
    ? segments
    : null;
}

const fixed = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};
const pair = ([x, y]: PathPoint) => `${fixed(x)} ${fixed(y)}`;

export function serializePath(segments: readonly PathSegment[]): string {
  return segments
    .map((segment) => {
      switch (segment.command) {
        case 'Z':
          return 'Z';
        case 'C':
          return `C${pair(segment.c1)} ${pair(segment.c2)} ${pair(segment.to)}`;
        case 'Q':
          return `Q${pair(segment.c1)} ${pair(segment.to)}`;
        default:
          return `${segment.command}${pair(segment.to)}`;
      }
    })
    .join('');
}

/** The path with every point mapped (for an affine map: exactly), in normal form. */
export function mapPath(d: string, map: (point: PathPoint) => PathPoint): string {
  const segments = normalizePath(d);
  if (!segments) return d;
  return serializePath(
    segments.map((segment): PathSegment => {
      switch (segment.command) {
        case 'Z':
          return segment;
        case 'C':
          return { ...segment, c1: map(segment.c1), c2: map(segment.c2), to: map(segment.to) };
        case 'Q':
          return { ...segment, c1: map(segment.c1), to: map(segment.to) };
        default:
          return { ...segment, to: map(segment.to) };
      }
    }),
  );
}

/** The path as polylines, one per subpath, with `steps` samples per curve. */
export function samplePath(d: string, steps = 8): PathPoint[][] {
  const segments = normalizePath(d) ?? [];
  const lines: PathPoint[][] = [];
  let line: PathPoint[] = [];
  let current: PathPoint = [0, 0];
  let start: PathPoint = [0, 0];
  const flush = () => {
    if (line.length > 1) lines.push(line);
    line = [];
  };
  for (const segment of segments) {
    if (segment.command === 'M') {
      flush();
      line = [segment.to];
      current = start = segment.to;
      continue;
    }
    if (!line.length) line = [current];
    if (segment.command === 'Z') {
      line.push(start);
      current = start;
      flush();
      continue;
    }
    if (segment.command === 'L') line.push(segment.to);
    else
      for (let n = 1; n <= steps; n++) {
        const t = n / steps;
        const u = 1 - t;
        line.push(
          segment.command === 'C'
            ? [
                u * u * u * current[0] +
                  3 * u * u * t * segment.c1[0] +
                  3 * u * t * t * segment.c2[0] +
                  t * t * t * segment.to[0],
                u * u * u * current[1] +
                  3 * u * u * t * segment.c1[1] +
                  3 * u * t * t * segment.c2[1] +
                  t * t * t * segment.to[1],
              ]
            : [
                u * u * current[0] + 2 * u * t * segment.c1[0] + t * t * segment.to[0],
                u * u * current[1] + 2 * u * t * segment.c1[1] + t * t * segment.to[1],
              ],
        );
      }
    current = segment.to;
  }
  flush();
  return lines;
}

/** Why path data cannot be used, or null. */
export function pathDataProblem(d: string): string | null {
  if (d.length > MAX_PATH_DATA) return `Path data must be at most ${MAX_PATH_DATA} characters.`;
  const segments = normalizePath(d);
  if (!segments) return 'Path data must be SVG path commands and numbers, starting with M.';
  if (segments.length > MAX_PATH_SEGMENTS)
    return `A path may have at most ${MAX_PATH_SEGMENTS} segments.`;
  return null;
}

/**
 * The circle through an arc's start, a point it passes through, and its end, as SVG arc flags;
 * null when the three points are (nearly) in a line.
 */
export function arcThrough([start, through, end]: readonly [PathPoint, PathPoint, PathPoint]) {
  const [ax, ay] = start;
  const [bx, by] = through;
  const [cx, cy] = end;
  const determinant = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(determinant) < 1e-6) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const centre: PathPoint = [
    (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / determinant,
    (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / determinant,
  ];
  const radius = Math.hypot(ax - centre[0], ay - centre[1]);
  const angle = ([x, y]: PathPoint) => Math.atan2(y - centre[1], x - centre[0]);
  const turn = (from: number, to: number) =>
    (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Sweeping clockwise on screen (increasing angle), does the arc pass `through` before `end`?
  const sweep = turn(angle(start), angle(through)) < turn(angle(start), angle(end));
  const span = sweep ? turn(angle(start), angle(end)) : turn(angle(end), angle(start));
  return { centre, radius, sweep, large: span > Math.PI, start: angle(start), span };
}

/** An arc through three points as path data; a straight line when they are in a line. */
export function arcPathData(points: readonly [PathPoint, PathPoint, PathPoint]): string {
  const arc = arcThrough(points);
  const [start, , end] = points;
  if (!arc) return `M${pair(start)}L${pair(end)}`;
  const r = fixed(arc.radius);
  return `M${pair(start)}A${r} ${r} 0 ${arc.large ? 1 : 0} ${arc.sweep ? 1 : 0} ${pair(end)}`;
}

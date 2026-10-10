import {
  dimensionLabel,
  drawingFrame,
  drawingPolylines,
  FILLABLE_SHAPES,
  OPEN_SHAPES,
  type BoardDrawing,
  type DrawingHatch,
  type DrawingLineStyle,
  type DrawingMarker,
  type DrawingScale,
} from './board-drawings';
import { arcPathData, type PathPoint } from './drawing-path';
import type { IllustrationInk } from './illustration';

/**
 * Canvas drawings as SVG markup. The live canvas, the SVG/PNG exports and the preview agents
 * are shown all paint drawings through `drawingSvg`, so they never disagree. Coordinates are
 * absolute canvas units (an anchored drawing is first made absolute with `absoluteDrawing`).
 */

type Point = readonly [number, number];

/** Inks on the blueprint; gold matches the icons, the rest match the arrow colours. */
export const INK_VALUES: Record<IllustrationInk, string> = {
  ink: '#e4edfa',
  gold: '#f4dcaa',
  sky: '#75d9f3',
  amber: '#f2cc79',
  violet: '#d6b0fa',
  coral: '#ffad8f',
  mint: '#8fe3b4',
  rose: '#f6a3c7',
  ice: '#c4d7ed',
};

export const LINE_DASHES: Record<DrawingLineStyle, string | undefined> = {
  solid: undefined,
  dashed: '10 7',
  center: '18 5 3 5',
  // Near-zero dashes with round caps paint as dots.
  dotted: '0.1 7',
};

/** A smooth path through freehand samples, using midpoints as quadratic curve ends. */
export function strokePath(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  if (rest.length < 2)
    return `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}`;
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const [x, y] = rest[i]!;
    const [nx, ny] = rest[i + 1]!;
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = rest[rest.length - 1]!;
  return `${d}L${last[0]} ${last[1]}`;
}

/** A filled arrowhead whose tip is `tip`, pointing away from `from`. */
export function arrowHead(from: Point, tip: Point, size: number): string {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (offset: number) =>
    `${tip[0] - size * Math.cos(angle + offset)} ${tip[1] - size * Math.sin(angle + offset)}`;
  return `M${tip[0]} ${tip[1]}L${wing(0.42)}L${wing(-0.42)}Z`;
}

/**
 * A dimension line: extension ticks at both ends, arrowheads pointing outwards to them, and
 * where its label sits (rotated to read left to right along the line).
 */
export function dimensionGeometry([start, end]: readonly [Point, Point], strokeWidth: number) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
  const nx = -(end[1] - start[1]) / length;
  const ny = (end[0] - start[0]) / length;
  const tick = 9;
  const ticks = [start, end]
    .map(([x, y]) => `M${x + nx * tick} ${y + ny * tick}L${x - nx * tick} ${y - ny * tick}`)
    .join('');
  const head = 7 + strokeWidth * 1.5;
  let angle = (Math.atan2(end[1] - start[1], end[0] - start[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return {
    line: `M${start[0]} ${start[1]}L${end[0]} ${end[1]}`,
    ticks,
    heads: arrowHead(end, start, head) + arrowHead(start, end, head),
    label: {
      x: (start[0] + end[0]) / 2 + nx * 12,
      y: (start[1] + end[1]) / 2 + ny * 12,
      angle,
    },
  };
}

/**
 * The outline a line-like drawing is painted along. Strokes are smoothed, lines and arrows are
 * straight, polygons close, arcs pass through their middle point and paths are their own data.
 */
export function drawingPathData(drawing: BoardDrawing): string {
  const points = drawing.points ?? [];
  switch (drawing.shape) {
    case 'path':
      return drawing.d ?? '';
    case 'arc':
      return arcPathData(points as unknown as [PathPoint, PathPoint, PathPoint]);
    case 'polygon':
      return `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}Z`;
    case 'stroke':
    case 'line':
      return strokePath(points);
    default:
      return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
  }
}

/** A marker at `tip`, the end of a line arriving from `from`. */
export function markerPath(kind: DrawingMarker, from: Point, tip: Point, strokeWidth: number) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  switch (kind) {
    case 'arrow':
      return { d: arrowHead(from, tip, 10 + strokeWidth * 2), filled: true };
    case 'dot': {
      const r = 2.5 + strokeWidth;
      const [x, y] = tip;
      return {
        d: `M${x - r} ${y}A${r} ${r} 0 1 0 ${x + r} ${y}A${r} ${r} 0 1 0 ${x - r} ${y}Z`,
        filled: true,
      };
    }
    case 'bar': {
      const half = 6 + strokeWidth;
      const nx = -Math.sin(angle) * half;
      const ny = Math.cos(angle) * half;
      return { d: `M${tip[0] + nx} ${tip[1] + ny}L${tip[0] - nx} ${tip[1] - ny}`, filled: false };
    }
    default:
      return null;
  }
}

/** The direction a drawing leaves its first point and arrives at its last. */
function drawingEnds(drawing: BoardDrawing) {
  const lines = drawingPolylines(drawing);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || first.length < 2 || !last || last.length < 2) return null;
  // Look a little way along a sampled curve so a short final step does not skew the marker.
  const back = (line: PathPoint[], from: number, step: number) => {
    const tip = line[from]!;
    for (let i = from + step; i >= 0 && i < line.length; i += step)
      if (Math.hypot(line[i]![0] - tip[0], line[i]![1] - tip[1]) >= 6) return line[i]!;
    return line[from + step]!;
  };
  return {
    start: { tip: first[0]!, from: back(first, 0, 1) },
    end: { tip: last[last.length - 1]!, from: back(last, last.length - 1, -1) },
  };
}

const escapeText = (value: string) =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const escapeAttribute = (value: string) => escapeText(value).replace(/"/gu, '&quot;');

function attributes(values: Record<string, string | number | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join('');
}

/** A repeating hatch in `color`, 10 canvas units apart. */
function hatchPattern(id: string, hatch: DrawingHatch, color: string) {
  const line = (d: string) => `<path d="${d}" stroke="${color}" stroke-width="1.2" fill="none"/>`;
  const content =
    hatch === 'dots'
      ? `<circle cx="5" cy="5" r="1.4" fill="${color}"/>`
      : hatch === 'cross'
        ? line('M0 5H10M5 0V10')
        : hatch === 'vertical'
          ? line('M5 0V10')
          : line('M0 5H10');
  const angle = hatch === 'diagonal' || hatch === 'cross' ? ' patternTransform="rotate(45)"' : '';
  return `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="10" height="10"${angle}>${content}</pattern></defs>`;
}

/** Which parts to paint: shapes sit beneath the diagram, words above it. */
export type DrawingPart = 'shape' | 'label' | 'all';

/**
 * One drawing as SVG markup. `halo` is the canvas colour painted behind text so labels stay
 * legible over grid lines and arrows. `scale` is the board's drawing scale, in which unlabelled
 * dimension lines read.
 */
export function drawingSvg(
  drawing: BoardDrawing,
  { halo, part = 'all', scale }: { halo: string; part?: DrawingPart; scale?: DrawingScale },
): string {
  const shape = part !== 'label';
  const label = part !== 'shape';
  if (drawing.shape === 'text' ? !label : drawing.shape !== 'dimension' && !shape) return '';
  const body = paint(drawing, { halo, shape, label, scale });
  if (!body) return '';
  const group: Record<string, string | number | undefined> = {};
  // Boxes, ellipses and text turn about their centre; other shapes store turned points.
  if (drawing.rotation) {
    const [cx, cy] = drawingFrame(drawing).centre;
    group.transform = `rotate(${drawing.rotation} ${cx} ${cy})`;
  }
  if (drawing.opacity !== undefined && drawing.opacity < 1) group.opacity = drawing.opacity;
  return Object.keys(group).length ? `<g${attributes(group)}>${body}</g>` : body;
}

function paint(
  drawing: BoardDrawing,
  {
    halo,
    shape,
    label,
    scale,
  }: { halo: string; shape: boolean; label: boolean; scale?: DrawingScale | undefined },
): string {
  const color = INK_VALUES[drawing.ink];
  const stroke = {
    stroke: color,
    'stroke-width': drawing.strokeWidth,
    'stroke-dasharray': LINE_DASHES[drawing.line],
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const textStyle = {
    fill: color,
    stroke: halo,
    'stroke-width': 4,
    'paint-order': 'stroke',
    'stroke-linejoin': 'round',
    'font-family': 'Inter, Arial, sans-serif',
  };
  const fillable = FILLABLE_SHAPES.includes(drawing.shape);
  const fillColor = !fillable
    ? undefined
    : drawing.fillInk
      ? INK_VALUES[drawing.fillInk]
      : drawing.fill
        ? color
        : undefined;
  const fill = fillColor
    ? { fill: fillColor, 'fill-opacity': drawing.fillOpacity ?? 0.16 }
    : { fill: 'none' };
  const hatchId = `opsis-hatch-${drawing.id}`;
  const hatched = fillable && drawing.hatch;
  const hatch = hatched
    ? hatchPattern(hatchId, drawing.hatch!, INK_VALUES[drawing.fillInk ?? drawing.ink])
    : '';
  // The hatch is a second fill over the first, without an outline.
  const hatchLayer = (tag: string, geometry: Record<string, string | number | undefined>) =>
    hatched
      ? `<${tag}${attributes({ ...geometry, fill: `url(#${hatchId})`, stroke: 'none' })}/>`
      : '';

  switch (drawing.shape) {
    case 'rect': {
      const geometry = {
        x: drawing.x,
        y: drawing.y,
        width: drawing.width,
        height: drawing.height,
        rx: 2,
      };
      return `${hatch}<rect${attributes({ ...geometry, ...stroke, ...fill })}/>${hatchLayer('rect', geometry)}`;
    }
    case 'ellipse': {
      const geometry = {
        cx: drawing.x! + drawing.width! / 2,
        cy: drawing.y! + drawing.height! / 2,
        rx: drawing.width! / 2,
        ry: drawing.height! / 2,
      };
      return `${hatch}<ellipse${attributes({ ...geometry, ...stroke, ...fill })}/>${hatchLayer('ellipse', geometry)}`;
    }
    case 'text': {
      const size = drawing.fontSize ?? 16;
      const anchor =
        drawing.align === 'middle' ? 'middle' : drawing.align === 'end' ? 'end' : undefined;
      const lines = drawing
        .text!.split('\n')
        .map(
          (line, index) =>
            `<tspan${attributes({ x: drawing.x, dy: index ? size * 1.25 : 0 })}>${escapeText(line || ' ')}</tspan>`,
        )
        .join('');
      const frame = drawingFrame(drawing);
      const backdrop = drawing.background
        ? `<rect${attributes({ x: frame.x - 6, y: frame.y - 3, width: frame.width + 12, height: frame.height + 6, rx: 4, fill: halo, 'fill-opacity': 0.92, stroke: color, 'stroke-opacity': 0.35, 'stroke-width': 1 })}/>`
        : '';
      return `${backdrop}<text${attributes({
        x: drawing.x,
        y: drawing.y! + size,
        'font-size': size,
        'font-weight': drawing.bold ? 700 : undefined,
        'text-anchor': anchor,
        ...textStyle,
      })}>${lines}</text>`;
    }
    case 'dimension': {
      const geometry = dimensionGeometry(
        drawing.points as [[number, number], [number, number]],
        drawing.strokeWidth,
      );
      const { x, y, angle } = geometry.label;
      return (
        (shape
          ? `<path${attributes({ d: geometry.line, ...stroke, fill: 'none' })}/>` +
            `<path${attributes({ d: geometry.ticks, ...stroke, 'stroke-dasharray': undefined, fill: 'none' })}/>` +
            `<path${attributes({ d: geometry.heads, fill: color })}/>`
          : '') +
        (label
          ? `<text${attributes({
              x,
              y,
              'font-size': 12,
              'text-anchor': 'middle',
              'dominant-baseline': 'middle',
              transform: `rotate(${angle} ${x} ${y})`,
              ...textStyle,
            })}>${escapeText(dimensionLabel(drawing, scale))}</text>`
          : '')
      );
    }
    default: {
      const d = drawingPathData(drawing);
      let markup = `${hatch}<path${attributes({ d, ...stroke, ...fill })}/>${hatchLayer('path', { d })}`;
      if (OPEN_SHAPES.includes(drawing.shape)) {
        const ends = drawingEnds(drawing);
        const start = drawing.startMarker ?? 'none';
        const end = drawing.endMarker ?? (drawing.shape === 'arrow' ? 'arrow' : 'none');
        for (const [kind, at] of [
          [start, ends?.start],
          [end, ends?.end],
        ] as const) {
          const marker = at && markerPath(kind, at.from, at.tip, drawing.strokeWidth);
          if (marker)
            markup += marker.filled
              ? `<path${attributes({ d: marker.d, fill: color })}/>`
              : `<path${attributes({ d: marker.d, stroke: color, 'stroke-width': drawing.strokeWidth, 'stroke-linecap': 'round', fill: 'none' })}/>`;
        }
      }
      return markup;
    }
  }
}

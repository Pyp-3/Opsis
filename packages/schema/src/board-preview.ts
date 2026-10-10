import type { BoardDocument } from './board';
import { absoluteDrawing, drawingBounds, visibleDrawings } from './board-drawings';
import { arrowHead, drawingSvg } from './drawing-svg';

/**
 * A schematic picture of a board for agents to check their work: every visible drawing exactly
 * as the canvas paints it, concepts as labelled markers where the canvas places their icons,
 * connections as straight arrows, and rulers in canvas coordinates. It is a check image, not
 * the reader's view: icons, routing and styling are simplified.
 */

export type PreviewRegion = { x: number; y: number; width: number; height: number };

/** Where a concept's icon sits within its layout box (the canvas's node footprint). */
const NODE_WIDTH = 224;
const ICON_Y = 44;
const ICON_RADIUS = 24;
const BACKGROUND = '#10233a';
const GRID = '#2a4566';
const CONCEPT = '#f4dcaa';
const CONNECTION = '#9fb4cc';
const RULER = '#9fb4cc';

const escape = (value: string) =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
const round = (value: number) => Math.round(value * 10) / 10;

/** The area holding every concept and visible drawing, padded. */
export function boardExtent(board: BoardDocument): PreviewRegion {
  const boxes = [
    ...board.nodes
      .filter((node) => board.positions[node.id])
      .map((node) => {
        const { x, y } = board.positions[node.id]!;
        return { minX: x, minY: y, maxX: x + NODE_WIDTH, maxY: y + 120 };
      }),
    ...visibleDrawings(board).map((drawing) => drawingBounds(drawing, board.positions)),
  ];
  if (!boxes.length) return { x: -240, y: -240, width: 480, height: 480 };
  const minX = Math.min(...boxes.map((box) => box.minX)) - 48;
  const minY = Math.min(...boxes.map((box) => box.minY)) - 48;
  const maxX = Math.max(...boxes.map((box) => box.maxX)) + 48;
  const maxY = Math.max(...boxes.map((box) => box.maxY)) + 48;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A ruler step giving about ten labelled marks across `span` canvas units. */
function rulerStep(span: number) {
  return (
    [24, 48, 96, 120, 240, 480, 960, 1920, 4800, 9600].find((step) => span / step <= 12) ?? 19200
  );
}

/**
 * The board (or a region of it) as an SVG preview at most `maxSize` pixels on its longer side.
 * Returns the markup and the pixel and canvas sizes it covers.
 */
export function boardPreviewSvg(
  board: BoardDocument,
  { region, maxSize = 1400 }: { region?: PreviewRegion; maxSize?: number } = {},
) {
  const area = region ?? boardExtent(board);
  const pixels = Math.min(maxSize, Math.max(area.width, area.height) * 3);
  const scale = pixels / Math.max(area.width, area.height, 1);
  const width = Math.max(1, Math.round(area.width * scale));
  const height = Math.max(1, Math.round(area.height * scale));
  // Sizes meant in screen pixels, converted to canvas units.
  const px = (value: number) => round(value / scale);
  const parts: string[] = [];
  parts.push(
    `<rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" fill="${BACKGROUND}"/>`,
  );

  // Grid squares when they are big enough to see, and ruler marks along the top and left.
  const step = rulerStep(Math.max(area.width, area.height));
  const fine = 24 * scale >= 6 ? 24 : step;
  const lines: string[] = [];
  for (let x = Math.ceil(area.x / fine) * fine; x <= area.x + area.width; x += fine)
    lines.push(`M${x} ${area.y}V${area.y + area.height}`);
  for (let y = Math.ceil(area.y / fine) * fine; y <= area.y + area.height; y += fine)
    lines.push(`M${area.x} ${y}H${area.x + area.width}`);
  parts.push(
    `<path d="${lines.join('')}" stroke="${GRID}" stroke-width="${px(0.6)}" opacity="0.6" fill="none"/>`,
  );
  const marks: string[] = [];
  const labels: string[] = [];
  const font = px(11);
  for (let x = Math.ceil(area.x / step) * step; x <= area.x + area.width; x += step) {
    marks.push(`M${x} ${area.y}V${area.y + area.height}`);
    labels.push(`<text x="${x + px(3)}" y="${area.y + px(13)}" font-size="${font}">${x}</text>`);
  }
  for (let y = Math.ceil(area.y / step) * step; y <= area.y + area.height; y += step) {
    marks.push(`M${area.x} ${y}H${area.x + area.width}`);
    labels.push(`<text x="${area.x + px(3)}" y="${y - px(3)}" font-size="${font}">${y}</text>`);
  }
  parts.push(
    `<path d="${marks.join('')}" stroke="${GRID}" stroke-width="${px(1.2)}" fill="none"/>`,
  );

  const drawings = visibleDrawings(board).map((drawing) =>
    absoluteDrawing(drawing, board.positions),
  );
  const scaleOption = board.drawingScale ? { scale: board.drawingScale } : {};
  for (const drawing of drawings)
    parts.push(drawingSvg(drawing, { halo: BACKGROUND, part: 'shape', ...scaleOption }));

  // Connections between icon centres, stopping at the icons' edges.
  const centre = (id: string) => {
    const at = board.positions[id];
    return at ? ([at.x + NODE_WIDTH / 2, at.y + ICON_Y] as const) : null;
  };
  for (const edge of board.edges) {
    const from = centre(edge.source);
    const to = centre(edge.target);
    if (!from || !to) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    const ux = (to[0] - from[0]) / length;
    const uy = (to[1] - from[1]) / length;
    const start = [from[0] + ux * ICON_RADIUS, from[1] + uy * ICON_RADIUS] as const;
    const end = [to[0] - ux * ICON_RADIUS, to[1] - uy * ICON_RADIUS] as const;
    parts.push(
      `<path d="M${round(start[0])} ${round(start[1])}L${round(end[0])} ${round(end[1])}" stroke="${CONNECTION}" stroke-width="2" fill="none"/>` +
        `<path d="${arrowHead(start, end, 12)}" fill="${CONNECTION}"/>`,
    );
    if (edge.label)
      parts.push(
        `<text x="${round((start[0] + end[0]) / 2)}" y="${round((start[1] + end[1]) / 2 - 6)}" font-size="12" text-anchor="middle" fill="${CONNECTION}" stroke="${BACKGROUND}" stroke-width="4" paint-order="stroke">${escape(edge.label)}</text>`,
      );
  }
  for (const node of board.nodes) {
    const at = centre(node.id);
    if (!at) continue;
    parts.push(
      `<circle cx="${at[0]}" cy="${at[1]}" r="${ICON_RADIUS}" fill="${BACKGROUND}" stroke="${CONCEPT}" stroke-width="2.5"${node.kind === 'decision' ? ' stroke-dasharray="6 4"' : ''}/>` +
        `<text x="${at[0]}" y="${at[1] + ICON_RADIUS + 18}" font-size="15" font-weight="600" text-anchor="middle" fill="${CONCEPT}" stroke="${BACKGROUND}" stroke-width="4" paint-order="stroke">${escape(node.label)}</text>` +
        `<text x="${at[0]}" y="${at[1] + 5}" font-size="11" text-anchor="middle" fill="${CONCEPT}">${escape(node.id.slice(0, 12))}</text>`,
    );
  }
  for (const drawing of drawings)
    parts.push(drawingSvg(drawing, { halo: BACKGROUND, part: 'label', ...scaleOption }));
  parts.push(`<g fill="${RULER}" font-family="Inter, Arial, sans-serif">${labels.join('')}</g>`);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${area.x} ${area.y} ${area.width} ${area.height}" font-family="Inter, Arial, sans-serif">` +
    `<defs><clipPath id="opsis-preview-area"><rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}"/></clipPath></defs>` +
    `<g clip-path="url(#opsis-preview-area)">${parts.join('')}</g></svg>`;
  return { svg, width, height, region: area, gridSquare: 24 };
}

const PREVIEW_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'pattern',
  'clipPath',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'text',
  'tspan',
  'title',
]);
export const MAX_PREVIEW_SVG = 5_000_000;

/**
 * Why markup is not a preview the renderer may rasterise, or null. Only the plain shapes the
 * preview uses are allowed: no scripts, entities, links, images or external references, so a
 * rasteriser never loads anything from outside the markup.
 */
export function previewSvgProblem(svg: string): string | null {
  if (svg.length > MAX_PREVIEW_SVG) return 'The preview is too large.';
  if (!svg.trimStart().startsWith('<svg')) return 'The preview must be an SVG element.';
  if (/<[!?]|href|xlink|javascript:|\son[a-z]+\s*=|@import/iu.test(svg))
    return 'The preview may not contain links, scripts, entities or declarations.';
  if (/url\(\s*(?!#)/iu.test(svg)) return 'The preview may only refer to its own patterns.';
  for (const [, tag] of svg.matchAll(/<\/?([A-Za-z][\w:.-]*)/gu))
    if (!PREVIEW_TAGS.has(tag!)) return `The preview may not contain <${tag}>.`;
  return null;
}

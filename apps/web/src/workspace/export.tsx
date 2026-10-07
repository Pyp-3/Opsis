import { renderToStaticMarkup } from 'react-dom/server';
import { saveBlob } from '../desktop';
import { absoluteDrawing, drawingBounds, visibleDrawings, type BoardDocument } from '@opsis/schema';
import { DrawingShape } from './DrawingShape';
import { NodeIcon } from './NodeIcon';
import { NODE_WIDTH } from './model';
import { routeBoard } from './routing';
import { wrapLabel, nodeHeight } from './geometry';
import { connectionStyle, PORT_OFFSETS, connectionLabel } from './connections';
import { iconColorOf, lookOf, paletteOf, type CanvasLook } from './canvas-theme';

const escape = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!,
  );

/** Draws the board in its own canvas palette and icon colour. */
export function boardSvg(board: BoardDocument, look: CanvasLook = lookOf(board)): string {
  const palette = paletteOf(look);
  const routes = routeBoard(board);
  const points = [
    ...(board.nodes.length
      ? []
      : [
          { x: 0, y: 0 },
          { x: 224, y: 124 },
        ]),
    ...board.nodes.flatMap((node) => {
      const p = board.positions[node.id] ?? { x: 0, y: 0 };
      return [p, { x: p.x + NODE_WIDTH, y: p.y + nodeHeight(node) }];
    }),
    ...visibleDrawings(board).flatMap((drawing) => {
      const bounds = drawingBounds(drawing, board.positions);
      return [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
      ];
    }),
    ...Object.values(routes).flatMap((route) => [
      ...route.points,
      ...(route.label
        ? [
            { x: route.label.x, y: route.label.y },
            { x: route.label.x + route.label.width, y: route.label.y + route.label.height },
          ]
        : []),
    ]),
  ];
  const minX = Math.min(...points.map((p) => p.x)) - 50;
  const minY = Math.min(...points.map((p) => p.y)) - 80;
  const width = Math.max(...points.map((p) => p.x)) - minX + 50;
  const height = Math.max(...points.map((p) => p.y)) - minY + 50;
  const edges = board.edges
    .map((edge) => {
      const route = routes[edge.id];
      if (!route) return '';
      const label = route.label;
      const text = label
        ? `<rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="5" fill="${palette.deep}" stroke="#607e9e"/>${route.lines.map((line, i) => `<text x="${label.x + label.width / 2}" y="${label.y + 18 + i * 16}" text-anchor="middle" font-family="monospace" font-size="12" fill="#e4edfa">${escape(line)}</text>`).join('')}`
        : '';
      const style = connectionStyle(edge);
      const callout = route.callout
        ? `<path d="${route.callout}" fill="none" stroke="${style.color}" stroke-width="1" stroke-dasharray="2 5" opacity=".7"/>`
        : '';
      return `<path d="${route.path}" fill="none" stroke="${palette.deep}" stroke-width="7"/><path d="${route.path}" fill="none" stroke="${style.color}" stroke-dasharray="${style.dash}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow-${style.color.slice(1)})"/>${callout}${text}`;
    })
    .join('');
  const nodes = board.nodes
    .map((node) => {
      const p = board.positions[node.id] ?? { x: 0, y: 0 };
      const label = wrapLabel(node.label)
        .map(
          (line, i) =>
            `<text x="${NODE_WIDTH / 2}" y="${110 + i * 18}" fill="${palette.ink}" text-anchor="middle" font-size="14">${escape(line)}</text>`,
        )
        .join('');
      const ports = Object.values(PORT_OFFSETS)
        .map(
          (port) =>
            `<circle cx="${port.x}" cy="${port.y}" r="4" fill="${palette.handle}" stroke="${palette.handleRing}"/>`,
        )
        .join('');
      const command = node.terminal
        ? wrapLabel(node.terminal.command, 26)
            .map(
              (line, i) =>
                `<text x="${NODE_WIDTH / 2}" y="${126 + (wrapLabel(node.label).length - 1) * 18 + i * 16}" fill="#e8d4a3" text-anchor="middle" font-family="monospace" font-size="12">${escape(line)}</text>`,
            )
            .join('')
        : '';
      return `<g transform="translate(${p.x} ${p.y})"><g transform="translate(${NODE_WIDTH / 2 - 24} 20)" color="${iconColorOf(look)}">${renderToStaticMarkup(<NodeIcon node={node} size={48} />)}</g>${ports}${label}${command}<title>${escape(node.explanation)}</title></g>`;
    })
    .join('');
  // As on the canvas: shapes beneath arrows and icons, their words above them, in layer order
  // and without hidden layers.
  const drawingPart = (part: 'shape' | 'label') =>
    visibleDrawings(board)
      .map((drawing) =>
        renderToStaticMarkup(
          <DrawingShape
            drawing={absoluteDrawing(drawing, board.positions)}
            halo={palette.deep}
            part={part}
            scale={board.drawingScale}
          />,
        ),
      )
      .join('');
  const markers = [...new Set(board.edges.map((edge) => connectionStyle(edge).color))]
    .map(
      (color) =>
        `<marker id="arrow-${color.slice(1)}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="${color}"/></marker>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="Arial,sans-serif"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity=".1"/></pattern>${markers}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${palette.deep}"/><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#grid)"/><text x="${minX + 30}" y="${minY + 35}" fill="${palette.ink}" font-size="18">${escape(board.title)} · Opsis</text>${drawingPart('shape')}${edges}${nodes}${drawingPart('label')}</svg>`;
}

export function download(content: string, name: string, type: string) {
  return saveBlob(new Blob([content], { type }), name);
}

export function boardMarkdown(board: BoardDocument): string {
  const safe = (value: string) => value.replace(/[\\`*_{}[\]<>#|]/g, '\\$&');
  return (
    `# ${safe(board.title)}\n\n${safe(board.description)}\n\n` +
    board.nodes
      .map((node, index) => {
        const paths = board.edges
          .filter((edge) => edge.source === node.id)
          .map(
            (edge) =>
              `- ${safe(connectionLabel(edge) || 'Next')} → ${safe(board.nodes.find((n) => n.id === edge.target)?.label ?? edge.target)}` +
              (edge.description ? ' — ' + safe(edge.description) : ''),
          )
          .join('\n');
        const terminal = node.terminal
          ? `**Command:** ${safe(node.terminal.command)}\n\n**Environment:** ${safe(node.terminal.environment)}\n\n**Input:** ${safe(node.terminal.input)}\n\n${node.terminal.exampleInput ? `**Sample input:**\n\n${safe(node.terminal.exampleInput)}\n\n` : ''}**Expected output:** ${safe(node.terminal.output)}\n\n**Expected success:** ${safe(node.terminal.success)}\n\n${node.terminal.issues.map((issue) => `### ${safe(issue.symptom)}\n\n${safe(issue.cause)}\n\n**Check / remedy:** ${safe(issue.remedy)}\n`).join('\n')}\n`
          : '';
        const sources =
          (node.notes ? `**Notes:** ${safe(node.notes)}\n\n` : '') +
          (node.references ?? [])
            .map(
              (reference) =>
                `**Source:** ${safe(reference.title)}${reference.url ? ` — ${safe(reference.url)}` : ''}\n${reference.excerpt ? safe(reference.excerpt) + '\n' : ''}`,
            )
            .join('\n');
        return `## ${index + 1}. ${safe(node.label)}\n\n${safe(node.summary)}\n\n${safe(node.explanation)}\n\n${terminal}${sources}${node.confidence && node.confidence !== 'normal' ? `**${node.confidence}**: ${safe(node.caveat ?? '')}\n\n` : ''}${paths}\n`;
      })
      .join('\n')
  );
}

const RASTER_FORMATS = {
  png: { type: 'image/png', ext: 'png', quality: undefined as number | undefined },
  jpeg: { type: 'image/jpeg', ext: 'jpg', quality: 0.92 },
} as const;
export type RasterFormat = keyof typeof RASTER_FORMATS;

/**
 * Rasterises the whole board to PNG or JPEG. It draws from {@link boardSvg}, which lays out
 * every node, port, label and routed path from the board's own bounds — so the file always
 * shows the complete diagram, not just whatever is in the viewport. The canvas is painted
 * with the board's background first, so JPEG (which has no transparency) never bleeds to black.
 */
export async function downloadRaster(board: BoardDocument, format: RasterFormat): Promise<void> {
  const look = lookOf(board);
  const svg = boardSvg(board, look);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // Cap the longest side so very large boards still encode, but keep small ones crisp at 2×.
    const scale = Math.min(2, 4096 / image.width, 4096 / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');
    context.fillStyle = paletteOf(look).deep;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { type, ext, quality } = RASTER_FORMATS[format];
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Image encoding failed.'))),
        type,
        quality,
      ),
    );
    await saveBlob(blob, `opsis-diagram.${ext}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const downloadPng = (board: BoardDocument) => downloadRaster(board, 'png');

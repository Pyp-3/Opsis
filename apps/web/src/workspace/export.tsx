import { renderToStaticMarkup } from 'react-dom/server';
import type { BoardDocument } from '@opsis/schema';
import { boardIcons } from './icons';
import { NODE_HEIGHT, NODE_WIDTH } from './model';
import { getBezierPath, Position } from '@xyflow/react';
import { edgePorts, PORT_OFFSETS } from './connections';

const escape = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!,
  );

export function boardSvg(board: BoardDocument): string {
  const points = board.nodes.map((node) => board.positions[node.id] ?? { x: 0, y: 0 });
  const minX = Math.min(...points.map((p) => p.x)) - 50;
  const minY = Math.min(...points.map((p) => p.y)) - 80;
  const width = Math.max(...points.map((p) => p.x)) - minX + NODE_WIDTH + 50;
  const height = Math.max(...points.map((p) => p.y)) - minY + NODE_HEIGHT + 50;
  const edges = board.edges
    .map((edge) => {
      const from = board.positions[edge.source];
      const to = board.positions[edge.target];
      if (!from || !to) return '';
      const ports = edgePorts(board, edge);
      const source = PORT_OFFSETS[ports.source],
        target = PORT_OFFSETS[ports.target];
      const [path, labelX, labelY] = getBezierPath({
        sourceX: from.x + source.x,
        sourceY: from.y + source.y,
        sourcePosition: ports.source as Position,
        targetX: to.x + target.x,
        targetY: to.y + target.y,
        targetPosition: ports.target as Position,
      });
      return `<path d="${path}" fill="none" stroke="#a9c7eb" stroke-width="2" marker-end="url(#arrow)"/><text x="${labelX}" y="${labelY - 12}" text-anchor="middle" font-size="11" fill="#d4e5fa">${escape(edge.label)}</text>`;
    })
    .join('');
  const nodes = board.nodes
    .map((node) => {
      const p = board.positions[node.id] ?? { x: 0, y: 0 };
      const Icon = boardIcons[node.icon];
      return `<g transform="translate(${p.x} ${p.y})"><g transform="translate(65 20)" color="#f4d598">${renderToStaticMarkup(<Icon size={48} />)}</g><text x="89" y="105" fill="white" text-anchor="middle" font-size="13">${escape(node.label)}</text><title>${escape(node.explanation)}</title></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="Arial,sans-serif"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity=".1"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10" fill="#a9c7eb"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#153c68"/><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#grid)"/><text x="${minX + 30}" y="${minY + 35}" fill="white" font-size="18">${escape(board.title)} · Opsis</text>${edges}${nodes}</svg>`;
}

export function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

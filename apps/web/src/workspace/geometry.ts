// Layout, ports, routing and exports share one footprint (including all visible text).
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 200;
export const COLUMN_GAP = 80;
export const ROW_GAP = 56;

export function nodeHeight(node: {
  label: string;
  confidence?: string | undefined;
  terminal?: { command: string } | undefined;
}): number {
  return (
    94 +
    wrapLabel(node.label).length * 18 +
    (node.confidence && node.confidence !== 'normal' ? 24 : 0) +
    (node.terminal ? wrapLabel(node.terminal.command, 26).length * 16 + 16 : 0) +
    12
  );
}

export function wrapLabel(text: string, columns = 28): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > columns) {
      lines.push(line);
      line = '';
    }
    let remainder = word;
    while (remainder.length > columns) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(remainder.slice(0, columns));
      remainder = remainder.slice(columns);
    }
    line = line ? `${line} ${remainder}` : remainder;
  }
  if (line) lines.push(line);
  return lines;
}

/** Frame the first row at readable scale; wide hand-arranged boards start at the first concept. */
export function readingViewport(
  positions: { x: number; y: number }[],
  width: number,
  height: number,
) {
  if (!positions.length) return { x: 0, y: 0, zoom: 1 };
  const top = Math.min(...positions.map((point) => point.y));
  const row = positions.filter((point) => point.y < top + NODE_HEIGHT);
  const left = Math.min(...row.map((point) => point.x));
  const right = Math.max(...row.map((point) => point.x)) + NODE_WIDTH;
  const zoom = Math.min(1, Math.max(0.8, (width - 48) / (right - left)));
  const center = (right - left) * zoom <= width - 24 ? (left + right) / 2 : left + NODE_WIDTH / 2;
  return {
    x: width / 2 - center * zoom,
    y: Math.min(160, Math.max(48, height * 0.2)) - top * zoom,
    zoom,
  };
}

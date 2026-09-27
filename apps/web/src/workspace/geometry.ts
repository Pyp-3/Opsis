// Layout, ports, routing and exports share one footprint (including all visible text).
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 200;
export const COLUMN_GAP = 80;
export const ROW_GAP = 56;

export function nodeHeight(node: { label: string; confidence?: string | undefined }): number {
  return (
    94 +
    wrapLabel(node.label).length * 18 +
    (node.confidence && node.confidence !== 'normal' ? 24 : 0) +
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

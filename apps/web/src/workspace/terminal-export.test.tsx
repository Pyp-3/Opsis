import { describe, expect, it } from 'vitest';
import { TERMINAL_PIPELINE_EXAMPLE, type BoardDocument } from '@opsis/schema';
import { boardMarkdown, boardSvg } from './export';
import { nodeHeight } from './geometry';

const board: BoardDocument = {
  ...TERMINAL_PIPELINE_EXAMPLE,
  agent: 'claude',
  version: 2,
  positions: Object.fromEntries(
    TERMINAL_PIPELINE_EXAMPLE.nodes.map((node, i) => [node.id, { x: 0, y: i * 250 }]),
  ),
};
describe('terminal metadata across canvas exports', () => {
  it('includes commands, expected results and remedies in notes', () => {
    const markdown = boardMarkdown(board);
    expect(markdown).toContain('**Command:** cat users.txt');
    expect(markdown).toContain('**Expected success:**');
    expect(markdown).toContain('**Check / remedy:**');
    expect(markdown).toContain('Permission denied');
  });
  it('reserves a footprint for command captions and escapes their SVG text', () => {
    const node = board.nodes[1]!;
    expect(nodeHeight(node)).toBeGreaterThan(nodeHeight({ label: node.label }));
    const copy = structuredClone(board);
    copy.nodes[1]!.terminal!.command = 'cat <input> & other';
    const svg = boardSvg(copy);
    expect(svg).toContain('cat &lt;input&gt; &amp; other');
    expect(svg).not.toContain('cat <input>');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

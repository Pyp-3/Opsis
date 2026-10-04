import { it, expect } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { StreamedNodes } from './streamed-nodes';
import { progressReader } from './progress';
it('streams only complete valid root nodes across arbitrary chunk boundaries and ignores nested/string impostors', () => {
  const reader = new StreamedNodes();
  const node = {
    ...EMAIL_DEMO.nodes[0]!,
    explanation: 'Literal "nodes": [{ and braces } with \\ escapes',
  };
  const input = JSON.stringify({
    title: 'nodes',
    nodes: [node, { id: 'bad' }, node, EMAIL_DEMO.nodes[1]],
    edges: [],
  });
  const found = [];
  for (const char of input) found.push(...reader.add(char));
  expect(found).toEqual([node, EMAIL_DEMO.nodes[1]]);
});
it('relays validated Claude partial nodes before final result and bounds oversized streams', () => {
  const read = progressReader('claude');
  const node = EMAIL_DEMO.nodes[0]!;
  const json = JSON.stringify({ nodes: [node] });
  const event = (text: string) =>
    JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: text },
      },
    });
  expect(read(event(json.slice(0, -3))).some((item) => item.type === 'node')).toBe(false);
  expect(read(event(json.slice(-3)))).toContainEqual({ type: 'node', node });
  expect(new StreamedNodes().add(' '.repeat(2_000_001) + json)).toEqual([]);
});

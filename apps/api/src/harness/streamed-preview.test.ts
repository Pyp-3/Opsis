import { it, expect } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { StreamedPreview } from './streamed-preview';
import { progressReader } from './progress';
it('streams only complete valid root nodes across arbitrary chunk boundaries and ignores nested/string impostors', () => {
  const reader = new StreamedPreview();
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
  expect(found).toEqual([
    { type: 'node', node },
    { type: 'node', node: EMAIL_DEMO.nodes[1] },
  ]);
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
  expect(new StreamedPreview().add(' '.repeat(2_000_001) + json)).toEqual([]);
});

it('streams sketch drawings from a whole sketch or its edits, sending a replacement again', () => {
  const reader = new StreamedPreview();
  const wall = {
    id: 'wall',
    shape: 'line',
    points: [
      [0, 0],
      [96, 0],
    ],
    ink: 'ink',
    line: 'solid',
    strokeWidth: 2,
  };
  const moved = {
    ...wall,
    points: [
      [0, 24],
      [96, 24],
    ],
  };
  const input = JSON.stringify({
    nodes: [EMAIL_DEMO.nodes[0]],
    edges: [{ id: 'e', source: 'a', target: 'b', label: 'drawings' }],
    drawings: [wall, { id: 'broken', shape: 'line' }],
    sketchEdits: { put: [moved], remove: ['wall'] },
    reply: 'Literal "drawings": [{"id": "x"}] in a string',
  });
  const found = [];
  for (let i = 0; i < input.length; i += 7) found.push(...reader.add(input.slice(i, i + 7)));
  expect(found).toEqual([
    { type: 'node', node: EMAIL_DEMO.nodes[0] },
    { type: 'drawing', drawing: wall },
    { type: 'drawing', drawing: moved },
  ]);
  // Objects nested inside a drawing, or drawings deeper in the answer, are not previews.
  expect(new StreamedPreview().add(JSON.stringify({ memory: { drawings: [wall] } }))).toEqual([]);
});

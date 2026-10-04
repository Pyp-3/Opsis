import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { layoutBoard, removeNode } from './model';
import { boardSvg } from './export';

describe('2D workspace documents', () => {
  it('retains manual positions when adding a new branch', async () => {
    const before = await layoutBoard(EMAIL_DEMO, 'claude');
    before.positions.sender = { x: -480, y: 336 };
    const graph = {
      ...EMAIL_DEMO,
      nodes: [...EMAIL_DEMO.nodes, { ...EMAIL_DEMO.nodes[0]!, id: 'branch' }],
      edges: [
        ...EMAIL_DEMO.edges,
        { id: 'new-edge', source: 'outgoing', target: 'branch', label: 'Failure' },
      ],
    };
    const after = await layoutBoard(graph, 'codex', before);
    for (const node of before.nodes)
      expect(after.positions[node.id]).toEqual(before.positions[node.id]);
    expect(after.agent).toBe('codex');
    expect(after.positions.branch).toBeDefined();
    expect(Object.values(before.positions)).not.toContainEqual(after.positions.branch);
  });
  it('removes incident connections when deleting a concept', async () => {
    const board = removeNode(await layoutBoard(EMAIL_DEMO, 'demo'), 'outgoing');
    expect(board.nodes.some((node) => node.id === 'outgoing')).toBe(false);
    expect(
      board.edges.some((edge) => edge.source === 'outgoing' || edge.target === 'outgoing'),
    ).toBe(false);
    expect(board.positions.outgoing).toBeUndefined();
  });
  it('escapes text when exporting diagrams to SVG', async () => {
    const board = await layoutBoard(EMAIL_DEMO, 'demo');
    board.title = '<script>alert(1)</script>';
    const svg = boardSvg(board);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    // Every arrow's head references a marker drawn in its own colour.
    const used = [...svg.matchAll(/marker-end="url\(#(arrow-[0-9a-f]{6})\)"/g)].map((m) => m[1]);
    expect(used.length).toBe(board.edges.length);
    for (const id of new Set(used)) expect(svg).toContain(`id="${id}"`);
  });
});

it('retains pinned positions during explicit arrangement and removes pins with concepts', async () => {
  const before = await layoutBoard(EMAIL_DEMO, 'demo');
  before.positions.sender = { x: -600, y: 300 };
  before.positions.app = { x: 8000, y: 300 };
  before.pinnedNodeIds = ['sender'];
  const after = await layoutBoard(before, 'demo', before, 900, 'pinned');
  expect(after.positions.sender).toEqual(before.positions.sender);
  expect(after.positions.app).not.toEqual(before.positions.app);
  expect(after.pinnedNodeIds).toEqual(['sender']);
  expect(removeNode(after, 'sender').pinnedNodeIds).toEqual([]);
});

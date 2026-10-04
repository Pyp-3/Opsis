import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO } from './email-demo';
import { BoardDocumentSchema, type BoardDocument } from './board';
import { boardReviewChanges, selectBoardChanges } from './board-review';
import { removeBoardNode } from './board-operations';

const before: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(
    EMAIL_DEMO.nodes.map((node, index) => [node.id, { x: index * 300, y: 50 }]),
  ),
  pinnedNodeIds: ['sender'],
};

describe('selective board review', () => {
  it('accepts one content change while retaining rejected content and manual positions', () => {
    const candidate = {
      ...before,
      title: 'Changed title',
      agent: 'codex' as const,
      nodes: before.nodes.map((node) => ({ ...node, label: node.label + ' new' })),
    };
    const changes = boardReviewChanges(before, candidate);
    expect(changes.some((change) => change.key === 'metadata')).toBe(true);
    const result = selectBoardChanges(before, candidate, ['nodes:sender']);
    expect(result.title).toBe(before.title);
    expect(result.agent).toBe('codex');
    expect(selectBoardChanges(before, candidate, []).agent).toBe(before.agent);
    expect(result.nodes.find((node) => node.id === 'sender')!.label).toContain('new');
    expect(result.nodes.find((node) => node.id === 'app')).toEqual(
      before.nodes.find((node) => node.id === 'app'),
    );
    expect(result.positions).toEqual(before.positions);
    expect(result.pinnedNodeIds).toEqual(['sender']);
    expect(BoardDocumentSchema.safeParse(result).success).toBe(true);
  });
  it('rejects dependent removals until the matching connections are also selected', () => {
    const candidate = removeBoardNode(before, 'sender');
    expect(() => selectBoardChanges(before, candidate, ['nodes:sender'])).toThrow('endpoint');
    const result = selectBoardChanges(
      before,
      candidate,
      boardReviewChanges(before, candidate).map((change) => change.key),
    );
    expect(result.nodes.some((node) => node.id === 'sender')).toBe(false);
    expect(result.pinnedNodeIds).toEqual([]);
  });
  it('preserves named conditions/descriptions and rejects dangling additions', () => {
    const node = { ...before.nodes[0]!, id: 'new' };
    const edge = {
      id: 'branch',
      source: 'sender',
      target: 'new',
      label: 'Next',
      condition: 'accepted',
      description: 'The request was accepted.',
    };
    const candidate = {
      ...before,
      nodes: [...before.nodes, node],
      edges: [...before.edges, edge],
      positions: { ...before.positions, new: { x: 600, y: 600 } },
    };
    expect(() => selectBoardChanges(before, candidate, ['edges:branch'])).toThrow('endpoint');
    const result = selectBoardChanges(before, candidate, ['nodes:new', 'edges:branch']);
    expect(result.edges.at(-1)).toEqual(edge);
    expect(result.positions.new).toEqual(candidate.positions.new);
    expect(selectBoardChanges(before, candidate, []).nodes).toEqual(before.nodes);
  });
});

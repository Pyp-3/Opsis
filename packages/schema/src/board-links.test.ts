import { expect, it } from 'vitest';
import { EMAIL_DEMO, boardOutputSchema, type BoardDocument } from './board';
import { preserveBoardLinks } from './board-links';

it('preserves explicit destinations by ID and discards links proposed by generation', () => {
  const target = '11111111-1111-4111-8111-111111111111';
  const before: BoardDocument = {
    ...EMAIL_DEMO,
    version: 2,
    positions: {},
    agent: 'demo',
    nodes: EMAIL_DEMO.nodes.map((node, index) => ({
      ...node,
      ...(index === 0 ? { linkedBoardId: target } : {}),
    })),
  };
  const proposed = {
    ...EMAIL_DEMO,
    nodes: EMAIL_DEMO.nodes.map((node) => ({
      ...node,
      linkedBoardId: '22222222-2222-4222-8222-222222222222',
    })),
  };
  const result = preserveBoardLinks(proposed, before);
  expect(result.nodes[0]!.linkedBoardId).toBe(target);
  expect(result.nodes[1]!.linkedBoardId).toBeUndefined();
  expect(preserveBoardLinks(proposed).nodes.every((node) => !node.linkedBoardId)).toBe(true);
  expect(boardOutputSchema).not.toContain('linkedBoardId');
});

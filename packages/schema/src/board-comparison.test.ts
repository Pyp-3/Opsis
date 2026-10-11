import { describe, it, expect } from 'vitest';
import { BoardDocumentSchema, EMAIL_DEMO, compareBoards } from './index';

describe('board comparison', () => {
  it('compares layout, notes and groups without mutating either board', () => {
    const before = BoardDocumentSchema.parse({
      ...EMAIL_DEMO,
      version: 2,
      agent: 'demo',
      positions: {},
      groups: [
        {
          id: 'delivery',
          label: 'Delivery',
          nodeIds: ['sender'],
          collapsed: true,
          boundary: false,
        },
      ],
    });
    const after = structuredClone(before);
    after.nodes[0]!.notes = 'A local note';
    after.positions.sender = { x: 12, y: 34 };
    after.groups![0]!.collapsed = false;
    const result = compareBoards(before, after);
    expect(result.map((item) => item.label)).toEqual(
      expect.arrayContaining(['Concept sender', 'Position sender', 'groups']),
    );
    expect(before.nodes[0]!.notes).toBeUndefined();
    expect(compareBoards(before, before)).toEqual([]);
  });
});

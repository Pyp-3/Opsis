import { describe, it, expect } from 'vitest';
import {
  BoardDocumentSchema,
  EMAIL_DEMO,
  removeBoardNode,
  visibleBoard,
  groupMembers,
} from './index';

const board = () =>
  BoardDocumentSchema.parse({
    ...EMAIL_DEMO,
    version: 2,
    agent: 'demo',
    positions: {},
    groups: [
      { id: 'outer', label: 'Delivery', nodeIds: ['sender'], collapsed: true, boundary: false },
      {
        id: 'inner',
        label: 'Servers',
        parentId: 'outer',
        nodeIds: ['outgoing'],
        collapsed: false,
        boundary: true,
      },
    ],
  });

describe('board groups and references', () => {
  it('collapses nested groups without deleting content, retains external connections and prunes memberships on deletion', () => {
    const original = board();
    const visible = visibleBoard(original);
    expect(groupMembers(original, 'outer')).toEqual(['sender', 'outgoing']);
    expect(visible.nodes.some((node) => node.id === 'outgoing')).toBe(false);
    expect(visible.nodes.find((node) => node.id === 'sender')?.label).toBe('Delivery (2)');
    expect(original.nodes.length).toBe(EMAIL_DEMO.nodes.length);
    expect(BoardDocumentSchema.safeParse(removeBoardNode(original, 'outgoing')).success).toBe(true);
    expect(
      visible.edges.every(
        (edge) =>
          visible.nodes.some((node) => node.id === edge.source) &&
          visible.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true);
  });

  it('rejects cyclic groups, duplicate memberships, unsafe source URLs and dangling members', () => {
    const original = board();
    expect(
      BoardDocumentSchema.safeParse({
        ...original,
        groups: original.groups!.map((group) =>
          group.id === 'outer' ? { ...group, parentId: 'inner' } : group,
        ),
      }).success,
    ).toBe(false);
    expect(
      BoardDocumentSchema.safeParse({
        ...original,
        groups: [{ ...original.groups![0], nodeIds: ['missing'] }],
      }).success,
    ).toBe(false);
    expect(
      BoardDocumentSchema.safeParse({
        ...original,
        groups: original.groups!.map((group) => ({ ...group, nodeIds: ['sender'] })),
      }).success,
    ).toBe(false);
    expect(
      BoardDocumentSchema.safeParse({
        ...original,
        nodes: original.nodes.map((node) => ({
          ...node,
          references: [{ title: 'source', url: 'javascript:alert(1)' }],
        })),
      }).success,
    ).toBe(false);
  });
});

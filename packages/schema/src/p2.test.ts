import { describe, it, expect } from 'vitest';
import {
  BoardDocumentSchema,
  EMAIL_DEMO,
  removeBoardNode,
  visibleBoard,
  groupMembers,
  boardFromText,
  compareBoards,
  PROCESS_EXAMPLES,
  BoardGraphSchema,
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
describe('P2 documents', () => {
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
  it('imports exact source excerpts locally, with no invented relationships and explicit bounds', () => {
    const imported = boardFromText('First paragraph.\n\nSecond paragraph.', 'notes.txt');
    expect(imported.nodes).toHaveLength(2);
    expect(imported.edges).toEqual([]);
    expect(imported.nodes[1]?.references?.[0]?.excerpt).toBe('Second paragraph.');
    expect(() => boardFromText('x'.repeat(100001), 'large')).toThrow();
    expect(() =>
      boardFromText(Array.from({ length: 51 }, () => 'a').join('\n\n'), 'many'),
    ).toThrow();
  });
  it('compares layout, notes and groups without mutating either board', () => {
    const before = board();
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
  it('ships valid reusable examples', () => {
    for (const example of PROCESS_EXAMPLES)
      expect(BoardGraphSchema.safeParse(example).success, example.title).toBe(true);
  });
});

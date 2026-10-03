import { describe, expect, it } from 'vitest';
import { BoardDocumentSchema, BoardSnapshotSchema, type BoardSnapshot } from './board';
import { EMAIL_DEMO } from './email-demo';
import { EMAIL_DEMO_ILLUSTRATIONS } from './demo-illustrations';
import {
  appendBoardHistory,
  createEmptyBoard,
  patchBoardNode,
  recordBoardEdit,
  removeBoardNode,
} from './board-operations';

describe('shared board edits', () => {
  it('creates valid empty boards with explicit agent and title', () => {
    const board = createEmptyBoard('My diagram', 'codex');
    expect(BoardDocumentSchema.parse(board)).toEqual(board);
    expect(board.agent).toBe('codex');
    expect(board.title).toBe('My diagram');
  });

  it('keeps forty recent states, records the prior board, and clears redo', () => {
    const first = createEmptyBoard('First');
    const last = createEmptyBoard('Last');
    const snapshot: BoardSnapshot = { board: first, past: Array(40).fill(null), future: [last] };
    const edited = recordBoardEdit(snapshot, last);
    expect(BoardSnapshotSchema.parse(edited).past).toHaveLength(40);
    expect(edited.past.at(-1)).toEqual(first);
    expect(edited.future).toEqual([]);
    expect(snapshot.future).toEqual([last]);
    expect(appendBoardHistory([], null)).toEqual([null]);
  });

  it('records the beginning of a drag when intermediate positions have changed', () => {
    const before = createEmptyBoard('Before');
    const preview = createEmptyBoard('Preview');
    const after = createEmptyBoard('After');
    expect(recordBoardEdit({ board: preview, past: [], future: [] }, after, before).past).toEqual([
      before,
    ]);
  });

  it('removes the node, its position, incident edges, and broken process chain', () => {
    const board = BoardDocumentSchema.parse({
      ...createEmptyBoard(),
      ...EMAIL_DEMO,
      nodes: [
        { ...EMAIL_DEMO.nodes[0], process: { op: 'source', text: 'one\ntwo\n' } },
        {
          ...EMAIL_DEMO.nodes[1],
          process: { op: 'head', from: EMAIL_DEMO.nodes[0]!.id, count: 1 },
        },
      ],
      edges: [EMAIL_DEMO.edges[0]],
      positions: { sender: { x: 1, y: 2 }, app: { x: 3, y: 4 } },
    });
    const next = removeBoardNode(board, 'sender');
    expect(next.nodes.map((node) => node.id)).toEqual(['app']);
    expect(next.nodes[0]!.process).toBeUndefined();
    expect(next.edges).toEqual([]);
    expect(next.positions).toEqual({ app: { x: 3, y: 4 } });
    expect(board.nodes).toHaveLength(2);
    expect(BoardDocumentSchema.safeParse(next).success).toBe(true);
  });

  it('invalidates narration and drawings together without mutating the previous node', () => {
    const node: Parameters<typeof patchBoardNode>[0] = {
      ...EMAIL_DEMO.nodes[0]!,
      narration: 'Old words',
      customIcon: { name: 'Circle', layers: [{ shape: 'circle', cx: 50, cy: 50, r: 20 }] },
      illustration: EMAIL_DEMO_ILLUSTRATIONS.sender,
    };
    const next = patchBoardNode(
      node,
      { label: 'New label', icon: 'box' },
      {
        narration: true,
        drawing: true,
      },
    );
    expect(next.label).toBe('New label');
    expect(next.icon).toBe('box');
    expect(next).not.toHaveProperty('narration');
    expect(next).not.toHaveProperty('customIcon');
    expect(next).not.toHaveProperty('illustration');
    expect(node.narration).toBe('Old words');
    expect(
      patchBoardNode(
        node,
        { explanation: 'More detail' },
        {
          narration: false,
          drawing: false,
        },
      ).illustration,
    ).toBe(node.illustration);
  });
});

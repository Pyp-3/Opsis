import { describe, it, expect } from 'vitest';
import { CollectionBundleSchema, prepareCollectionImport } from './collection-bundle';
import { createEmptyBoard } from './board-operations';
import { EMAIL_DEMO } from './email-demo';

describe('collection copies', () => {
  it('remaps internal links, drops outside links, and starts fresh history', () => {
    const a = '00000000-0000-4000-8000-000000000001',
      b = '00000000-0000-4000-8000-000000000002';
    const c = '00000000-0000-4000-8000-000000000003',
      d = '00000000-0000-4000-8000-000000000004';
    const board = {
      ...createEmptyBoard('Mail'),
      ...EMAIL_DEMO,
      agent: 'demo',
      drawings: [
        {
          id: 'sketch',
          shape: 'text',
          x: 10,
          y: 20,
          text: 'Keep this sketch',
          ink: 'mint',
          line: 'solid',
          strokeWidth: 2,
        },
      ],
      nodes: EMAIL_DEMO.nodes.map((node, index) => ({
        ...node,
        linkedBoardId: index === 0 ? b : c,
      })),
    };
    const bundle = {
      format: 'opsis-collection',
      version: 1,
      name: 'Lessons',
      boards: [
        { id: a, title: 'Mail', board, tags: ['Work'] },
        { id: b, title: 'Target', board: null, tags: [] },
      ],
    };
    const copies = prepareCollectionImport(bundle, [c, d]);
    expect(copies[0]!.snapshot.board!.nodes[0]!.linkedBoardId).toBe(d);
    expect(copies[0]!.snapshot.board!.nodes[1]!.linkedBoardId).toBeUndefined();
    expect(copies[0]!.snapshot.past).toEqual([]);
    expect(copies[0]!.tags).toEqual(['Work']);
    expect(copies[0]!.snapshot.board!.drawings).toEqual(board.drawings);
    expect(() => prepareCollectionImport(bundle, [a, d])).toThrow();
    expect(() => prepareCollectionImport(bundle, [c, c])).toThrow();
    expect(
      CollectionBundleSchema.safeParse({ ...bundle, boards: [bundle.boards[0], bundle.boards[0]] })
        .success,
    ).toBe(false);
  });
});

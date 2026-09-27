// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardSnapshotSchema, EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { useBoardHistory } from './useBoardHistory';
import { walkthroughOrder } from './Walkthrough';
import { boardMarkdown } from './export';
import { importBoard } from './migration';
import legacy from '../../../../fixtures/osg/sun-east.osg.json';

afterEach(cleanup);
const board: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
describe('durable history and learning tools', () => {
  it('restores undo and redo from a serialized snapshot', () => {
    const { result, unmount } = renderHook(() => useBoardHistory({ board, past: [], future: [] }));
    act(() => result.current.commit({ ...board, title: 'Second title' }));
    const snapshot = BoardSnapshotSchema.parse(JSON.parse(JSON.stringify(result.current.snapshot)));
    unmount();
    const restored = renderHook(() => useBoardHistory(snapshot));
    act(() => restored.result.current.travel());
    expect(restored.result.current.board?.title).toBe(board.title);
    act(() => restored.result.current.travel(true));
    expect(restored.result.current.board?.title).toBe('Second title');
  });
  it('visits branches, cycles and disconnected concepts once without mutating the graph', () => {
    const cycle = {
      ...board,
      edges: [...board.edges, { id: 'loop', source: 'recipient', target: 'sender', label: '' }],
    };
    const original = JSON.stringify(cycle);
    expect(new Set(walkthroughOrder(cycle)).size).toBe(board.nodes.length);
    expect(JSON.stringify(cycle)).toBe(original);
  });
  it('exports explanations and uncertainty to notes', () => {
    const text = boardMarkdown({
      ...board,
      nodes: board.nodes.map((node) => ({
        ...node,
        confidence: 'uncertain',
        caveat: 'Check source',
      })),
    });
    expect(text).toContain('Check source');
    expect(text).toContain(board.nodes[0]!.explanation);
    expect(text).toContain('→ Email app');
  });
  it('imports legacy files with warnings and keeps the source intact', async () => {
    const original = JSON.stringify(legacy);
    const migrated = await importBoard(legacy);
    expect(migrated.nodes.length).toBe(legacy.scenes.flatMap((scene) => scene.nodes).length);
    expect(migrated.nodes.every((node) => node.confidence === 'simplified')).toBe(true);
    expect(JSON.stringify(legacy)).toBe(original);
    await expect(importBoard({ invalid: true })).rejects.toThrow();
  });
});

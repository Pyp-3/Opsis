// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardSnapshotSchema, EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { useBoardHistory } from './useBoardHistory';
import { walkthroughOrder } from '@opsis/schema';
import { boardMarkdown, boardSvg } from './export';
import { importBoard } from './migration';
import legacy from '../../../../fixtures/osg/sun-east.osg.json';

afterEach(cleanup);
const board: BoardDocument = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
describe('durable history and learning tools', () => {
  it('treats an entire drag as one durable transaction, including no-op and cancelled drags', () => {
    const { result } = renderHook(() => useBoardHistory({ board, past: [], future: [] }));
    act(() => result.current.begin());
    for (let i = 0; i < 100; i++)
      act(() => result.current.setBoard({ ...board, positions: { sender: { x: i, y: i } } }));
    expect(result.current.snapshot.board).toEqual(board);
    expect(result.current.history.past).toHaveLength(0);
    act(() => result.current.end());
    expect(result.current.history.past).toHaveLength(1);
    const final = result.current.board;
    for (let i = 0; i < 30; i++) {
      act(() => result.current.travel());
      expect(result.current.board).toEqual(board);
      act(() => result.current.travel(true));
      expect(result.current.board).toEqual(final);
    }
    act(() => {
      result.current.begin();
      result.current.end();
    });
    expect(result.current.history.past).toHaveLength(1);
    act(() => {
      result.current.begin();
      result.current.setBoard({ ...board, title: 'Transient' });
      result.current.travel();
      result.current.end();
    });
    expect(result.current.board).toEqual(final);
    expect(result.current.history.past).toHaveLength(1);
  });
  it('bounds history, clears redo only for real edits, and isolates replacement boards', () => {
    const { result } = renderHook(() => useBoardHistory({ board, past: [], future: [] }));
    for (let i = 0; i < 120; i++)
      act(() => result.current.commit({ ...board, title: `Version ${i}` }));
    expect(result.current.history.past).toHaveLength(40);
    for (let i = 0; i < 40; i++) act(() => result.current.travel());
    expect(result.current.board?.title).toBe('Version 79');
    expect(result.current.history.future).toHaveLength(40);
    act(() => result.current.commit({ ...board, title: 'A new branch' }));
    expect(result.current.history.future).toHaveLength(0);
    act(() => result.current.replace({ board: null, past: [], future: [] }));
    act(() => result.current.travel());
    expect(result.current.board).toBeNull();
  });
  it('no-op edits preserve the redo branch and do not consume undo', () => {
    const { result } = renderHook(() => useBoardHistory({ board, past: [], future: [] }));
    act(() => result.current.commit({ ...board, title: 'Changed' }));
    act(() => result.current.travel());
    act(() => result.current.commit(JSON.parse(JSON.stringify(board))));
    expect(result.current.history.past).toHaveLength(0);
    expect(result.current.history.future).toHaveLength(1);
    act(() => result.current.travel(true));
    expect(result.current.board?.title).toBe('Changed');
  });
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
  it('repairs missing imported positions without moving supplied positions and exports an empty board safely', async () => {
    const imported = await importBoard({ ...board, positions: { sender: { x: 700, y: 300 } } });
    expect(imported.positions.sender).toEqual({ x: 700, y: 300 });
    expect(imported.nodes.every((node) => imported.positions[node.id])).toBe(true);
    const empty = { ...board, nodes: [], edges: [], positions: {} };
    expect(BoardSnapshotSchema.safeParse({ board: empty, past: [], future: [] }).success).toBe(
      true,
    );
    expect(boardSvg(empty)).not.toMatch(/NaN|Infinity/);
  });
});

import { describe, expect, it } from 'vitest';
import { BoardDocumentSchema, EMAIL_DEMO, type BoardDocument } from '@opsis/schema';
import { connectBoard, edgePorts } from './connections';
import { layoutBoard } from './model';

const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: {
    outgoing: { x: 0, y: 0 },
    incoming: { x: 300, y: 0 },
    recipient: { x: 300, y: 300 },
  },
};
describe('branching connections', () => {
  it('drops a reconnected arrow’s spoken line, but keeps it when only the ports change', () => {
    const moved = connectBoard(board, { source: 'outgoing', target: 'recipient' }, 'transfer');
    expect(moved.edges.find((edge) => edge.id === 'transfer')!.narration).toBeUndefined();
    const turned = connectBoard(
      board,
      { source: 'outgoing', target: 'incoming', sourceHandle: 'bottom', targetHandle: 'top' },
      'transfer',
    );
    expect(turned.edges.find((edge) => edge.id === 'transfer')!.narration).toBe(
      EMAIL_DEMO.edges.find((edge) => edge.id === 'transfer')!.narration,
    );
  });
  it('allows several connections from the same port and several connections to one object', () => {
    const first = connectBoard(
      board,
      { source: 'outgoing', target: 'recipient', sourceHandle: 'right', targetHandle: 'left' },
      'branch-1',
    );
    const next = connectBoard(
      first,
      { source: 'outgoing', target: 'sender', sourceHandle: 'right', targetHandle: 'bottom' },
      'branch-2',
    );
    expect(next.edges.filter((edge) => edge.source === 'outgoing')).toHaveLength(3);
    expect(next.edges.filter((edge) => edge.target === 'recipient')).toHaveLength(2);
    expect(BoardDocumentSchema.parse(JSON.parse(JSON.stringify(next))).edgePorts).toEqual({
      'branch-1': { source: 'right', target: 'left' },
      'branch-2': { source: 'right', target: 'bottom' },
    });
  });
  it('retargets an edge without losing its label or duplicating it', () => {
    const next = connectBoard(
      board,
      { source: 'outgoing', target: 'recipient', sourceHandle: 'bottom', targetHandle: 'top' },
      'transfer',
    );
    expect(next.edges).toHaveLength(board.edges.length);
    expect(next.edges.find((edge) => edge.id === 'transfer')).toMatchObject({
      target: 'recipient',
      label: 'SMTP',
    });
  });
  it('adjusts automatic ports as nodes move, while respecting pinned ports', () => {
    const edge = board.edges.find((item) => item.id === 'transfer')!;
    expect(edgePorts(board, edge)).toEqual({ source: 'right', target: 'left' });
    const moved = { ...board, positions: { ...board.positions, incoming: { x: 0, y: 400 } } };
    expect(edgePorts(moved, edge)).toEqual({ source: 'right', target: 'top' });
    const pinned = connectBoard(
      moved,
      { source: 'outgoing', target: 'incoming', sourceHandle: 'right', targetHandle: 'left' },
      edge.id,
    );
    expect(edgePorts(pinned, edge)).toEqual({ source: 'right', target: 'left' });
  });
  it('preserves custom ports through agent updates', async () => {
    const pinned = connectBoard(
      board,
      { source: 'outgoing', target: 'incoming', sourceHandle: 'bottom', targetHandle: 'top' },
      'transfer',
    );
    expect((await layoutBoard(EMAIL_DEMO, 'claude', pinned)).edgePorts?.transfer).toEqual({
      source: 'bottom',
      target: 'top',
    });
  });
});

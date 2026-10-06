import { describe, expect, it } from 'vitest';
import {
  EMAIL_DEMO,
  EMAIL_DEMO_ILLUSTRATIONS,
  type BoardDocument,
  type BoardSnapshot,
} from '@opsis/schema';
import {
  CanvasError,
  addConcept,
  connect,
  disconnect,
  removeConcept,
  updateConcept,
  updateDetails,
  writeDiagram,
} from './canvas.js';

const board: BoardDocument = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(EMAIL_DEMO.nodes.map((node, i) => [node.id, { x: 0, y: i * 240 }])),
};
const start: BoardSnapshot = { board, past: [], future: [{ ...board, title: 'Redo me' }] };

describe('agent canvas edits', () => {
  it('sets and clears explicit board links as undoable edits and preserves them in rewrites', () => {
    const destination = '00000000-0000-4000-8000-000000000001';
    const linked = updateConcept(start, 'sender', { linkedBoardId: destination });
    expect(linked.board!.nodes[0]!.linkedBoardId).toBe(destination);
    expect(linked.past.at(-1)).toEqual(board);
    const rewritten = writeDiagram(linked, {
      title: 'Rewritten',
      description: 'Same concept, new wording',
      concepts: [{ id: 'sender', label: 'Sender', summary: 'Writes the message' }],
      connections: [],
    });
    expect(rewritten.board!.nodes[0]!.linkedBoardId).toBe(destination);
    const cleared = updateConcept(rewritten, 'sender', { linkedBoardId: null });
    expect(cleared.board!.nodes[0]!.linkedBoardId).toBeUndefined();
    expect(cleared.past.at(-1)!.nodes[0]!.linkedBoardId).toBe(destination);
  });
  it('adds a concept below another, with an arrow, as one undoable step', () => {
    const { snapshot, id } = addConcept(start, {
      label: 'Spam filter',
      summary: 'Checks the message before it is delivered.',
      icon: 'filter',
      after: 'recipient',
      connectionLabel: 'screens',
    });
    expect(id).toBe('spam-filter');
    expect(snapshot.past).toEqual([board]);
    expect(snapshot.future).toEqual([]);
    const next = snapshot.board!;
    expect(next.nodes.at(-1)).toMatchObject({ id, kind: 'step', explanation: expect.any(String) });
    expect(next.edges.at(-1)).toMatchObject({ source: 'recipient', target: id, label: 'screens' });
    // Placed clear of every existing concept.
    const placed = next.positions[id]!;
    for (const [other, p] of Object.entries(board.positions))
      expect(Math.abs(p.x - placed.x) >= 224 || Math.abs(p.y - placed.y) >= 200, other).toBe(true);
  });

  it('starts an empty board and gives repeated labels distinct ids', () => {
    const empty: BoardSnapshot = { board: null, past: [], future: [] };
    const first = addConcept(empty, { label: 'Step', summary: 'One.' });
    const second = addConcept(first.snapshot, { label: 'Step', summary: 'Two.' });
    expect([first.id, second.id]).toEqual(['step', 'step-2']);
    expect(second.snapshot.past).toHaveLength(2);
  });

  it('edits like the canvas does: new words drop narration, a new icon drops the drawing', () => {
    const narrated: BoardSnapshot = {
      ...start,
      board: {
        ...board,
        nodes: board.nodes.map((node, i) =>
          i === 0 ? { ...node, narration: 'Old line', customIcon: undefined } : node,
        ),
      },
    };
    const id = board.nodes[0]!.id;
    const renamed = updateConcept(narrated, id, { label: 'You type' }).board!.nodes[0]!;
    expect(renamed.label).toBe('You type');
    expect(renamed.narration).toBeUndefined();
    expect(updateConcept(narrated, id, { kind: 'note' }).board!.nodes[0]!.narration).toBe(
      'Old line',
    );
  });

  it('removes concepts with their arrows, and connects and disconnects them', () => {
    const removed = removeConcept(start, 'sender').board!;
    expect(removed.nodes.some((node) => node.id === 'sender')).toBe(false);
    expect(removed.edges.some((edge) => [edge.source, edge.target].includes('sender'))).toBe(false);
    expect(removed.positions.sender).toBeUndefined();

    const linked = connect(start, {
      from: 'recipient',
      to: 'sender',
      label: 'replies',
      kind: 'response',
    });
    expect(linked.snapshot.board!.edges.at(-1)).toMatchObject({ id: linked.id, kind: 'response' });
    expect(disconnect(linked.snapshot, linked.id).board!.edges).toEqual(board.edges);
  });

  it('explains what went wrong instead of saving an invalid board', () => {
    expect(() => removeConcept(start, 'nope')).toThrow(CanvasError);
    expect(() => removeConcept(start, 'nope')).toThrow(/Known ids: sender/);
    expect(() => connect(start, { from: 'sender', to: 'ghost' })).toThrow(/No concept "ghost"/);
    expect(() => updateDetails(start, { title: '' })).toThrow(CanvasError);
  });

  it('updates the title, summary and colours', () => {
    const next = updateDetails(start, {
      title: 'Mail',
      description: 'Where it goes.',
      look: { canvas: 'forest', icon: 'mint' },
    }).board!;
    expect(next).toMatchObject({
      title: 'Mail',
      description: 'Where it goes.',
      look: { canvas: 'forest', icon: 'mint' },
    });
  });

  it('drops stale narration and drawings when a rewrite changes both words and icon', () => {
    const node = {
      ...board.nodes[0]!,
      narration: 'The original spoken description.',
      illustration: EMAIL_DEMO_ILLUSTRATIONS.sender!,
      customIcon: {
        name: 'Old icon',
        layers: [{ shape: 'circle' as const, cx: 12, cy: 12, r: 8 }],
      },
    };
    const next = writeDiagram(
      { ...start, board: { ...board, nodes: [node], edges: [] } },
      {
        title: board.title,
        description: board.description,
        concepts: [{ id: node.id, label: 'Changed words', summary: node.summary, icon: 'inbox' }],
        connections: [],
      },
    ).board!;
    expect(next.nodes[0]).not.toHaveProperty('narration');
    expect(next.nodes[0]).not.toHaveProperty('customIcon');
    expect(next.nodes[0]).not.toHaveProperty('illustration');
  });

  it('rewrites a diagram, keeping the places of concepts that stay and placing new ones', () => {
    const kept = board.nodes[0]!;
    const next = writeDiagram(
      { ...start, board: { ...board, look: { canvas: 'plum', icon: 'sky' } } },
      {
        title: 'Shorter',
        description: 'Two steps.',
        concepts: [
          { id: kept.id, label: kept.label, summary: kept.summary },
          { id: 'outbox', label: 'Outbox', summary: 'Waits to send.', icon: 'inbox' },
        ],
        connections: [{ from: kept.id, to: 'outbox', label: 'queues' }],
      },
    ).board!;
    expect(next.nodes.map((node) => node.id)).toEqual([kept.id, 'outbox']);
    expect(next.positions[kept.id]).toEqual(board.positions[kept.id]);
    expect(next.positions.outbox!.y).toBeGreaterThan(board.positions[kept.id]!.y);
    expect(Object.keys(next.positions)).toHaveLength(2);
    expect(next.look).toEqual({ canvas: 'plum', icon: 'sky' });
    expect(next.edges).toEqual([
      { id: `${kept.id}-to-outbox`, source: kept.id, target: 'outbox', label: 'queues' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { EMAIL_DEMO } from './email-demo';
import { BoardDocumentSchema, BoardRequestSchema, type BoardDocument } from './board';
import { AGENT_SKETCH_LAYER, type BoardDrawing } from './board-drawings';
import { boardReviewChanges, selectBoardChanges } from './board-review';
import {
  applyFocusEdits,
  chatFocusFor,
  chatPriority,
  focusEditProblems,
  type FocusEdits,
} from './chat-focus';
import {
  MAX_CHAT_MESSAGES,
  appendChatMessage,
  chatConversation,
  withChatOutcome,
  type BoardChatThread,
} from './board-chat';

const box = (id: string, extra: Partial<BoardDrawing> = {}): BoardDrawing => ({
  id,
  shape: 'rect',
  x: 0,
  y: 0,
  width: 96,
  height: 48,
  ink: 'ink',
  line: 'solid',
  strokeWidth: 2,
  ...extra,
});

const board: BoardDocument = BoardDocumentSchema.parse({
  ...EMAIL_DEMO,
  version: 2,
  agent: 'demo',
  positions: Object.fromEntries(
    EMAIL_DEMO.nodes.map((node, index) => [node.id, { x: index * 300, y: 50 }]),
  ),
  drawingLayers: [
    { id: 'plans', name: 'Plans' },
    { id: 'private', name: 'Private', hidden: true },
    { id: 'fixed', name: 'Fixed', locked: true },
    AGENT_SKETCH_LAYER,
  ],
  drawings: [
    box('wall', { layerId: 'plans' }),
    box('door', { anchorId: 'outgoing', x: 10 }),
    box('secret', { layerId: 'private' }),
    box('frozen', { layerId: 'fixed' }),
    box('pinned', { locked: true }),
    box('zone', { layerId: AGENT_SKETCH_LAYER.id }),
  ],
});

describe('chat drawing focus', () => {
  it('sends only selected drawings the reader may change, without layers or locks', () => {
    const focus = chatFocusFor(board, {
      drawingIds: ['wall', 'secret', 'frozen', 'pinned', 'zone'],
    });
    expect(focus?.drawings.map((drawing) => drawing.id)).toEqual(['wall']);
    expect(focus?.drawings[0]).not.toHaveProperty('layerId');
    expect(focus?.sketchIds).toEqual(['zone']);
    expect(chatFocusFor(board, { drawingIds: ['secret'] })).toBeUndefined();
  });
  it('focuses on the drawings attached to the selected concept', () => {
    expect(chatFocusFor(board, { nodeId: 'outgoing' })?.drawings).toEqual([
      box('door', { anchorId: 'outgoing', x: 10 }),
    ]);
    expect(chatFocusFor(board, { nodeId: 'sender' })).toBeUndefined();
  });
  it('works drawing-first for a focus, a drawing tool or a request about a sketch', () => {
    const focus = chatFocusFor(board, { drawingIds: ['wall'] });
    expect(chatPriority({ prompt: 'Make it bigger', focus })).toEqual({
      priority: 'drawing',
      reason: 'focus',
    });
    expect(chatPriority({ prompt: 'Add a step', drawingTool: true }).reason).toBe('tool');
    expect(chatPriority({ prompt: 'Sketch the floor plan of the plant room' }).reason).toBe(
      'request',
    );
    expect(chatPriority({ prompt: 'How does Windows boot?' }).priority).toBe('diagram');
    expect(chatPriority({ prompt: 'Explain how DNS resolves a name' }).priority).toBe('diagram');
  });
  it('accepts a focus in a generation request', () => {
    const focus = chatFocusFor(board, { drawingIds: ['wall', 'zone'] });
    expect(
      BoardRequestSchema.safeParse({
        prompt: 'Dash it',
        agent: 'demo',
        board,
        focus,
        priority: 'drawing',
        thread: crypto.randomUUID(),
        memory: 'Reader wants metric units.',
        conversation: [{ role: 'assistant', text: 'Done.', outcome: 'discarded' }],
      }).success,
    ).toBe(true);
  });
  it('lets agents change only focused drawings attached to real concepts', () => {
    const edits: FocusEdits = {
      update: [box('wall', { line: 'dashed' }), box('secret')],
      remove: ['wall'],
    };
    const problems = focusEditProblems(edits, new Set(['wall']), new Set(['sender']));
    expect(problems.join(' ')).toMatch(/secret is not in focus/);
    expect(problems.join(' ')).toMatch(/at most once/);
    expect(
      focusEditProblems(
        { update: [box('wall', { anchorId: 'gone' })], remove: [] },
        new Set(['wall']),
        new Set(['sender']),
      ),
    ).toEqual(['A focused drawing can only move with an existing concept.']);
  });
  it('applies focus edits in place, keeping each drawing on its layer', () => {
    const next = applyFocusEdits(
      board,
      new Set(['wall', 'door']),
      {
        update: [box('wall', { ink: 'coral' }), box('frozen', { ink: 'coral' })],
        remove: ['door'],
      },
      new Set(board.nodes.map((node) => node.id)),
    );
    expect(next.drawings?.map((drawing) => drawing.id)).toEqual([
      'wall',
      'secret',
      'frozen',
      'pinned',
      'zone',
    ]);
    expect(next.drawings?.[0]).toEqual(box('wall', { ink: 'coral', layerId: 'plans' }));
    // Drawings outside the focus are never changed.
    expect(next.drawings?.find((drawing) => drawing.id === 'frozen')?.ink).toBe('ink');
  });
  it('reviews focus edits as one change the reader can accept or reject', () => {
    const candidate = applyFocusEdits(
      board,
      new Set(['wall', 'door']),
      { update: [box('wall', { ink: 'coral' })], remove: ['door'] },
      new Set(board.nodes.map((node) => node.id)),
    );
    const changes = boardReviewChanges(board, candidate);
    expect(changes).toEqual([
      { key: 'reader-drawings', label: 'Change your selected drawings: 1 updated, 1 removed' },
    ]);
    const accepted = selectBoardChanges(board, candidate, ['reader-drawings']);
    expect(accepted.drawings?.find((drawing) => drawing.id === 'wall')?.ink).toBe('coral');
    expect(accepted.drawings?.some((drawing) => drawing.id === 'door')).toBe(false);
    expect(accepted.drawings?.some((drawing) => drawing.id === 'zone')).toBe(true);
    const rejected = selectBoardChanges(board, candidate, []);
    expect(rejected.drawings).toEqual(board.drawings);
  });
});

describe('continuous chat threads', () => {
  const thread = (count: number): BoardChatThread => ({
    id: crypto.randomUUID(),
    agent: 'claude',
    model: 'claude-sonnet-5-5',
    messages: Array.from({ length: count }, (_, index) => ({
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      text: `Message ${index}`,
    })),
  });
  it('condenses the oldest messages instead of refusing a full thread', () => {
    const full = thread(MAX_CHAT_MESSAGES);
    const next = appendChatMessage(full, { role: 'user', text: 'Keep going' });
    expect(next.messages.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGES - 1);
    expect(next.messages[0]!.role).toBe('user');
    expect(next.messages.at(-1)!.text).toBe('Keep going');
    expect(next.condensed).toBe(MAX_CHAT_MESSAGES + 1 - next.messages.length);
    // Without agent notes, the condensed requests are kept as notes.
    expect(next.memory).toMatch(/Earlier request: Message 0/);
    const withNotes = appendChatMessage(
      { ...full, memory: 'Reader prefers metric.' },
      { role: 'user', text: 'More' },
    );
    expect(withNotes.memory).toBe('Reader prefers metric.');
  });
  it('shows the agent recent messages with their outcomes, without the pending one', () => {
    const settled = withChatOutcome(thread(30), 'discarded');
    const conversation = chatConversation(
      appendChatMessage(settled, { role: 'user', text: 'Try again' }).messages,
    );
    expect(conversation).toHaveLength(12);
    expect(conversation.at(-1)).toEqual({
      role: 'assistant',
      text: 'Message 29',
      outcome: 'discarded',
    });
  });
});

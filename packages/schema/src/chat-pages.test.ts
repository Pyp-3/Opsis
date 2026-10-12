import { describe, expect, it } from 'vitest';
import type { BoardDocument } from './board';
import { boardOutputSchemaFor, BoardRequestSchema } from './board';
import { compactChatThread, type BoardChatThread } from './board-chat';
import { boardPages } from './board-pages';
import {
  MAX_PAGE_READS,
  chatPageDigest,
  chatPageIndex,
  pageMentions,
  pageReadsFor,
} from './chat-pages';
import { DNS_DEMO } from './dns-demo';
import { EMAIL_DEMO } from './email-demo';
import { modelSettingsProblem } from './model-settings';

const positions = (nodes: readonly { id: string }[]) =>
  Object.fromEntries(nodes.map((node, index) => [node.id, { x: index * 300, y: 0 }]));
const ids = ['page-email-0001', 'page-dns-000002', 'page-empty-0003'];
const board = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'claude',
  positions: positions(EMAIL_DEMO.nodes),
  pages: [
    { id: ids[0], title: 'Email journey' },
    {
      id: ids[1],
      title: 'DNS lookup',
      hidden: true,
      content: {
        nodes: DNS_DEMO.nodes,
        edges: DNS_DEMO.edges,
        positions: positions(DNS_DEMO.nodes),
        drawings: [
          {
            id: 'note',
            shape: 'text',
            x: 0,
            y: 0,
            text: 'Cache for 300 s',
            ink: 'ink',
            line: 'solid',
            strokeWidth: 2,
          },
        ],
        info: { text: 'Resolvers cache answers for their TTL.' },
      },
    },
    { id: ids[2], title: 'Blank', content: { nodes: [], edges: [], positions: {} } },
  ],
} as unknown as BoardDocument;

describe('pages in chat', () => {
  it('finds @page mentions by number, in order, without repeats or missing pages', () => {
    const pages = boardPages(board);
    expect(pageMentions('Compare @page2 with @PAGE 1, then @page-2 again', pages)).toEqual([
      ids[1],
      ids[0],
    ]);
    expect(pageMentions('@page9 and email@page2x and @pages', pages)).toEqual([]);
  });

  it('indexes every page briefly and marks the current one', () => {
    const index = chatPageIndex(board, ids[1]!);
    expect(index.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(index[0]).toMatchObject({ title: 'Email journey' });
    expect(index[0]).not.toHaveProperty('current');
    expect(index[1]).toMatchObject({ current: true, hidden: true, drawings: 1, info: true });
    expect(index[1]!.concepts.length).toBeLessThanOrEqual(10);
    expect(index[2]).toEqual({ page: 3, title: 'Blank', concepts: [] });
  });

  it('gives a page’s meaning without layout, and nothing for an unknown page', () => {
    const digest = chatPageDigest(board, ids[1]!)!;
    expect(digest).toMatchObject({
      page: 2,
      title: 'DNS lookup',
      drawingText: ['Cache for 300 s'],
      info: 'Resolvers cache answers for their TTL.',
    });
    expect(digest.concepts).toHaveLength(DNS_DEMO.nodes.length);
    expect(digest.connections[0]).toHaveProperty('from');
    expect(JSON.stringify(digest)).not.toContain('positions');
    expect(chatPageDigest(board, 'page-unknown-99')).toBeNull();
  });

  it('reads only pages the agent does not have, by number or id, within the limit', () => {
    expect(pageReadsFor(board, [1, '2', ids[2], 2, 7, 'x', null], [ids[0]!])).toEqual([
      ids[1],
      ids[2],
    ]);
    expect(pageReadsFor(board, 'all', [])).toEqual([]);
    expect(MAX_PAGE_READS).toBe(4);
  });

  it('accepts a page context on requests and offers reading in the schema only when asked', () => {
    const parsed = BoardRequestSchema.safeParse({
      prompt: 'Explain',
      agent: 'claude',
      pages: { document: board, current: ids[0], mentions: [ids[1]] },
      freshSession: true,
    });
    expect(parsed.success).toBe(true);
    expect(
      BoardRequestSchema.safeParse({
        prompt: 'Explain',
        agent: 'claude',
        pages: { document: board, current: 'not a page id!' },
      }).success,
    ).toBe(false);
    expect(boardOutputSchemaFor({ readPages: true })).toContain('"readPages":{');
    expect(boardOutputSchemaFor({})).not.toContain('readPages');
  });
});

describe('compacting a chat thread', () => {
  const message = (role: 'user' | 'assistant', text: string) => ({ role, text });
  const thread: BoardChatThread = {
    id: '6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d',
    agent: 'claude',
    model: 'claude-sonnet-5-5',
    messages: [
      message('user', 'Explain email'),
      message('assistant', 'Here it is.'),
      message('user', 'Add spam'),
      message('assistant', 'Added.'),
    ],
  };

  it('keeps the latest exchange, condenses the rest and asks for a fresh session', () => {
    const compacted = compactChatThread(thread);
    expect(compacted.messages.map((item) => item.text)).toEqual(['Add spam', 'Added.']);
    expect(compacted).toMatchObject({ condensed: 2, restart: true });
    // Without agent notes, the condensed requests are kept as notes.
    expect(compacted.memory).toBe('Earlier request: Explain email');
    expect(compactChatThread({ ...thread, memory: 'Reader wants spam.' }).memory).toBe(
      'Reader wants spam.',
    );
  });

  it('never starts with a reply, and only marks a short thread for a fresh session', () => {
    const odd = compactChatThread({ ...thread, messages: thread.messages.slice(0, 3) });
    expect(odd.messages[0]!.role).toBe('user');
    const short = { ...thread, messages: thread.messages.slice(0, 2) };
    expect(compactChatThread(short)).toEqual({ ...short, restart: true });
  });
});

describe('agent access settings', () => {
  it('allows full access and fast mode only on Claude’s and Codex’s CLIs', () => {
    const settings = { model: 'm', effort: 'low', access: 'full', fast: true } as const;
    expect(modelSettingsProblem('claude', settings)).toBeNull();
    expect(modelSettingsProblem('codex', settings)).toBeNull();
    expect(modelSettingsProblem('kimi', { ...settings, connection: 'api' })).toMatch(/CLI/);
    expect(modelSettingsProblem('grok', { model: 'm', effort: 'low', fast: true })).toMatch(/CLI/);
    expect(
      modelSettingsProblem('claude', { model: 'm', effort: 'low', access: 'restricted' }),
    ).toBeNull();
  });
});

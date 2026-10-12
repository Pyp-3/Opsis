import { afterEach, describe, expect, it, vi } from 'vitest';
import { DNS_DEMO, EMAIL_DEMO, boardPage, type BoardDocument } from '@opsis/schema';
import type { FastifyInstance } from 'fastify';
import type { LLMRequest } from './harness/types.js';
import { signIn } from './test-session.js';
import { buildApp } from './app.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const THREAD = '6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d';
const EMAIL_PAGE = 'emailpage0000001';
const DNS_PAGE = 'dnspage000000002';
const SPAM_PAGE = 'spampage00000003';
const positions = (nodes: readonly { id: string }[]) =>
  Object.fromEntries(nodes.map((node, index) => [node.id, { x: index * 300, y: 50 }]));

/** A three-page board: the email journey, the DNS lookup, and a page about spam filters. */
const document = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'claude',
  positions: positions(EMAIL_DEMO.nodes),
  pages: [
    { id: EMAIL_PAGE, title: 'Email journey' },
    {
      id: DNS_PAGE,
      title: 'DNS lookup',
      content: {
        nodes: DNS_DEMO.nodes,
        edges: DNS_DEMO.edges,
        positions: positions(DNS_DEMO.nodes),
      },
    },
    {
      id: SPAM_PAGE,
      title: 'Spam filters',
      hidden: true,
      content: {
        nodes: [
          {
            id: 'filter',
            label: 'Spam filter',
            icon: 'filter',
            kind: 'step',
            summary: 'Scores each message.',
            explanation: 'Content and sender reputation give each message a score.',
          },
        ],
        edges: [],
        positions: { filter: { x: 0, y: 0 } },
        info: { text: 'Filters learn from what readers mark as spam.' },
      },
    },
  ],
} as unknown as BoardDocument;

/** An answer that only asks to read pages: a placeholder the server discards. */
const askToRead = (pages: number[]) => ({
  title: 'Reading',
  description: '',
  narration: 'Reading.',
  nodes: [
    {
      id: 'placeholder',
      label: 'Reading',
      icon: 'file',
      summary: 'Reading pages.',
      explanation: 'Placeholder.',
    },
  ],
  edges: [],
  reply: 'Reading pages',
  memory: '',
  readPages: pages,
});

function setup(...outputs: object[]) {
  const complete = vi.fn(async () => JSON.stringify(outputs.shift() ?? EMAIL_DEMO));
  const factory = vi.fn(async () => ({ model: 'test', complete }));
  const app = buildApp({ databasePath: ':memory:', boardClientFactory: factory });
  void signIn(app);
  apps.push(app);
  return { app, complete, factory };
}
const sent = (complete: ReturnType<typeof setup>['complete'], call = 0) =>
  (complete.mock.calls[call] as unknown as [LLMRequest])[0];

const generate = (app: FastifyInstance, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/v1/boards/generate',
    payload: {
      agent: 'claude',
      prompt: 'Add what happens when a message is marked as spam',
      board: boardPage(document, EMAIL_PAGE),
      thread: THREAD,
      ...payload,
    },
  });

describe('chat across pages', () => {
  it('sends an index of the pages and the mentioned page in full, then lets the agent read one more', async () => {
    const { app, complete } = setup(askToRead([3]), { ...EMAIL_DEMO, reply: 'Added spam.' });
    const response = await generate(app, {
      pages: { document, current: EMAIL_PAGE, mentions: [DNS_PAGE] },
    });
    expect([200, 409]).toContain(response.statusCode);
    expect(complete).toHaveBeenCalledTimes(2);

    const first = sent(complete, 0);
    const user = JSON.parse(first.user) as {
      pages: { page: number; title: string; current?: true; concepts: string[] }[];
      referencedPages: { page: number; title: string; concepts: { label: string }[] }[];
    };
    expect(user.pages.map((page) => page.title)).toEqual([
      'Email journey',
      'DNS lookup',
      'Spam filters',
    ]);
    expect(user.pages[0]).toMatchObject({ page: 1, current: true });
    expect(user.pages[2]).toMatchObject({ concepts: ['Spam filter'], hidden: true, info: true });
    // Only the mentioned page is sent in full; the spam page waits until it is asked for.
    expect(user.referencedPages.map((page) => page.title)).toEqual(['DNS lookup']);
    expect(user.referencedPages[0]!.concepts.length).toBe(DNS_DEMO.nodes.length);
    expect(first.user).not.toContain('Filters learn');
    expect(first.system).toContain('Board pages:');
    expect(first.system).toContain('"readPages":{');

    // The read page follows as data, with its Info text, and the agent answers in full.
    const second = sent(complete, 1);
    expect(second.user).toContain('Pages you asked to read');
    expect(second.user).toContain('Filters learn from what readers mark as spam.');
    const body = response.json() as { turn: { pages: string[] } };
    expect(body.turn.pages).toEqual([DNS_PAGE, SPAM_PAGE]);
  });

  it('reads pages once per request, never the current page, and never past the limit', async () => {
    const { app, complete } = setup(askToRead([1, 9, 2]), {
      ...askToRead([3]),
      ...EMAIL_DEMO,
      reply: 'Done.',
    });
    const response = await generate(app, { pages: { document, current: EMAIL_PAGE } });
    expect(complete).toHaveBeenCalledTimes(2);
    // Only page 2 is read: page 1 is the current page and there is no page 9.
    const note = sent(complete, 1).user.split('Pages you asked to read')[1]!;
    expect(note).toContain('"title":"DNS lookup"');
    expect(note).not.toContain('"title":"Spam filters"');
    expect((response.json() as { turn: { pages: string[] } }).turn.pages).toEqual([DNS_PAGE]);
  });

  it('offers no reading when every page is already given, and none on one-page boards', async () => {
    const { app, complete } = setup(EMAIL_DEMO, EMAIL_DEMO);
    await generate(app, {
      pages: { document, current: EMAIL_PAGE, mentions: [DNS_PAGE, SPAM_PAGE] },
    });
    expect(sent(complete, 0).system).not.toContain('"readPages":{');
    await generate(app, {});
    expect(sent(complete, 1).system).not.toContain('Board pages:');
    expect(sent(complete, 1).user).not.toContain('"pages"');
  });

  it('starts a fresh session after compaction, then resumes it within the same request', async () => {
    const { app, complete } = setup(askToRead([2]), EMAIL_DEMO);
    await generate(app, { pages: { document, current: EMAIL_PAGE }, freshSession: true });
    expect(sent(complete, 0).session?.fresh).toBe(true);
    expect(sent(complete, 1).session?.fresh).toBeUndefined();
  });

  it('tells a full-access agent it may use its tools, and a restricted one that it may not', async () => {
    const { app, complete, factory } = setup(EMAIL_DEMO, EMAIL_DEMO);
    const settings = { model: 'claude-sonnet-5-5', effort: 'low' } as const;
    await generate(app, { settings: { ...settings, access: 'full', fast: true } });
    expect(sent(complete, 0).system).toContain('You run with full access');
    expect(sent(complete, 0).system).not.toContain('Do not use tools or inspect files');
    expect((factory.mock.calls[0] as unknown[])[1]).toMatchObject({ access: 'full', fast: true });
    await generate(app, { settings });
    expect(sent(complete, 1).system).toContain('Do not use tools or inspect files');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DNS_DEMO, EMAIL_DEMO } from '@opsis/schema';
import type { LLMRequest } from './harness/types.js';
import { signIn } from './test-session.js';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const THREAD = '6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d';
const wall = {
  id: 'wall',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 240,
  height: 120,
  ink: 'ink',
  line: 'solid',
  strokeWidth: 2,
};
const board = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'claude',
  positions: Object.fromEntries(
    EMAIL_DEMO.nodes.map((node, index) => [node.id, { x: index * 300, y: 50 }]),
  ),
  drawingLayers: [{ id: 'plans', name: 'Plans' }],
  drawings: [{ ...wall, layerId: 'plans' }],
};

function setup(...outputs: object[]) {
  const complete = vi.fn(async () => JSON.stringify(outputs.shift() ?? EMAIL_DEMO));
  const factory = vi.fn(async () => ({ model: 'test', complete }));
  const app = buildApp({ databasePath: ':memory:', boardClientFactory: factory });
  void signIn(app);
  apps.push(app);
  return { app, complete };
}
const sent = (complete: ReturnType<typeof setup>['complete'], call = 0) =>
  (complete.mock.calls[call] as unknown as [LLMRequest])[0];

describe('chat generation', () => {
  it('sends the thread’s notes and outcomes and returns the reply and new notes', async () => {
    const { app, complete } = setup({
      ...EMAIL_DEMO,
      reply: 'I kept the retry loop you accepted.',
      memory: 'Reader wants retries shown.\nRejected: spam folder branch.',
    });
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'claude',
        prompt: 'Now show the happy path only',
        board,
        thread: THREAD,
        memory: 'Reader wants retries shown.',
        conversation: [
          { role: 'user', text: 'Add a spam branch' },
          { role: 'assistant', text: 'Added it.', outcome: 'discarded' },
        ],
      },
    });
    const request = sent(complete);
    expect(request.system).toMatch(/Conversation: this request comes from a chat thread/);
    expect(JSON.parse(request.user)).toMatchObject({
      memory: 'Reader wants retries shown.',
      conversation: [{}, { outcome: 'discarded' }],
    });
    // The session belongs to the signed-in account, never to an id the browser chose.
    expect(request.session?.key).toMatch(new RegExp(`^[A-Za-z0-9_-]+/${THREAD}$`, 'u'));
    expect(request.session?.resumeSystem).toMatch(/^Continue as Opsis in this session/);
    expect(JSON.parse(request.session!.resumeUser)).toMatchObject({ lastOutcome: 'discarded' });
    expect(JSON.parse(request.session!.resumeUser)).not.toHaveProperty('conversation');
    expect(reply.statusCode).toBe(200);
    expect(reply.json().turn).toEqual({
      reply: 'I kept the retry loop you accepted.',
      memory: 'Reader wants retries shown.\nRejected: spam folder branch.',
    });
  });

  it('works drawing-first on focused drawings and sends their edits for review', async () => {
    const { app, complete } = setup({
      ...EMAIL_DEMO,
      reply: 'I dashed the wall.',
      memory: '',
      focusEdits: { update: [{ ...wall, line: 'dashed' }], remove: [] },
    });
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'claude',
        prompt: 'Dash the wall',
        board: { ...board, drawings: [] },
        focus: { drawings: [wall] },
        priority: 'drawing',
      },
    });
    const request = sent(complete);
    expect(request.system).toMatch(/Focus: focus\.drawings are drawings the reader selected/);
    expect(request.system).toMatch(/Priority: drawing first/);
    expect(JSON.parse(request.user).focus).toEqual({ drawings: [wall] });
    expect(reply.statusCode).toBe(409);
    expect(reply.json().changes).toContain('Change your selected drawings: 1 updated, 0 removed');
    expect(reply.json().turn.focusEdits.update[0].line).toBe('dashed');
  });

  it('repairs once when an agent edits a drawing outside the focus', async () => {
    const { app, complete } = setup(
      {
        ...EMAIL_DEMO,
        reply: 'Done.',
        memory: '',
        focusEdits: { update: [{ ...wall, id: 'someone-else' }], remove: [] },
      },
      { ...EMAIL_DEMO, reply: 'Done.', memory: '' },
    );
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Tidy', board, focus: { drawings: [wall] } },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(sent(complete, 1).user).toMatch(/someone-else is not in focus/);
    expect(reply.statusCode).toBe(200);
  });

  it('lets the demo dash focused drawings and keep notes, without an agent', async () => {
    const { app, complete } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'demo',
        prompt: 'Dash the selected drawing',
        board,
        focus: { drawings: [wall] },
        memory: 'Reader asked: Explain email',
      },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(200);
    const { turn } = reply.json();
    expect(turn.focusEdits.update).toEqual([{ ...wall, ink: 'coral', line: 'dashed' }]);
    expect(turn.memory).toBe(
      'Reader asked: Explain email\nReader asked: Dash the selected drawing',
    );
  });

  it('answers on several new pages when asked, repairing an invalid page once', async () => {
    const page = { ...DNS_DEMO, title: 'How the address is found' };
    const { app, complete } = setup(
      { ...EMAIL_DEMO, reply: 'Two pages.', morePages: [{ ...page, nodes: [] }] },
      { ...EMAIL_DEMO, reply: 'Two pages.', morePages: [page] },
    );
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'A deck on email and DNS', newPages: true },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      title: EMAIL_DEMO.title,
      morePages: [{ title: 'How the address is found', nodes: DNS_DEMO.nodes }],
    });
    // The pages instructions and a schema for further pages go to the agent.
    const request = sent(complete);
    expect(request.system).toContain('Pages: the reader asked for this answer on new pages');
    expect(request.system).toContain('"morePages"');
    expect(request.system).toContain('"$ref":"#/$defs/node"');
    expect(sent(complete, 1).user).toContain('Repair your previous invalid JSON');

    // Without the request, further pages are not offered, and any returned are left out.
    const plain = setup({ ...EMAIL_DEMO, morePages: [page] });
    const single = await plain.app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().morePages).toBeUndefined();
    expect(sent(plain.complete).system).not.toContain('morePages');
  });

  it('lets the demo answer on two pages', async () => {
    const { app } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'demo', prompt: 'A deck on email and DNS', newPages: true },
    });
    expect(reply.json()).toMatchObject({
      title: EMAIL_DEMO.title,
      morePages: [{ title: DNS_DEMO.title }],
    });
  });
});

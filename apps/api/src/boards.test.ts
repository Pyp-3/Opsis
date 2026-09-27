import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardGraphSchema, EMAIL_DEMO } from '@opsis/schema';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
import { HarnessError } from './harness/errors.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const document = {
  ...EMAIL_DEMO,
  version: 2,
  agent: 'claude',
  positions: { sender: { x: 123, y: 456 } },
};

describe('2D board API', () => {
  function setup(output: string | Error = JSON.stringify(EMAIL_DEMO)) {
    const complete = vi.fn(async () => {
      if (output instanceof Error) throw output;
      return output;
    });
    const factory = vi.fn(async () => ({ model: 'test', complete }));
    const app = buildApp({ databasePath: ':memory:', llm: null, boardClientFactory: factory });
    apps.push(app);
    return { app, complete, factory };
  }
  it('repairs invalid JSON once using the same model and validation feedback', async () => {
    const { app, complete, factory } = setup();
    complete.mockResolvedValueOnce('not JSON').mockResolvedValueOnce(JSON.stringify(EMAIL_DEMO));
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(result.statusCode).toBe(200);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          'Downward visual layout does NOT mean interactions only go forward',
        ),
      }),
      expect.any(AbortSignal),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.stringContaining('Validation error:') }),
      expect.any(AbortSignal),
    );
  });
  it('repairs malformed CLI output but never retries authentication/process errors', async () => {
    const { app, complete } = setup();
    complete.mockRejectedValueOnce(new HarnessError('harness_malformed'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards/generate',
          payload: { agent: 'claude', prompt: 'Email' },
        })
      ).statusCode,
    ).toBe(200);
    expect(complete).toHaveBeenCalledTimes(2);
    complete.mockClear().mockRejectedValue(new HarnessError('harness_exit'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards/generate',
          payload: { agent: 'claude', prompt: 'Email' },
        })
      ).statusCode,
    ).toBe(502);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('stops after two invalid outputs', async () => {
    const { app, complete } = setup('{}');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards/generate',
          payload: { agent: 'claude', prompt: 'Email' },
        })
      ).statusCode,
    ).toBe(502);
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('requires review for dropped and rewritten existing content', async () => {
    const output = {
      ...EMAIL_DEMO,
      nodes: EMAIL_DEMO.nodes.slice(1).map((node) => ({ ...node, label: 'Rewritten' })),
      edges: EMAIL_DEMO.edges.slice(1),
    };
    const { app, complete } = setup(JSON.stringify(output));
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'claude',
        prompt: 'Expand one step',
        selectedId: 'outgoing',
        board: document,
      },
    });
    expect(result.statusCode).toBe(409);
    expect(result.json().changes).toContain('Remove concept: sender');
    expect(result.json().changes).toContain('Change concept: incoming');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.json().candidate).toEqual(output);
  });
  it('caches concurrent readiness probes for 30 seconds, including unavailable clients', async () => {
    const { app, factory } = setup();
    await Promise.all([app.inject('/v1/agents'), app.inject('/v1/agents')]);
    await app.inject('/v1/agents');
    expect(factory).toHaveBeenCalledTimes(2);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    try {
      await app.inject('/v1/agents');
      expect(factory).toHaveBeenCalledTimes(4);
    } finally {
      now.mockRestore();
    }
  });
  it('sends the current board and selection to the chosen provider', async () => {
    const { app, complete, factory } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'codex',
        prompt: 'Add a failure branch',
        board: document,
        selectedId: 'outgoing',
      },
    });
    expect(reply.statusCode).toBe(200);
    expect(factory).toHaveBeenCalledWith('codex', { model: 'gpt-6-luna', effort: 'low' });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.stringContaining('"x":123'), promptId: 'board/v2' }),
      expect.any(AbortSignal),
    );
    expect(BoardGraphSchema.safeParse(reply.json()).success).toBe(true);
  });
  it('never silently substitutes demo content on an agent error', async () => {
    const { app } = setup(new Error('private provider details'));
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(reply.statusCode).toBe(502);
    expect(reply.body).not.toContain('private provider details');
    expect(reply.json().message).toContain('board is unchanged');
  });
  it('honors explicit model settings without falling back to an account default', async () => {
    const { app, factory } = setup();
    const settings = { model: 'sonnet', effort: 'medium' };
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email', settings },
    });
    expect(reply.statusCode).toBe(200);
    expect(factory).toHaveBeenCalledWith('claude', settings);
  });
  it.each([
    { model: 'default', effort: 'low' },
    { model: 'haiku', effort: 'unbounded' },
    { model: '--model opus', effort: 'low' },
  ])('rejects invalid or implicit model settings', async (settings) => {
    const { app, factory } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email', settings },
    });
    expect(reply.statusCode).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });
  it.each([
    { ...EMAIL_DEMO, edges: [{ id: 'bad', source: 'absent', target: 'sender', label: '' }] },
    { ...EMAIL_DEMO, nodes: [...EMAIL_DEMO.nodes, EMAIL_DEMO.nodes[0]] },
  ])('rejects structurally inconsistent generated diagrams', async (output) => {
    const { app } = setup(JSON.stringify(output));
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(reply.statusCode).toBe(502);
  });
  it('validates the request before invoking a provider', async () => {
    const { app, factory } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email', selectedId: 'missing', board: document },
    });
    expect(reply.statusCode).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });
  it('adds the demo failure path once, preserving all original concepts', async () => {
    const { app, factory } = setup();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'demo', prompt: 'Show delivery failures', board: document },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().nodes.slice(0, 5)).toEqual(EMAIL_DEMO.nodes);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'demo',
        prompt: 'Show delivery failures',
        board: { ...document, ...first.json() },
      },
    });
    expect(second.json()).toEqual(first.json());
    expect(factory).not.toHaveBeenCalled();
  });
  it('does not pretend demo mode answers arbitrary prompts', async () => {
    const { app } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'demo', prompt: 'Explain photosynthesis' },
    });
    expect(reply.statusCode).toBe(400);
  });
});

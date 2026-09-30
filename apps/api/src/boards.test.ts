import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoardGraphSchema,
  EMAIL_DEMO,
  EMAIL_DEMO_ILLUSTRATIONS,
  illustrateOutputSchema,
} from '@opsis/schema';
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
      [],
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.stringContaining('Validation error:') }),
      expect.any(AbortSignal),
      [],
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
      expect.objectContaining({ user: expect.stringContaining('"x":123'), promptId: 'board/v3' }),
      expect.any(AbortSignal),
      [],
    );
    expect(BoardGraphSchema.safeParse(reply.json()).success).toBe(true);
  });
  it('asks the agent to write spoken narration for the process player', async () => {
    const { app, complete } = setup(JSON.stringify(EMAIL_DEMO));
    await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email delivery' },
    });
    const [request] = complete.mock.calls[0] as unknown as [{ system: string }];
    expect(request.system).toMatch(/narrated film/);
    expect(request.system).toMatch(/grammatical sentences/);
    // The output schema makes narration required on the board, every node and every edge.
    const schema = JSON.parse(request.system.slice(request.system.indexOf('Schema: ') + 8));
    expect(schema.required).toContain('narration');
    expect(schema.properties.nodes.items.required).toContain('narration');
    expect(schema.properties.edges.items.required).toContain('narration');
  });
  it('lets the agent re-word narration so the story flows, without asking for review', async () => {
    const reworded = {
      ...EMAIL_DEMO,
      nodes: EMAIL_DEMO.nodes.map((node) => ({ ...node, narration: `Now, ${node.summary}` })),
      edges: EMAIL_DEMO.edges.map((edge) => ({ ...edge, narration: 'Then it moves on.' })),
    };
    const { app } = setup(JSON.stringify(reworded));
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Smooth the narration', board: document },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().edges[0].narration).toBe('Then it moves on.');
    // A real content change alongside it still needs review.
    const { app: second } = setup(
      JSON.stringify({
        ...reworded,
        nodes: [{ ...reworded.nodes[0]!, summary: 'Changed.' }, ...reworded.nodes.slice(1)],
      }),
    );
    const changed = await second.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Smooth the narration', board: document },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().changes).toEqual(['Change concept: sender']);
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

  describe('illustrations', () => {
    const drawing = EMAIL_DEMO_ILLUSTRATIONS.sender!;
    const illustrate = (app: FastifyInstance, payload: object) =>
      app.inject({ method: 'POST', url: '/v1/boards/illustrate', payload });
    it('draws the email demo without calling an agent', async () => {
      const { app, factory } = setup();
      const reply = await illustrate(app, { agent: 'demo', board: document });
      expect(reply.statusCode).toBe(200);
      expect(Object.keys(reply.json().illustrations)).toEqual(EMAIL_DEMO.nodes.map((n) => n.id));
      expect(reply.json().skipped).toEqual([]);
      expect(factory).not.toHaveBeenCalled();
    });
    it('keeps valid drawings for the requested objects and skips the rest', async () => {
      const { app, complete, factory } = setup(
        JSON.stringify({
          illustrations: [
            { id: 'sender', illustration: drawing },
            { id: 'app', illustration: { layers: [{ shape: 'circle' }] } },
            { id: 'outgoing', illustration: drawing },
          ],
        }),
      );
      const reply = await illustrate(app, {
        agent: 'claude',
        board: document,
        nodeIds: ['sender', 'app'],
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toEqual({ illustrations: { sender: drawing }, skipped: ['app'] });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith('claude', expect.anything(), illustrateOutputSchema);
      const request = (complete.mock.calls[0] as unknown as [{ user: string }])[0];
      expect(JSON.parse(request.user).draw.map((item: { id: string }) => item.id)).toEqual([
        'sender',
        'app',
      ]);
    });
    it('asks once for a repair when no drawing is valid', async () => {
      const { app, complete } = setup();
      complete
        .mockResolvedValueOnce(
          JSON.stringify({ illustrations: [{ id: 'sender', illustration: { layers: [] } }] }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({ illustrations: [{ id: 'sender', illustration: drawing }] }),
        );
      const reply = await illustrate(app, { agent: 'codex', board: document, nodeIds: ['sender'] });
      expect(reply.statusCode).toBe(200);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenLastCalledWith(
        expect.objectContaining({ user: expect.stringContaining('None of your illustrations') }),
        expect.any(AbortSignal),
      );
    });
    it('rejects objects that are not on the board', async () => {
      const { app } = setup();
      const reply = await illustrate(app, {
        agent: 'claude',
        board: document,
        nodeIds: ['nowhere'],
      });
      expect(reply.statusCode).toBe(400);
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoardGraphSchema,
  EMAIL_DEMO,
  EMAIL_DEMO_ILLUSTRATIONS,
  illustrateOutputSchema,
  TERMINAL_PIPELINE_EXAMPLE,
  boardOutputSchema,
} from '@opsis/schema';
import { signIn } from './test-session.js';
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
    const app = buildApp({ databasePath: ':memory:', boardClientFactory: factory });
    void signIn(app);
    apps.push(app);
    return { app, complete, factory };
  }

  it('refuses agent work to signed-out requests, however the path is encoded', async () => {
    const factory = vi.fn(async () => ({ model: 'test', complete: async () => '{}' }));
    const app = buildApp({ databasePath: ':memory:', speech: null, boardClientFactory: factory });
    apps.push(app);
    const settings = { agent: 'claude', settings: { model: 'haiku', effort: 'low' } };
    for (const url of [
      '/v1/boards/check-agent',
      '/v1/boards/%63heck-agent',
      '/v1/boards/%67enerate',
      '/v1/boards/%69llustrate',
    ])
      expect((await app.inject({ method: 'POST', url, payload: settings })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/%61gents' })).statusCode).not.toBe(200);
    expect(factory).not.toHaveBeenCalled();
  });

  it('counts encoded sign-in paths against the sign-in budget', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null, rateLimit: 2 });
    apps.push(app);
    const attempt = (url: string) =>
      app.inject({ method: 'POST', url, payload: { email: 'a@example.com', password: 'guess' } });
    expect((await attempt('/v1/auth/login')).statusCode).toBe(401);
    expect((await attempt('/%761/auth/login')).statusCode).toBe(401);
    expect((await attempt('/v1/%61uth/login')).statusCode).toBe(429);
  });

  it('checks configuration without a completion and rejects invalid model/effort combinations', async () => {
    const { app, complete, factory } = setup();
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/check-agent',
      payload: {
        agent: 'codex',
        settings: { model: 'gpt-6-luna', effort: 'low', executablePath: '/tmp/selected-cli' },
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().message).toContain('not verified');
    expect(complete).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({ executablePath: '/tmp/selected-cli' }),
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'codex',
        prompt: 'Explain email',
        settings: { model: 'gpt-5.5', effort: 'max' },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not repair or retry a request that exceeds its configured character limit', async () => {
    const { app, complete } = setup(new HarnessError('harness_request_limit'));
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(result.statusCode).toBe(400);
    expect(result.json().message).toContain('character limit');
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(['claude', 'codex'])(
    'requests coherent example data and retains terminal output for %s',
    async (agent) => {
      const { app, complete } = setup(JSON.stringify(TERMINAL_PIPELINE_EXAMPLE));
      const result = await app.inject({
        method: 'POST',
        url: '/v1/boards/generate',
        payload: { agent, prompt: 'Show a terminal flow with sample users' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().nodes[2].terminal.output).toBe(
        TERMINAL_PIPELINE_EXAMPLE.nodes[2]!.terminal!.output,
      );
      expect(result.json().nodes[2].terminal.exampleInput.split('\n')).toHaveLength(12);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: 'board/v8',
          system: expect.stringContaining('Generate small, plausible synthetic example data'),
        }),
        expect.any(AbortSignal),
        [],
        expect.any(Function),
      );
      expect(
        JSON.parse(boardOutputSchema).properties.nodes.items.properties.terminal.properties
          .exampleInput,
      ).toBeDefined();
    },
  );
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
      expect.any(Function),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.stringContaining('Validation error:') }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
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
  it('lets agents draw custom icons and drops malformed ones without failing the diagram', async () => {
    const drawn = { name: 'Envelope seal', layers: [{ shape: 'circle', cx: 12, cy: 12, r: 4 }] };
    const { app, complete } = setup(
      JSON.stringify({
        ...EMAIL_DEMO,
        nodes: EMAIL_DEMO.nodes.map((node, index) =>
          index === 0
            ? { ...node, customIcon: drawn }
            : index === 1
              ? { ...node, customIcon: { name: 'Broken', layers: [{ shape: 'circle' }] } }
              : node,
        ),
      }),
    );
    const result = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().nodes[0].customIcon).toEqual(drawn);
    expect(result.json().nodes[1].customIcon).toBeUndefined();
    expect(result.json().nodes[1].icon).toBe(EMAIL_DEMO.nodes[1]!.icon);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('When none models the idea well'),
      }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
    );
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
      expect.objectContaining({ user: expect.stringContaining('"x":123'), promptId: 'board/v8' }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
    );
    const { turn, ...graph } = reply.json();
    expect(BoardGraphSchema.safeParse(graph).success).toBe(true);
    expect(turn).toEqual({});
  });
  it('accepts an agent sketch, repairs a broken one once and reviews sketch changes', async () => {
    const sketch = [
      {
        id: 'room',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 480,
        height: 240,
        ink: 'ink',
        line: 'solid',
        strokeWidth: 2,
      },
      {
        id: 'label',
        shape: 'text',
        anchorId: 'outgoing',
        x: 0,
        y: -24,
        text: 'Server room',
        rotation: 15,
        ink: 'sky',
        line: 'solid',
        strokeWidth: 2,
      },
    ];
    const { app, complete } = setup(JSON.stringify({ ...EMAIL_DEMO, drawings: sketch }));
    const fresh = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Lay out the mail servers' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().drawings).toEqual(sketch);
    const [request] = complete.mock.calls[0] as unknown as [{ system: string }];
    expect(request.system).toMatch(/Drawings: for spatial, physical or graphical subjects/);
    expect(JSON.parse(boardOutputSchema).properties.drawings.type).toBe('array');

    // A sketch attached to a concept that does not exist is repaired once like any other error.
    complete
      .mockResolvedValueOnce(
        JSON.stringify({ ...EMAIL_DEMO, drawings: [{ ...sketch[1], anchorId: 'nowhere' }] }),
      )
      .mockResolvedValueOnce(JSON.stringify({ ...EMAIL_DEMO, drawings: sketch }));
    const repaired = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Lay out the mail servers' },
    });
    expect(repaired.statusCode).toBe(200);
    expect(complete).toHaveBeenLastCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('A drawing can only move with an existing concept'),
      }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
    );

    // On a follow-up the agent sees its own sketch; changing it needs review, leaving it out does not.
    const withSketch = { ...document, drawings: sketch };
    complete.mockResolvedValueOnce(JSON.stringify({ ...EMAIL_DEMO, drawings: [sketch[0]] }));
    const changed = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Drop the label', board: withSketch },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().changes).toContain('Change agent sketch');
    expect(complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.stringContaining('"Server room"') }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
    );
    complete.mockResolvedValueOnce(JSON.stringify(EMAIL_DEMO));
    const kept = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'claude', prompt: 'Explain it again', board: withSketch },
    });
    expect(kept.statusCode).toBe(200);
  });
  it('sketches the demo mail servers without an agent', async () => {
    const { app, complete } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'demo', prompt: 'Sketch the mail servers', board: document },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().drawings.map((item: { id: string }) => item.id)).toEqual([
      'provider-zone',
      'provider-label',
      'zone-width',
    ]);
    expect(complete).not.toHaveBeenCalled();
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
    // The chat reply travels beside the diagram, not in it.
    const { turn, ...graph } = first.json();
    expect(turn.reply).toMatch(/delivery fails/);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: {
        agent: 'demo',
        prompt: 'Show delivery failures',
        board: { ...document, ...graph },
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

  it('streams the agent’s progress, then the result, to clients that ask', async () => {
    const { app, complete } = setup();
    complete.mockImplementationOnce((async (
      _request: unknown,
      _signal: unknown,
      _files: unknown,
      onProgress?: (progress: object) => void,
    ) => {
      onProgress?.({ type: 'note', text: 'Tracing the email to its inbox', done: true });
      return JSON.stringify(EMAIL_DEMO);
    }) as never);
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      headers: { accept: 'application/x-ndjson, application/json' },
      payload: { agent: 'claude', prompt: 'Explain email' },
    });
    expect(reply.headers['content-type']).toContain('application/x-ndjson');
    expect(reply.headers['cache-control']).toBe('no-store');
    const events = reply.body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events[0]).toEqual({ type: 'progress', progress: { type: 'preview-reset' } });
    expect(events[1]).toEqual({
      type: 'progress',
      progress: { type: 'note', text: 'Tracing the email to its inbox', done: true },
    });
    expect(events.at(-1)).toMatchObject({ type: 'result', status: 200, body: EMAIL_DEMO });
    // Claude is asked for specific progress notes; Codex's answer must stay pure JSON.
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining('progress notes') }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
    );
  });
  it('streams validation failures as a result event', async () => {
    const { app } = setup();
    const reply = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      headers: { accept: 'application/x-ndjson' },
      payload: { agent: 'claude' },
    });
    expect(JSON.parse(reply.body.trim())).toMatchObject({ type: 'result', status: 400 });
  });
  it('does not ask Codex to write notes outside its JSON answer', async () => {
    const { app, complete } = setup();
    await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { agent: 'codex', prompt: 'Explain email' },
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.not.stringContaining('progress notes') }),
      expect.any(AbortSignal),
      [],
      expect.any(Function),
    );
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
        [],
        expect.any(Function),
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

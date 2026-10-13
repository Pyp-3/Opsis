import Fastify from 'fastify';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { respond, outcome } from './transport';
import { generateBoard } from './generate';
import { illustrateBoard } from './illustrate';
import { HarnessError } from '../harness/errors';
import type { BoardClient, BoardClientFactory } from './client';

const arrow = {
  id: 'arrow',
  shape: 'arrow',
  ink: 'ink',
  line: 'solid',
  strokeWidth: 2,
  points: [
    [0, 0],
    [10, 10],
  ],
};
const invalid = JSON.stringify({
  ...EMAIL_DEMO,
  sketchEdits: {
    put: [
      {
        ...arrow,
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
          [20, 10],
        ],
      },
    ],
    remove: [],
  },
});
const body = {
  agent: 'codex',
  prompt: 'Change this sketch',
  board: { ...EMAIL_DEMO, version: 2, agent: 'codex', positions: {}, drawings: [arrow] },
};

function untilAborted(signal: AbortSignal): Promise<void> {
  return signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

describe('agent request deadlines', () => {
  it.each(['application/json', 'application/x-ndjson'])(
    'reports a deadline during the one invalid-arrow repair over %s',
    async (accept) => {
      const complete = vi
        .fn<BoardClient['complete']>()
        .mockResolvedValueOnce(invalid)
        .mockImplementationOnce(async (_request, signal) => {
          await untilAborted(signal!);
          // Providers can discard AbortSignal.reason; the host must still identify its deadline.
          throw new HarnessError('harness_cancelled');
        });
      const factory: BoardClientFactory = async () => ({ model: 'test', complete });
      const app = Fastify();
      onTestFinished(() => app.close());
      app.post('/generate', (request, reply) =>
        respond(
          request,
          reply,
          (context) =>
            generateBoard(body, factory, context, async () => ({ files: [], documents: [] })),
          30,
        ),
      );
      const response = await app.inject({ method: 'POST', url: '/generate', headers: { accept } });
      const result =
        accept === 'application/json'
          ? { status: response.statusCode, body: response.json() }
          : JSON.parse(response.body.trim().split('\n').at(-1)!);
      expect(result).toMatchObject({
        status: 502,
        body: { message: expect.stringContaining('took too long') },
      });
      expect(result.body).not.toHaveProperty('candidate');
      expect(result.body.message).toContain('Your board is unchanged');
      expect(result.body.message).not.toMatch(/login|usage/u);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(complete.mock.calls[1]![0].user).toContain('Validation error');
      expect(complete.mock.calls[1]![1]).toBe(complete.mock.calls[0]![1]);
      expect(body.board.drawings).toEqual([arrow]);
    },
  );

  it.each([invalid, JSON.stringify(EMAIL_DEMO)])(
    'does not accept or repair a late answer %#',
    async (answer) => {
      const controller = new AbortController();
      const complete = vi.fn<BoardClient['complete']>(async () => {
        controller.abort(new HarnessError('harness_timeout'));
        return answer;
      });
      const result = await generateBoard(
        body,
        async () => ({ model: 'test', complete }),
        {
          signal: controller.signal,
          progress: () => undefined,
        },
        async () => ({ files: [], documents: [] }),
      );
      expect(result).toMatchObject({
        status: 502,
        body: { message: expect.stringContaining('took too long') },
      });
      expect(complete).toHaveBeenCalledTimes(1);
    },
  );

  it('reports the same host deadline for illustration calls', async () => {
    const complete = vi.fn<BoardClient['complete']>(async (_request, signal?: AbortSignal) => {
      await untilAborted(signal!);
      throw new Error('Provider aborted');
    });
    const app = Fastify();
    onTestFinished(() => app.close());
    app.post('/illustrate', (request, reply) =>
      respond(
        request,
        reply,
        (context) =>
          illustrateBoard(
            { agent: 'codex', board: body.board },
            async () => ({ model: 'test', complete }),
            context,
          ),
        30,
      ),
    );
    const response = await app.inject({ method: 'POST', url: '/illustrate' });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain('took too long to draw');
    expect(response.json().message).toContain('Your icons are unchanged');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('keeps disconnects distinct from deadlines', async () => {
    const app = Fastify();
    onTestFinished(() => app.close());
    let disconnected: AbortSignal | undefined;
    app.post('/disconnect', (request, reply) =>
      respond(request, reply, async ({ signal }) => {
        disconnected = signal;
        reply.raw.emit('close');
        return outcome(200, { cancelled: true });
      }),
    );
    await expect(app.inject({ method: 'POST', url: '/disconnect' })).rejects.toThrow(
      'response destroyed',
    );
    expect(disconnected?.aborted).toBe(true);
    expect(disconnected?.reason).not.toBeInstanceOf(HarnessError);
  });
});

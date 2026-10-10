import type { FastifyRequest, FastifyReply } from 'fastify';
import type { HarnessProgress } from '../harness/index.js';

export type Outcome = { status: number; body: unknown };
export const outcome = (status: number, body: unknown): Outcome => ({ status, body });
export type AgentWork = (context: {
  signal: AbortSignal;
  progress: (progress: HarnessProgress) => void;
  /** The signed-in account, which scopes chat threads' native CLI sessions. */
  account?: string;
  /** Waits, for the demo's paced streaming; hosts without timers supply their own. */
  pause?: (ms: number) => Promise<void>;
}) => Promise<Outcome>;

/** Agent calls end when the reader leaves or after three minutes. */
const AGENT_DEADLINE_MS = 180_000;

/**
 * Runs agent work for a route. A client that accepts `application/x-ndjson` receives the
 * agent's progress live, one JSON event per line, then `{ type: "result", status, body }`;
 * anyone else receives the result as an ordinary JSON response.
 */
export async function respond(request: FastifyRequest, reply: FastifyReply, work: AgentWork) {
  const controller = new AbortController();
  const cancel = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.on('close', cancel);
  const deadline = setTimeout(() => controller.abort(), AGENT_DEADLINE_MS);
  try {
    if (!request.headers.accept?.includes('application/x-ndjson')) {
      const result = await work({ signal: controller.signal, progress: () => undefined });
      return reply.code(result.status).send(result.body);
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    const send = (event: object) => {
      if (!reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    let result: Outcome;
    try {
      result = await work({
        signal: controller.signal,
        progress: (progress) => send({ type: 'progress', progress }),
      });
    } catch {
      result = outcome(500, { message: 'Something went wrong. Your board is unchanged.' });
    }
    send({ type: 'result', ...result });
    reply.raw.end();
  } finally {
    clearTimeout(deadline);
    reply.raw.off('close', cancel);
  }
}

import { checkAgent } from './boards/check-agent.js';
import type { FastifyInstance } from 'fastify';
import { localBoardClient, type BoardClientFactory } from './boards/client.js';
import { generateBoard } from './boards/generate.js';
import { illustrateBoard } from './boards/illustrate.js';
import { respond } from './boards/transport.js';
import { prepareAttachments } from './attachments.js';

export { localBoardClient, type BoardClient, type BoardClientFactory } from './boards/client.js';

export function registerBoardRoutes(
  app: FastifyInstance,
  factory: BoardClientFactory = localBoardClient,
) {
  let agentCache: { expires: number; value: unknown } | undefined;
  let pendingAgents: Promise<unknown> | undefined;
  app.get('/v1/agents', async () => {
    if (agentCache && agentCache.expires > Date.now()) return agentCache.value;
    if (pendingAgents) return pendingAgents;
    pendingAgents = (async () => {
      const agents = await Promise.all(
        (['claude', 'codex'] as const).map(async (id) => {
          try {
            await factory(id);
            return { id, available: true, detail: 'CLI ready · account access unverified' };
          } catch {
            return {
              id,
              available: false,
              detail: `Unavailable · check ${id} installation and version`,
            };
          }
        }),
      );
      const value = [
        ...agents,
        ...(['kimi', 'grok', 'antigravity'] as const).map((id) => ({
          id,
          available: true,
          detail: 'API · configure this instance’s key in Settings',
        })),
        { id: 'demo', available: true, detail: 'Built-in examples · no agent calls' },
      ];
      agentCache = { value, expires: Date.now() + 30_000 };
      return value;
    })();
    try {
      return await pendingAgents;
    } finally {
      pendingAgents = undefined;
    }
  });

  app.post('/v1/boards/check-agent', { bodyLimit: 8192 }, async (request, reply) => {
    const result = await checkAgent(request.body, factory);
    return reply.code(result.status).send(result.body);
  });

  app.post('/v1/boards/generate', { bodyLimit: 40_000_000 }, (request, reply) =>
    respond(request, reply, (context) =>
      generateBoard(
        request.body,
        factory,
        { ...context, ...(request.user ? { account: request.user.id } : {}) },
        prepareAttachments,
      ),
    ),
  );
  app.post('/v1/boards/illustrate', { bodyLimit: 4_000_000 }, (request, reply) =>
    respond(request, reply, (context) => illustrateBoard(request.body, factory, context)),
  );
}

import type { FastifyInstance } from 'fastify';
import type { ApiStore } from './storage.js';

/** Default-deny guest boundary, after authentication and before any route handler.
 * Match Fastify's resolved route, including encoded aliases. New APIs are denied by default.
 * Invitations and ownership never override a guest's public-view-only restriction.
 */
export function registerGuestAccess(app: FastifyInstance, store: ApiStore) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.user?.role !== 'guest') return;
    const route = request.routeOptions.url;
    if (request.method === 'POST' && route === '/v1/auth/logout') return;
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!route || route === '/*') return; // Static web assets / SPA shell only.
      if (['/v1/auth/me', '/v1/health', '/v1/instance', '/v1/boards/public'].includes(route))
        return;
      if (route === '/v1/boards/:id') {
        const { id } = request.params as { id: string };
        const board = store.getBoard(id);
        if (!board || board.visibility !== 'public' || board.archived)
          return reply.code(404).send({ message: 'Board not found.' });
        // Do not expose old revisions, private tags, chat, or editor identities.
        return reply.send({
          id: board.id,
          revision: board.revision,
          snapshot: { board: board.snapshot.board, past: [], future: [] },
          visibility: 'public',
          archived: false,
          access: 'viewer',
          owner: { name: board.ownerName ?? 'Unknown' },
        });
      }
    }
    return reply.code(403).send({ message: 'Guest accounts can only view public boards.' });
  });
}

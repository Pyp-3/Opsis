import type { FastifyInstance } from 'fastify';
import { BoardPageIdSchema, readerSnapshot } from '@opsis/schema';
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
    // The narrator reads guests only the script of a board they can open; see narration-access.ts.
    if (request.method === 'POST' && (route === '/v1/speech' || route === '/v1/speech/warm'))
      return;
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!route || route === '/*') return; // Static web assets / SPA shell only.
      // A board's link opens for anyone, so for guests too.
      if (
        [
          '/v1/auth/me',
          '/v1/health',
          '/v1/instance',
          '/v1/boards/public',
          '/v1/guest/boards/:id',
          '/v1/speech',
        ].includes(route)
      )
        return;
      if (route === '/v1/boards/:id') {
        const { id } = request.params as { id: string };
        const board = store.getBoard(id);
        if (!board || board.visibility === 'private' || board.archived)
          return reply.code(404).send({ message: 'Board not found.' });
        // Do not expose old revisions, private tags, chat, editor identities or hidden pages.
        const page = (request.query as { page?: unknown } | undefined)?.page;
        return reply.send({
          id: board.id,
          revision: board.revision,
          snapshot: readerSnapshot(
            board.snapshot,
            BoardPageIdSchema.safeParse(page).success ? (page as string) : null,
          ),
          visibility: board.visibility,
          archived: false,
          access: 'viewer',
          owner: { name: board.ownerName ?? 'Unknown' },
        });
      }
    }
    return reply.code(403).send({ message: 'Guest accounts can only view public boards.' });
  });
}

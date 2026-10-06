import type { FastifyInstance } from 'fastify';
import { SearchQuerySchema, searchBoards } from '@opsis/schema';
import type { ApiStore } from './storage.js';
import { requireUser } from './auth.js';

/** Searches the boards the account owns or edits; public boards and archives are excluded. */
export function registerBoardSearch(app: FastifyInstance, store: ApiStore) {
  app.get('/v1/search', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const query = SearchQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: 'Search for 2–200 characters.' });
    return { results: searchBoards(store.listSearchableBoards(user.id), query.data.q) };
  });
}

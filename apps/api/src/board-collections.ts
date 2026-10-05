import type { FastifyInstance } from 'fastify';
import {
  BoardCollectionAssignmentSchema,
  BoardCollectionRequestSchema,
  BoardIdSchema,
  MAX_BOARD_COLLECTIONS,
} from '@opsis/schema';
import { randomUUID } from 'node:crypto';
import type { ApiStore } from './storage.js';
import { requireUser } from './auth.js';

const DUPLICATE_NAME = 'You already have a collection with that name.';

/** Private per-account folders for owned boards. Other accounts' collections answer 404. */
export function registerBoardCollections(app: FastifyInstance, store: ApiStore) {
  app.get('/v1/collections', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listCollections(user.id) : reply;
  });
  app.post('/v1/collections', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const body = BoardCollectionRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ message: 'Enter a collection name (1–60 characters).' });
    const id = randomUUID();
    const result = store.createCollection(id, user.id, body.data.name, MAX_BOARD_COLLECTIONS);
    if (result === 'duplicate') return reply.code(409).send({ message: DUPLICATE_NAME });
    if (result === 'limit')
      return reply
        .code(400)
        .send({ message: `You can have up to ${MAX_BOARD_COLLECTIONS} collections.` });
    return reply
      .code(201)
      .send(store.listCollections(user.id).find((collection) => collection.id === id));
  });
  app.patch('/v1/collections/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = BoardIdSchema.safeParse(request.params);
    const body = BoardCollectionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Enter a collection name (1–60 characters).' });
    const result = store.renameCollection(params.data.id, user.id, body.data.name);
    if (result === 'missing') return reply.code(404).send({ message: 'Collection not found.' });
    if (result === 'duplicate') return reply.code(409).send({ message: DUPLICATE_NAME });
    return store.listCollections(user.id).find((collection) => collection.id === params.data.id);
  });
  app.delete('/v1/collections/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = BoardIdSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: 'Invalid collection ID.' });
    if (!store.deleteCollection(params.data.id, user.id))
      return reply.code(404).send({ message: 'Collection not found.' });
    return reply.code(204).send();
  });
  app.put('/v1/boards/:id/collection', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = BoardIdSchema.safeParse(request.params);
    const body = BoardCollectionAssignmentSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid board or collection.' });
    const result = store.setBoardCollection(params.data.id, user.id, body.data.collectionId);
    if (result === 'missing') return reply.code(404).send({ message: 'Board not found.' });
    if (result === 'collection') return reply.code(404).send({ message: 'Collection not found.' });
    return { id: params.data.id, collectionId: body.data.collectionId };
  });
}

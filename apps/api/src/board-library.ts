import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BoardSnapshotSchema } from '@opsis/schema';
import type { ApiStore } from './storage.js';

export function registerBoardLibrary(app: FastifyInstance, store: ApiStore) {
  const idSchema = z.object({ id: z.string().uuid() });
  app.get('/v1/boards', async () => store.listBoards());
  app.get('/v1/boards/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: 'Invalid board ID.' });
    const result = store.getBoard(params.data.id);
    return result ?? reply.code(404).send({ message: 'Board not found.' });
  });
  app.put('/v1/boards/:id', { bodyLimit: 20_000_000 }, async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    const body = z
      .object({ snapshot: BoardSnapshotSchema, revision: z.number().int().nonnegative() })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid saved board.' });
    const result = store.saveBoard(params.data.id, body.data.snapshot, body.data.revision);
    return (
      result ??
      reply.code(409).send({
        message:
          'This board changed in another tab. Save as a separate board to preserve your changes, then reopen the original from Saved boards.',
      })
    );
  });
}

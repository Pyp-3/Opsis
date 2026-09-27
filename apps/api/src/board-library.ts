import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BoardSnapshotSchema } from '@opsis/schema';
import { randomUUID } from 'node:crypto';
import type { ApiStore } from './storage.js';

export function registerBoardLibrary(app: FastifyInstance, store: ApiStore) {
  const idSchema = z.object({ id: z.string().uuid() });
  app.get('/v1/boards', async () => store.listBoards());
  app.post('/v1/boards', async (request, reply) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(100) })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ message: 'Enter a board name (1–100 characters).' });
    const id = randomUUID();
    const snapshot = BoardSnapshotSchema.parse({
      board: {
        version: 2,
        title: body.data.title,
        description: '',
        nodes: [],
        edges: [],
        positions: {},
        agent: 'claude',
      },
      past: [],
      future: [],
    });
    store.saveBoard(id, snapshot, 0);
    return reply.code(201).send(store.getBoard(id));
  });
  app.patch('/v1/boards/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    const body = z
      .object({ title: z.string().trim().min(1).max(100), revision: z.number().int().positive() })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid board name or revision.' });
    const current = store.getBoard(params.data.id);
    if (!current) return reply.code(404).send({ message: 'Board not found.' });
    if (current.revision !== body.data.revision)
      return reply.code(409).send({
        message: 'This board changed in another tab. Reopen the board manager and retry.',
      });
    if (current.snapshot.board?.title === body.data.title) return current;
    const before = current.snapshot.board;
    const board = before
      ? { ...before, title: body.data.title }
      : {
          version: 2 as const,
          title: body.data.title,
          description: '',
          nodes: [],
          edges: [],
          positions: {},
          agent: 'claude' as const,
        };
    const snapshot = { board, past: [...current.snapshot.past.slice(-39), before], future: [] };
    if (!store.saveBoard(current.id, snapshot, current.revision))
      return reply.code(409).send({ message: 'Board changed. Reopen the manager and retry.' });
    return store.getBoard(current.id);
  });
  app.delete('/v1/boards/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    const body = z
      .object({ revision: z.number().int().positive() })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid board ID or revision.' });
    const result = store.deleteBoard(params.data.id, body.data.revision);
    if (result === 'missing') return reply.code(404).send({ message: 'Board not found.' });
    if (result === 'conflict')
      return reply.code(409).send({
        message: 'This board changed in another tab. Reopen the board manager before deleting.',
      });
    return reply.code(204).send();
  });
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

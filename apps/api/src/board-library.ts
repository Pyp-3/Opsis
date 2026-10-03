import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BoardSnapshotSchema } from '@opsis/schema';
import { randomUUID } from 'node:crypto';
import type { ApiStore, User } from './storage.js';
import { requireUser } from './auth.js';

const VisibilitySchema = z.enum(['private', 'public']);

/**
 * Each account's boards. Owners read and write their own; a public board can be read (never
 * written) by any signed-in account, which is how friends share canvases. A private board
 * someone else owns answers 404, so its existence is not revealed.
 */
export function registerBoardLibrary(app: FastifyInstance, store: ApiStore) {
  const idSchema = z.object({ id: z.string().uuid() });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ message: 'Board not found.' });
  /** The board, if `user` may read it. */
  const readable = (id: string, user: User) => {
    const board = store.getBoard(id);
    return board && (board.ownerId === user.id || board.visibility === 'public') ? board : null;
  };
  const view = (board: NonNullable<ReturnType<ApiStore['getBoard']>>, user: User) => ({
    id: board.id,
    revision: board.revision,
    snapshot: board.snapshot,
    visibility: board.visibility,
    access: board.ownerId === user.id ? ('owner' as const) : ('viewer' as const),
    owner: { name: board.ownerName ?? 'Unknown' },
  });

  app.get('/v1/boards', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listBoards(user.id) : reply;
  });
  app.get('/v1/boards/public', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listPublicBoards(user.id) : reply;
  });
  app.post('/v1/boards', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
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
    store.saveBoard(id, snapshot, 0, user.id);
    return reply.code(201).send(view(store.getBoard(id)!, user));
  });
  app.patch('/v1/boards/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(100).optional(),
        visibility: VisibilitySchema.optional(),
        revision: z.number().int().positive(),
      })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid board name or revision.' });
    const current = store.getBoard(params.data.id);
    if (!current || current.ownerId !== user.id) return notFound(reply);
    if (current.revision !== body.data.revision)
      return reply.code(409).send({
        message: 'This board changed in another tab. Reopen the board manager and retry.',
      });
    // Sharing is a property of the board, not an edit to it: no revision or undo step.
    if (body.data.visibility) store.setVisibility(current.id, body.data.visibility);
    const title = body.data.title;
    if (title === undefined || current.snapshot.board?.title === title)
      return view(store.getBoard(current.id)!, user);
    const before = current.snapshot.board;
    const board = before
      ? { ...before, title }
      : {
          version: 2 as const,
          title,
          description: '',
          nodes: [],
          edges: [],
          positions: {},
          agent: 'claude' as const,
        };
    const snapshot = { board, past: [...current.snapshot.past.slice(-39), before], future: [] };
    const saved = store.saveBoard(current.id, snapshot, current.revision, user.id);
    if (!saved || saved === 'forbidden')
      return reply.code(409).send({ message: 'Board changed. Reopen the manager and retry.' });
    return view(store.getBoard(current.id)!, user);
  });
  app.delete('/v1/boards/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const body = z
      .object({ revision: z.number().int().positive() })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid board ID or revision.' });
    if (store.getBoard(params.data.id)?.ownerId !== user.id) return notFound(reply);
    const result = store.deleteBoard(params.data.id, body.data.revision);
    if (result === 'missing') return notFound(reply);
    if (result === 'conflict')
      return reply.code(409).send({
        message: 'This board changed in another tab. Reopen the board manager before deleting.',
      });
    return reply.code(204).send();
  });
  app.get('/v1/boards/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: 'Invalid board ID.' });
    const board = readable(params.data.id, user);
    return board ? view(board, user) : notFound(reply);
  });
  app.put('/v1/boards/:id', { bodyLimit: 20_000_000 }, async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const body = z
      .object({ snapshot: BoardSnapshotSchema, revision: z.number().int().nonnegative() })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid saved board.' });
    const result = store.saveBoard(params.data.id, body.data.snapshot, body.data.revision, user.id);
    if (result === 'forbidden')
      return readable(params.data.id, user)
        ? reply.code(403).send({
            message: 'This board belongs to someone else. Save a copy to edit it.',
          })
        : notFound(reply);
    return (
      result ??
      reply.code(409).send({
        message:
          'This board changed in another tab. Save as a separate board to preserve your changes, then reopen the original from Saved boards.',
      })
    );
  });
}

import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BoardSnapshotSchema,
  createEmptyBoard,
  recordBoardEdit,
  BoardIdSchema,
  BoardCreateRequestSchema,
  BoardUpdateRequestSchema,
  BoardDeleteRequestSchema,
  BoardSaveRequestSchema,
  TemplateCreateRequestSchema,
} from '@opsis/schema';
import { randomUUID } from 'node:crypto';
import type { ApiStore, User } from './storage.js';
import { requireUser } from './auth.js';

/**
 * Each account's boards. Owners read and write their own; a public board can be read (never
 * written) by any signed-in account, which is how friends share canvases. A private board
 * someone else owns answers 404, so its existence is not revealed.
 */
export function registerBoardLibrary(app: FastifyInstance, store: ApiStore) {
  const idSchema = BoardIdSchema;
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
  app.get('/v1/templates', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listTemplates(user.id) : reply;
  });
  app.post('/v1/templates', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const body = TemplateCreateRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ message: 'Invalid template name or source board.' });
    const source = store.getBoard(body.data.boardId);
    if (!source || source.ownerId !== user.id) return notFound(reply);
    if (source.revision !== body.data.revision)
      return reply
        .code(409)
        .send({ message: 'This board changed. Refresh the library and retry.' });
    if (!source.snapshot.board)
      return reply
        .code(400)
        .send({ message: 'Add content to this board before saving a template.' });
    const id = randomUUID();
    store.createTemplate(id, user.id, body.data.title, source.snapshot.board);
    return reply.code(201).send({ id, title: body.data.title });
  });
  app.delete('/v1/templates/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: 'Invalid template ID.' });
    if (!store.deleteTemplate(params.data.id, user.id))
      return reply.code(404).send({ message: 'Template not found.' });
    return reply.code(204).send();
  });
  app.get('/v1/boards/public', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listPublicBoards(user.id) : reply;
  });
  app.post('/v1/boards', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const body = BoardCreateRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ message: 'Enter a board name (1–100 characters).' });
    const id = randomUUID();
    const template = body.data.templateId
      ? store.getTemplate(body.data.templateId, user.id)
      : undefined;
    if (body.data.templateId && !template)
      return reply.code(404).send({ message: 'Template not found.' });
    const snapshot = BoardSnapshotSchema.parse({
      board: template ? { ...template, title: body.data.title } : createEmptyBoard(body.data.title),
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
    const body = BoardUpdateRequestSchema.safeParse(request.body);
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
    const board = before ? { ...before, title } : createEmptyBoard(title);
    const snapshot = recordBoardEdit(current.snapshot, board);
    const saved = store.saveBoard(current.id, snapshot, current.revision, user.id);
    if (!saved || saved === 'forbidden')
      return reply.code(409).send({ message: 'Board changed. Reopen the manager and retry.' });
    return view(store.getBoard(current.id)!, user);
  });
  app.delete('/v1/boards/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const body = BoardDeleteRequestSchema.safeParse(request.body);
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
    const body = BoardSaveRequestSchema.safeParse(request.body);
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

import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BoardCollaboratorRequestSchema,
  BoardSnapshotSchema,
  createEmptyBoard,
  recordBoardEdit,
  BoardIdSchema,
  BoardCreateRequestSchema,
  BoardUpdateRequestSchema,
  BoardDeleteRequestSchema,
  BoardSaveRequestSchema,
  TemplateCreateRequestSchema,
  BoardDuplicateRequestSchema,
  BoardRevisionQuerySchema,
} from '@opsis/schema';
import { randomUUID } from 'node:crypto';
import type { ApiStore, User } from './storage.js';
import { requireUser } from './auth.js';
import type { ThreadSessionCleaner } from './cli-sessions.js';
import { sessionKey } from './harness/sessions.js';

/**
 * Owners manage boards and may invite named editors. Public visibility grants only
 * read access to signed-in accounts. Uninvited private boards answer 404.
 */
export function registerBoardLibrary(
  app: FastifyInstance,
  store: ApiStore,
  removeThreadSessions: ThreadSessionCleaner,
) {
  const idSchema = BoardIdSchema;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ message: 'Board not found.' });
  /** The board, if `user` may read it. */
  const readable = (id: string, user: User) => {
    const board = store.getBoard(id);
    return board &&
      (board.ownerId === user.id ||
        (!board.archived && (board.visibility === 'public' || store.isEditor(id, user.id))))
      ? board
      : null;
  };
  const view = (board: NonNullable<ReturnType<ApiStore['getBoard']>>, user: User) => ({
    id: board.id,
    revision: board.revision,
    snapshot: board.snapshot,
    visibility: board.visibility,
    archived: board.archived,
    access:
      board.ownerId === user.id
        ? ('owner' as const)
        : !board.archived && store.isEditor(board.id, user.id)
          ? ('editor' as const)
          : ('viewer' as const),
    owner: { name: board.ownerName ?? 'Unknown' },
  });

  app.get('/v1/boards', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listBoards(user.id, true) : reply;
  });
  app.get('/v1/boards/:id/backlinks', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    if (!params.success || !readable(params.data.id, user)) return notFound(reply);
    return store.listBacklinks(user.id, params.data.id);
  });
  app.get('/v1/boards/shared', async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? store.listSharedBoards(user.id) : reply;
  });
  app.get('/v1/boards/:id/editors', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    if (!params.success || store.getBoard(params.data.id)?.ownerId !== user.id)
      return notFound(reply);
    return store.listEditors(params.data.id);
  });
  app.put('/v1/boards/:id/editors', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const body = BoardCollaboratorRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid editor settings.' });
    const result = store.setEditor(
      params.data.id,
      user.id,
      body.data.email,
      body.data.enabled,
      body.data.revision,
    );
    if (result === 'missing') return notFound(reply);
    if (result === 'conflict')
      return reply.code(409).send({ message: 'Board changed. Refresh and retry.' });
    if (result === 'account')
      return reply.code(400).send({ message: 'Choose another existing account on this server.' });
    return store.listEditors(params.data.id);
  });
  app.get('/v1/boards/:id/revisions', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const query = BoardRevisionQuerySchema.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ message: 'Invalid revision query.' });
    if (store.getBoard(params.data.id)?.ownerId !== user.id) return notFound(reply);
    return store.listRevisions(params.data.id, query.data.before);
  });
  app.get('/v1/boards/:id/revisions/:revision', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = request.params as { id: string; revision: string };
    const revision = Number(params.revision);
    if (!idSchema.safeParse(params).success || !Number.isSafeInteger(revision) || revision < 1)
      return reply.code(400).send({ message: 'Invalid revision.' });
    if (store.getBoard(params.id)?.ownerId !== user.id) return notFound(reply);
    const board = store.readRevision(params.id, revision);
    return board === undefined ? notFound(reply) : { revision, board };
  });
  app.post('/v1/boards/:id/duplicate', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = idSchema.safeParse(request.params);
    const body = BoardDuplicateRequestSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ message: 'Invalid copy request.' });
    const id = randomUUID();
    const result = store.duplicateBoard(
      params.data.id,
      user.id,
      body.data.revision,
      id,
      body.data.title,
      body.data.fromRevision,
    );
    if (result === 'missing') return notFound(reply);
    if (result === 'conflict')
      return reply
        .code(409)
        .send({ message: 'This board changed. Refresh the library and retry.' });
    return reply.code(201).send(view(store.getBoard(id)!, user));
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
    const { collectionId } = body.data;
    if (collectionId && !store.ownsCollection(collectionId, user.id))
      return reply.code(404).send({ message: 'Collection not found.' });
    const snapshot = BoardSnapshotSchema.parse({
      board: template ? { ...template, title: body.data.title } : createEmptyBoard(body.data.title),
      past: [],
      future: [],
    });
    store.saveBoard(id, snapshot, 0, user.id);
    if (collectionId) store.setBoardCollection(id, user.id, collectionId);
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
    if (body.data.archived !== undefined) {
      if (current.archived === body.data.archived) return view(current, user);
      if (!store.setArchived(current.id, body.data.archived, current.revision))
        return reply
          .code(409)
          .send({ message: 'This board changed. Refresh the library and retry.' });
      return view(store.getBoard(current.id)!, user);
    }
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
    await removeThreadSessions(
      result.threads.flatMap((thread) => sessionKey(thread.userId, thread.id) ?? []),
    );
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

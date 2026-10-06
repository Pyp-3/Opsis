import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BoardChatWriteSchema, BoardIdSchema } from '@opsis/schema';
import type { ApiStore } from './storage.js';

/** A thread belongs to its account even when the board has other editors. */
export function registerBoardChat(app: FastifyInstance, store: ApiStore) {
  const authorize = (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user || request.viaAgent) {
      reply.code(401).send({ message: 'Sign in to use private chat.' });
      return null;
    }
    const params = BoardIdSchema.safeParse(request.params);
    const board = params.success ? store.getBoard(params.data.id) : null;
    if (
      !board ||
      (board.ownerId !== request.user.id &&
        (board.archived ||
          (board.visibility !== 'public' && !store.isEditor(board.id, request.user.id))))
    ) {
      reply.code(404).send({ message: 'Board not found.' });
      return null;
    }
    return { userId: request.user.id, boardId: board.id };
  };
  app.get('/v1/boards/:id/chat', async (request, reply) => {
    const scope = authorize(request, reply);
    return scope ? store.listChatThreads(scope.userId, scope.boardId) : reply;
  });
  app.put('/v1/boards/:id/chat', async (request, reply) => {
    const scope = authorize(request, reply);
    if (!scope) return reply;
    const body = BoardChatWriteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: 'Invalid chat thread.' });
    const result = store.saveChatThread(
      scope.userId,
      scope.boardId,
      body.data.thread,
      body.data.revision,
    );
    if (result === 'conflict')
      return reply
        .code(409)
        .send({ message: 'This thread changed elsewhere. Reload it before sending.' });
    if (result === 'limit')
      return reply
        .code(400)
        .send({ message: 'Keep up to 30 threads per board. Delete an older thread first.' });
    return result;
  });
  app.delete('/v1/boards/:id/chat/:threadId', async (request, reply) => {
    const scope = authorize(request, reply);
    if (!scope) return reply;
    const id = (request.params as { threadId: string }).threadId;
    store.deleteChatThread(scope.userId, scope.boardId, id);
    return reply.code(204).send();
  });
}

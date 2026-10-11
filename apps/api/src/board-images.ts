import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  BoardIdSchema,
  IMAGE_ID_PATTERN,
  MAX_BOARD_IMAGES,
  MAX_IMAGE_BYTES,
  imageFileInfo,
} from '@opsis/schema';
import type { ApiStore, User } from './storage.js';
import { requireUser } from './auth.js';

const ImageUploadSchema = z
  .object({
    // Strict base64, so the bytes checked are exactly the bytes sent.
    data: z
      .string()
      .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
const ImageParamsSchema = BoardIdSchema.extend({
  image: z.string().regex(IMAGE_ID_PATTERN),
}).strict();

/**
 * Images in a page's Info. Owners and invited editors upload them; anyone who may read a board
 * reads the images it shows, and link or public boards' images also open without sign-in.
 *
 * Every upload is checked by its own bytes (PNG, JPEG or WebP only, within size limits) and
 * served with its checked type, `nosniff` and a sandboxing policy, so a stored file can only
 * ever display as a picture.
 */
export function registerBoardImages(app: FastifyInstance, store: ApiStore) {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ message: 'Image not found.' });
  const readable = (id: string, user: User) => {
    const board = store.getBoard(id);
    return (
      !!board &&
      (board.ownerId === user.id ||
        (!board.archived && (board.visibility !== 'private' || store.isEditor(id, user.id))))
    );
  };
  const send = (reply: FastifyReply, boardId: string, image: string) => {
    const stored = store.getImage(boardId, image);
    if (!stored) return notFound(reply);
    return reply
      .header('Content-Type', stored.mediaType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Content-Disposition', 'inline')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(stored.data);
  };

  app.post(
    '/v1/boards/:id/images',
    { bodyLimit: Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024 },
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return reply;
      const params = BoardIdSchema.safeParse(request.params);
      const body = ImageUploadSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send({ message: 'Choose a PNG, JPEG or WebP image.' });
      const board = store.getBoard(params.data.id);
      const editable =
        board &&
        (board.ownerId === user.id || (!board.archived && store.isEditor(board.id, user.id)));
      if (!editable)
        return board && readable(board.id, user)
          ? reply.code(403).send({ message: 'Only the owner and editors can add images.' })
          : reply.code(404).send({ message: 'Board not found.' });
      const data = Buffer.from(body.data.data, 'base64');
      const info = imageFileInfo(new Uint8Array(data));
      if (!info)
        return reply.code(400).send({
          message: `Choose a PNG, JPEG or WebP image up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
        });
      const id = createHash('sha256').update(data).digest('hex');
      if (store.saveImage(board.id, id, info, data) === 'full')
        return reply
          .code(409)
          .send({ message: `A board can hold up to ${MAX_BOARD_IMAGES} images.` });
      return reply.code(201).send({ id, ...info });
    },
  );

  app.get('/v1/boards/:id/images/:image', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const params = ImageParamsSchema.safeParse(request.params);
    if (!params.success || !readable(params.data.id, user)) return notFound(reply);
    return send(reply, params.data.id, params.data.image);
  });

  // A link or public board's images open for anyone, as the board itself does.
  app.get('/v1/guest/boards/:id/images/:image', async (request, reply) => {
    const params = ImageParamsSchema.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const board = store.getBoard(params.data.id);
    if (!board || board.archived || board.visibility === 'private') return notFound(reply);
    return send(reply, params.data.id, params.data.image);
  });
}

import { z } from 'zod';
import { BoardSnapshotSchema } from './board';

// HTTP request contracts shared by the Fastify compatibility server and Go host.
export const BoardIdSchema = z.object({ id: z.string().uuid() });
export const BoardCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    templateId: z.string().uuid().optional(),
  })
  .strict();
export const BoardUpdateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    archived: z.boolean().optional(),
    revision: z.number().int().positive(),
  })
  .strict()
  .refine(
    (body) =>
      body.archived === undefined || (body.title === undefined && body.visibility === undefined),
    'Archive separately from renaming or sharing.',
  );
export const BoardDeleteRequestSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const BoardDuplicateRequestSchema = z
  .object({
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(100).optional(),
    fromRevision: z.number().int().positive().optional(),
  })
  .strict();
export const BoardRevisionQuerySchema = z.object({
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export const BoardSaveRequestSchema = z
  .object({
    snapshot: BoardSnapshotSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const TemplateCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    boardId: z.string().uuid(),
    revision: z.number().int().positive(),
  })
  .strict();

/** Owners explicitly grant/revoke editing to an existing account on this server. */
export const BoardCollaboratorRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    enabled: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();

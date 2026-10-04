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
    revision: z.number().int().positive(),
  })
  .strict();
export const BoardDeleteRequestSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
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

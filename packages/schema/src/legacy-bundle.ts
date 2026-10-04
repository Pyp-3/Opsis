import { z } from 'zod';
import { BoardDocumentSchema } from './board';
export const LegacyBundleSchema = z
  .object({
    format: z.literal('opsis-legacy-bundle/v1'),
    boards: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            sourceId: z.string().max(200),
            board: BoardDocumentSchema,
          })
          .strict(),
      )
      .max(100)
      .refine(
        (boards) => new Set(boards.map((board) => board.id)).size === boards.length,
        'Bundle board IDs must be unique.',
      ),
    rejected: z
      .array(z.object({ sourceId: z.string().max(200), reason: z.string().max(300) }).strict())
      .max(10000),
  })
  .strict();

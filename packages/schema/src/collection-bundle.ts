import { z } from 'zod';
import { BoardDocumentSchema } from './board';
import { BoardTagsRequestSchema } from './board-organization';
import { BoardVisibilitySchema } from './board-requests';
import { mapBoardPages } from './board-pages';

export const CollectionBundleSchema = z
  .object({
    format: z.literal('opsis-collection'),
    version: z.literal(1),
    name: z.string().trim().min(1).max(60),
    boards: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().min(1).max(100),
            board: BoardDocumentSchema.nullable(),
            tags: z.array(z.string()).transform((tags, context) => {
              const result = BoardTagsRequestSchema.safeParse({ tags });
              if (!result.success) {
                context.addIssue({ code: 'custom', message: 'Invalid board tags.' });
                return z.NEVER;
              }
              return result.data.tags;
            }),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    (bundle) => new Set(bundle.boards.map((board) => board.id)).size === bundle.boards.length,
    'Duplicate board IDs.',
  );
export type CollectionBundle = z.infer<typeof CollectionBundleSchema>;
export const CollectionSharingSchema = z
  .object({
    boards: z
      .array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict())
      .max(1000),
    change: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('visibility'), visibility: BoardVisibilitySchema }).strict(),
      z
        .object({
          kind: z.literal('editor'),
          email: z.string().email().max(254),
          enabled: z.boolean(),
        })
        .strict(),
    ]),
  })
  .strict();
export type CollectionSharing = z.infer<typeof CollectionSharingSchema>;

/** Imported boards have fresh identity/history. Destinations outside the bundle are removed. */
export function prepareCollectionImport(input: unknown, ids: string[]) {
  const bundle = CollectionBundleSchema.parse(input);
  z.array(z.string().uuid()).length(bundle.boards.length).parse(ids);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => bundle.boards.some((board) => board.id === id))
  )
    throw new Error('Import requires fresh unique board IDs.');
  const mapping = new Map(bundle.boards.map((board, index) => [board.id, ids[index]!]));
  return bundle.boards.map((entry, index) => ({
    id: ids[index]!,
    title: entry.title,
    tags: entry.tags,
    snapshot: {
      board: entry.board
        ? mapBoardPages({ ...entry.board, title: entry.title }, (page) => ({
            ...page,
            nodes: page.nodes.map((node) => {
              const next = { ...node };
              delete next.linkedBoardId;
              const target = node.linkedBoardId && mapping.get(node.linkedBoardId);
              if (target) next.linkedBoardId = target;
              return next;
            }),
          }))
        : null,
      past: [],
      future: [],
    },
  }));
}

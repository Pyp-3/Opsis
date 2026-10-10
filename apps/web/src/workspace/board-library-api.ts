import { apiFetch as fetch } from '../app-url';
import { z } from 'zod';
import {
  BoardSnapshotSchema,
  BoardVisibilitySchema,
  BoardPageIdSchema,
  type BoardSnapshot,
  type BoardVisibility,
} from '@opsis/schema';

/** Fired when the API says the session has ended; the app returns to sign-in. */
export const AUTH_EXPIRED = 'opsis:auth-expired';
export type BoardAccess = 'owner' | 'editor' | 'viewer';

export const BoardEntrySchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  snapshot: BoardSnapshotSchema,
  savedSnapshot: BoardSnapshotSchema.optional(),
  /** `viewer` for someone else's link or public board: shown, never saved. */
  access: z.enum(['owner', 'editor', 'viewer']).optional(),
  owner: z.object({ name: z.string() }).optional(),
  visibility: BoardVisibilitySchema.optional(),
  /** In a tab's recovery copy: the hidden page whose link opened this board. */
  revealedPage: BoardPageIdSchema.optional(),
});
export const BoardListSchema = z.array(
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    revision: z.number(),
    updatedAt: z.number(),
    visibility: BoardVisibilitySchema.optional(),
    archived: z.boolean().optional(),
    /** The owner's private collection; `null` when unfiled. */
    collectionId: z.string().uuid().nullable().optional(),
    /** The owner's private tags. */
    tags: z.array(z.string()).optional(),
    /** Which agent produced the board, when it has content. */
    agent: z.string().nullable().optional(),
  }),
);

/** HTTP transport stays separate from the hook's save queue and conflict policy. */
export const boardLibraryApi = {
  list: () => fetch('/v1/boards'),
  /** `page` is a hidden page's link: viewers receive that page too. */
  read: (id: string, page?: string | null) =>
    fetch(`/v1/boards/${id}${page ? `?page=${encodeURIComponent(page)}` : ''}`),
  save: (id: string, snapshot: BoardSnapshot, revision: number) =>
    fetch(`/v1/boards/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot, revision }),
    }),
  manage: (
    action:
      'create' | 'rename' | 'delete' | 'share' | 'template' | 'duplicate' | 'archive' | 'unarchive',
    id: string | undefined,
    body: {
      title?: string | undefined;
      visibility?: BoardVisibility | undefined;
      revision?: number;
      templateId?: string;
      archived?: boolean;
      fromRevision?: number;
      collectionId?: string;
    },
  ) =>
    fetch(
      action === 'template'
        ? '/v1/templates'
        : action === 'create'
          ? '/v1/boards'
          : action === 'duplicate'
            ? `/v1/boards/${id}/duplicate`
            : `/v1/boards/${id}`,
      {
        method:
          action === 'create' || action === 'template' || action === 'duplicate'
            ? 'POST'
            : action === 'delete'
              ? 'DELETE'
              : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'template' ? { ...body, boardId: id } : body),
      },
    ),
};

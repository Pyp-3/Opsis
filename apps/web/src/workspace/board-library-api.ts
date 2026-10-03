import { z } from 'zod';
import { BoardSnapshotSchema, type BoardSnapshot } from '@opsis/schema';

/** Fired when the API says the session has ended; the app returns to sign-in. */
export const AUTH_EXPIRED = 'opsis:auth-expired';
export type BoardAccess = 'owner' | 'viewer';

export const BoardEntrySchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  snapshot: BoardSnapshotSchema,
  savedSnapshot: BoardSnapshotSchema.optional(),
  /** `viewer` for someone else's public board: shown, never saved. */
  access: z.enum(['owner', 'viewer']).optional(),
  owner: z.object({ name: z.string() }).optional(),
});
export const BoardListSchema = z.array(
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    revision: z.number(),
    updatedAt: z.number(),
    visibility: z.enum(['private', 'public']).optional(),
  }),
);

/** HTTP transport stays separate from the hook's save queue and conflict policy. */
export const boardLibraryApi = {
  list: () => fetch('/v1/boards'),
  read: (id: string) => fetch(`/v1/boards/${id}`),
  save: (id: string, snapshot: BoardSnapshot, revision: number) =>
    fetch(`/v1/boards/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot, revision }),
    }),
  manage: (
    action: 'create' | 'rename' | 'delete' | 'share',
    id: string | undefined,
    body: {
      title?: string | undefined;
      visibility?: 'private' | 'public' | undefined;
      revision?: number;
    },
  ) =>
    fetch(action === 'create' ? '/v1/boards' : `/v1/boards/${id}`, {
      method: action === 'create' ? 'POST' : action === 'delete' ? 'DELETE' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

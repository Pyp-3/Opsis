import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { SmartCollectionRuleSchema, type SmartCollectionRule } from '@opsis/schema';
import { AUTH_EXPIRED } from './board-library-api';

const CollectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.number(),
});
export type BoardCollection = z.infer<typeof CollectionSchema>;
const SmartCollectionSchema = CollectionSchema.extend({ rule: SmartCollectionRuleSchema });
export type SmartCollection = z.infer<typeof SmartCollectionSchema>;

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * The account's private board collections. Filing a board is organization, not an edit:
 * it never touches the board's revision, so it cannot conflict with an open canvas.
 * `onBoardsChanged` refreshes the library after a change to which boards are filed where.
 */
export function useBoardCollections(onBoardsChanged: () => Promise<unknown>) {
  const [collections, setCollections] = useState<BoardCollection[]>([]);
  const [smartCollections, setSmartCollections] = useState<SmartCollection[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [response, smart] = await Promise.all([
      fetch('/v1/collections'),
      fetch('/v1/smart-collections'),
    ]);
    if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
    if (!response.ok || !smart.ok) throw new Error('Could not load collections.');
    setCollections(z.array(CollectionSchema).parse(await response.json()));
    setSmartCollections(z.array(SmartCollectionSchema).parse(await smart.json()));
  }, []);
  useEffect(() => {
    // Async network completion synchronizes collections with their external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e: Error) => setError(e.message));
  }, [load]);

  /** Runs one request; reports its message on failure and refreshes what it changed. */
  const run = async (request: () => Promise<Response>, boardsChanged: boolean) => {
    setBusy(true);
    try {
      const response = await request();
      if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Collection change failed.');
      }
      const body: unknown = response.status === 204 ? null : await response.json();
      await load();
      if (boardsChanged) await onBoardsChanged();
      setError('');
      return { ok: true as const, body };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Collection change failed.');
      return { ok: false as const };
    } finally {
      setBusy(false);
    }
  };

  return {
    reload: load,
    collections,
    smartCollections,
    error,
    busy,
    async create(name: string) {
      const result = await run(() => fetch('/v1/collections', json('POST', { name })), false);
      return result.ok ? CollectionSchema.parse(result.body) : null;
    },
    async rename(id: string, name: string) {
      return (await run(() => fetch(`/v1/collections/${id}`, json('PATCH', { name })), false)).ok;
    },
    /** Removes the collection only; its boards stay in the library, unfiled. */
    async remove(id: string) {
      return (await run(() => fetch(`/v1/collections/${id}`, { method: 'DELETE' }), true)).ok;
    },
    async file(boardId: string, collectionId: string | null) {
      return (
        await run(
          () => fetch(`/v1/boards/${boardId}/collection`, json('PUT', { collectionId })),
          true,
        )
      ).ok;
    },
    /** Replaces a board's tags; like filing, this is not an edit to the board. */
    async tag(boardId: string, tags: string[]) {
      return (await run(() => fetch(`/v1/boards/${boardId}/tags`, json('PUT', { tags })), true)).ok;
    },
    /** Creates a smart collection, or replaces one's name and rule when `id` is given. */
    async saveSmart(name: string, rule: SmartCollectionRule, id?: string) {
      const result = await run(
        () =>
          fetch(
            id ? `/v1/smart-collections/${id}` : '/v1/smart-collections',
            json(id ? 'PUT' : 'POST', { name, rule }),
          ),
        false,
      );
      return result.ok ? SmartCollectionSchema.parse(result.body) : null;
    },
    /** Smart collections only filter; deleting one never touches boards. */
    async removeSmart(id: string) {
      return (await run(() => fetch(`/v1/smart-collections/${id}`, { method: 'DELETE' }), false))
        .ok;
    },
  };
}

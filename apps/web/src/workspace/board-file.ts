import { z } from 'zod';
import type { BoardDocument } from '@opsis/schema';
import { AUTH_EXPIRED } from './board-library-api';

/**
 * A board's editable JSON file. A filed board also names its collection beside the board
 * document, never inside it: collections are the account's private organization, not board
 * data, so the saved document stays unchanged and a file without the name is a plain board.
 * Collections travel by name, as in collection bundles, because ids differ between accounts.
 */
export function boardFileJson(board: BoardDocument, collection?: string) {
  return JSON.stringify(collection ? { ...board, collection } : board, null, 2);
}

const CollectionName = z.string().trim().min(1).max(60);

/** Separates a board file's collection name from the board itself, which is validated later. */
export function splitBoardFile(value: unknown): { board: unknown; collection?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('collection' in value))
    return { board: value };
  const { collection, ...board } = value as { collection: unknown };
  const name = CollectionName.safeParse(collection);
  return name.success ? { board, collection: name.data } : { board };
}

const Collections = z.array(z.object({ id: z.string().uuid(), name: z.string() }));

async function listCollections() {
  const response = await fetch('/v1/collections');
  if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
  if (!response.ok) throw new Error('Could not load collections.');
  return Collections.parse(await response.json());
}

/** The name of one of the account's collections, for its boards' exports. */
export async function collectionNameOf(collectionId: string) {
  return (await listCollections()).find((item) => item.id === collectionId)?.name;
}

async function failure(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  return new Error(payload.message ?? fallback);
}

/**
 * Files an imported board into the account's collection with this name, matched without regard
 * to case, creating the collection when there is none. Filing is not an edit to the board.
 */
export async function fileIntoCollectionNamed(boardId: string, name: string) {
  const json = (method: string, body: unknown) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let collection = (await listCollections()).find(
    (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (!collection) {
    const created = await fetch('/v1/collections', json('POST', { name }));
    if (!created.ok) throw await failure(created, 'Could not create the collection.');
    collection = Collections.element.parse(await created.json());
  }
  const filed = await fetch(
    `/v1/boards/${boardId}/collection`,
    json('PUT', { collectionId: collection.id }),
  );
  if (!filed.ok) throw await failure(filed, 'Could not file the board.');
  return collection.name;
}

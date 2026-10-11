import { apiFetch as fetch } from '../app-url';
import { z } from 'zod';
import { BundledImagesSchema, type BoardDocument, type BundledImage } from '@opsis/schema';
import { AUTH_EXPIRED } from './board-library-api';

/**
 * A board's editable JSON file. A filed board also names its collection beside the board
 * document, never inside it: collections are the account's private organization, not board
 * data, so the saved document stays unchanged and a file without the name is a plain board.
 * Collections travel by name, as in collection bundles, because ids differ between accounts.
 * The pictures its pages show travel beside it too, as `images`, so the file is complete on
 * any server.
 */
export function boardFileJson(
  board: BoardDocument,
  collection?: string,
  images: readonly BundledImage[] = [],
) {
  return JSON.stringify(
    {
      ...board,
      ...(collection ? { collection } : {}),
      ...(images.length ? { images } : {}),
    },
    null,
    2,
  );
}

const CollectionName = z.string().trim().min(1).max(60);

/**
 * Separates a board file's collection name and pictures from the board itself, which is
 * validated later. Pictures that are not well formed are dropped; the server checks the rest.
 */
export function splitBoardFile(value: unknown): {
  board: unknown;
  collection?: string;
  images: BundledImage[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { board: value, images: [] };
  const { collection, images, ...board } = value as { collection?: unknown; images?: unknown };
  const name = CollectionName.safeParse(collection);
  const pictures = images === undefined ? null : BundledImagesSchema.safeParse(images);
  return {
    board,
    ...(name.success ? { collection: name.data } : {}),
    images: pictures?.success ? pictures.data : [],
  };
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

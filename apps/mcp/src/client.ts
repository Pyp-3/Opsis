import { z } from 'zod';
import { BoardSnapshotSchema, BoardVisibilitySchema, type BoardSnapshot } from '@opsis/schema';
import { CanvasError } from './canvas.js';

const Entry = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  snapshot: BoardSnapshotSchema,
  access: z.enum(['owner', 'editor', 'viewer']).optional(),
  owner: z.object({ name: z.string() }).optional(),
});
export type BoardEntry = z.infer<typeof Entry>;
const List = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    revision: z.number(),
    updatedAt: z.number(),
    visibility: BoardVisibilitySchema,
    ownerName: z.string().optional(),
    archived: z.boolean().optional(),
    collectionId: z.string().nullable().optional(),
  }),
);
const Collection = z.object({ id: z.string().uuid(), name: z.string() });
const SearchResults = z.object({
  results: z.array(
    z.object({
      boardId: z.string(),
      boardTitle: z.string(),
      access: z.enum(['owner', 'editor']),
      conceptId: z.string().optional(),
      label: z.string(),
      field: z.string(),
      snippet: z.string(),
    }),
  ),
});
const NO_KEY =
  'No agent key. In Opsis open Account → Agent keys, create one, and set it as OPSIS_AGENT_KEY for this MCP server.';
const REJECTED_KEY =
  'Opsis rejected the agent key: it was revoked, or this request did not come straight from this machine. Create a new key under Account → Agent keys.';

/**
 * Talks to the same local API the web app saves through, so an agent's edit is an ordinary
 * saved revision: an open canvas pulls it within a couple of seconds and can undo it.
 */
const RenderedImage = z.object({ mimeType: z.literal('image/png'), data: z.string() });

export function opsisClient(
  base: string,
  agentKey: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  async function call(path: string, init?: RequestInit) {
    if (!agentKey) throw new CanvasError(NO_KEY);
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${agentKey}`,
          ...init?.headers,
        },
      });
    } catch {
      throw new CanvasError(
        `Opsis is not reachable at ${base}. Start Opsis (or set OPSIS_API_URL).`,
      );
    }
    if (response.status === 401) throw new CanvasError(REJECTED_KEY);
    return response;
  }
  async function failure(response: Response, fallback: string) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    return new CanvasError(payload.message ?? fallback);
  }

  const get = async (id: string): Promise<BoardEntry> => {
    const response = await call(`/v1/boards/${encodeURIComponent(id)}`);
    if (response.status === 404) throw new CanvasError(`No board with id ${id}.`);
    if (!response.ok) throw await failure(response, 'Could not read the board.');
    return Entry.parse(await response.json());
  };

  return {
    async list() {
      const response = await call('/v1/boards');
      if (!response.ok) throw await failure(response, 'Could not list boards.');
      return List.parse(await response.json());
    },
    get,
    /** Other people's public boards; readable, never writable. */
    async listPublic() {
      const response = await call('/v1/boards/public');
      if (!response.ok) throw await failure(response, 'Could not list public boards.');
      return List.parse(await response.json());
    },
    /** Keyword search over the boards this account owns or edits, best first. */
    async search(query: string) {
      const response = await call(`/v1/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw await failure(response, 'Could not search boards.');
      return SearchResults.parse(await response.json()).results;
    },
    async create(title: string, collectionId?: string): Promise<BoardEntry> {
      const response = await call('/v1/boards', {
        method: 'POST',
        body: JSON.stringify({ title, ...(collectionId ? { collectionId } : {}) }),
      });
      if (!response.ok) throw await failure(response, 'Could not create the board.');
      return Entry.parse(await response.json());
    },
    /** The account's private collections, by name. */
    async listCollections() {
      const response = await call('/v1/collections');
      if (!response.ok) throw await failure(response, 'Could not list collections.');
      return z.array(Collection).parse(await response.json());
    },
    async createCollection(name: string) {
      const response = await call('/v1/collections', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw await failure(response, 'Could not create the collection.');
      return Collection.parse(await response.json());
    },
    /**
     * Files an owned board into one collection, or none with `null`. Filing is organization,
     * not an edit: the board's revision and undo history are unchanged.
     */
    async fileBoard(boardId: string, collectionId: string | null) {
      const response = await call(`/v1/boards/${encodeURIComponent(boardId)}/collection`, {
        method: 'PUT',
        body: JSON.stringify({ collectionId }),
      });
      if (response.status === 404) {
        const { message } = (await response.json().catch(() => ({}))) as { message?: string };
        throw new CanvasError(
          message === 'Collection not found.'
            ? `No collection with id ${collectionId}. List them with opsis_list_collections.`
            : `No board with id ${boardId} that this account owns; only owners file boards.`,
        );
      }
      if (!response.ok) throw await failure(response, 'Could not file the board.');
    },
    /**
     * Rasterises a board preview to PNG on the Opsis host. Null when this host cannot render
     * images (an older host, or a desktop running without its local Node service).
     */
    async render(svg: string): Promise<{ mimeType: string; data: string } | null> {
      const response = await call('/v1/render', { method: 'POST', body: JSON.stringify({ svg }) });
      if (response.status === 404 || response.status === 503) return null;
      if (!response.ok) throw await failure(response, 'Could not render the preview.');
      return RenderedImage.parse(await response.json());
    },
    /**
     * Reads the latest revision, applies `change` and saves it. If someone saved in between
     * (the reader dragging a concept, say), it re-reads and re-applies rather than overwriting.
     */
    async edit<T>(
      id: string,
      change: (snapshot: BoardSnapshot) => { snapshot: BoardSnapshot; result: T },
    ): Promise<{ revision: number; snapshot: BoardSnapshot; result: T }> {
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await get(id);
        const { snapshot, result } = change(current.snapshot);
        const response = await call(`/v1/boards/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ snapshot, revision: current.revision }),
        });
        if (response.status === 409) continue;
        if (response.status === 403)
          throw new CanvasError('This board belongs to someone else; agents can only read it.');
        if (!response.ok) throw await failure(response, 'Could not save the board.');
        const saved = (await response.json()) as { revision: number };
        return { revision: saved.revision, snapshot, result };
      }
      throw new CanvasError('The board kept changing while saving. Try again.');
    },
  };
}
export type OpsisClient = ReturnType<typeof opsisClient>;

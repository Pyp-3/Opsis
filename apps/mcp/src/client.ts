import { z } from 'zod';
import { BoardSnapshotSchema, type BoardSnapshot } from '@opsis/schema';
import { CanvasError } from './canvas.js';

const Entry = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  snapshot: BoardSnapshotSchema,
});
export type BoardEntry = z.infer<typeof Entry>;
const List = z.array(
  z.object({ id: z.string(), title: z.string(), revision: z.number(), updatedAt: z.number() }),
);

/**
 * Talks to the same local API the web app saves through, so an agent's edit is an ordinary
 * saved revision: an open canvas pulls it within a couple of seconds and can undo it.
 */
export function opsisClient(base: string, fetcher: typeof fetch = fetch) {
  async function call(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    } catch {
      throw new CanvasError(
        `Opsis is not reachable at ${base}. Start it with \`pnpm dev\` (or set OPSIS_API_URL).`,
      );
    }
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
    async create(title: string): Promise<BoardEntry> {
      const response = await call('/v1/boards', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw await failure(response, 'Could not create the board.');
      return Entry.parse(await response.json());
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
        if (!response.ok) throw await failure(response, 'Could not save the board.');
        const saved = (await response.json()) as { revision: number };
        return { revision: saved.revision, snapshot, result };
      }
      throw new CanvasError('The board kept changing while saving. Try again.');
    },
  };
}
export type OpsisClient = ReturnType<typeof opsisClient>;

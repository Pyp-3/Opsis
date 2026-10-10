import type { FastifyRequest } from 'fastify';
import { LRUCache } from 'lru-cache';
import { narrationLines } from '@opsis/schema';
import type { ApiStore } from './storage.js';
import type { NarrationSource } from './speech.js';

/**
 * Who may use the server's narrator, and for what. Signed-in members may have any line spoken,
 * as they may already run agents. Everyone else (people opening a shared link without an account,
 * and restricted guest accounts) only hears the script of a board they can open: a sentence the
 * player would speak for that board, on the pages they may see. Nothing else reaches the model.
 */
export function narrationAccess(store: ApiStore) {
  // Scripts by board revision and revealed page, so a played board is not re-read per sentence.
  const scripts = new LRUCache<string, Set<string>>({ max: 200 });
  return (request: FastifyRequest, text: string, source: NarrationSource | undefined) => {
    if (request.user && request.user.role !== 'guest') return true;
    if (!source) return false;
    const board = store.getBoard(source.id);
    if (!board?.snapshot.board || board.archived || board.visibility === 'private') return false;
    const key = `${board.id}:${board.revision}:${source.page ?? ''}`;
    let lines = scripts.get(key);
    if (!lines) {
      lines = narrationLines(board.snapshot.board, source.page);
      scripts.set(key, lines);
    }
    return lines.has(text);
  };
}

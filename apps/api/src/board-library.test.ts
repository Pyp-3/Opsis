import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { buildApp } from './app.js';

const board = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
const snapshot = { board, past: [null], future: [] };
describe('SQLite v2 library', () => {
  it('creates empty named boards, renames with history, and rejects stale deletes and resurrection', async () => {
    const app = buildApp({ databasePath: ':memory:', llm: null });
    try {
      for (const title of ['', ' ', 'x'.repeat(101)])
        expect(
          (await app.inject({ method: 'POST', url: '/v1/boards', payload: { title } })).statusCode,
        ).toBe(400);
      const create = await app.inject({
        method: 'POST',
        url: '/v1/boards',
        payload: { title: 'Empty board' },
      });
      expect(create.statusCode).toBe(201);
      const entry = create.json();
      expect(entry.snapshot.board.nodes).toEqual([]);
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/v1/boards/${entry.id}`,
        payload: { title: 'Renamed', revision: entry.revision },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().snapshot.past[0].title).toBe('Empty board');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/boards/${entry.id}`,
            payload: { revision: entry.revision },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/boards/${entry.id}`,
            payload: { revision: renamed.json().revision },
          })
        ).statusCode,
      ).toBe(204);
      expect((await app.inject(`/v1/boards/${entry.id}`)).statusCode).toBe(404);
      expect((await app.inject('/v1/boards')).json()).toEqual([]);
      for (const revision of [0, entry.revision, renamed.json().revision])
        expect(
          (
            await app.inject({
              method: 'PUT',
              url: `/v1/boards/${entry.id}`,
              payload: { snapshot: entry.snapshot, revision },
            })
          ).statusCode,
        ).toBe(409);
    } finally {
      await app.close();
    }
  });
  it('keeps independent boards and history across restart; rejects stale writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsis-library-test-'));
    let app = buildApp({ databasePath: join(directory, 'boards.sqlite'), llm: null });
    try {
      const first = randomUUID(),
        second = randomUUID();
      for (const id of [first, second]) {
        const response = await app.inject({
          method: 'PUT',
          url: `/v1/boards/${id}`,
          payload: { snapshot, revision: 0 },
        });
        expect(response.statusCode).toBe(200);
      }
      await app.close();
      app = buildApp({ databasePath: join(directory, 'boards.sqlite'), llm: null });
      expect((await app.inject('/v1/boards')).json()).toHaveLength(2);
      const restored = (await app.inject(`/v1/boards/${first}`)).json();
      expect(restored.snapshot).toEqual(snapshot);
      expect(restored.revision).toBe(1);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/v1/boards/${first}`,
            payload: {
              snapshot: { ...snapshot, board: { ...board, title: 'Unwanted overwrite' } },
              revision: 0,
            },
          })
        ).statusCode,
      ).toBe(409);
      expect((await app.inject(`/v1/boards/${first}`)).json()).toEqual(restored);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/v1/boards/${first}`,
            payload: { snapshot: { ...snapshot, board: { invalid: true } }, revision: 1 },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from './app';

type Method = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';

async function accounts(app: ReturnType<typeof buildApp>) {
  const signup = async (email: string) => {
    const result = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { name: email, email, password: 'correct horse' },
    });
    return String(result.headers['set-cookie']).split(';')[0]!;
  };
  const owner = await signup('collector@example.com');
  const stranger = await signup('stranger@example.com');
  const request = (cookie: string, method: Method, url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  return { owner, stranger, request };
}

describe('board collections', () => {
  it('files owned boards privately without changing revisions, and ungroups on delete', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null });
    try {
      const { owner, stranger, request } = await accounts(app);
      for (const name of ['', ' ', 'x'.repeat(61)])
        expect((await request(owner, 'POST', '/v1/collections', { name })).statusCode).toBe(400);
      const work = await request(owner, 'POST', '/v1/collections', { name: 'Work' });
      expect(work.statusCode).toBe(201);
      const collection = work.json();
      expect(collection).toMatchObject({ name: 'Work' });
      expect((await request(owner, 'POST', '/v1/collections', { name: 'work' })).statusCode).toBe(
        409,
      );
      // Collections are private to their account.
      expect((await request(stranger, 'GET', '/v1/collections')).json()).toEqual([]);
      expect(
        (await request(stranger, 'PATCH', `/v1/collections/${collection.id}`, { name: 'Mine' }))
          .statusCode,
      ).toBe(404);
      expect(
        (await request(stranger, 'DELETE', `/v1/collections/${collection.id}`)).statusCode,
      ).toBe(404);

      const filed = (
        await request(owner, 'POST', '/v1/boards', {
          title: 'Filed at creation',
          collectionId: collection.id,
        })
      ).json();
      const loose = (await request(owner, 'POST', '/v1/boards', { title: 'Loose' })).json();
      const before = (await request(owner, 'GET', '/v1/boards')).json();
      expect(before.find((entry: { id: string }) => entry.id === filed.id).collectionId).toBe(
        collection.id,
      );
      expect(before.find((entry: { id: string }) => entry.id === loose.id).collectionId).toBe(null);

      // Moving is organization, not an edit: no revision, update time or undo step changes.
      expect(
        (
          await request(owner, 'PUT', `/v1/boards/${loose.id}/collection`, {
            collectionId: collection.id,
          })
        ).statusCode,
      ).toBe(200);
      const moved = (await request(owner, 'GET', `/v1/boards/${loose.id}`)).json();
      expect(moved.revision).toBe(loose.revision);
      expect(moved.snapshot).toEqual(loose.snapshot);
      const after = (await request(owner, 'GET', '/v1/boards')).json();
      const movedEntry = after.find((entry: { id: string }) => entry.id === loose.id);
      expect(movedEntry).toMatchObject({ collectionId: collection.id, revision: loose.revision });
      expect(movedEntry.updatedAt).toBe(
        before.find((entry: { id: string }) => entry.id === loose.id).updatedAt,
      );

      // Strangers cannot file someone else's board or use someone else's collection.
      expect(
        (
          await request(stranger, 'PUT', `/v1/boards/${loose.id}/collection`, {
            collectionId: null,
          })
        ).statusCode,
      ).toBe(404);
      const theirs = (await request(stranger, 'POST', '/v1/boards', { title: 'Theirs' })).json();
      expect(
        (
          await request(stranger, 'PUT', `/v1/boards/${theirs.id}/collection`, {
            collectionId: collection.id,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await request(stranger, 'POST', '/v1/boards', {
            title: 'Sneaky',
            collectionId: collection.id,
          })
        ).statusCode,
      ).toBe(404);

      // A copy is filed beside its source.
      const copy = (
        await request(owner, 'POST', `/v1/boards/${filed.id}/duplicate`, {
          revision: filed.revision,
        })
      ).json();
      expect(
        (await request(owner, 'GET', '/v1/boards'))
          .json()
          .find((entry: { id: string }) => entry.id === copy.id).collectionId,
      ).toBe(collection.id);

      const renamed = await request(owner, 'PATCH', `/v1/collections/${collection.id}`, {
        name: 'Projects',
      });
      expect(renamed.json()).toMatchObject({ id: collection.id, name: 'Projects' });

      // Deleting a collection never deletes its boards.
      expect((await request(owner, 'DELETE', `/v1/collections/${collection.id}`)).statusCode).toBe(
        204,
      );
      const remaining = (await request(owner, 'GET', '/v1/boards')).json();
      expect(remaining).toHaveLength(3);
      expect(remaining.every((entry: { collectionId: null }) => entry.collectionId === null)).toBe(
        true,
      );
      expect((await request(owner, 'GET', '/v1/collections')).json()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('keeps collections and filing across a restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsis-collections-test-'));
    const databasePath = join(directory, 'boards.sqlite');
    let app = buildApp({ databasePath, speech: null });
    try {
      const { owner, request } = await accounts(app);
      const collection = (
        await request(owner, 'POST', '/v1/collections', { name: 'Research' })
      ).json();
      const board = (
        await request(owner, 'POST', '/v1/boards', {
          title: 'Kept',
          collectionId: collection.id,
        })
      ).json();
      await app.close();
      app = buildApp({ databasePath, speech: null });
      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'collector@example.com', password: 'correct horse' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const get = (url: string) => app.inject({ url, headers: { cookie } });
      expect((await get('/v1/collections')).json()).toEqual([
        expect.objectContaining({ id: collection.id, name: 'Research' }),
      ]);
      expect((await get('/v1/boards')).json()).toEqual([
        expect.objectContaining({ id: board.id, collectionId: collection.id }),
      ]);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

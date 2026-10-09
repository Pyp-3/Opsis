import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildApp } from './app';

it('keeps chats account-private, rejects agent access, and respects board revocation', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null });
  try {
    const signup = async (email: string) =>
      String(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/auth/signup',
            payload: { email, name: email, password: 'correct horse' },
          })
        ).headers['set-cookie'],
      ).split(';')[0]!;
    const owner = await signup('owner@example.com'),
      editor = await signup('editor@example.com');
    const call = (
      cookie: string,
      method: 'POST' | 'GET' | 'PUT' | 'DELETE',
      url: string,
      payload?: object,
    ) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const board = (await call(owner, 'POST', '/v1/boards', { title: 'Private' })).json();
    const path = `/v1/boards/${board.id}/chat`;
    expect((await call(editor, 'GET', path)).statusCode).toBe(404);
    await call(owner, 'PUT', `/v1/boards/${board.id}/editors`, {
      email: 'editor@example.com',
      enabled: true,
      revision: board.revision,
    });
    const thread = {
      id: randomUUID(),
      agent: 'demo',
      model: 'built-in',
      messages: [{ role: 'user', text: 'My private question' }],
    };
    expect((await call(owner, 'PUT', path, { revision: 0, thread })).statusCode).toBe(200);
    expect((await call(editor, 'GET', path)).json()).toEqual([]);
    expect((await call(editor, 'DELETE', `${path}/${thread.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'GET', path)).json()).toHaveLength(1);
    expect((await call(owner, 'PUT', path, { revision: 0, thread })).statusCode).toBe(409);
    expect(
      (await call(owner, 'PUT', path, { revision: 1, thread: { ...thread, model: 'other' } }))
        .statusCode,
    ).toBe(409);
    const key = (await call(owner, 'POST', '/v1/auth/agent-keys', { name: 'Fixture agent' })).json()
      .key;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: path,
          remoteAddress: '127.0.0.1',
          headers: { authorization: `Bearer ${key}` },
        })
      ).statusCode,
    ).toBe(401);
    expect((await call(editor, 'PUT', path, { revision: 0, thread })).statusCode).toBe(200);
    await call(owner, 'PUT', `/v1/boards/${board.id}/editors`, {
      email: 'editor@example.com',
      enabled: false,
      revision: board.revision,
    });
    expect((await call(editor, 'GET', path)).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

it("removes each account's native CLI sessions when its thread or the board is deleted", async () => {
  const removed: string[][] = [];
  const app = buildApp({
    databasePath: ':memory:',
    speech: null,
    removeThreadSessions: async (keys) => void removed.push([...keys]),
  });
  try {
    const signup = async (email: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: { email, name: email, password: 'correct horse' },
      });
      return {
        cookie: String(response.headers['set-cookie']).split(';')[0]!,
        id: (response.json() as { user: { id: string } }).user.id,
      };
    };
    const owner = await signup('owner@example.com'),
      editor = await signup('editor@example.com');
    const call = (
      cookie: string,
      method: 'POST' | 'PUT' | 'DELETE',
      url: string,
      payload?: object,
    ) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const board = (await call(owner.cookie, 'POST', '/v1/boards', { title: 'Shared' })).json();
    await call(owner.cookie, 'PUT', `/v1/boards/${board.id}/editors`, {
      email: 'editor@example.com',
      enabled: true,
      revision: board.revision,
    });
    const path = `/v1/boards/${board.id}/chat`;
    const thread = () => ({
      id: randomUUID(),
      agent: 'demo',
      model: 'built-in',
      messages: [{ role: 'user', text: 'Explain this' }],
    });
    const [first, second, theirs] = [thread(), thread(), thread()];
    for (const [who, item] of [
      [owner, first],
      [owner, second],
      [editor, theirs],
    ] as const)
      expect((await call(who.cookie, 'PUT', path, { revision: 0, thread: item })).statusCode).toBe(
        200,
      );
    expect((await call(owner.cookie, 'DELETE', `${path}/${first.id}`)).statusCode).toBe(204);
    expect(removed).toEqual([[`${owner.id}/${first.id}`]]);
    // Deleting the board takes every account's threads on it, so their sessions go too.
    const current = (
      await app.inject({ url: `/v1/boards/${board.id}`, headers: { cookie: owner.cookie } })
    ).json();
    expect(
      (
        await call(owner.cookie, 'DELETE', `/v1/boards/${board.id}`, {
          revision: current.revision,
        })
      ).statusCode,
    ).toBe(204);
    expect(removed[1]?.sort()).toEqual(
      [`${owner.id}/${second.id}`, `${editor.id}/${theirs.id}`].sort(),
    );
  } finally {
    await app.close();
  }
});

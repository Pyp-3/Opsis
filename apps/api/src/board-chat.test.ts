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

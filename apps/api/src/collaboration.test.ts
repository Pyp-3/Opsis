import { it, expect } from 'vitest';
import { buildApp } from './app';
it('requires owner invitations, preserves revision conflicts, and revokes editing immediately', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null });
  const signup = async (email: string) => {
    const result = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { name: email, email, password: 'correct horse' },
    });
    return String(result.headers['set-cookie']).split(';')[0]!;
  };
  try {
    const owner = await signup('owner@example.com'),
      editor = await signup('editor@example.com'),
      stranger = await signup('stranger@example.com');
    const request = (
      cookie: string,
      method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
      url: string,
      payload?: object,
    ) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const created = (
      await request(owner, 'POST', '/v1/boards', { title: 'Shared project' })
    ).json();
    const path = `/v1/boards/${created.id}`;
    expect((await request(editor, 'GET', path)).statusCode).toBe(404);
    expect(
      (
        await request(editor, 'PUT', path + '/editors', {
          revision: 1,
          email: 'stranger@example.com',
          enabled: true,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(owner, 'PUT', path + '/editors', {
          revision: 1,
          email: 'editor@example.com',
          enabled: true,
        })
      ).statusCode,
    ).toBe(200);
    expect((await request(editor, 'GET', path)).json().access).toBe('editor');
    expect((await request(editor, 'GET', '/v1/boards/shared')).json()).toHaveLength(1);
    const snapshot = created.snapshot;
    snapshot.board.title = 'Editor changed content';
    expect((await request(editor, 'PUT', path, { revision: 1, snapshot })).statusCode).toBe(200);
    expect((await request(owner, 'PUT', path, { revision: 1, snapshot })).statusCode).toBe(409);
    for (const endpoint of ['/editors', '/revisions'])
      expect((await request(editor, 'GET', path + endpoint)).statusCode).toBe(404);
    expect((await request(editor, 'DELETE', path, { revision: 2 })).statusCode).toBe(404);
    expect((await request(stranger, 'GET', path)).statusCode).toBe(404);
    expect(
      (
        await request(owner, 'PUT', path + '/editors', {
          revision: 2,
          email: 'editor@example.com',
          enabled: false,
        })
      ).statusCode,
    ).toBe(200);
    expect((await request(editor, 'PUT', path, { revision: 2, snapshot })).statusCode).toBe(404);
    expect((await request(owner, 'GET', path)).json()).toMatchObject({ access: 'owner', snapshot });
  } finally {
    await app.close();
  }
});

import { it, expect } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { buildApp } from './app';

it('searches owned and invited boards only, never others or archives', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null });
  try {
    const signup = async (email: string) => {
      const result = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: { name: email, email, password: 'correct horse' },
      });
      return String(result.headers['set-cookie']).split(';')[0]!;
    };
    const ada = await signup('ada-search@example.com');
    const bob = await signup('bob-search@example.com');
    const call = (
      cookie: string,
      method: 'GET' | 'PUT' | 'POST' | 'PATCH',
      url: string,
      payload?: object,
    ) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const board = { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} };
    const save = async (cookie: string, title: string) => {
      const created = (await call(cookie, 'POST', '/v1/boards', { title })).json();
      return (
        await call(cookie, 'PUT', `/v1/boards/${created.id}`, {
          snapshot: { board: { ...board, title }, past: [], future: [] },
          revision: created.revision,
        })
      ).json() as { id: string; revision: number };
    };
    const mine = await save(ada, 'My email journey');
    const theirs = await save(bob, 'Bob email journey');
    const invited = await save(bob, 'Shared email journey');
    expect(
      (
        await call(bob, 'PUT', `/v1/boards/${invited.id}/editors`, {
          email: 'ada-search@example.com',
          enabled: true,
          revision: invited.revision,
        })
      ).statusCode,
    ).toBe(200);
    // Public boards stay out of search; only boards you own or edit are searched.
    await call(bob, 'PATCH', `/v1/boards/${theirs.id}`, {
      visibility: 'public',
      revision: theirs.revision,
    });
    const concept = EMAIL_DEMO.nodes[0]!.label;
    const results = (await call(ada, 'GET', `/v1/search?q=${encodeURIComponent(concept)}`)).json()
      .results as { boardId: string; access: string; conceptId?: string }[];
    expect(new Set(results.map((hit) => hit.boardId))).toEqual(new Set([mine.id, invited.id]));
    expect(results.find((hit) => hit.boardId === invited.id)?.access).toBe('editor');
    expect(results.some((hit) => hit.conceptId === EMAIL_DEMO.nodes[0]!.id)).toBe(true);

    await call(ada, 'PATCH', `/v1/boards/${mine.id}`, { archived: true, revision: mine.revision });
    const afterArchive = (
      await call(ada, 'GET', `/v1/search?q=${encodeURIComponent(concept)}`)
    ).json().results as { boardId: string }[];
    expect(afterArchive.every((hit) => hit.boardId === invited.id)).toBe(true);
    expect((await call(ada, 'GET', '/v1/search?q=a')).statusCode).toBe(400);
    expect((await app.inject('/v1/search?q=email')).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});

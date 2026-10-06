import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { MAX_USAGE_RECORDS } from '@opsis/schema';
import { buildApp } from './app';

const usage = (at: number, boardId?: string) => ({
  id: randomUUID(),
  at,
  agent: 'claude',
  model: 'haiku',
  effort: 'low',
  purpose: 'diagram',
  ...(boardId ? { boardId } : {}),
  attempts: [
    {
      inputTokens: 10,
      outputTokens: null,
      cachedInputTokens: null,
      cacheWriteTokens: null,
      estimatedCostUSD: 0.01,
    },
  ],
});

it('keeps validated settings and bounded usage per account, not per browser', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null, rateLimit: 10_000 });
  try {
    const signup = async (email: string) => {
      const result = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: { name: email, email, password: 'correct horse' },
      });
      return String(result.headers['set-cookie']).split(';')[0]!;
    };
    const ada = await signup('ada@example.com');
    const bob = await signup('bob@example.com');
    const call = (
      cookie: string,
      method: 'GET' | 'PUT' | 'POST' | 'DELETE',
      url: string,
      payload?: object,
    ) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

    const preferences = { claude: { model: 'sonnet', effort: 'medium' } };
    expect(
      (await call(ada, 'PUT', '/v1/account/settings/model-preferences', { value: preferences }))
        .statusCode,
    ).toBe(204);
    for (const [key, value] of [
      ['model-preferences', { claude: { model: '', effort: 'low' } }],
      ['model-profiles', 'not a list'],
      ['unknown-key', {}],
      ['provider-limits', { enabled: true, caps: {} }],
    ] as const)
      expect((await call(ada, 'PUT', `/v1/account/settings/${key}`, { value })).statusCode).toBe(
        400,
      );
    expect((await call(ada, 'GET', '/v1/account/settings')).json()).toEqual({
      values: { 'model-preferences': preferences },
    });
    expect((await call(bob, 'GET', '/v1/account/settings')).json()).toEqual({ values: {} });

    const boardId = randomUUID();
    expect((await call(ada, 'POST', '/v1/account/usage', usage(1, boardId))).statusCode).toBe(204);
    expect(
      (await call(ada, 'POST', '/v1/account/usage', { ...usage(2), attempts: 'x' })).statusCode,
    ).toBe(400);
    const listed = (await call(ada, 'GET', '/v1/account/usage')).json();
    expect(listed).toEqual([expect.objectContaining({ boardId, at: 1 })]);
    // A missing measurement stays null; it is never stored as zero.
    expect(listed[0].attempts[0].outputTokens).toBeNull();
    expect((await call(bob, 'GET', '/v1/account/usage')).json()).toEqual([]);

    for (let at = 2; at <= MAX_USAGE_RECORDS + 1; at++)
      await call(ada, 'POST', '/v1/account/usage', usage(at));
    const kept = (await call(ada, 'GET', '/v1/account/usage')).json();
    expect(kept).toHaveLength(MAX_USAGE_RECORDS);
    expect(kept[0].at).toBe(2);
    expect((await call(ada, 'DELETE', '/v1/account/usage')).statusCode).toBe(204);
    expect((await call(ada, 'GET', '/v1/account/usage')).json()).toEqual([]);
  } finally {
    await app.close();
  }
});

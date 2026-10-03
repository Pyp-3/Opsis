import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { signIn } from './test-session.js';

describe('Opsis API', () => {
  it('reports health without an account or speech model', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null });
    try {
      const response = await app.inject('/v1/health');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('no longer serves retired pipeline routes', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null });
    try {
      const id = '00000000-0000-4000-8000-000000000000';
      for (const route of [
        { method: 'POST', url: '/v1/visualize' },
        { method: 'POST', url: '/v1/explain' },
        { method: 'POST', url: '/v1/drilldown' },
        { method: 'GET', url: '/v1/osg/' + id },
        { method: 'PUT', url: '/v1/osg/' + id },
        { method: 'POST', url: '/v1/share/' + id },
        { method: 'GET', url: '/v1/shared/' + 'A'.repeat(32) },
      ] as const) {
        expect((await app.inject(route)).statusCode).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});

describe('rate limiting', () => {
  it('bounds board polling separately without consuming the edit/model allowance', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null, rateLimit: 1 });
    await signIn(app);
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: 'GET', url: '/v1/boards' })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/boards' })).statusCode).toBe(429);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/boards', payload: { title: 'New board' } }))
        .statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/boards', payload: { title: 'Another board' } }))
        .statusCode,
    ).toBe(429);
    await app.close();
  });
  it('limits each client with the shared error shape', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null, rateLimit: 1 });
    await signIn(app);
    await app.inject({ method: 'GET', url: '/v1/boards/public' });
    const response = await app.inject({ method: 'GET', url: '/v1/boards/public' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      code: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again soon.',
      stage: 'request',
      retryable: true,
    });
    await app.close();
  });

  it('keeps the authentication budget separate from board work', async () => {
    const app = buildApp({ databasePath: ':memory:', speech: null, rateLimit: 1 });
    await signIn(app);
    // Sign-up consumed this window's authentication allowance.
    expect((await app.inject('/v1/auth/me')).statusCode).toBe(429);
    expect((await app.inject('/v1/boards/public')).statusCode).toBe(200);
    expect((await app.inject('/v1/health')).statusCode).toBe(200);
    await app.close();
  });
});

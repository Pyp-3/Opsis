import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /v1/health', () => {
  const app = buildApp();
  afterAll(() => app.close());

  it('returns status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProviderKeys } from './provider-keys';
import { buildApp } from './app';

it('keeps instance keys across restart and honours environment overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'opsis-keys-'));
  try {
    const path = join(directory, 'test.sqlite');
    const keys = new ProviderKeys(path, {});
    keys.set('kimi', 'fixture-secret');
    expect(new ProviderKeys(path, {}).get('kimi')).toBe('fixture-secret');
    const overridden = new ProviderKeys(path, { OPSIS_KIMI_API_KEY: 'fixture-environment' });
    expect(overridden.get('kimi')).toBe('fixture-environment');
    overridden.set('kimi');
    expect(overridden.get('kimi')).toBe('fixture-environment');
    expect(new ProviderKeys(path, {}).get('kimi')).toBeUndefined();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('shares status across accounts without returning secrets or exporting account settings', async () => {
  const app = buildApp({ databasePath: ':memory:', speech: null });
  try {
    const url = '/v1/instance/provider-keys';
    expect((await app.inject(url)).statusCode).toBe(401);
    const cookies: string[] = [];
    for (const name of ['one', 'two']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: { name, email: `${name}@example.com`, password: 'correct horse' },
      });
      cookies.push(String(response.headers['set-cookie']).split(';')[0]!);
    }
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `${url}/kimi`,
          headers: { cookie: cookies[0]! },
          payload: { key: 'fixture-secret' },
        })
      ).statusCode,
    ).toBe(204);
    const status = await app.inject({ url, headers: { cookie: cookies[1]! } });
    expect(status.json()).toContainEqual({ id: 'kimi', configured: true, source: 'instance' });
    expect(status.body).not.toContain('fixture-secret');
    expect(
      (await app.inject({ url: '/v1/account/settings', headers: { cookie: cookies[0]! } })).body,
    ).not.toContain('fixture-secret');
    const minted = await app.inject({
      method: 'POST',
      url: '/v1/auth/agent-keys',
      headers: { cookie: cookies[0]! },
      payload: { name: 'fixture' },
    });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `${url}/kimi`,
          remoteAddress: '127.0.0.1',
          headers: { authorization: `Bearer ${minted.json().key}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'DELETE', url: `${url}/kimi`, headers: { cookie: cookies[1]! } }))
        .statusCode,
    ).toBe(204);
  } finally {
    await app.close();
  }
});

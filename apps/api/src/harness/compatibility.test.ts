import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { parseVersion } from './version';
import { extractHarnessResult } from './envelope';
import { listenHost } from '../listen-host';
import { buildApp } from '../app';
it('keeps supported CLI versions and recorded output contracts explicit without live calls', () => {
  for (const [provider, version, file] of [
    ['claude', '2.1.281', 'claude-2.1.281.json'],
    ['codex', '0.156.0', 'codex-0.156.0.jsonl'],
    ['agy', '1.3.0', 'agy-1.3.0.jsonl'],
  ] as const) {
    expect(parseVersion(provider, version)).toBe(version);
    expect(
      extractHarnessResult(
        provider,
        readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'),
      ),
    ).toBeTruthy();
    expect(() => parseVersion(provider, '999.0.0')).toThrow();
  }
  for (const version of ['0.157.0', '0.159.0'])
    expect(parseVersion('codex', version)).toBe(version);
});
it('keeps network hosting gated and returns defensive API headers', async () => {
  expect(listenHost()).toBe('127.0.0.1');
  expect(listenHost('::1')).toBe('::1');
  expect(() => listenHost('0.0.0.0')).toThrow('loopback');
  const app = buildApp({ databasePath: ':memory:', speech: null });
  try {
    const health = await app.inject('/v1/health');
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    const write = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(write.statusCode).toBe(403);
  } finally {
    await app.close();
  }
});

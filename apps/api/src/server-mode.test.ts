import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InjectOptions } from 'fastify';
import { DEFAULT_BOARD_MODELS, type BoardModelSettings } from '@opsis/schema';
import { buildApp } from './app.js';
import { createAccount, resetAccountPassword } from './accounts.js';
import { listenHost } from './listen-host.js';
import { serverModeFromEnv, type ServerMode } from './server-mode.js';
import { ApiStore } from './storage.js';
import type { BoardClientFactory } from './boards.js';

const ORIGIN = 'https://opsis.example.com';
const dirs: string[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function webRoot() {
  const parent = await mkdtemp(join(tmpdir(), 'opsis-server-'));
  dirs.push(parent);
  const dir = join(parent, 'web');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Opsis</title>');
  await writeFile(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  return dir;
}

async function serve(boardClientFactory?: BoardClientFactory, rateLimit = 1_000) {
  const root = await webRoot();
  // Beside the web root, as in a real install: a path escaping the root must not reach it.
  const databasePath = join(root, '..', 'opsis.sqlite');
  const store = new ApiStore(databasePath);
  await createAccount(store, { email: 'Ada@Example.com', name: 'Ada', password: 'correct horse' });
  store.close();
  const serverMode = serverModeFromEnv({ OPSIS_PUBLIC_ORIGIN: ORIGIN, OPSIS_WEB_ROOT: root });
  const app = buildApp({
    databasePath,
    speech: null,
    rateLimit,
    serverMode,
    ...(boardClientFactory ? { boardClientFactory } : {}),
  });
  apps.push(app);
  return { app, databasePath };
}

/** A browser request as Nginx forwards it: Host kept, scheme and client address added. */
const viaProxy = (options: InjectOptions & { headers?: Record<string, string> }) => ({
  ...options,
  headers: {
    host: 'opsis.example.com',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '203.0.113.7',
    'sec-fetch-site': 'same-origin',
    ...(options.method && options.method !== 'GET' ? { origin: ORIGIN } : {}),
    ...options.headers,
  },
});

async function logIn(app: ReturnType<typeof buildApp>) {
  const response = await app.inject(
    viaProxy({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'correct horse' },
    }),
  );
  expect(response.statusCode).toBe(200);
  return response;
}

describe('personal server mode', () => {
  it('needs an HTTPS origin and a built web app', async () => {
    const root = await webRoot();
    expect(serverModeFromEnv({})).toBeNull();
    for (const origin of ['http://opsis.example.com', 'https://opsis.example.com/app', 'nope'])
      expect(() =>
        serverModeFromEnv({ OPSIS_PUBLIC_ORIGIN: origin, OPSIS_WEB_ROOT: root }),
      ).toThrow('HTTPS origin');
    expect(() =>
      serverModeFromEnv({ OPSIS_PUBLIC_ORIGIN: ORIGIN, OPSIS_WEB_ROOT: join(root, 'missing') }),
    ).toThrow('No built web app');
    expect(serverModeFromEnv({ OPSIS_PUBLIC_ORIGIN: `${ORIGIN}/`, OPSIS_WEB_ROOT: root })).toEqual({
      publicOrigin: ORIGIN,
      publicHost: 'opsis.example.com',
      trustedProxy: 'loopback',
      webRoot: root,
    } satisfies ServerMode);
    expect(listenHost('0.0.0.0', true)).toBe('0.0.0.0');
    expect(() => listenHost('0.0.0.0')).toThrow('loopback');
  });

  it('closes sign-up, keeps logging in, and marks the session cookie Secure', async () => {
    const { app } = await serve();
    const instance = await app.inject(viaProxy({ url: '/v1/instance' }));
    expect(instance.json()).toEqual({ signup: false, accountExecutablePaths: false });
    const signup = await app.inject(
      viaProxy({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: { name: 'Eve', email: 'eve@example.com', password: 'correct horse' },
      }),
    );
    expect(signup.statusCode).toBe(403);
    expect(signup.json().message).toMatch(/Sign-up is closed/);
    const login = await logIn(app);
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax; .*; Secure$/);
    expect(login.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(login.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('refuses plain HTTP, other host names and writes from other origins', async () => {
    const { app } = await serve();
    const plain = await app.inject(
      viaProxy({ url: '/v1/health', headers: { 'x-forwarded-proto': 'http' } }),
    );
    expect(plain.statusCode).toBe(421);
    const rebound = await app.inject(
      viaProxy({ url: '/v1/health', headers: { host: 'evil.example' } }),
    );
    expect(rebound.statusCode).toBe(421);
    for (const origin of ['https://evil.example', 'http://opsis.example.com']) {
      const write = await app.inject(
        viaProxy({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'ada@example.com', password: 'correct horse' },
          headers: { origin },
        }),
      );
      expect(write.statusCode).toBe(403);
    }
    // A forwarded header from an untrusted peer is ignored, so it cannot claim HTTPS.
    const direct = await app.inject({
      url: '/v1/health',
      remoteAddress: '198.51.100.4',
      headers: {
        host: 'opsis.example.com',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'none',
      },
    });
    expect(direct.statusCode).toBe(421);
    // Agents on the server itself (the MCP server) still reach the API directly.
    expect((await app.inject({ url: '/v1/health' })).statusCode).toBe(200);
  });

  it('serves the web app with page routes falling back to its index', async () => {
    const { app } = await serve();
    const page = await app.inject(viaProxy({ url: '/boards?collection=x' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Opsis</title>');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
    const asset = await app.inject(viaProxy({ url: '/assets/index-abc123.js' }));
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await app.inject(viaProxy({ url: '/assets/missing.js' }))).statusCode).toBe(404);
    // Loading the app's many files does not spend the API's request budget.
    const limited = await serve(undefined, 3);
    for (let load = 0; load < 5; load++)
      expect((await limited.app.inject(viaProxy({ url: '/canvas' }))).statusCode).toBe(200);
    expect((await limited.app.inject(viaProxy({ url: '/v1/instance' }))).statusCode).toBe(200);
    expect((await app.inject(viaProxy({ url: '/v1/unknown' }))).statusCode).toBe(404);
    for (const url of [
      '/../opsis.sqlite',
      '/%2e%2e/opsis.sqlite',
      '/assets/..%2f..%2fopsis.sqlite',
    ])
      expect((await app.inject(viaProxy({ url }))).body).not.toContain('SQLite');
  });

  it('runs the server’s agent CLIs, never a path saved by an account', async () => {
    const seen: (BoardModelSettings | undefined)[] = [];
    const { app } = await serve(async (_agent, settings) => {
      seen.push(settings);
      return { model: 'fake', complete: async () => '{}' };
    });
    const cookie = String((await logIn(app)).headers['set-cookie']).split(';')[0]!;
    const check = await app.inject(
      viaProxy({
        method: 'POST',
        url: '/v1/boards/check-agent',
        headers: { cookie },
        payload: {
          agent: 'claude',
          settings: { ...DEFAULT_BOARD_MODELS.claude, executablePath: '/home/eve/not-claude' },
        },
      }),
    );
    expect(check.statusCode).toBe(200);
    expect(seen.at(-1)).toEqual(DEFAULT_BOARD_MODELS.claude);
    expect(seen.at(-1)).not.toHaveProperty('executablePath');
  });
});

describe('operator accounts', () => {
  it('creates accounts and resets a password, signing the account out everywhere', async () => {
    const { app, databasePath } = await serve();
    const cookie = String((await logIn(app)).headers['set-cookie']).split(';')[0]!;
    const store = new ApiStore(databasePath);
    try {
      await expect(
        createAccount(store, { email: 'ada@example.com', name: 'Ada', password: 'another one' }),
      ).rejects.toThrow('already exists');
      await expect(
        createAccount(store, { email: 'grace@example.com', name: 'Grace', password: 'short' }),
      ).rejects.toThrow('at least 8');
      await createAccount(store, {
        email: 'grace@example.com',
        name: 'Grace',
        password: 'long enough',
      });
      expect(store.listUsers().map((user) => user.email)).toEqual([
        'ada@example.com',
        'grace@example.com',
      ]);
      await expect(
        resetAccountPassword(store, 'nobody@example.com', 'long enough'),
      ).rejects.toThrow('No account');
      await resetAccountPassword(store, 'ADA@example.com', 'a new password');
    } finally {
      store.close();
    }
    const me = await app.inject(viaProxy({ url: '/v1/auth/me', headers: { cookie } }));
    expect(me.statusCode).toBe(401);
    const old = await app.inject(
      viaProxy({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'ada@example.com', password: 'correct horse' },
      }),
    );
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject(
      viaProxy({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'ada@example.com', password: 'a new password' },
      }),
    );
    expect(fresh.statusCode).toBe(200);
  });
});

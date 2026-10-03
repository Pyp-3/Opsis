import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { EMAIL_DEMO } from '@opsis/schema';
import { buildApp } from './app.js';
import { hashPassword, verifyPassword } from './auth.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function start() {
  const app = buildApp({ databasePath: ':memory:', llm: null, rateLimit: 1_000 });
  apps.push(app);
  return app;
}
const snapshot = {
  board: { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} },
  past: [],
  future: [],
};
type App = ReturnType<typeof buildApp>;
async function signUp(app: App, email: string, name = 'Ada', password = 'correct horse') {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { name, email, password },
  });
  const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0]!;
  return { response, cookie };
}

describe('accounts', () => {
  it('hashes passwords with a salt and verifies them', async () => {
    const one = await hashPassword('correct horse');
    const two = await hashPassword('correct horse');
    expect(one).toMatch(/^scrypt\$/);
    expect(one).not.toContain('correct horse');
    expect(one).not.toBe(two);
    expect(await verifyPassword('correct horse', one)).toBe(true);
    expect(await verifyPassword('wrong horse', one)).toBe(false);
  });

  it('signs up, stays signed in with an HttpOnly cookie, logs out and logs back in', async () => {
    const app = start();
    const { response, cookie } = await signUp(app, 'Ada@Example.com ');
    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
    expect(response.json().user.password).toBeUndefined();
    expect(String(response.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax/);
    const me = await app.inject({ url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().user.email).toBe('ada@example.com');

    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    expect((await app.inject({ url: '/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'nope nope' },
    });
    expect(wrong.statusCode).toBe(401);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'nope nope' },
    });
    // The same answer whether or not the account exists.
    expect(unknown.json()).toEqual(wrong.json());
    const right = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ADA@example.com', password: 'correct horse' },
    });
    expect(right.statusCode).toBe(200);
    expect(right.headers['set-cookie']).toBeDefined();
  });

  it('explains invalid sign-ups and refuses a second account for one email', async () => {
    const app = start();
    const short = await signUp(app, 'ada@example.com', 'Ada', 'short');
    expect(short.response.statusCode).toBe(400);
    expect(short.response.json()).toEqual({
      message: 'Use at least 8 characters.',
      field: 'password',
    });
    expect((await signUp(app, 'not-an-email')).response.json().field).toBe('email');
    expect((await signUp(app, 'ada@example.com')).response.statusCode).toBe(201);
    const again = await signUp(app, 'ADA@example.com');
    expect(again.response.statusCode).toBe(409);
    expect(again.response.json().field).toBe('email');
  });

  it('requires an account for boards and agent runs', async () => {
    const app = start();
    for (const url of ['/v1/boards', '/v1/boards/public', '/v1/agents'])
      expect((await app.inject(url)).statusCode).toBe(401);
    const generate = await app.inject({
      method: 'POST',
      url: '/v1/boards/generate',
      payload: { prompt: 'x', agent: 'demo' },
    });
    expect(generate.statusCode).toBe(401);
  });
});

describe('owned and shared boards', () => {
  it('keeps boards private to their owner until they are made public, and read-only to others', async () => {
    const app = start();
    const ada = (await signUp(app, 'ada@example.com', 'Ada')).cookie;
    const bob = (await signUp(app, 'bob@example.com', 'Bob')).cookie;
    const id = randomUUID();
    const put = (cookie: string, revision: number) =>
      app.inject({
        method: 'PUT',
        url: `/v1/boards/${id}`,
        headers: { cookie },
        payload: { snapshot, revision },
      });
    expect((await put(ada, 0)).statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/boards', headers: { cookie: ada } })).json()).toEqual([
      expect.objectContaining({ id, visibility: 'private' }),
    ]);
    expect((await app.inject({ url: '/v1/boards', headers: { cookie: bob } })).json()).toEqual([]);
    // Private boards are invisible to others, even by id.
    expect(
      (await app.inject({ url: `/v1/boards/${id}`, headers: { cookie: bob } })).statusCode,
    ).toBe(404);
    expect((await put(bob, 1)).statusCode).toBe(404);

    const shared = await app.inject({
      method: 'PATCH',
      url: `/v1/boards/${id}`,
      headers: { cookie: ada },
      payload: { visibility: 'public', revision: 1 },
    });
    expect(shared.json()).toMatchObject({ visibility: 'public', revision: 1, access: 'owner' });
    const seen = (await app.inject({ url: `/v1/boards/${id}`, headers: { cookie: bob } })).json();
    expect(seen).toMatchObject({ access: 'viewer', owner: { name: 'Ada' }, visibility: 'public' });
    expect(
      (await app.inject({ url: '/v1/boards/public', headers: { cookie: bob } })).json(),
    ).toEqual([expect.objectContaining({ id, ownerName: 'Ada', title: EMAIL_DEMO.title })]);
    // An owner's own public boards stay in their library, not in the public list.
    expect(
      (await app.inject({ url: '/v1/boards/public', headers: { cookie: ada } })).json(),
    ).toEqual([]);
    expect((await put(bob, 1)).statusCode).toBe(403);
    for (const [method, payload] of [
      ['PATCH', { title: 'Mine now', revision: 1 }],
      ['DELETE', { revision: 1 }],
    ] as const)
      expect(
        (
          await app.inject({
            method,
            url: `/v1/boards/${id}`,
            headers: { cookie: bob },
            payload,
          })
        ).statusCode,
      ).toBe(404);
  });

  it('migrates a pre-accounts database and gives its boards to the first account only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsis-auth-test-'));
    const path = join(directory, 'old.sqlite');
    try {
      // The table exactly as earlier versions created it, with one saved board.
      const old = new Database(path);
      old.exec(`CREATE TABLE boards_v2 (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, snapshot TEXT NOT NULL,
        revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      const legacy = randomUUID();
      old
        .prepare('INSERT INTO boards_v2 VALUES (?,?,?,?,?)')
        .run(legacy, EMAIL_DEMO.title, JSON.stringify(snapshot), 3, Date.now());
      old.close();

      const app = buildApp({ databasePath: path, llm: null, rateLimit: 1_000 });
      apps.push(app);
      const ada = (await signUp(app, 'ada@example.com')).cookie;
      expect((await app.inject({ url: '/v1/boards', headers: { cookie: ada } })).json()).toEqual([
        expect.objectContaining({ id: legacy, revision: 3, visibility: 'private' }),
      ]);
      const bob = (await signUp(app, 'bob@example.com')).cookie;
      expect((await app.inject({ url: '/v1/boards', headers: { cookie: bob } })).json()).toEqual(
        [],
      );
    } finally {
      await Promise.all(apps.splice(0).map((app) => app.close()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('agent keys', () => {
  async function keyFor(app: App, cookie: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/auth/agent-keys',
      headers: { cookie },
      payload: { name: 'Claude Code' },
    });
    expect(created.statusCode).toBe(201);
    return created.json() as { id: string; key: string };
  }

  it('work only for local agents, never from a browser or another machine', async () => {
    const app = start();
    const ada = (await signUp(app, 'ada@example.com', 'Ada')).cookie;
    const { key } = await keyFor(app, ada);
    expect(key).toMatch(/^opsis_agent_/);
    const auth = { authorization: `Bearer ${key}` };
    expect((await app.inject({ url: '/v1/boards', headers: auth })).statusCode).toBe(200);
    // Node's fetch (which the MCP server uses) sends Sec-Fetch-Mode; that alone is fine.
    expect(
      (await app.inject({ url: '/v1/boards', headers: { ...auth, 'sec-fetch-mode': 'cors' } }))
        .statusCode,
    ).toBe(200);
    // A web page (Origin / Sec-Fetch headers), a forwarding proxy, or a remote address: refused.
    for (const headers of [
      { ...auth, origin: 'http://127.0.0.1:3000' },
      { ...auth, 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' },
      { ...auth, 'x-forwarded-for': '203.0.113.9' },
    ])
      expect((await app.inject({ url: '/v1/boards', headers })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/v1/boards', headers: auth, remoteAddress: '192.168.1.20' }))
        .statusCode,
    ).toBe(401);
    // Agents cannot mint more keys for themselves.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/agent-keys',
          headers: auth,
          payload: { name: 'More' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('are listed without their secret and stop working once revoked', async () => {
    const app = start();
    const ada = (await signUp(app, 'ada@example.com')).cookie;
    const { id, key } = await keyFor(app, ada);
    const listed = (
      await app.inject({ url: '/v1/auth/agent-keys', headers: { cookie: ada } })
    ).json();
    expect(listed).toEqual([expect.objectContaining({ id, name: 'Claude Code' })]);
    expect(JSON.stringify(listed)).not.toContain(key);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/auth/agent-keys/${id}`,
          headers: { cookie: ada },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: '/v1/boards', headers: { authorization: `Bearer ${key}` } }))
        .statusCode,
    ).toBe(401);
  });
});

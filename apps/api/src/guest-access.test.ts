import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createEmptyBoard } from '@opsis/schema';
import { ApiStore } from './storage.js';
import { createAccount } from './accounts.js';
import { buildApp } from './app.js';
import { serverModeFromEnv } from './server-mode.js';

it('enforces a persistent, default-deny public-view-only guest boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opsis-guest-'));
  await writeFile(join(dir, 'index.html'), '<title>Opsis</title>');
  const databasePath = join(dir, 'test.sqlite');
  const store = new ApiStore(databasePath);
  const owner = await createAccount(store, {
    name: 'Owner',
    email: 'owner@example.com',
    password: 'test password',
  });
  const guest = await createAccount(store, {
    name: 'Guest',
    email: 'guest@example.com',
    password: 'test password',
  });
  const publicId = randomUUID(),
    privateId = randomUUID(),
    ownedId = randomUUID();
  const board = createEmptyBoard('Public diagram');
  const snapshot = { board, past: [createEmptyBoard('Old private information')], future: [] };
  store.saveBoard(publicId, snapshot, 0, owner.id);
  store.saveBoard(privateId, snapshot, 0, owner.id);
  store.saveBoard(ownedId, snapshot, 0, guest.id);
  store.setVisibility(publicId, 'public');
  store.setEditor(privateId, owner.id, guest.email, true, 1);
  const oldKey = 'opsis_agent_fixture';
  store.createAgentKey({
    id: randomUUID(),
    name: 'Old key',
    userId: guest.id,
    tokenHash: createHash('sha256').update(oldKey).digest('base64url'),
  });
  const factory = vi.fn();
  const serverMode = serverModeFromEnv({
    OPSIS_PUBLIC_ORIGIN: 'https://opsis.example.com',
    OPSIS_WEB_ROOT: dir,
    OPSIS_GUEST_EMAILS: ' GUEST@example.com ',
  });
  const makeApp = () =>
    buildApp({
      databasePath,
      serverMode,
      speech: null,
      rateLimit: 1000,
      boardClientFactory: factory,
    });
  let app = makeApp();
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: guest.email, password: 'test password' },
    });
    expect(login.json().user.role).toBe('guest');
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const get = (url: string) => app.inject({ url, headers: { cookie } });
    expect((await get('/v1/auth/me')).json().user.role).toBe('guest');
    expect(
      (await get('/v1/boards/public')).json().map((entry: { id: string }) => entry.id),
    ).toEqual([publicId]);
    const viewed = (await get(`/v1/boards/${publicId}`)).json();
    expect(viewed).toMatchObject({ access: 'viewer', snapshot: { board, past: [], future: [] } });
    for (const id of [privateId, ownedId, randomUUID()])
      expect((await get(`/v1/boards/${id}`)).statusCode).toBe(404);
    for (const url of [
      '/v1/agents',
      '/v1/boards',
      '/v1/boards/shared',
      '/v1/account/settings',
      '/v1/auth/agent-keys',
      `/v1/boards/${publicId}/chat`,
      `/v1/boards/${publicId}/editors`,
      `/v1/boards/${publicId}/revisions`,
      '/v1/instance/provider-keys',
      '/v1/collections',
    ]) {
      expect((await get(url)).statusCode, url).toBe(403);
    }
    for (const url of [
      '/v1/boards',
      '/v1/boards/generate',
      '/v1/boards/%67enerate',
      '/%761/boards/check-agent',
      '/v1/boards/illustrate',
      '/v1/auth/agent-keys',
      '/v1/auth/signup',
      `/v1/boards/${publicId}/duplicate`,
    ]) {
      expect(
        (await app.inject({ method: 'POST', url, headers: { cookie }, payload: {} })).statusCode,
        url,
      ).toBe(403);
    }
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      expect(
        (
          await app.inject({
            method,
            url: `/v1/boards/${publicId}`,
            headers: { cookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards/generate',
          headers: { authorization: `Bearer ${oldKey}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(factory).not.toHaveBeenCalled();
    store.setVisibility(publicId, 'private');
    expect((await get(`/v1/boards/${publicId}`)).statusCode).toBe(404);
    store.setVisibility(publicId, 'public');
    store.setArchived(publicId, true, 1);
    expect((await get(`/v1/boards/${publicId}`)).statusCode).toBe(404);
    await app.close();
    app = makeApp();
    expect((await get('/v1/auth/me')).json().user.role).toBe('guest');
    expect((await get('/v1/agents')).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } }))
        .statusCode,
    ).toBe(204);
    expect((await get('/v1/auth/me')).statusCode).toBe(401);
  } finally {
    await app.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

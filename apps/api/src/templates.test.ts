import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { EMAIL_DEMO } from '@opsis/schema';
import { buildApp } from './app.js';
import { signIn, withSession } from './test-session.js';

it('persists private templates independently of their source and creates boards with fresh history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opsis-templates-test-'));
  let app = buildApp({ databasePath: join(directory, 'boards.sqlite'), speech: null });
  try {
    expect((await app.inject('/v1/templates')).statusCode).toBe(401);
    const cookie = await signIn(app);
    const id = randomUUID();
    const board = {
      ...EMAIL_DEMO,
      version: 2,
      agent: 'demo',
      positions: { [EMAIL_DEMO.nodes[0]!.id]: { x: 123, y: 456 } },
    };
    await app.inject({
      method: 'PUT',
      url: `/v1/boards/${id}`,
      payload: { snapshot: { board, past: [null], future: [board] }, revision: 0 },
    });
    for (const title of ['', ' ', 'x'.repeat(101)]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/templates',
            payload: { title, boardId: id, revision: 1 },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/templates',
          payload: { title: 'Stale', boardId: id, revision: 2 },
        })
      ).statusCode,
    ).toBe(409);
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/templates',
      payload: { title: 'Email starter', boardId: id, revision: 1 },
    });
    expect(saved.statusCode).toBe(201);
    const templateId = saved.json().id;
    await app.inject({
      method: 'PATCH',
      url: `/v1/boards/${id}`,
      payload: { title: 'Changed source', revision: 1 },
    });
    await app.inject({ method: 'DELETE', url: `/v1/boards/${id}`, payload: { revision: 2 } });
    await app.close();
    app = buildApp({ databasePath: join(directory, 'boards.sqlite'), speech: null });
    withSession(app, cookie);
    expect((await app.inject('/v1/templates')).json()).toEqual([
      { id: templateId, title: 'Email starter', createdAt: expect.any(Number) },
    ]);
    const copies = [];
    for (const title of ['Project A', 'Project B']) {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/boards',
        payload: { title, templateId },
      });
      expect(created.statusCode).toBe(201);
      const copy = created.json();
      expect(copy.snapshot).toEqual({ board: { ...board, title }, past: [], future: [] });
      expect(copy.visibility).toBe('private');
      expect(copy.revision).toBe(1);
      copies.push(copy);
    }
    expect(copies[0].id).not.toBe(copies[1].id);
    await signIn(app, 'Other account');
    expect((await app.inject('/v1/templates')).json()).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards',
          payload: { title: 'Not mine', templateId },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/templates/${templateId}` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/templates',
          payload: { title: 'Not mine', boardId: copies[0].id, revision: 1 },
        })
      ).statusCode,
    ).toBe(404);
    withSession(app, cookie);
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/templates/${templateId}` })).statusCode,
    ).toBe(204);
    expect((await app.inject('/v1/templates')).json()).toEqual([]);
    expect((await app.inject(`/v1/boards/${copies[0].id}`)).json().snapshot.board.title).toBe(
      'Project A',
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/boards',
          payload: { title: 'Deleted', templateId },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

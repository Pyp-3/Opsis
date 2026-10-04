import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { EMAIL_DEMO, BoardSnapshotSchema } from '@opsis/schema';
import { buildApp } from '../app.js';
import { signIn } from '../test-session.js';
import { ApiStore } from '../storage.js';
import { copyDatabase } from './database-copy.js';

it('duplicates privately, archives durably, guards revisions and protects private history', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  const owner = await signIn(app),
    viewer = await signIn(app);
  const request = (
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) => app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  try {
    const source = (await request(owner, 'POST', '/v1/boards', { title: 'Source' })).json();
    const path = `/v1/boards/${source.id}`;
    const snapshot = BoardSnapshotSchema.parse({
      board: {
        ...EMAIL_DEMO,
        version: 2,
        agent: 'demo',
        positions: { [EMAIL_DEMO.nodes[0]!.id]: { x: 31, y: 47 } },
      },
      past: [],
      future: [],
    });
    expect((await request(owner, 'PUT', path, { revision: 1, snapshot })).statusCode).toBe(200);
    await request(owner, 'PATCH', path, { revision: 2, visibility: 'public' });
    expect((await request(viewer, 'GET', path)).statusCode).toBe(200);
    expect((await request(viewer, 'GET', `${path}/revisions`)).statusCode).toBe(404);
    expect((await request(viewer, 'GET', `${path}/revisions/1`)).statusCode).toBe(404);
    expect((await request(viewer, 'POST', `${path}/duplicate`, { revision: 2 })).statusCode).toBe(
      404,
    );
    expect((await request(owner, 'POST', `${path}/duplicate`, { revision: 1 })).statusCode).toBe(
      409,
    );
    const copy = (await request(owner, 'POST', `${path}/duplicate`, { revision: 2 })).json();
    expect(copy.id).not.toBe(source.id);
    expect(copy.visibility).toBe('private');
    expect(copy.snapshot).toEqual({
      board: { ...snapshot.board, title: `${snapshot.board!.title} (copy)` },
      past: [],
      future: [],
    });
    const archived = await request(owner, 'PATCH', path, { revision: 2, archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ archived: true, revision: 3, snapshot });
    expect(
      (await request(owner, 'PATCH', path, { revision: 3, archived: true })).json().revision,
    ).toBe(3);
    expect((await request(viewer, 'GET', path)).statusCode).toBe(404);
    expect((await request(viewer, 'GET', '/v1/boards/public')).json()).toEqual([]);
    expect((await request(owner, 'PUT', path, { revision: 2, snapshot })).statusCode).toBe(409);
    expect(
      (await request(owner, 'GET', `${path}/revisions`))
        .json()
        .map((row: { revision: number }) => row.revision),
    ).toEqual([3, 2, 1]);
    expect((await request(owner, 'GET', `${path}/revisions/2`)).json().board).toEqual(
      snapshot.board,
    );
    const restored = (
      await request(owner, 'POST', `${path}/duplicate`, { revision: 3, fromRevision: 1 })
    ).json();
    expect(restored.snapshot.board.title).toBe('Source (copy)');
    expect(restored.archived).toBe(false);
    expect((await request(owner, 'GET', path)).json()).toMatchObject({
      archived: true,
      revision: 3,
    });
    expect((await request(owner, 'PATCH', path, { revision: 3, archived: false })).statusCode).toBe(
      200,
    );
    expect((await request(viewer, 'GET', path)).statusCode).toBe(200);
    expect((await request(owner, 'DELETE', path, { revision: 4 })).statusCode).toBe(204);
    expect((await request(owner, 'GET', `${path}/revisions`)).statusCode).toBe(404);
    expect((await request(owner, 'PUT', path, { revision: 0, snapshot })).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});

it('rolls back failed migrations and refuses unknown future migration versions', () => {
  const folder = mkdtempSync(join(tmpdir(), 'opsis-migration-'));
  const path = join(folder, 'database.sqlite');
  const db = new Database(path);
  try {
    db.exec(
      "CREATE TABLE boards_v2(id TEXT PRIMARY KEY,title TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO boards_v2 VALUES('legacy','Legacy','not json',1,1)",
    );
    expect(() => new ApiStore(path)).toThrow();
    expect(
      (db.prepare('PRAGMA table_info(boards_v2)').all() as { name: string }[]).some(
        (column) => column.name === 'archived',
      ),
    ).toBe(false);
    expect(db.prepare('SELECT count(*) AS total FROM schema_migrations').get()).toEqual({
      total: 0,
    });
    expect(db.prepare('SELECT snapshot FROM boards_v2').get()).toEqual({ snapshot: 'not json' });
    db.prepare('UPDATE boards_v2 SET snapshot=?').run(
      JSON.stringify({ board: null, past: [], future: [] }),
    );
    new ApiStore(path).close();
    db.exec("INSERT INTO schema_migrations VALUES(99,'future')");
    expect(() => new ApiStore(path)).toThrow('requires a newer version');
    expect(db.prepare('SELECT count(*) AS total FROM boards_v2').get()).toEqual({ total: 1 });
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('paginates persistent revisions beyond the bounded undo history', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  await signIn(app);
  try {
    const board = (
      await app.inject({ method: 'POST', url: '/v1/boards', payload: { title: 'First' } })
    ).json();
    const path = `/v1/boards/${board.id}`;
    for (let revision = 1; revision <= 55; revision++) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: path,
            payload: { revision, title: `Version ${revision + 1}` },
          })
        ).statusCode,
      ).toBe(200);
    }
    const first = (await app.inject(`${path}/revisions`)).json();
    expect(first).toHaveLength(50);
    expect(first[0].revision).toBe(56);
    const older = (await app.inject(`${path}/revisions?before=${first.at(-1).revision}`)).json();
    expect(older.map((row: { revision: number }) => row.revision)).toEqual([6, 5, 4, 3, 2, 1]);
    expect((await app.inject(`${path}/revisions?before=nope`)).statusCode).toBe(400);
    expect((await app.inject(path)).json().snapshot.past).toHaveLength(40);
    expect((await app.inject(`${path}/revisions/1`)).json().board.title).toBe('First');
  } finally {
    await app.close();
  }
});

it('migrates legacy data in place and backs up/restores live WAL, archives, history and tombstones', () => {
  const folder = mkdtempSync(join(tmpdir(), 'opsis-persistence-'));
  const source = join(folder, 'source.sqlite'),
    backup = join(folder, 'backup.sqlite'),
    restored = join(folder, 'restored.sqlite');
  const id = randomUUID(),
    deleted = randomUUID(),
    owner = randomUUID();
  const snapshot = BoardSnapshotSchema.parse({
    board: { ...EMAIL_DEMO, version: 2, agent: 'demo', positions: {} },
    past: [null],
    future: [],
  });
  const legacy = new Database(source);
  legacy.exec(
    "CREATE TABLE boards_v2(id TEXT PRIMARY KEY,title TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL); CREATE TABLE old_pipeline(value TEXT); INSERT INTO old_pipeline VALUES('preserve');",
  );
  legacy
    .prepare('INSERT INTO boards_v2 VALUES(?,?,?,?,?)')
    .run(id, snapshot.board!.title, JSON.stringify(snapshot), 7, 123);
  legacy.close();
  let store: ApiStore | undefined;
  try {
    store = new ApiStore(source);
    store.createUser({ id: owner, email: 'owner@test.example', name: 'Owner', password: 'test' });
    expect(store.getBoard(id)?.snapshot).toEqual(snapshot);
    expect(store.listRevisions(id).map((row) => row.revision)).toEqual([7]);
    expect(store.saveBoard(id, snapshot, 7, owner)).toMatchObject({ revision: 8 });
    expect(store.setArchived(id, true, 8)).toBe(true);
    store.saveBoard(deleted, snapshot, 0, owner);
    store.deleteBoard(deleted, 1);
    store.createTemplate(randomUUID(), owner, 'Keep template', snapshot.board!);
    copyDatabase(source, backup);
    expect(() => copyDatabase(source, backup)).toThrow('Destination already exists');
    writeFileSync(join(folder, 'blocked.sqlite-wal'), 'unchanged');
    expect(() => copyDatabase(source, join(folder, 'blocked.sqlite'))).toThrow(
      'Destination already exists',
    );
    if (process.platform !== 'win32') expect(statSync(backup).mode & 0o777).toBe(0o600);
    store.close();
    store = undefined;
    copyDatabase(backup, restored);
    store = new ApiStore(restored);
    expect(store.getBoard(id)).toMatchObject({
      ownerId: owner,
      archived: true,
      revision: 9,
      snapshot,
    });
    expect(store.listRevisions(id).map((row) => row.revision)).toEqual([9, 8, 7]);
    expect(store.saveBoard(deleted, snapshot, 0, owner)).toBeNull();
    expect(store.listTemplates(owner)).toHaveLength(1);
    store.close();
    store = undefined;
    const inspection = new Database(restored);
    expect(inspection.prepare('SELECT * FROM old_pipeline').get()).toEqual({ value: 'preserve' });
    expect(inspection.prepare('SELECT count(*) AS total FROM schema_migrations').get()).toEqual({
      total: 1,
    });
    expect(
      inspection
        .prepare('SELECT count(*) AS total FROM board_revisions WHERE board_id=?')
        .get(deleted),
    ).toEqual({ total: 0 });
    inspection.close();
    store = new ApiStore(restored);
    expect(store.listRevisions(id)).toHaveLength(3);
  } finally {
    store?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

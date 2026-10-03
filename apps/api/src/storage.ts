import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { LRUCache } from 'lru-cache';
import {
  BoardSnapshotSchema,
  type BoardSnapshot,
  ExplanationSchema,
  OSGSchema,
  type Explanation,
  type OSG,
} from '@opsis/schema';

const cacheEntries = sqliteTable('cache_entries', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: integer('created_at').notNull(),
});

const osgDocuments = sqliteTable('osg_documents', {
  id: text('id').primaryKey(),
  document: text('document').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

const explanations = sqliteTable('explanations', {
  key: text('key').primaryKey(),
  osgId: text('osg_id').notNull(),
  document: text('document').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

const shares = sqliteTable('shares', {
  token: text('token').primaryKey(),
  osgId: text('osg_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type User = { id: string; email: string; name: string };
export type Visibility = 'private' | 'public';
export type BoardListing = {
  id: string;
  title: string;
  revision: number;
  updatedAt: number;
  visibility: Visibility;
};

function databasePath(path: string): string {
  if (path === ':memory:') return path;
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

/** SQLite persistence plus a bounded in-process LRU front cache. */
export class ApiStore {
  private readonly sqlite: Database.Database;
  private readonly db;
  private readonly memory: LRUCache<string, object>;

  constructor(path: string, memoryEntries = 256) {
    this.sqlite = new Database(databasePath(path));
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS boards_v2 (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, snapshot TEXT NOT NULL,
        revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deleted_boards_v2 (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS osg_documents (
        id TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS explanations (
        key TEXT PRIMARY KEY, osg_id TEXT NOT NULL, document TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shares (
        token TEXT PRIMARY KEY, osg_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        password TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_keys (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
    `);
    // Boards predate accounts: add ownership in place. Unowned boards go to the first account.
    const columns = this.sqlite.prepare('PRAGMA table_info(boards_v2)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'owner_id'))
      this.sqlite.exec(`
        ALTER TABLE boards_v2 ADD COLUMN owner_id TEXT;
        ALTER TABLE boards_v2 ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
      `);
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS boards_v2_owner ON boards_v2 (owner_id)');
    this.db = drizzle(this.sqlite);
    this.memory = new LRUCache({ max: memoryEntries });
  }

  /** The boards one account owns. */
  listBoards(ownerId: string) {
    return this.sqlite
      .prepare(
        `SELECT id, title, revision, updated_at AS updatedAt, visibility FROM boards_v2
         WHERE owner_id = ? ORDER BY updated_at DESC`,
      )
      .all(ownerId) as BoardListing[];
  }

  /** Other people's public boards, newest first. */
  listPublicBoards(exceptOwnerId: string, limit = 100) {
    return this.sqlite
      .prepare(
        `SELECT b.id, b.title, b.revision, b.updated_at AS updatedAt, b.visibility,
                u.name AS ownerName
         FROM boards_v2 b JOIN users u ON u.id = b.owner_id
         WHERE b.visibility = 'public' AND b.owner_id != ?
         ORDER BY b.updated_at DESC LIMIT ?`,
      )
      .all(exceptOwnerId, limit) as (BoardListing & { ownerName: string })[];
  }

  getBoard(id: string) {
    const row = this.sqlite
      .prepare(
        `SELECT b.snapshot, b.revision, b.owner_id AS ownerId, b.visibility, u.name AS ownerName
         FROM boards_v2 b LEFT JOIN users u ON u.id = b.owner_id WHERE b.id = ?`,
      )
      .get(id) as
      | {
          snapshot: string;
          revision: number;
          ownerId: string | null;
          visibility: Visibility;
          ownerName: string | null;
        }
      | undefined;
    return row
      ? {
          id,
          snapshot: BoardSnapshotSchema.parse(JSON.parse(row.snapshot)),
          revision: row.revision,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          visibility: row.visibility,
        }
      : undefined;
  }

  /**
   * Saves a revision. A new id becomes a board owned by `ownerId`; an existing one is only
   * saved for its owner (`'forbidden'` otherwise).
   */
  saveBoard(id: string, snapshot: BoardSnapshot, revision: number, ownerId: string) {
    return this.sqlite.transaction(() => {
      if (this.sqlite.prepare('SELECT id FROM deleted_boards_v2 WHERE id = ?').get(id)) return null;
      const current = this.getBoard(id);
      if (current && current.ownerId !== ownerId) return 'forbidden' as const;
      if ((current?.revision ?? 0) !== revision) return null;
      const next = revision + 1;
      this.sqlite
        .prepare(
          `INSERT INTO boards_v2 (id,title,snapshot,revision,updated_at,owner_id) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,snapshot=excluded.snapshot,revision=excluded.revision,updated_at=excluded.updated_at`,
        )
        .run(
          id,
          snapshot.board?.title ?? 'Untitled canvas',
          JSON.stringify(snapshot),
          next,
          Date.now(),
          ownerId,
        );
      return { id, revision: next };
    })();
  }

  setVisibility(id: string, visibility: Visibility) {
    this.sqlite.prepare('UPDATE boards_v2 SET visibility = ? WHERE id = ?').run(visibility, id);
  }

  deleteBoard(id: string, revision: number) {
    return this.sqlite.transaction(() => {
      const current = this.getBoard(id);
      if (!current) return 'missing' as const;
      if (current.revision !== revision) return 'conflict' as const;
      this.sqlite.prepare('INSERT INTO deleted_boards_v2 (id) VALUES (?)').run(id);
      this.sqlite.prepare('DELETE FROM boards_v2 WHERE id = ?').run(id);
      return 'deleted' as const;
    })();
  }

  /** Creates an account; the very first one also takes the boards saved before accounts. */
  createUser(user: { id: string; email: string; name: string; password: string }) {
    return this.sqlite.transaction(() => {
      if (this.findUserByEmail(user.email)) return null;
      const first = !this.sqlite.prepare('SELECT id FROM users LIMIT 1').get();
      this.sqlite
        .prepare('INSERT INTO users (id,email,name,password,created_at) VALUES (?,?,?,?,?)')
        .run(user.id, user.email, user.name, user.password, Date.now());
      if (first)
        this.sqlite
          .prepare('UPDATE boards_v2 SET owner_id = ? WHERE owner_id IS NULL')
          .run(user.id);
      return this.findUser(user.id)!;
    })();
  }

  findUserByEmail(email: string) {
    return this.sqlite
      .prepare('SELECT id, email, name, password FROM users WHERE email = ?')
      .get(email) as (User & { password: string }) | undefined;
  }

  findUser(id: string) {
    return this.sqlite.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id) as
      User | undefined;
  }

  createSession(tokenHash: string, userId: string, expiresAt: number) {
    const now = Date.now();
    this.sqlite.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    this.sqlite
      .prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
      .run(tokenHash, userId, now, expiresAt);
  }

  sessionUser(tokenHash: string) {
    return this.sqlite
      .prepare(
        `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, Date.now()) as User | undefined;
  }

  deleteSession(tokenHash: string) {
    this.sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  createAgentKey(key: { id: string; userId: string; name: string; tokenHash: string }) {
    this.sqlite
      .prepare('INSERT INTO agent_keys (id,user_id,name,token_hash,created_at) VALUES (?,?,?,?,?)')
      .run(key.id, key.userId, key.name, key.tokenHash, Date.now());
  }

  listAgentKeys(userId: string) {
    return this.sqlite
      .prepare(
        `SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM agent_keys
         WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(userId) as { id: string; name: string; createdAt: number; lastUsedAt: number | null }[];
  }

  deleteAgentKey(id: string, userId: string) {
    return (
      this.sqlite.prepare('DELETE FROM agent_keys WHERE id = ? AND user_id = ?').run(id, userId)
        .changes > 0
    );
  }

  agentKeyUser(tokenHash: string) {
    const user = this.sqlite
      .prepare(
        `SELECT u.id, u.email, u.name FROM agent_keys k JOIN users u ON u.id = k.user_id
         WHERE k.token_hash = ?`,
      )
      .get(tokenHash) as User | undefined;
    if (user)
      this.sqlite
        .prepare('UPDATE agent_keys SET last_used_at = ? WHERE token_hash = ?')
        .run(Date.now(), tokenHash);
    return user;
  }

  /** Reads a JSON cache entry from memory first, then SQLite. */
  getCache<T>(key: string): T | undefined {
    const hot = this.memory.get(key);
    if (hot !== undefined) return hot as T;
    const row = this.db.select().from(cacheEntries).where(eq(cacheEntries.key, key)).get();
    if (!row) return undefined;
    const value = JSON.parse(row.value) as T;
    this.memory.set(key, value as object);
    return value;
  }

  /** Writes a JSON cache entry to the LRU and SQLite. */
  setCache(key: string, value: unknown): void {
    const now = Date.now();
    this.memory.set(key, value as object);
    this.db
      .insert(cacheEntries)
      .values({ key, value: JSON.stringify(value), createdAt: now })
      .onConflictDoUpdate({
        target: cacheEntries.key,
        set: { value: JSON.stringify(value), createdAt: now },
      })
      .run();
  }

  /** Loads and validates a stored OSG. */
  getOsg(id: string): OSG | undefined {
    const row = this.db.select().from(osgDocuments).where(eq(osgDocuments.id, id)).get();
    return row ? OSGSchema.parse(JSON.parse(row.document)) : undefined;
  }

  /** Validates and upserts an OSG. */
  putOsg(value: OSG): OSG {
    const document = OSGSchema.parse(value);
    const serialized = JSON.stringify(document);
    const now = Date.now();
    this.db
      .insert(osgDocuments)
      .values({ id: document.id, document: serialized, updatedAt: now })
      .onConflictDoUpdate({
        target: osgDocuments.id,
        set: { document: serialized, updatedAt: now },
      })
      .run();
    return document;
  }

  /**
   * Stores a pipeline-generated OSG only when its id is new and returns the stored document, so a
   * user edit saved through PUT survives regeneration with the same deterministic id.
   */
  insertOsgIfAbsent(value: OSG): OSG {
    const document = OSGSchema.parse(value);
    this.db
      .insert(osgDocuments)
      .values({ id: document.id, document: JSON.stringify(document), updatedAt: Date.now() })
      .onConflictDoNothing({ target: osgDocuments.id })
      .run();
    return this.getOsg(document.id) ?? document;
  }

  /** Loads a persisted explanation by its complete request identity. */
  getExplanation(key: string): Explanation | undefined {
    const row = this.db.select().from(explanations).where(eq(explanations.key, key)).get();
    return row ? ExplanationSchema.parse(JSON.parse(row.document)) : undefined;
  }

  /** Persists a validated explanation. */
  putExplanation(key: string, value: Explanation): Explanation {
    const document = ExplanationSchema.parse(value);
    const serialized = JSON.stringify(document);
    const now = Date.now();
    this.db
      .insert(explanations)
      .values({ key, osgId: document.osgId, document: serialized, updatedAt: now })
      .onConflictDoUpdate({
        target: explanations.key,
        set: { document: serialized, updatedAt: now },
      })
      .run();
    return document;
  }

  /** Records a read-only share token for an existing OSG. */
  putShare(token: string, osgId: string): void {
    this.db.insert(shares).values({ token, osgId, createdAt: Date.now() }).run();
  }

  /** Resolves a share token to the OSG it grants read access to. */
  getSharedOsg(token: string): OSG | undefined {
    const row = this.db.select().from(shares).where(eq(shares.token, token)).get();
    return row ? this.getOsg(row.osgId) : undefined;
  }

  /** Closes the SQLite connection. */
  close(): void {
    this.sqlite.close();
  }
}

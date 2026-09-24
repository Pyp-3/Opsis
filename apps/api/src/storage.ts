import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { LRUCache } from 'lru-cache';
import { ExplanationSchema, OSGSchema, type Explanation, type OSG } from '@opsis/schema';

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
    this.sqlite.exec(`
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
    `);
    this.db = drizzle(this.sqlite);
    this.memory = new LRUCache({ max: memoryEntries });
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

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { PERSISTENCE_MIGRATIONS } from './persistence/migrations.js';
import {
  BoardDocumentSchema,
  BoardSnapshotSchema,
  type BoardDocument,
  type BoardSnapshot,
  copyBoardSnapshot,
} from '@opsis/schema';

export type User = { id: string; email: string; name: string };
export type Visibility = 'private' | 'public';
export type BoardListing = {
  id: string;
  title: string;
  revision: number;
  updatedAt: number;
  visibility: Visibility;
  archived: boolean;
  collectionId: string | null;
};
export type BoardCollection = { id: string; name: string; createdAt: number };

function databasePath(path: string): string {
  if (path === ':memory:') return path;
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

/** SQLite persistence for accounts, owned boards and revision history. */
export class ApiStore {
  private readonly sqlite: Database.Database;

  constructor(path: string) {
    this.sqlite = new Database(databasePath(path));
    try {
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('foreign_keys = ON');
      this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS boards_v2 (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, snapshot TEXT NOT NULL,
        revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deleted_boards_v2 (id TEXT PRIMARY KEY);
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
      CREATE TABLE IF NOT EXISTS board_templates (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, board TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS board_templates_owner ON board_templates (owner_id);
    `);
      // Boards predate accounts: add ownership in place. Unowned boards go to the first account.
      const columns = this.sqlite.prepare('PRAGMA table_info(boards_v2)').all() as {
        name: string;
      }[];
      if (!columns.some((column) => column.name === 'owner_id'))
        this.sqlite.exec(`
        ALTER TABLE boards_v2 ADD COLUMN owner_id TEXT;
        ALTER TABLE boards_v2 ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
      `);
      this.sqlite.exec('CREATE INDEX IF NOT EXISTS boards_v2_owner ON boards_v2 (owner_id)');
      this.sqlite.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL)',
      );
      this.sqlite.transaction(() => {
        const applied = this.sqlite.prepare('SELECT version FROM schema_migrations').all() as {
          version: number;
        }[];
        if (
          applied.some(({ version }) => !PERSISTENCE_MIGRATIONS.some((m) => m.version === version))
        )
          throw new Error('This database requires a newer version of Opsis.');
        for (const migration of PERSISTENCE_MIGRATIONS) {
          if (applied.some(({ version }) => version === migration.version)) continue;
          this.sqlite.exec(migration.sql);
          this.sqlite
            .prepare('INSERT INTO schema_migrations VALUES (?,?)')
            .run(migration.version, migration.name);
        }
      })();
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }

  /** Templates are private snapshots, independent of source boards and their history. */
  listTemplates(ownerId: string) {
    return this.sqlite
      .prepare(
        'SELECT id, title, created_at AS createdAt FROM board_templates WHERE owner_id = ? ORDER BY created_at DESC',
      )
      .all(ownerId) as { id: string; title: string; createdAt: number }[];
  }

  createTemplate(id: string, ownerId: string, title: string, board: BoardDocument) {
    this.sqlite
      .prepare(
        'INSERT INTO board_templates (id, owner_id, title, board, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, ownerId, title, JSON.stringify(board), Date.now());
  }

  getTemplate(id: string, ownerId: string) {
    const row = this.sqlite
      .prepare('SELECT board FROM board_templates WHERE id = ? AND owner_id = ?')
      .get(id, ownerId) as { board: string } | undefined;
    return row ? BoardDocumentSchema.parse(JSON.parse(row.board)) : undefined;
  }

  deleteTemplate(id: string, ownerId: string) {
    return (
      this.sqlite
        .prepare('DELETE FROM board_templates WHERE id = ? AND owner_id = ?')
        .run(id, ownerId).changes > 0
    );
  }

  /** The boards one account owns. */
  listBoards(ownerId: string, includeArchived = false) {
    const rows = this.sqlite
      .prepare(
        `SELECT id, title, revision, updated_at AS updatedAt, visibility, archived,
                collection_id AS collectionId FROM boards_v2
         WHERE owner_id = ? AND (? OR archived=0) ORDER BY updated_at DESC`,
      )
      .all(ownerId, Number(includeArchived)) as (Omit<BoardListing, 'archived'> & {
      archived: number;
    })[];
    return rows.map((row) => ({ ...row, archived: Boolean(row.archived) }));
  }

  /** Other people's public boards, newest first. */
  listPublicBoards(exceptOwnerId: string, limit = 100) {
    return this.sqlite
      .prepare(
        `SELECT b.id, b.title, b.revision, b.updated_at AS updatedAt, b.visibility,
                u.name AS ownerName
         FROM boards_v2 b JOIN users u ON u.id = b.owner_id
         WHERE b.visibility = 'public' AND b.archived=0 AND b.owner_id != ?
         ORDER BY b.updated_at DESC LIMIT ?`,
      )
      .all(exceptOwnerId, limit) as (Omit<BoardListing, 'archived' | 'collectionId'> & {
      ownerName: string;
    })[];
  }

  getBoard(id: string) {
    const row = this.sqlite
      .prepare(
        `SELECT b.snapshot, b.revision, b.owner_id AS ownerId, b.visibility, b.archived, u.name AS ownerName,
                b.collection_id AS collectionId
         FROM boards_v2 b LEFT JOIN users u ON u.id = b.owner_id WHERE b.id = ?`,
      )
      .get(id) as
      | {
          snapshot: string;
          revision: number;
          ownerId: string | null;
          visibility: Visibility;
          archived: number;
          ownerName: string | null;
          collectionId: string | null;
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
          archived: Boolean(row.archived),
          collectionId: row.collectionId,
        }
      : undefined;
  }

  /**
   * Saves a revision. A new id becomes a board owned by `ownerId`; an existing one is only
   * saved for its owner or an invited editor of an active board (`'forbidden'` otherwise).
   */
  saveBoard(id: string, snapshot: BoardSnapshot, revision: number, ownerId: string) {
    return this.sqlite.transaction(() => {
      if (this.sqlite.prepare('SELECT id FROM deleted_boards_v2 WHERE id = ?').get(id)) return null;
      const current = this.getBoard(id);
      if (
        current &&
        current.ownerId !== ownerId &&
        (current.archived || !this.isEditor(id, ownerId))
      )
        return 'forbidden' as const;
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

  isEditor(id: string, userId: string) {
    return !!this.sqlite
      .prepare('SELECT 1 FROM board_editors WHERE board_id=? AND user_id=?')
      .get(id, userId);
  }
  listEditors(id: string) {
    return this.sqlite
      .prepare(
        'SELECT u.email,u.name FROM board_editors e JOIN users u ON u.id=e.user_id WHERE e.board_id=? ORDER BY u.name',
      )
      .all(id);
  }
  listSharedBoards(userId: string) {
    return this.sqlite
      .prepare(
        'SELECT b.id,b.title,b.revision,b.updated_at AS updatedAt,u.name AS ownerName FROM board_editors e JOIN boards_v2 b ON b.id=e.board_id JOIN users u ON u.id=b.owner_id WHERE e.user_id=? AND b.archived=0 ORDER BY b.updated_at DESC',
      )
      .all(userId);
  }
  setEditor(id: string, ownerId: string, email: string, enabled: boolean, revision: number) {
    return this.sqlite.transaction(() => {
      const board = this.getBoard(id);
      if (!board || board.ownerId !== ownerId) return 'missing';
      if (board.revision !== revision) return 'conflict';
      const user = this.findUserByEmail(email);
      if (!user || user.id === ownerId) return 'account';
      if (enabled)
        this.sqlite.prepare('INSERT OR IGNORE INTO board_editors VALUES(?,?)').run(id, user.id);
      else
        this.sqlite
          .prepare('DELETE FROM board_editors WHERE board_id=? AND user_id=?')
          .run(id, user.id);
      return 'saved';
    })();
  }

  setArchived(id: string, archived: boolean, revision: number) {
    return (
      this.sqlite
        .prepare(
          'UPDATE boards_v2 SET archived=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?',
        )
        .run(Number(archived), Date.now(), id, revision).changes > 0
    );
  }

  listRevisions(id: string, before = Number.MAX_SAFE_INTEGER) {
    return this.sqlite
      .prepare(
        'SELECT revision,title,saved_at AS savedAt FROM board_revisions WHERE board_id=? AND revision<? ORDER BY revision DESC LIMIT 50',
      )
      .all(id, before) as { revision: number; title: string; savedAt: number }[];
  }

  readRevision(id: string, revision: number) {
    const row = this.sqlite
      .prepare('SELECT document FROM board_revisions WHERE board_id=? AND revision=?')
      .get(id, revision) as { document: string } | undefined;
    return row ? BoardDocumentSchema.nullable().parse(JSON.parse(row.document)) : undefined;
  }

  duplicateBoard(
    id: string,
    ownerId: string,
    revision: number,
    newId: string,
    title?: string,
    fromRevision?: number,
  ) {
    return this.sqlite.transaction(() => {
      const source = this.getBoard(id);
      if (!source || source.ownerId !== ownerId) return 'missing' as const;
      if (source.revision !== revision) return 'conflict' as const;
      const board =
        fromRevision === undefined ? source.snapshot.board : this.readRevision(id, fromRevision);
      if (board === undefined) return 'missing' as const;
      const snapshot = copyBoardSnapshot(board, title);
      this.saveBoard(newId, snapshot, 0, ownerId);
      // A copy is filed beside its source.
      this.sqlite
        .prepare('UPDATE boards_v2 SET collection_id=? WHERE id=?')
        .run(source.collectionId, newId);
      return 'created' as const;
    })();
  }

  listCollections(ownerId: string) {
    return this.sqlite
      .prepare(
        'SELECT id, name, created_at AS createdAt FROM board_collections WHERE owner_id=? ORDER BY name COLLATE NOCASE',
      )
      .all(ownerId) as BoardCollection[];
  }

  private collectionNamed(ownerId: string, name: string) {
    return this.sqlite
      .prepare('SELECT id FROM board_collections WHERE owner_id=? AND name=? COLLATE NOCASE')
      .get(ownerId, name) as { id: string } | undefined;
  }

  ownsCollection(id: string, ownerId: string) {
    return !!this.sqlite
      .prepare('SELECT 1 FROM board_collections WHERE id=? AND owner_id=?')
      .get(id, ownerId);
  }

  createCollection(id: string, ownerId: string, name: string, limit: number) {
    return this.sqlite.transaction(() => {
      if (this.collectionNamed(ownerId, name)) return 'duplicate' as const;
      const { count } = this.sqlite
        .prepare('SELECT count(*) AS count FROM board_collections WHERE owner_id=?')
        .get(ownerId) as { count: number };
      if (count >= limit) return 'limit' as const;
      this.sqlite
        .prepare('INSERT INTO board_collections (id, owner_id, name, created_at) VALUES (?,?,?,?)')
        .run(id, ownerId, name, Date.now());
      return 'created' as const;
    })();
  }

  renameCollection(id: string, ownerId: string, name: string) {
    return this.sqlite.transaction(() => {
      if (!this.ownsCollection(id, ownerId)) return 'missing' as const;
      const existing = this.collectionNamed(ownerId, name);
      if (existing && existing.id !== id) return 'duplicate' as const;
      this.sqlite.prepare('UPDATE board_collections SET name=? WHERE id=?').run(name, id);
      return 'renamed' as const;
    })();
  }

  /** Removes the folder only: its boards stay, ungrouped. */
  deleteCollection(id: string, ownerId: string) {
    return this.sqlite.transaction(() => {
      if (!this.ownsCollection(id, ownerId)) return false;
      this.sqlite.prepare('UPDATE boards_v2 SET collection_id=NULL WHERE collection_id=?').run(id);
      this.sqlite.prepare('DELETE FROM board_collections WHERE id=?').run(id);
      return true;
    })();
  }

  /** Files an owned board; neither its revision nor its update time changes. */
  setBoardCollection(boardId: string, ownerId: string, collectionId: string | null) {
    return this.sqlite.transaction(() => {
      if (this.getBoard(boardId)?.ownerId !== ownerId) return 'missing' as const;
      if (collectionId && !this.ownsCollection(collectionId, ownerId)) return 'collection' as const;
      this.sqlite
        .prepare('UPDATE boards_v2 SET collection_id=? WHERE id=?')
        .run(collectionId, boardId);
      return 'saved' as const;
    })();
  }

  /** Validated JSON per key; see ACCOUNT_SETTING_SCHEMAS. */
  listAccountSettings(userId: string) {
    const rows = this.sqlite
      .prepare('SELECT key, value FROM account_settings WHERE user_id=?')
      .all(userId) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
  }

  saveAccountSetting(userId: string, key: string, value: unknown) {
    this.sqlite
      .prepare(
        `INSERT INTO account_settings (user_id, key, value, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      )
      .run(userId, key, JSON.stringify(value), Date.now());
  }

  /** The account's usage records, oldest first. */
  listUsageRecords(userId: string) {
    const rows = this.sqlite
      .prepare('SELECT record FROM usage_records WHERE user_id=? ORDER BY at, rowid')
      .all(userId) as { record: string }[];
    return rows.map((row) => JSON.parse(row.record) as unknown);
  }

  /** Adds a record, keeping only the newest `limit`. A repeated id is ignored. */
  addUsageRecord(
    userId: string,
    record: { id: string; at: number; boardId?: string | undefined },
    limit: number,
  ) {
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          'INSERT OR IGNORE INTO usage_records (id, user_id, at, board_id, record) VALUES (?,?,?,?,?)',
        )
        .run(record.id, userId, record.at, record.boardId ?? null, JSON.stringify(record));
      this.sqlite
        .prepare(
          `DELETE FROM usage_records WHERE user_id=? AND id NOT IN (
             SELECT id FROM usage_records WHERE user_id=? ORDER BY at DESC, rowid DESC LIMIT ?)`,
        )
        .run(userId, userId, limit);
    })();
  }

  clearUsageRecords(userId: string) {
    this.sqlite.prepare('DELETE FROM usage_records WHERE user_id=?').run(userId);
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

  /** Closes the SQLite connection. */
  close(): void {
    this.sqlite.close();
  }
}

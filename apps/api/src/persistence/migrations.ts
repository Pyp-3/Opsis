/** Append-only SQL catalogue shared with the native host through its fixed contract bundle. */
export const PERSISTENCE_MIGRATIONS = [
  {
    version: 1,
    name: 'archive-and-revision-history',
    sql: `
      ALTER TABLE boards_v2 ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));
      CREATE TABLE board_revisions (
        board_id TEXT NOT NULL REFERENCES boards_v2(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, title TEXT NOT NULL, document TEXT NOT NULL,
        saved_at INTEGER NOT NULL, PRIMARY KEY(board_id,revision)
      );
      INSERT INTO board_revisions SELECT id,revision,title,COALESCE(json_extract(snapshot,'$.board'),'null'),updated_at FROM boards_v2;
      CREATE TRIGGER board_revision_created AFTER INSERT ON boards_v2 BEGIN
        INSERT INTO board_revisions VALUES(NEW.id,NEW.revision,NEW.title,COALESCE(json_extract(NEW.snapshot,'$.board'),'null'),NEW.updated_at);
      END;
      CREATE TRIGGER board_revision_saved AFTER UPDATE OF revision ON boards_v2
      WHEN NEW.revision != OLD.revision BEGIN
        INSERT INTO board_revisions VALUES(NEW.id,NEW.revision,NEW.title,COALESCE(json_extract(NEW.snapshot,'$.board'),'null'),NEW.updated_at);
      END;
    `,
  },
  {
    version: 2,
    name: 'named-board-editors',
    sql: `
    CREATE TABLE board_editors (
      board_id TEXT NOT NULL REFERENCES boards_v2(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(board_id,user_id)
    );
    CREATE INDEX board_editors_user ON board_editors(user_id);
  `,
  },
  {
    version: 3,
    name: 'board-collections',
    sql: `
    CREATE TABLE board_collections (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX board_collections_owner_name ON board_collections(owner_id, name COLLATE NOCASE);
    ALTER TABLE boards_v2 ADD COLUMN collection_id TEXT REFERENCES board_collections(id) ON DELETE SET NULL;
    CREATE INDEX boards_v2_collection ON boards_v2(collection_id);
  `,
  },
  {
    version: 4,
    name: 'account-settings-and-usage',
    sql: `
    CREATE TABLE account_settings (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, key)
    );
    CREATE TABLE usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at INTEGER NOT NULL, board_id TEXT, record TEXT NOT NULL
    );
    CREATE INDEX usage_records_user_at ON usage_records(user_id, at);
  `,
  },
  {
    version: 5,
    name: 'board-tags-and-smart-collections',
    sql: `
    CREATE TABLE board_tags (
      board_id TEXT NOT NULL REFERENCES boards_v2(id) ON DELETE CASCADE,
      tag TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY(board_id, tag)
    );
    CREATE INDEX board_tags_tag ON board_tags(tag);
    CREATE TABLE smart_collections (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, rule TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX smart_collections_owner_name ON smart_collections(owner_id, name COLLATE NOCASE);
  `,
  },
] as const;

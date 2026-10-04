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
] as const;

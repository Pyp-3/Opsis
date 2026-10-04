package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

func (s *Server) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS boards_v2(id TEXT PRIMARY KEY,title TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS deleted_boards_v2(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_keys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_used_at INTEGER);
CREATE TABLE IF NOT EXISTS board_templates(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,board TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS board_templates_owner ON board_templates(owner_id);`)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(`PRAGMA table_info(boards_v2)`)
	if err != nil {
		return err
	}
	owned := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var value any
		if err := rows.Scan(&cid, &name, &typ, &notnull, &value, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == "owner_id" {
			owned = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if !owned {
		if _, err := s.db.Exec(`ALTER TABLE boards_v2 ADD COLUMN owner_id TEXT; ALTER TABLE boards_v2 ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';`); err != nil {
			return err
		}
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS boards_v2_owner ON boards_v2(owner_id)`)
	if err != nil {
		return err
	}
	return s.applyMigrations()
}

type Board struct {
	ID         string
	Snapshot   json.RawMessage
	Revision   int64
	OwnerID    sql.NullString
	OwnerName  sql.NullString
	Visibility string
	Archived   bool
}

type boardReader interface{ QueryRow(string, ...any) *sql.Row }

func (s *Server) readBoard(reader boardReader, id string) (*Board, error) {
	board := &Board{ID: id}
	var snapshot string
	err := reader.QueryRow(`SELECT b.snapshot,b.revision,b.owner_id,b.visibility,u.name,b.archived FROM boards_v2 b LEFT JOIN users u ON u.id=b.owner_id WHERE b.id=?`, id).Scan(&snapshot, &board.Revision, &board.OwnerID, &board.Visibility, &board.OwnerName, &board.Archived)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	board.Snapshot, err = s.contracts.Apply("snapshot", json.RawMessage(snapshot))
	if err != nil {
		return nil, err
	}
	return board, nil
}

func (board *Board) view(user *User) map[string]any {
	access := "viewer"
	if board.OwnerID.String == user.ID {
		access = "owner"
	}
	name := "Unknown"
	if board.OwnerName.Valid {
		name = board.OwnerName.String
	}
	return map[string]any{"id": board.ID, "revision": board.Revision, "snapshot": board.Snapshot, "visibility": board.Visibility, "archived": board.Archived, "access": access, "owner": map[string]string{"name": name}}
}

func snapshotBoard(snapshot json.RawMessage) (json.RawMessage, string, error) {
	var parsed struct {
		Board json.RawMessage `json:"board"`
	}
	if err := json.Unmarshal(snapshot, &parsed); err != nil {
		return nil, "", err
	}
	var board struct {
		Title *string `json:"title"`
	}
	if err := json.Unmarshal(parsed.Board, &board); err != nil {
		return nil, "", err
	}
	title := "Untitled canvas"
	if board.Title != nil {
		title = *board.Title
	}
	return parsed.Board, title, nil
}

// Revision checks, ownership, and tombstones share one immediate transaction.
func (s *Server) saveBoard(id string, snapshot json.RawMessage, revision int64, user string) (string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var deleted int
	if err := tx.QueryRow(`SELECT count(*) FROM deleted_boards_v2 WHERE id=?`, id).Scan(&deleted); err != nil {
		return "", err
	}
	if deleted > 0 {
		return "conflict", nil
	}
	current, err := s.readBoard(tx, id)
	if err != nil {
		return "", err
	}
	if current != nil && current.OwnerID.String != user {
		return "forbidden", nil
	}
	if (current == nil && revision != 0) || (current != nil && current.Revision != revision) {
		return "conflict", nil
	}
	_, title, err := snapshotBoard(snapshot)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(`INSERT INTO boards_v2(id,title,snapshot,revision,updated_at,owner_id) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,snapshot=excluded.snapshot,revision=excluded.revision,updated_at=excluded.updated_at`, id, title, string(snapshot), revision+1, time.Now().UnixMilli(), user)
	if err != nil {
		return "", err
	}
	return "saved", tx.Commit()
}

func (s *Server) listBoards(user string, public bool, includeArchived bool) ([]map[string]any, error) {
	query := `SELECT id,title,revision,updated_at,visibility,NULL,archived FROM boards_v2 WHERE owner_id=? ORDER BY updated_at DESC`
	if public {
		query = `SELECT b.id,b.title,b.revision,b.updated_at,b.visibility,u.name,b.archived FROM boards_v2 b JOIN users u ON u.id=b.owner_id WHERE b.visibility='public' AND b.archived=0 AND b.owner_id!=? ORDER BY b.updated_at DESC LIMIT 100`
	}
	rows, err := s.db.Query(query, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	boards := []map[string]any{}
	for rows.Next() {
		var id, title, visibility string
		var revision, updated int64
		var owner sql.NullString
		var archived bool
		if err := rows.Scan(&id, &title, &revision, &updated, &visibility, &owner, &archived); err != nil {
			return nil, err
		}
		if archived && !includeArchived {
			continue
		}
		board := map[string]any{"archived": archived, "id": id, "title": title, "revision": revision, "updatedAt": updated, "visibility": visibility}
		if public {
			board["ownerName"] = owner.String
		}
		boards = append(boards, board)
	}
	return boards, rows.Err()
}

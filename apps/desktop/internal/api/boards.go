package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/contracts"
	"github.com/google/uuid"
)

func boardMissing() error { return failure(404, "Board not found.") }
func invalidBody(err error, message string) error {
	var invalid *contracts.ValidationError
	if errors.As(err, &invalid) {
		return failure(400, message)
	}
	return err
}

func (s *Server) boardRoutes() {
	s.handle("GET /v1/boards", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		boards, err := s.listBoards(user.ID, false, true)
		if err != nil {
			return err
		}
		writeJSON(w, 200, boards)
		return nil
	})
	s.handle("GET /v1/boards/public", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		boards, err := s.listBoards(user.ID, true, false)
		if err != nil {
			return err
		}
		writeJSON(w, 200, boards)
		return nil
	})
	s.handle("GET /v1/boards/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return failure(400, "Invalid board ID.")
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		if board == nil || (board.OwnerID.String != user.ID && (board.Visibility != "public" || board.Archived)) {
			return boardMissing()
		}
		writeJSON(w, 200, board.view(user))
		return nil
	})
	s.handle("POST /v1/boards", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		var body struct {
			Title      string `json:"title"`
			TemplateID string `json:"templateId"`
		}
		if err := s.body(w, r, "create", &body); err != nil {
			return invalidBody(err, "Enter a board name (1–100 characters).")
		}
		var snapshot json.RawMessage
		if body.TemplateID != "" {
			var raw string
			err := s.db.QueryRow(`SELECT board FROM board_templates WHERE id=? AND owner_id=?`, body.TemplateID, user.ID).Scan(&raw)
			if errors.Is(err, sql.ErrNoRows) {
				return failure(404, "Template not found.")
			}
			if err != nil {
				return err
			}
			snapshot, err = s.contracts.Apply("fromTemplate", map[string]any{"board": json.RawMessage(raw), "title": body.Title})
			if err != nil {
				return err
			}
		} else {
			snapshot, err = s.contracts.Apply("empty", body.Title)
			if err != nil {
				return err
			}
		}
		id := uuid.NewString()
		if _, err := s.saveBoard(id, snapshot, 0, user.ID); err != nil {
			return err
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		writeJSON(w, 201, board.view(user))
		return nil
	})
	s.handle("PUT /v1/boards/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Snapshot json.RawMessage `json:"snapshot"`
			Revision int64           `json:"revision"`
		}
		if !s.validID(id) {
			return failure(400, "Invalid saved board.")
		}
		if err := s.body(w, r, "save", &body); err != nil {
			return invalidBody(err, "Invalid saved board.")
		}
		result, err := s.saveBoard(id, body.Snapshot, body.Revision, user.ID)
		if err != nil {
			return err
		}
		if result == "forbidden" {
			board, err := s.readBoard(s.db, id)
			if err != nil {
				return err
			}
			if board != nil && board.Visibility == "public" && !board.Archived {
				return failure(403, "This board belongs to someone else. Save a copy to edit it.")
			}
			return boardMissing()
		}
		if result == "conflict" {
			return failure(409, "This board changed in another tab. Save as a separate board to preserve your changes, then reopen the original from Saved boards.")
		}
		writeJSON(w, 200, map[string]any{"id": id, "revision": body.Revision + 1})
		return nil
	})
	s.handle("PATCH /v1/boards/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Title      *string `json:"title"`
			Visibility string  `json:"visibility"`
			Archived   *bool   `json:"archived"`
			Revision   int64   `json:"revision"`
		}
		if !s.validID(id) {
			return failure(400, "Invalid board name or revision.")
		}
		if err := s.body(w, r, "update", &body); err != nil {
			return invalidBody(err, "Invalid board name or revision.")
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		board, err := s.readBoard(tx, id)
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		if board.Revision != body.Revision {
			return failure(409, "This board changed in another tab. Reopen the board manager and retry.")
		}
		if body.Archived != nil && *body.Archived != board.Archived {
			if _, err := tx.Exec(`UPDATE boards_v2 SET archived=?,revision=revision+1,updated_at=? WHERE id=?`, *body.Archived, time.Now().UnixMilli(), id); err != nil {
				return err
			}
		}
		if body.Visibility != "" {
			if _, err := tx.Exec(`UPDATE boards_v2 SET visibility=? WHERE id=?`, body.Visibility, id); err != nil {
				return err
			}
		}
		document, title, err := snapshotBoard(board.Snapshot)
		if err != nil {
			return err
		}
		if body.Title != nil && (string(document) == "null" || *body.Title != title) {
			snapshot, err := s.contracts.Apply("rename", map[string]any{"snapshot": board.Snapshot, "title": *body.Title})
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE boards_v2 SET title=?,snapshot=?,revision=revision+1,updated_at=? WHERE id=?`, *body.Title, string(snapshot), time.Now().UnixMilli(), id); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		board, err = s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		writeJSON(w, 200, board.view(user))
		return nil
	})
	s.handle("DELETE /v1/boards/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Revision int64 `json:"revision"`
		}
		if !s.validID(id) {
			return failure(400, "Invalid board ID or revision.")
		}
		if err := s.body(w, r, "delete", &body); err != nil {
			return invalidBody(err, "Invalid board ID or revision.")
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		board, err := s.readBoard(tx, id)
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		if board.Revision != body.Revision {
			return failure(409, "This board changed in another tab. Reopen the board manager before deleting.")
		}
		if _, err := tx.Exec(`INSERT INTO deleted_boards_v2(id) VALUES(?)`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM boards_v2 WHERE id=?`, id); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 204, nil)
		return nil
	})
	s.templateRoutes()
	s.boardHistoryRoutes()
}

func (s *Server) templateRoutes() {
	s.handle("GET /v1/templates", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT id,title,created_at FROM board_templates WHERE owner_id=? ORDER BY created_at DESC`, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		templates := []map[string]any{}
		for rows.Next() {
			var id, title string
			var created int64
			if err := rows.Scan(&id, &title, &created); err != nil {
				return err
			}
			templates = append(templates, map[string]any{"id": id, "title": title, "createdAt": created})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, templates)
		return nil
	})
	s.handle("POST /v1/templates", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		var body struct {
			Title    string `json:"title"`
			BoardID  string `json:"boardId"`
			Revision int64  `json:"revision"`
		}
		if err := s.body(w, r, "template", &body); err != nil {
			return invalidBody(err, "Invalid template name or source board.")
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		board, err := s.readBoard(tx, body.BoardID)
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		if board.Revision != body.Revision {
			return failure(409, "This board changed. Refresh the library and retry.")
		}
		document, _, err := snapshotBoard(board.Snapshot)
		if err != nil {
			return err
		}
		if string(document) == "null" {
			return failure(400, "Add content to this board before saving a template.")
		}
		id := uuid.NewString()
		if _, err := tx.Exec(`INSERT INTO board_templates(id,owner_id,title,board,created_at) VALUES(?,?,?,?,?)`, id, user.ID, body.Title, string(document), time.Now().UnixMilli()); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 201, map[string]string{"id": id, "title": body.Title})
		return nil
	})
	s.handle("DELETE /v1/templates/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return failure(400, "Invalid template ID.")
		}
		result, err := s.db.Exec(`DELETE FROM board_templates WHERE id=? AND owner_id=?`, id, user.ID)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if changed == 0 {
			return failure(404, "Template not found.")
		}
		writeJSON(w, 204, nil)
		return nil
	})
}

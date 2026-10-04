package api

import (
	"database/sql"
	"errors"
	"net/http"
)

func isBoardEditor(reader boardReader, boardID, userID string) (bool, error) {
	var count int
	err := reader.QueryRow(`SELECT count(*) FROM board_editors WHERE board_id=? AND user_id=?`, boardID, userID).Scan(&count)
	return count > 0, err
}

func (s *Server) collaborationRoutes() {
	s.handle("GET /v1/boards/shared", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT b.id,b.title,b.revision,b.updated_at,u.name FROM board_editors e JOIN boards_v2 b ON b.id=e.board_id JOIN users u ON u.id=b.owner_id WHERE e.user_id=? AND b.archived=0 ORDER BY b.updated_at DESC`, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		result := []map[string]any{}
		for rows.Next() {
			var id, title, name string
			var revision, updated int64
			if err := rows.Scan(&id, &title, &revision, &updated, &name); err != nil {
				return err
			}
			result = append(result, map[string]any{"id": id, "title": title, "revision": revision, "updatedAt": updated, "ownerName": name})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, result)
		return nil
	})
	s.handle("GET /v1/boards/{id}/editors", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		board, err := s.readBoard(s.db, r.PathValue("id"))
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		return s.writeEditors(w, board.ID)
	})
	s.handle("PUT /v1/boards/{id}/editors", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		var body struct {
			Email    string `json:"email"`
			Enabled  bool   `json:"enabled"`
			Revision int64  `json:"revision"`
		}
		if err := s.body(w, r, "editor", &body); err != nil {
			return invalidBody(err, "Invalid editor settings.")
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		board, err := s.readBoard(tx, r.PathValue("id"))
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		if board.Revision != body.Revision {
			return failure(409, "Board changed. Refresh and retry.")
		}
		var userID string
		err = tx.QueryRow(`SELECT id FROM users WHERE email=?`, body.Email).Scan(&userID)
		if errors.Is(err, sql.ErrNoRows) || userID == user.ID {
			return failure(400, "Choose another existing account on this server.")
		}
		if err != nil {
			return err
		}
		if body.Enabled {
			_, err = tx.Exec(`INSERT OR IGNORE INTO board_editors VALUES(?,?)`, board.ID, userID)
		} else {
			_, err = tx.Exec(`DELETE FROM board_editors WHERE board_id=? AND user_id=?`, board.ID, userID)
		}
		if err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return s.writeEditors(w, board.ID)
	})
}
func (s *Server) writeEditors(w http.ResponseWriter, id string) error {
	rows, err := s.db.Query(`SELECT u.email,u.name FROM board_editors e JOIN users u ON u.id=e.user_id WHERE e.board_id=? ORDER BY u.name`, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	result := []map[string]string{}
	for rows.Next() {
		var email, name string
		if err := rows.Scan(&email, &name); err != nil {
			return err
		}
		result = append(result, map[string]string{"email": email, "name": name})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, result)
	return nil
}

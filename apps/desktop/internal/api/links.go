package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

func (s *Server) linkRoutes() {
	s.handle("GET /v1/boards/{id}/backlinks", func(w http.ResponseWriter, r *http.Request) error {
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
		editor, err := isBoardEditor(s.db, id, user.ID)
		if err != nil {
			return err
		}
		if board == nil || (board.OwnerID.String != user.ID && (board.Archived || (board.Visibility == "private" && !editor))) {
			return boardMissing()
		}
		// Candidates mention the board's ID; the shared rule finds the linking concepts on every
		// page the account may read.
		rows, err := s.db.Query(`SELECT b.id,b.title,json_extract(b.snapshot,'$.board'),(b.owner_id=? OR EXISTS
      (SELECT 1 FROM board_editors e WHERE e.board_id=b.id AND e.user_id=?))
    FROM boards_v2 b WHERE instr(b.snapshot,?)>0 AND b.archived=0
    AND (b.owner_id=? OR b.visibility='public' OR EXISTS
      (SELECT 1 FROM board_editors e WHERE e.board_id=b.id AND e.user_id=?))
    ORDER BY b.title,b.id`, user.ID, user.ID, id, user.ID, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		links := []json.RawMessage{}
		batch := []map[string]any{}
		flush := func() error {
			if len(batch) == 0 {
				return nil
			}
			found, err := s.contracts.Apply("backlinks", map[string]any{"targetId": id, "boards": batch})
			if err != nil {
				return err
			}
			var parsed []json.RawMessage
			if err := json.Unmarshal(found, &parsed); err != nil {
				return err
			}
			links = append(links, parsed...)
			batch = batch[:0]
			return nil
		}
		for rows.Next() {
			var id, title string
			var document sql.NullString
			var full bool
			if err := rows.Scan(&id, &title, &document, &full); err != nil {
				return err
			}
			board := json.RawMessage("null")
			if document.Valid {
				board = json.RawMessage(document.String)
			}
			batch = append(batch, map[string]any{"id": id, "title": title, "board": board, "fullAccess": full})
			if len(batch) == 50 {
				if err := flush(); err != nil {
					return err
				}
			}
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if err := flush(); err != nil {
			return err
		}
		writeJSON(w, 200, links)
		return nil
	})
}

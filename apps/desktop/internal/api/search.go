package api

import (
	"encoding/json"
	"net/http"
)

// searchBatchBytes keeps each contract call well below the VM's input limit.
const searchBatchBytes = 8_000_000

type searchableBoard struct {
	ID     string          `json:"id"`
	Title  string          `json:"title"`
	Access string          `json:"access"`
	Board  json.RawMessage `json:"board"`
}

// Searches active boards the account owns or was invited to edit, using the shared
// ranking in batches; public boards and archives are excluded.
func (s *Server) searchRoutes() {
	s.handle("GET /v1/search", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		parsed, err := s.contracts.Apply("searchQuery", map[string]string{"q": r.URL.Query().Get("q")})
		if err != nil {
			return invalidBody(err, "Search for 2–200 characters.")
		}
		var query struct {
			Q string `json:"q"`
		}
		if err := json.Unmarshal(parsed, &query); err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT b.id,b.title,b.snapshot,CASE WHEN b.owner_id=? THEN 'owner' ELSE 'editor' END FROM boards_v2 b WHERE b.archived=0 AND (b.owner_id=? OR EXISTS (SELECT 1 FROM board_editors e WHERE e.board_id=b.id AND e.user_id=?)) ORDER BY b.updated_at DESC`, user.ID, user.ID, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		hits := []json.RawMessage{}
		batch := []searchableBoard{}
		size := 0
		flush := func() error {
			if len(batch) == 0 {
				return nil
			}
			raw, err := s.contracts.Apply("search", map[string]any{"query": query.Q, "boards": batch})
			if err != nil {
				return err
			}
			var found []json.RawMessage
			if err := json.Unmarshal(raw, &found); err != nil {
				return err
			}
			hits = append(hits, found...)
			batch, size = batch[:0], 0
			return nil
		}
		for rows.Next() {
			var id, title, snapshot, access string
			if err := rows.Scan(&id, &title, &snapshot, &access); err != nil {
				return err
			}
			var stored struct {
				Board json.RawMessage `json:"board"`
			}
			if err := json.Unmarshal([]byte(snapshot), &stored); err != nil {
				return err
			}
			if size+len(stored.Board) > searchBatchBytes {
				if err := flush(); err != nil {
					return err
				}
			}
			batch = append(batch, searchableBoard{ID: id, Title: title, Access: access, Board: stored.Board})
			size += len(stored.Board)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if err := flush(); err != nil {
			return err
		}
		ranked, err := s.contracts.Apply("searchRank", map[string]any{"hits": hits})
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"results": ranked})
		return nil
	})
}

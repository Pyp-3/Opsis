package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"strings"
	"time"
)

type bundleBoard struct {
	ID    string          `json:"id"`
	Title string          `json:"title"`
	Board json.RawMessage `json:"board"`
	Tags  []string        `json:"tags"`
}
type collectionBundle struct {
	Format  string        `json:"format"`
	Version int           `json:"version"`
	Name    string        `json:"name"`
	Boards  []bundleBoard `json:"boards"`
}

func (s *Server) collectionBundleRoutes() {
	s.handle("GET /v1/collections/{id}/bundle", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var name string
		err = s.db.QueryRow(`SELECT name FROM board_collections WHERE id=? AND owner_id=?`, id, user.ID).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			return collectionMissing()
		}
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT b.id,b.title,COALESCE(json_extract(b.snapshot,'$.board'),'null'),(SELECT json_group_array(tag) FROM board_tags WHERE board_id=b.id) FROM boards_v2 b WHERE b.collection_id=? AND b.owner_id=? ORDER BY b.updated_at DESC`, id, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		bundle := collectionBundle{Format: "opsis-collection", Version: 1, Name: name, Boards: []bundleBoard{}}
		size := 0
		for rows.Next() {
			var entry bundleBoard
			var board, tags string
			if err := rows.Scan(&entry.ID, &entry.Title, &board, &tags); err != nil {
				return err
			}
			size += len(board) + len(tags) + len(entry.Title) + 100
			if len(bundle.Boards) >= 100 || size > 16_000_000 {
				return failure(400, "Export up to 100 boards and 16 MB at a time.")
			}
			entry.Board = json.RawMessage(board)
			if err := json.Unmarshal([]byte(tags), &entry.Tags); err != nil {
				return err
			}
			bundle.Boards = append(bundle.Boards, entry)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		raw, err := s.contracts.Apply("collectionBundle", bundle)
		if err != nil {
			return err
		}
		if len(raw) > 16_000_000 {
			return failure(400, "This collection exceeds the 16 MB bundle limit.")
		}
		writeJSON(w, 200, json.RawMessage(raw))
		return nil
	})
	s.handle("POST /v1/collections/import", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		raw, err := rawBody(w, r, 16_000_000)
		if err != nil {
			return err
		}
		validated, err := s.contracts.Apply("collectionBundle", raw)
		if err != nil {
			return invalidBody(err, "Invalid collection bundle.")
		}
		var bundle collectionBundle
		if err := json.Unmarshal(validated, &bundle); err != nil {
			return err
		}
		ids := make([]string, len(bundle.Boards))
		for i := range ids {
			ids[i] = uuid.NewString()
		}
		prepared, err := s.contracts.Apply("prepareCollectionImport", map[string]any{"bundle": json.RawMessage(validated), "ids": ids})
		if err != nil {
			return err
		}
		var entries []struct {
			ID       string          `json:"id"`
			Title    string          `json:"title"`
			Tags     []string        `json:"tags"`
			Snapshot json.RawMessage `json:"snapshot"`
		}
		if err := json.Unmarshal(prepared, &entries); err != nil {
			return err
		}
		limitRaw, err := s.contracts.Apply("collectionLimit", nil)
		if err != nil {
			return err
		}
		var limit int
		if err := json.Unmarshal(limitRaw, &limit); err != nil {
			return err
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM board_collections WHERE owner_id=?`, user.ID).Scan(&count); err != nil {
			return err
		}
		if count >= limit {
			return failure(400, "Collection limit reached.")
		}
		name := bundle.Name
		for n := 2; ; n++ {
			existing, err := collectionNamed(tx, user.ID, name)
			if err != nil {
				return err
			}
			if existing == "" {
				break
			}
			base := []rune(bundle.Name)
			if len(base) > 48 {
				base = base[:48]
			}
			name = fmt.Sprintf("%s (import %d)", string(base), n)
		}
		collectionID := uuid.NewString()
		now := time.Now().UnixMilli()
		if _, err := tx.Exec(`INSERT INTO board_collections(id,owner_id,name,created_at) VALUES(?,?,?,?)`, collectionID, user.ID, name, now); err != nil {
			return err
		}
		for _, entry := range entries {
			if _, err := tx.Exec(`INSERT INTO boards_v2(id,title,snapshot,revision,updated_at,owner_id,visibility,collection_id) VALUES(?,?,?,1,?,?,'private',?)`, entry.ID, entry.Title, string(entry.Snapshot), now, user.ID, collectionID); err != nil {
				return err
			}
			for _, tag := range entry.Tags {
				if _, err := tx.Exec(`INSERT INTO board_tags(board_id,tag) VALUES(?,?)`, entry.ID, tag); err != nil {
					return err
				}
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 201, map[string]any{"id": collectionID, "name": name, "boards": ids})
		return nil
	})
	s.handle("PUT /v1/collections/{id}/sharing", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Boards []struct {
				ID       string `json:"id"`
				Revision int    `json:"revision"`
			} `json:"boards"`
			Change struct {
				Kind       string `json:"kind"`
				Visibility string `json:"visibility"`
				Email      string `json:"email"`
				Enabled    bool   `json:"enabled"`
			} `json:"change"`
		}
		if err := s.body(w, r, "collectionSharing", &body); err != nil {
			return invalidBody(err, "Invalid collection sharing request.")
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		owned, err := ownsCollection(tx, id, user.ID)
		if err != nil {
			return err
		}
		if !owned {
			return collectionMissing()
		}
		rows, err := tx.Query(`SELECT id,revision FROM boards_v2 WHERE collection_id=? AND owner_id=?`, id, user.ID)
		if err != nil {
			return err
		}
		actual := map[string]int{}
		for rows.Next() {
			var boardID string
			var revision int
			if err := rows.Scan(&boardID, &revision); err != nil {
				rows.Close()
				return err
			}
			actual[boardID] = revision
		}
		rowErr := rows.Err()
		rows.Close()
		if rowErr != nil {
			return rowErr
		}
		expected := map[string]bool{}
		conflict := len(actual) != len(body.Boards)
		for _, board := range body.Boards {
			if actual[board.ID] != board.Revision || expected[board.ID] {
				conflict = true
			}
			expected[board.ID] = true
		}
		if conflict {
			return failure(409, "The collection changed. Reload your boards before sharing.")
		}
		var editorID string
		if body.Change.Kind == "editor" {
			err := tx.QueryRow(`SELECT id FROM users WHERE email=?`, strings.ToLower(body.Change.Email)).Scan(&editorID)
			if errors.Is(err, sql.ErrNoRows) || editorID == user.ID {
				return failure(400, "Choose another existing account.")
			}
			if err != nil {
				return err
			}
		}
		for boardID := range actual {
			if body.Change.Kind == "visibility" {
				_, err = tx.Exec(`UPDATE boards_v2 SET visibility=?,revision=revision+1,updated_at=? WHERE id=?`, body.Change.Visibility, time.Now().UnixMilli(), boardID)
			} else if body.Change.Enabled {
				_, err = tx.Exec(`INSERT OR IGNORE INTO board_editors VALUES(?,?)`, boardID, editorID)
			} else {
				_, err = tx.Exec(`DELETE FROM board_editors WHERE board_id=? AND user_id=?`, boardID, editorID)
			}
			if err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 204, nil)
		return nil
	})
}

package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

const duplicateSmartCollection = "You already have a smart collection with that name."
const invalidSmartCollection = "Name the smart collection and choose at least one condition."
const invalidTags = "Use up to 10 tags of 1–30 characters."

func smartCollectionMissing() error { return failure(404, "Smart collection not found.") }

func (s *Server) listSmartCollections(userID string) ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT id,name,rule,created_at FROM smart_collections WHERE owner_id=? ORDER BY name COLLATE NOCASE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	smart := []map[string]any{}
	for rows.Next() {
		var id, name, rule string
		var created int64
		if err := rows.Scan(&id, &name, &rule, &created); err != nil {
			return nil, err
		}
		smart = append(smart, map[string]any{"id": id, "name": name, "rule": json.RawMessage(rule), "createdAt": created})
	}
	return smart, rows.Err()
}

// Tags and smart collections are owner-private organization: tagging changes neither a
// board's revision nor its update time, and smart collections only filter the listing.
func (s *Server) organizationRoutes() {
	s.handle("PUT /v1/boards/{id}/tags", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Tags []string `json:"tags"`
		}
		if !s.validID(id) {
			return failure(400, invalidTags)
		}
		if err := s.body(w, r, "tags", &body); err != nil {
			return invalidBody(err, invalidTags)
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
		if _, err := tx.Exec(`DELETE FROM board_tags WHERE board_id=?`, id); err != nil {
			return err
		}
		for _, tag := range body.Tags {
			if _, err := tx.Exec(`INSERT INTO board_tags(board_id,tag) VALUES(?,?)`, id, tag); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"id": id, "tags": body.Tags})
		return nil
	})
	s.handle("GET /v1/smart-collections", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		smart, err := s.listSmartCollections(user.ID)
		if err != nil {
			return err
		}
		writeJSON(w, 200, smart)
		return nil
	})
	s.handle("POST /v1/smart-collections", s.saveSmartCollection(true))
	s.handle("PUT /v1/smart-collections/{id}", s.saveSmartCollection(false))
	s.handle("DELETE /v1/smart-collections/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return failure(400, "Invalid smart collection ID.")
		}
		result, err := s.db.Exec(`DELETE FROM smart_collections WHERE id=? AND owner_id=?`, id, user.ID)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if changed == 0 {
			return smartCollectionMissing()
		}
		writeJSON(w, 204, nil)
		return nil
	})
}

// saveSmartCollection creates a smart collection, or replaces an owned one's name and rule.
func (s *Server) saveSmartCollection(create bool) func(http.ResponseWriter, *http.Request) error {
	return func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := uuid.NewString()
		if !create {
			id = r.PathValue("id")
			if !s.validID(id) {
				return failure(400, invalidSmartCollection)
			}
		}
		var body struct {
			Name string          `json:"name"`
			Rule json.RawMessage `json:"rule"`
		}
		if err := s.body(w, r, "smartCollection", &body); err != nil {
			return invalidBody(err, invalidSmartCollection)
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var owned int
		if err := tx.QueryRow(`SELECT count(*) FROM smart_collections WHERE id=? AND owner_id=?`, id, user.ID).Scan(&owned); err != nil {
			return err
		}
		if !create && owned == 0 {
			return smartCollectionMissing()
		}
		var named string
		err = tx.QueryRow(`SELECT id FROM smart_collections WHERE owner_id=? AND name=? COLLATE NOCASE`, user.ID, body.Name).Scan(&named)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if named != "" && named != id {
			return failure(409, duplicateSmartCollection)
		}
		status := 200
		if create {
			status = 201
			raw, err := s.contracts.Apply("smartCollectionLimit", nil)
			if err != nil {
				return err
			}
			var limit, count int
			if err := json.Unmarshal(raw, &limit); err != nil {
				return err
			}
			if err := tx.QueryRow(`SELECT count(*) FROM smart_collections WHERE owner_id=?`, user.ID).Scan(&count); err != nil {
				return err
			}
			if count >= limit {
				return failure(400, fmt.Sprintf("You can have up to %d smart collections.", limit))
			}
			if _, err := tx.Exec(`INSERT INTO smart_collections(id,owner_id,name,rule,created_at) VALUES(?,?,?,?,?)`, id, user.ID, body.Name, string(body.Rule), time.Now().UnixMilli()); err != nil {
				return err
			}
		} else if _, err := tx.Exec(`UPDATE smart_collections SET name=?,rule=? WHERE id=?`, body.Name, string(body.Rule), id); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		smart, err := s.listSmartCollections(user.ID)
		if err != nil {
			return err
		}
		for _, item := range smart {
			if item["id"] == id {
				writeJSON(w, status, item)
				return nil
			}
		}
		return smartCollectionMissing()
	}
}

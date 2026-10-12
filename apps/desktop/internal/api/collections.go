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

const duplicateCollectionName = "You already have a collection with that name in this location."
const invalidCollectionName = "Enter a collection name (1–60 characters)."

func collectionMissing() error { return failure(404, "Collection not found.") }

func ownsCollection(reader boardReader, id, userID string) (bool, error) {
	var count int
	err := reader.QueryRow(`SELECT count(*) FROM board_collections WHERE id=? AND owner_id=?`, id, userID).Scan(&count)
	return count > 0, err
}

// collectionNamed matches a root collection for portable imports, ignoring case.
func collectionNamed(reader boardReader, userID, name string) (string, error) {
	var id string
	err := reader.QueryRow(`SELECT id FROM board_collections WHERE owner_id=? AND parent_id IS NULL AND name=? COLLATE NOCASE`, userID, name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func readCollections(reader interface {
	Query(string, ...any) (*sql.Rows, error)
}, userID string) ([]map[string]any, error) {
	rows, err := reader.Query(`SELECT id,name,parent_id,created_at FROM board_collections WHERE owner_id=? ORDER BY name COLLATE NOCASE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	collections := []map[string]any{}
	for rows.Next() {
		var id, name string
		var created int64
		var parent sql.NullString
		if err := rows.Scan(&id, &name, &parent, &created); err != nil {
			return nil, err
		}
		collections = append(collections, map[string]any{"id": id, "name": name, "parentId": collectionParent(parent), "createdAt": created})
	}
	return collections, rows.Err()
}

func collectionParent(parent sql.NullString) any {
	if parent.Valid {
		return parent.String
	}
	return nil
}

func (s *Server) listCollections(userID string) ([]map[string]any, error) {
	return readCollections(s.db, userID)
}

func (s *Server) validateCollection(operation string, input any) error {
	raw, err := s.contracts.Apply(operation, input)
	if err != nil {
		return err
	}
	var invalid *string
	if err := json.Unmarshal(raw, &invalid); err != nil {
		return err
	}
	if invalid == nil {
		return nil
	}
	switch *invalid {
	case "missing":
		return collectionMissing()
	case "cycle":
		return failure(400, "A collection cannot contain itself or an ancestor.")
	case "duplicate":
		if operation == "collectionDeletion" {
			return failure(409, "Move or rename child collections before deleting: a name already exists in the parent location.")
		}
		return failure(409, duplicateCollectionName)
	}
	return fmt.Errorf("unexpected collection validation result")
}

func (s *Server) writeCollection(w http.ResponseWriter, status int, userID, id string) error {
	collections, err := s.listCollections(userID)
	if err != nil {
		return err
	}
	for _, collection := range collections {
		if collection["id"] == id {
			writeJSON(w, status, collection)
			return nil
		}
	}
	return collectionMissing()
}

// Collections are private per-account folders for owned boards. Filing a board is
// organization, not an edit: it changes neither the revision nor the update time.
func (s *Server) collectionRoutes() {
	s.handle("GET /v1/collections", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		collections, err := s.listCollections(user.ID)
		if err != nil {
			return err
		}
		writeJSON(w, 200, collections)
		return nil
	})
	s.handle("POST /v1/collections", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		var body struct {
			Name     string  `json:"name"`
			ParentID *string `json:"parentId"`
		}
		if err := s.body(w, r, "collection", &body); err != nil {
			return invalidBody(err, invalidCollectionName)
		}
		raw, err := s.contracts.Apply("collectionLimit", nil)
		if err != nil {
			return err
		}
		var limit int
		if err := json.Unmarshal(raw, &limit); err != nil {
			return err
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		id := uuid.NewString()
		collections, err := readCollections(tx, user.ID)
		if err != nil {
			return err
		}
		if err := s.validateCollection("collectionPlacement", map[string]any{"collections": collections, "candidate": map[string]any{"id": id, "name": body.Name, "parentId": body.ParentID}}); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM board_collections WHERE owner_id=?`, user.ID).Scan(&count); err != nil {
			return err
		}
		if count >= limit {
			return failure(400, fmt.Sprintf("You can have up to %d collections.", limit))
		}
		if _, err := tx.Exec(`INSERT INTO board_collections(id,owner_id,name,created_at,parent_id) VALUES(?,?,?,?,?)`, id, user.ID, body.Name, time.Now().UnixMilli(), body.ParentID); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return s.writeCollection(w, 201, user.ID, id)
	})
	s.handle("PATCH /v1/collections/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Name     *string         `json:"name"`
			ParentID json.RawMessage `json:"parentId"`
		}
		if !s.validID(id) {
			return failure(400, invalidCollectionName)
		}
		if err := s.body(w, r, "collectionUpdate", &body); err != nil {
			return invalidBody(err, invalidCollectionName)
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
		collections, err := readCollections(tx, user.ID)
		if err != nil {
			return err
		}
		var candidate map[string]any
		for _, item := range collections {
			if item["id"] == id {
				candidate = map[string]any{"id": item["id"], "name": item["name"], "parentId": item["parentId"]}
				break
			}
		}
		if candidate == nil {
			return collectionMissing()
		}
		if body.Name != nil {
			candidate["name"] = *body.Name
		}
		if body.ParentID != nil {
			var parent *string
			if err := json.Unmarshal(body.ParentID, &parent); err != nil {
				return err
			}
			if parent == nil {
				candidate["parentId"] = nil
			} else {
				candidate["parentId"] = *parent
			}
		}
		if err := s.validateCollection("collectionPlacement", map[string]any{"collections": collections, "candidate": candidate}); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE board_collections SET name=?,parent_id=? WHERE id=?`, candidate["name"], candidate["parentId"], id); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return s.writeCollection(w, 200, user.ID, id)
	})
	s.handle("DELETE /v1/collections/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return failure(400, "Invalid collection ID.")
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
		collections, err := readCollections(tx, user.ID)
		if err != nil {
			return err
		}
		if err := s.validateCollection("collectionDeletion", map[string]any{"collections": collections, "id": id}); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE board_collections SET parent_id=(SELECT parent_id FROM board_collections WHERE id=?) WHERE parent_id=?`, id, id); err != nil {
			return err
		}
		// Removes the folder only: its boards stay, ungrouped.
		if _, err := tx.Exec(`UPDATE boards_v2 SET collection_id=NULL WHERE collection_id=?`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM board_collections WHERE id=?`, id); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 204, nil)
		return nil
	})
	s.handle("PUT /v1/boards/{id}/collection", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			CollectionID *string `json:"collectionId"`
		}
		if !s.validID(id) {
			return failure(400, "Invalid board or collection.")
		}
		if err := s.body(w, r, "collectionAssignment", &body); err != nil {
			return invalidBody(err, "Invalid board or collection.")
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
		if body.CollectionID != nil {
			owned, err := ownsCollection(tx, *body.CollectionID, user.ID)
			if err != nil {
				return err
			}
			if !owned {
				return collectionMissing()
			}
		}
		if _, err := tx.Exec(`UPDATE boards_v2 SET collection_id=? WHERE id=?`, body.CollectionID, id); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"id": id, "collectionId": body.CollectionID})
		return nil
	})
}

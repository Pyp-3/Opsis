package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) boardHistoryRoutes() {
	s.handle("GET /v1/boards/{id}/revisions", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		query := map[string]string{}
		if values, ok := r.URL.Query()["before"]; ok {
			query["before"] = values[0]
		}
		var body struct{ Before *int64 }
		raw, err := s.contracts.Apply("revisionQuery", query)
		if !s.validID(id) {
			return failure(400, "Invalid revision query.")
		}
		if err != nil {
			return invalidBody(err, "Invalid revision query.")
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			return err
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		before := int64(9007199254740991)
		if body.Before != nil {
			before = *body.Before
		}
		rows, err := s.db.Query(`SELECT revision,title,saved_at FROM board_revisions WHERE board_id=? AND revision<? ORDER BY revision DESC LIMIT 50`, id, before)
		if err != nil {
			return err
		}
		defer rows.Close()
		entries := []map[string]any{}
		for rows.Next() {
			var revision, saved int64
			var title string
			if err := rows.Scan(&revision, &title, &saved); err != nil {
				return err
			}
			entries = append(entries, map[string]any{"revision": revision, "title": title, "savedAt": saved})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, entries)
		return nil
	})
	s.handle("GET /v1/boards/{id}/revisions/{revision}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		revision, err := strconv.ParseInt(r.PathValue("revision"), 10, 64)
		if err != nil || revision < 1 || revision > 9007199254740991 || !s.validID(id) {
			return failure(400, "Invalid revision.")
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return err
		}
		if board == nil || board.OwnerID.String != user.ID {
			return boardMissing()
		}
		var document string
		err = s.db.QueryRow(`SELECT document FROM board_revisions WHERE board_id=? AND revision=?`, id, revision).Scan(&document)
		if errors.Is(err, sql.ErrNoRows) {
			return boardMissing()
		}
		if err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"revision": revision, "board": json.RawMessage(document)})
		return nil
	})
	s.handle("POST /v1/boards/{id}/duplicate", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		id := r.PathValue("id")
		var body struct {
			Revision     int64
			Title        *string
			FromRevision *int64
		}
		if !s.validID(id) {
			return failure(400, "Invalid copy request.")
		}
		if err := s.body(w, r, "duplicate", &body); err != nil {
			return invalidBody(err, "Invalid copy request.")
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		source, err := s.readBoard(tx, id)
		if err != nil {
			return err
		}
		if source == nil || source.OwnerID.String != user.ID {
			return boardMissing()
		}
		if source.Revision != body.Revision {
			return failure(409, "This board changed. Refresh the library and retry.")
		}
		document, _, err := snapshotBoard(source.Snapshot)
		if err != nil {
			return err
		}
		if body.FromRevision != nil {
			var raw string
			err := tx.QueryRow(`SELECT document FROM board_revisions WHERE board_id=? AND revision=?`, id, *body.FromRevision).Scan(&raw)
			if errors.Is(err, sql.ErrNoRows) {
				return boardMissing()
			}
			if err != nil {
				return err
			}
			document = json.RawMessage(raw)
		}
		input := map[string]any{"board": document}
		if body.Title != nil {
			input["title"] = *body.Title
		}
		snapshot, err := s.contracts.Apply("copy", input)
		if err != nil {
			return err
		}
		_, title, err := snapshotBoard(snapshot)
		if err != nil {
			return err
		}
		newID := uuid.NewString()
		if _, err := tx.Exec(`INSERT INTO boards_v2(id,title,snapshot,revision,updated_at,owner_id) VALUES(?,?,?,1,?,?)`, newID, title, string(snapshot), time.Now().UnixMilli(), user.ID); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		board, err := s.readBoard(s.db, newID)
		if err != nil {
			return err
		}
		writeJSON(w, 201, board.view(user))
		return nil
	})
}

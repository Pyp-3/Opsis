package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
)

var threadUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// removeThreadSessions removes deleted chat threads' native CLI sessions, transcripts included,
// keyed like sessionKey in sessions.ts. Cleanup is best effort: the threads are already gone.
func (s *Server) removeThreadSessions(threads [][2]string) {
	for _, thread := range threads {
		if threadUUID.MatchString(thread[1]) {
			_, _ = harness.RemoveSession(thread[0]+"/"+strings.ToLower(thread[1]), s.transcriptHomes)
		}
	}
}

// Threads are scoped to the signed-in account, independently of board editors.
func (s *Server) chatRoutes() {
	authorize := func(r *http.Request) (string, string, error) {
		who := current(r)
		if who.User == nil || who.ViaAgent {
			return "", "", failure(401, "Sign in to use private chat.")
		}
		id := r.PathValue("id")
		if !s.validID(id) {
			return "", "", boardMissing()
		}
		board, err := s.readBoard(s.db, id)
		if err != nil {
			return "", "", err
		}
		editor, err := isBoardEditor(s.db, id, who.User.ID)
		if err != nil {
			return "", "", err
		}
		if board == nil || (board.OwnerID.String != who.User.ID && (board.Archived || (board.Visibility == "private" && !editor))) {
			return "", "", boardMissing()
		}
		return who.User.ID, id, nil
	}
	s.handle("GET /v1/boards/{id}/chat", func(w http.ResponseWriter, r *http.Request) error {
		user, id, err := authorize(r)
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT document,revision,updated_at FROM board_chat_threads WHERE user_id=? AND board_id=? ORDER BY updated_at DESC`, user, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		entries := []map[string]any{}
		for rows.Next() {
			var document string
			var revision, updated int64
			if err := rows.Scan(&document, &revision, &updated); err != nil {
				return err
			}
			var entry map[string]any
			if err := json.Unmarshal([]byte(document), &entry); err != nil {
				return err
			}
			entry["revision"] = revision
			entry["updatedAt"] = updated
			entries = append(entries, entry)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, entries)
		return nil
	})
	s.handle("PUT /v1/boards/{id}/chat", func(w http.ResponseWriter, r *http.Request) error {
		user, id, err := authorize(r)
		if err != nil {
			return err
		}
		var body struct {
			Revision int            `json:"revision"`
			Thread   map[string]any `json:"thread"`
		}
		if err := s.body(w, r, "chatWrite", &body); err != nil {
			return invalidBody(err, "Invalid chat thread.")
		}
		threadID := body.Thread["id"].(string)
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var revision int
		var document string
		err = tx.QueryRow(`SELECT revision,document FROM board_chat_threads WHERE user_id=? AND board_id=? AND id=?`, user, id, threadID).Scan(&revision, &document)
		exists := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if revision != body.Revision {
			return failure(409, "This thread changed elsewhere. Reload it before sending.")
		}
		if exists {
			var before map[string]any
			if err := json.Unmarshal([]byte(document), &before); err != nil {
				return err
			}
			if before["agent"] != body.Thread["agent"] || before["model"] != body.Thread["model"] {
				return failure(409, "This thread changed elsewhere. Reload it before sending.")
			}
		} else {
			var count int
			if err := tx.QueryRow(`SELECT count(*) FROM board_chat_threads WHERE user_id=? AND board_id=?`, user, id).Scan(&count); err != nil {
				return err
			}
			if count >= 30 {
				return failure(400, "Keep up to 30 threads per board. Delete an older thread first.")
			}
		}
		raw, err := json.Marshal(body.Thread)
		if err != nil {
			return err
		}
		updated := time.Now().UnixMilli()
		if _, err := tx.Exec(`INSERT INTO board_chat_threads VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,board_id,id) DO UPDATE SET document=excluded.document,revision=excluded.revision,updated_at=excluded.updated_at`, user, id, threadID, string(raw), revision+1, updated); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		body.Thread["revision"] = revision + 1
		body.Thread["updatedAt"] = updated
		writeJSON(w, 200, body.Thread)
		return nil
	})
	s.handle("DELETE /v1/boards/{id}/chat/{threadId}", func(w http.ResponseWriter, r *http.Request) error {
		user, id, err := authorize(r)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`DELETE FROM board_chat_threads WHERE user_id=? AND board_id=? AND id=?`, user, id, r.PathValue("threadId")); err != nil {
			return err
		}
		s.removeThreadSessions([][2]string{{user, r.PathValue("threadId")}})
		writeJSON(w, 204, nil)
		return nil
	})
}

// boardChatThreads lists every account's threads on a board as (account, thread) pairs.
func boardChatThreads(tx *sql.Tx, board string) ([][2]string, error) {
	rows, err := tx.Query(`SELECT user_id,id FROM board_chat_threads WHERE board_id=?`, board)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var threads [][2]string
	for rows.Next() {
		var thread [2]string
		if err := rows.Scan(&thread[0], &thread[1]); err != nil {
			return nil, err
		}
		threads = append(threads, thread)
	}
	return threads, rows.Err()
}

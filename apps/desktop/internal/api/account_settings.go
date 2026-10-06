package api

import (
	"encoding/json"
	"net/http"
	"time"
)

// Preferences and usage history belong to the signed-in account, not a browser.
// Values are validated by the shared contracts and stored as opaque JSON.
func (s *Server) accountSettingsRoutes() {
	s.handle("GET /v1/account/settings", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT key,value FROM account_settings WHERE user_id=?`, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		values := map[string]json.RawMessage{}
		for rows.Next() {
			var key, value string
			if err := rows.Scan(&key, &value); err != nil {
				return err
			}
			values[key] = json.RawMessage(value)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"values": values})
		return nil
	})
	s.handle("PUT /v1/account/settings/{key}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		data, err := rawBody(w, r, 1_048_576)
		if err != nil {
			return err
		}
		var body struct {
			Value json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(data, &body); err != nil {
			return failure(400, "Invalid setting.")
		}
		parsed, err := s.contracts.Apply("accountSetting", map[string]any{"key": r.PathValue("key"), "value": body.Value})
		if err != nil {
			return invalidBody(err, "Invalid setting.")
		}
		var setting struct {
			Key   string          `json:"key"`
			Value json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(parsed, &setting); err != nil {
			return err
		}
		if _, err := s.db.Exec(`INSERT INTO account_settings(user_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, user.ID, setting.Key, string(setting.Value), time.Now().UnixMilli()); err != nil {
			return err
		}
		writeJSON(w, 204, nil)
		return nil
	})
	s.handle("GET /v1/account/usage", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT record FROM usage_records WHERE user_id=? ORDER BY at,rowid`, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		records := []json.RawMessage{}
		for rows.Next() {
			var record string
			if err := rows.Scan(&record); err != nil {
				return err
			}
			records = append(records, json.RawMessage(record))
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, records)
		return nil
	})
	s.handle("POST /v1/account/usage", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		data, err := rawBody(w, r, 1_048_576)
		if err != nil {
			return err
		}
		parsed, err := s.contracts.Apply("usageRecord", data)
		if err != nil {
			return invalidBody(err, "Invalid usage record.")
		}
		var record struct {
			ID      string  `json:"id"`
			At      int64   `json:"at"`
			BoardID *string `json:"boardId"`
		}
		if err := json.Unmarshal(parsed, &record); err != nil {
			return err
		}
		raw, err := s.contracts.Apply("usageLimit", nil)
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
		if _, err := tx.Exec(`INSERT OR IGNORE INTO usage_records(id,user_id,at,board_id,record) VALUES(?,?,?,?,?)`, record.ID, user.ID, record.At, record.BoardID, string(parsed)); err != nil {
			return err
		}
		// Keep only the newest records for this account.
		if _, err := tx.Exec(`DELETE FROM usage_records WHERE user_id=? AND id NOT IN (SELECT id FROM usage_records WHERE user_id=? ORDER BY at DESC,rowid DESC LIMIT ?)`, user.ID, user.ID, limit); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		writeJSON(w, 204, nil)
		return nil
	})
	s.handle("DELETE /v1/account/usage", func(w http.ResponseWriter, r *http.Request) error {
		user, err := requireUser(r)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`DELETE FROM usage_records WHERE user_id=?`, user.ID); err != nil {
			return err
		}
		writeJSON(w, 204, nil)
		return nil
	})
}

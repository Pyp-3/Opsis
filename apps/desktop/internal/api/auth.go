package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/contracts"
	"github.com/google/uuid"
	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
)

func randomToken(size int) string {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(data)
}
func digest(token string) string {
	value := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(value[:])
}
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash, err := scrypt.Key([]byte(norm.NFKC.String(password)), salt, 1<<15, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return "scrypt$" + base64.RawURLEncoding.EncodeToString(salt) + "$" + base64.RawURLEncoding.EncodeToString(hash), nil
}
func verifyPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(expected) != 64 {
		return false
	}
	actual, err := scrypt.Key([]byte(norm.NFKC.String(password)), salt, 1<<15, 8, 1, len(expected))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func internalRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || (host != "127.0.0.1" && host != "::1" && host != "::ffff:127.0.0.1") {
		return false
	}
	for _, header := range []string{"Origin", "Sec-Fetch-Site", "Sec-Fetch-Dest", "X-Forwarded-For", "Forwarded"} {
		if r.Header.Get(header) != "" {
			return false
		}
	}
	return true
}

func scanUser(row *sql.Row) (*User, error) {
	var user User
	err := row.Scan(&user.ID, &user.Email, &user.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &user, err
}

func (s *Server) authenticate(r *http.Request) (identity, error) {
	if cookie, err := r.Cookie("opsis_session"); err == nil {
		user, err := scanUser(s.db.QueryRow(`SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, digest(cookie.Value), time.Now().UnixMilli()))
		if err != nil {
			return identity{}, err
		}
		if user != nil {
			return identity{User: user}, nil
		}
	}
	bearer, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if hasBearer && strings.HasPrefix(bearer, "opsis_agent_") && !strings.ContainsAny(bearer, " \t\r\n") && internalRequest(r) {
		user, err := scanUser(s.db.QueryRow(`SELECT u.id,u.email,u.name FROM agent_keys k JOIN users u ON u.id=k.user_id WHERE k.token_hash=?`, digest(bearer)))
		if err != nil {
			return identity{}, err
		}
		if user != nil {
			_, err = s.db.Exec(`UPDATE agent_keys SET last_used_at=? WHERE token_hash=?`, time.Now().UnixMilli(), digest(bearer))
			return identity{User: user, ViaAgent: true}, err
		}
	}
	return identity{}, nil
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user User, status int) error {
	token := randomToken(32)
	now := time.Now().UnixMilli()
	if _, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at<?`, now); err != nil {
		return err
	}
	if _, err := s.db.Exec(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)`, digest(token), user.ID, now, now+30*86400000); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: "opsis_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 86400, Secure: r.TLS != nil})
	writeJSON(w, status, map[string]any{"user": user})
	return nil
}

func authValidation(err error) error {
	var validation *contracts.ValidationError
	if errors.As(err, &validation) {
		return &httpError{400, validation}
	}
	return err
}

func (s *Server) authRoutes() {
	s.handle("POST /v1/auth/signup", func(w http.ResponseWriter, r *http.Request) error {
		var body struct{ Name, Email, Password string }
		if err := s.body(w, r, "signup", &body); err != nil {
			return authValidation(err)
		}
		password, err := hashPassword(body.Password)
		if err != nil {
			return err
		}
		tx, err := s.db.BeginTx(r.Context(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM users WHERE email=?`, body.Email).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return &httpError{409, map[string]string{"message": "An account with this email already exists. Log in instead.", "field": "email"}}
		}
		if err := tx.QueryRow(`SELECT count(*) FROM users`).Scan(&count); err != nil {
			return err
		}
		user := User{ID: uuid.NewString(), Email: body.Email, Name: body.Name}
		if _, err := tx.Exec(`INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)`, user.ID, user.Email, user.Name, password, time.Now().UnixMilli()); err != nil {
			return err
		}
		if count == 0 {
			if _, err := tx.Exec(`UPDATE boards_v2 SET owner_id=? WHERE owner_id IS NULL`, user.ID); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return s.startSession(w, r, user, 201)
	})
	s.handle("POST /v1/auth/login", func(w http.ResponseWriter, r *http.Request) error {
		var body struct{ Email, Password string }
		if err := s.body(w, r, "login", &body); err != nil {
			return authValidation(err)
		}
		var user User
		var password string
		err := s.db.QueryRow(`SELECT id,email,name,password FROM users WHERE email=?`, body.Email).Scan(&user.ID, &user.Email, &user.Name, &password)
		found := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if !found {
			password = s.dummyHash
		}
		valid := verifyPassword(body.Password, password)
		if !found || !valid {
			return failure(401, "That email and password don’t match.")
		}
		return s.startSession(w, r, user, 200)
	})
	s.handle("POST /v1/auth/logout", func(w http.ResponseWriter, r *http.Request) error {
		if cookie, err := r.Cookie("opsis_session"); err == nil {
			if _, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash=?`, digest(cookie.Value)); err != nil {
				return err
			}
		}
		http.SetCookie(w, &http.Cookie{Name: "opsis_session", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1, Secure: r.TLS != nil})
		writeJSON(w, 204, nil)
		return nil
	})
	s.handle("GET /v1/auth/me", func(w http.ResponseWriter, r *http.Request) error {
		user := current(r).User
		if user == nil {
			return failure(401, "Not signed in.")
		}
		writeJSON(w, 200, map[string]any{"user": user})
		return nil
	})
	sessionOnly := func(r *http.Request) (*User, error) {
		who := current(r)
		if who.User == nil || who.ViaAgent {
			return nil, failure(401, "Sign in to manage agent keys.")
		}
		return who.User, nil
	}
	s.handle("GET /v1/auth/agent-keys", func(w http.ResponseWriter, r *http.Request) error {
		user, err := sessionOnly(r)
		if err != nil {
			return err
		}
		rows, err := s.db.Query(`SELECT id,name,created_at,last_used_at FROM agent_keys WHERE user_id=? ORDER BY created_at DESC`, user.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		keys := []map[string]any{}
		for rows.Next() {
			var id, name string
			var created int64
			var used sql.NullInt64
			if err := rows.Scan(&id, &name, &created, &used); err != nil {
				return err
			}
			var last any
			if used.Valid {
				last = used.Int64
			}
			keys = append(keys, map[string]any{"id": id, "name": name, "createdAt": created, "lastUsedAt": last})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		writeJSON(w, 200, keys)
		return nil
	})
	s.handle("POST /v1/auth/agent-keys", func(w http.ResponseWriter, r *http.Request) error {
		user, err := sessionOnly(r)
		if err != nil {
			return err
		}
		var body struct{ Name string }
		if err := s.body(w, r, "key", &body); err != nil {
			return failure(400, "Name the key (1–60 characters).")
		}
		key := "opsis_agent_" + randomToken(24)
		id := uuid.NewString()
		if _, err := s.db.Exec(`INSERT INTO agent_keys(id,user_id,name,token_hash,created_at) VALUES(?,?,?,?,?)`, id, user.ID, body.Name, digest(key), time.Now().UnixMilli()); err != nil {
			return err
		}
		writeJSON(w, 201, map[string]string{"id": id, "name": body.Name, "key": key})
		return nil
	})
	s.handle("DELETE /v1/auth/agent-keys/{id}", func(w http.ResponseWriter, r *http.Request) error {
		user, err := sessionOnly(r)
		if err != nil {
			return err
		}
		result, err := s.db.Exec(`DELETE FROM agent_keys WHERE id=? AND user_id=?`, r.PathValue("id"), user.ID)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if changed == 0 {
			return failure(404, "Key not found.")
		}
		writeJSON(w, 204, nil)
		return nil
	})
}

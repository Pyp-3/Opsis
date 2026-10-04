package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/contracts"
	_ "github.com/mattn/go-sqlite3"
)

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}
type identity struct {
	User     *User
	ViaAgent bool
}
type identityKey struct{}
type httpError struct {
	status int
	body   any
}

func (e *httpError) Error() string { return "HTTP request failed" }
func failure(status int, message string) error {
	return &httpError{status, map[string]any{"message": message}}
}

type Server struct {
	db         *sql.DB
	contracts  *contracts.Contracts
	mux        *http.ServeMux
	fallback   http.Handler
	dummyHash  string
	rateMu     sync.Mutex
	requests   map[string][]time.Time
	rateLimit  int
	rateWindow time.Duration
}

func New(database string, fallback http.Handler) (*Server, error) {
	if database != ":memory:" {
		absolute, err := filepath.Abs(database)
		if err != nil {
			return nil, err
		}
		database = absolute
		if err := os.MkdirAll(filepath.Dir(database), 0700); err != nil {
			return nil, err
		}
	}
	dsn := database
	if database != ":memory:" {
		dsn = (&url.URL{Scheme: "file", Path: database}).String()
	}
	dsn += "?_busy_timeout=5000&_foreign_keys=on&_journal_mode=WAL&_txlock=immediate"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	c, err := contracts.New()
	if err != nil {
		db.Close()
		return nil, err
	}
	s := &Server{db: db, contracts: c, mux: http.NewServeMux(), fallback: fallback, requests: make(map[string][]time.Time), rateLimit: 60, rateWindow: time.Minute}
	if value, err := strconv.Atoi(os.Getenv("OPSIS_RATE_LIMIT")); err == nil && value > 0 {
		s.rateLimit = value
	}
	if value, err := strconv.Atoi(os.Getenv("OPSIS_RATE_WINDOW_MS")); err == nil && value > 0 {
		s.rateWindow = time.Duration(value) * time.Millisecond
	}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	s.dummyHash, err = hashPassword("nonexistent-account-" + randomToken(16))
	if err != nil {
		db.Close()
		return nil, err
	}
	s.routes()
	return s, nil
}

func (s *Server) Close() error { return s.db.Close() }

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func (s *Server) handle(pattern string, handler func(http.ResponseWriter, *http.Request) error) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if err := handler(w, r); err != nil {
			var response *httpError
			if errors.As(err, &response) {
				writeJSON(w, response.status, response.body)
			} else {
				writeJSON(w, 500, map[string]any{"code": "internal_error", "message": "Opsis could not complete that request.", "stage": "request", "retryable": true})
			}
		}
	})
}

func (s *Server) body(w http.ResponseWriter, r *http.Request, operation string, out any) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return failure(415, "Expected application/json.")
	}
	limit := int64(1_048_576)
	if operation == "save" {
		limit = 20_000_000
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return failure(413, "Request body is too large.")
	}
	if !json.Valid(data) {
		return failure(400, "Invalid JSON.")
	}
	parsed, err := s.contracts.Apply(operation, json.RawMessage(data))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(parsed, out); err != nil {
		return &contracts.ValidationError{Message: "Invalid request value."}
	}
	return nil
}

func (s *Server) validID(id string) bool {
	_, err := s.contracts.Apply("id", map[string]string{"id": id})
	return err == nil
}
func current(r *http.Request) identity {
	value, _ := r.Context().Value(identityKey{}).(identity)
	return value
}
func requireUser(r *http.Request) (*User, error) {
	user := current(r).User
	if user == nil {
		return nil, failure(401, "Sign in to continue.")
	}
	return user, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/health" && !strings.HasPrefix(r.URL.Path, "/v1/speech") && !s.allow(r) {
		writeJSON(w, 429, map[string]any{"code": "rate_limit_exceeded", "message": "Too many requests. Wait a minute and try again.", "stage": "request", "retryable": true})
		return
	}
	identity, err := s.authenticate(r)
	if err != nil {
		writeJSON(w, 500, map[string]string{"message": "Opsis could not read the session."})
		return
	}
	s.mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, identity)))
}

func (s *Server) allow(r *http.Request) bool {
	bucket := "work"
	allowance := s.rateLimit
	if strings.HasPrefix(r.URL.Path, "/v1/auth/") {
		bucket = "auth"
	}
	if r.Method == "GET" && (r.URL.Path == "/v1/boards" || (strings.HasPrefix(r.URL.Path, "/v1/boards/") && s.validID(strings.TrimPrefix(r.URL.Path, "/v1/boards/")))) {
		bucket = "board-read"
		allowance *= 10
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	key := host + ":" + bucket
	now := time.Now()
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	recent := s.requests[key]
	first := 0
	for first < len(recent) && now.Sub(recent[first]) >= s.rateWindow {
		first++
	}
	recent = recent[first:]
	if len(recent) >= allowance {
		s.requests[key] = recent
		return false
	}
	s.requests[key] = append(recent, now)
	return true
}

func (s *Server) routes() {
	s.handle("GET /v1/health", func(w http.ResponseWriter, _ *http.Request) error {
		writeJSON(w, 200, map[string]string{"status": "ok"})
		return nil
	})
	s.authRoutes()
	s.boardRoutes()
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Kokoro inference is the only remaining Node service.
		if s.fallback != nil && (r.URL.Path == "/v1/speech" || strings.HasPrefix(r.URL.Path, "/v1/speech/")) {
			s.fallback.ServeHTTP(w, r)
			return
		}
		writeJSON(w, 404, map[string]string{"message": "Route not found."})
	})
}

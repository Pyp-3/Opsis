package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/contracts"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/generation"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
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
	providerKeys *generation.ProviderKeys
	db           *sql.DB
	contracts    *contracts.Contracts
	mux          *http.ServeMux
	fallback     http.Handler
	dummyHash    string
	rateMu       sync.Mutex
	requests     map[string][]time.Time
	rateLimit    int
	rateWindow   time.Duration
	// Where the CLIs keep the transcripts of deleted chat threads' native sessions.
	transcriptHomes harness.TranscriptHomes
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
		dsn = fileURI(database, "")
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
	s := &Server{db: db, contracts: c, mux: http.NewServeMux(), fallback: fallback, requests: make(map[string][]time.Time), rateLimit: 60, rateWindow: time.Minute, transcriptHomes: harness.DefaultTranscriptHomes()}
	s.providerKeys, err = generation.NewProviderKeys(database)
	if err != nil {
		db.Close()
		return nil, err
	}
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
	s.providerKeyRoutes()
	s.linkRoutes()
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

// rawBody reads a bounded JSON request body without validating its shape.
func rawBody(w http.ResponseWriter, r *http.Request, limit int64) (json.RawMessage, error) {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return nil, failure(415, "Expected application/json.")
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return nil, failure(413, "Request body is too large.")
	}
	if !json.Valid(data) {
		return nil, failure(400, "Invalid JSON.")
	}
	return json.RawMessage(data), nil
}

func (s *Server) body(w http.ResponseWriter, r *http.Request, operation string, out any) error {
	limit := int64(1_048_576)
	if operation == "save" {
		limit = 20_000_000
	}
	data, err := rawBody(w, r, limit)
	if err != nil {
		return err
	}
	parsed, err := s.contracts.Apply(operation, data)
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
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if strings.HasPrefix(r.URL.Path, "/v1/") {
		w.Header().Set("Cache-Control", "no-store")
	}
	if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" && r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		writeJSON(w, 403, map[string]string{"message": "Cross-site writes are not allowed."})
		return
	}
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
	if r.Method == "GET" && (r.URL.Path == "/v1/boards" || (strings.HasPrefix(r.URL.Path, "/v1/boards/") && s.validID(strings.TrimPrefix(r.URL.Path, "/v1/boards/"))) || (strings.HasPrefix(r.URL.Path, "/v1/guest/boards/") && s.validID(strings.TrimPrefix(r.URL.Path, "/v1/guest/boards/")))) {
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
	// The desktop app is always a local install: open sign-up and account-chosen CLI paths.
	// Only the Fastify host's personal server mode (docs/SERVER.md) narrows these.
	s.handle("GET /v1/instance", func(w http.ResponseWriter, _ *http.Request) error {
		writeJSON(w, 200, map[string]bool{"signup": true, "accountExecutablePaths": true})
		return nil
	})
	s.authRoutes()
	s.boardRoutes()
	s.accountSettingsRoutes()
	s.chatRoutes()
	s.collectionBundleRoutes()
	// Board previews for agents are rasterised by the local Node service, after sign-in here.
	s.handle("POST /v1/render", func(w http.ResponseWriter, r *http.Request) error {
		if current(r).User == nil {
			return failure(401, "Sign in to continue.")
		}
		if s.fallback == nil {
			return failure(503, "Previews need the desktop's local Node service, which is not running.")
		}
		s.fallback.ServeHTTP(w, r)
		return nil
	})
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Kokoro inference is the only remaining Node service.
		if s.fallback != nil && (r.URL.Path == "/v1/speech" || strings.HasPrefix(r.URL.Path, "/v1/speech/")) {
			if r.Method == "POST" && r.URL.Path == "/v1/speech" && current(r).User == nil {
				if err := s.allowGuestNarration(w, r); err != nil {
					var response *httpError
					if errors.As(err, &response) {
						writeJSON(w, response.status, response.body)
					} else {
						writeJSON(w, 500, map[string]string{"message": "Opsis could not check this narration."})
					}
					return
				}
			}
			s.fallback.ServeHTTP(w, r)
			return
		}
		writeJSON(w, 404, map[string]string{"message": "Route not found."})
	})
}

// allowGuestNarration lets someone who is not signed in hear only the script of a board shared
// with them by link (or public): the line must be one the player speaks for that board, on the
// pages they may see. The body is read once and restored for the speech service.
func (s *Server) allowGuestNarration(w http.ResponseWriter, r *http.Request) error {
	data, err := rawBody(w, r, 65_536)
	if err != nil {
		return err
	}
	r.Body = io.NopCloser(bytes.NewReader(data))
	var body struct {
		Text  string `json:"text"`
		Board *struct {
			ID   string `json:"id"`
			Page string `json:"page"`
		} `json:"board"`
	}
	refused := failure(403, "The narrator only reads the script of a board you can open.")
	if err := json.Unmarshal(data, &body); err != nil || body.Board == nil || !s.validID(body.Board.ID) {
		return refused
	}
	board, err := s.readBoard(s.db, body.Board.ID)
	if err != nil {
		return err
	}
	if board == nil || board.Archived || board.Visibility == "private" {
		return refused
	}
	document, _, err := snapshotBoard(board.Snapshot)
	if err != nil {
		return err
	}
	if string(document) == "null" {
		return refused
	}
	input := map[string]any{"board": document, "text": body.Text}
	if body.Board.Page != "" {
		input["page"] = body.Board.Page
	}
	allowed, err := s.contracts.Apply("narrationAllowed", input)
	if err != nil {
		return refused
	}
	if string(allowed) != "true" {
		return refused
	}
	return nil
}

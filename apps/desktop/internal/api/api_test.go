package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

type testClient struct {
	t      *testing.T
	server *Server
	cookie *http.Cookie
	key    string
}

func (c *testClient) request(method, path string, body any, status int) map[string]any {
	c.t.Helper()
	result, _ := c.raw(method, path, body, status).(map[string]any)
	return result
}

// raw decodes any JSON response, such as a list.
func (c *testClient) raw(method, path string, body any, status int) any {
	c.t.Helper()
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("Content-Type", "application/json")
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	if c.key != "" {
		r.Header.Set("Authorization", "Bearer "+c.key)
	}
	w := httptest.NewRecorder()
	c.server.ServeHTTP(w, r)
	if w.Code != status {
		c.t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, status, w.Body.String())
	}
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == "opsis_session" {
			c.cookie = cookie
		}
	}
	var result any
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	return result
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	t.Setenv("OPSIS_RATE_LIMIT", "10000")
	s, err := New(filepath.Join(t.TempDir(), "opsis.sqlite"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func signup(t *testing.T, s *Server, email string) *testClient {
	c := &testClient{t: t, server: s}
	c.request("POST", "/v1/auth/signup", map[string]string{"name": email, "email": email, "password": "test-password"}, 201)
	return c
}

func TestAccountsBoardsConflictsHistoryAndTombstones(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "owner@example.test")
	viewer := signup(t, s, "viewer@example.test")
	board := owner.request("POST", "/v1/boards", map[string]any{"title": "Original"}, 201)
	id := board["id"].(string)
	path := "/v1/boards/" + id
	viewer.request("GET", path, nil, 404)
	owner.request("PATCH", path, map[string]any{"visibility": "public", "revision": 1}, 200)
	public := viewer.request("GET", path, nil, 200)
	if public["access"] != "viewer" {
		t.Fatal("public board writable")
	}
	viewer.request("PUT", path, map[string]any{"snapshot": board["snapshot"], "revision": 1}, 403)
	owner.request("PATCH", path, map[string]any{"title": "Renamed", "revision": 1}, 200)
	current := owner.request("GET", path, nil, 200)
	snapshot := current["snapshot"].(map[string]any)
	if len(snapshot["past"].([]any)) != 1 || current["revision"] != float64(2) {
		t.Fatal("rename/history contract changed")
	}
	owner.request("PUT", path, map[string]any{"snapshot": board["snapshot"], "revision": 1}, 409)
	owner.request("DELETE", path, map[string]any{"revision": 1}, 409)
	owner.request("DELETE", path, map[string]any{"revision": 2}, 204)
	owner.request("PUT", path, map[string]any{"snapshot": board["snapshot"], "revision": 0}, 409)
	owner.request("GET", path, nil, 404)
	owner.request("POST", "/v1/auth/logout", nil, 204)
	owner.request("GET", "/v1/auth/me", nil, 401)
	owner.request("POST", "/v1/auth/login", map[string]string{"email": "OWNER@EXAMPLE.TEST", "password": "test-password"}, 200)
	owner.request("GET", "/v1/auth/me", nil, 200)
}

func TestAgentKeysAreLocalRevocableAndCannotMintKeys(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "agent@example.test")
	key := owner.request("POST", "/v1/auth/agent-keys", map[string]string{"name": "Local agent"}, 201)
	agent := &testClient{t: t, server: s, key: key["key"].(string)}
	agent.request("POST", "/v1/boards", map[string]string{"title": "Agent board"}, 201)
	agent.request("POST", "/v1/auth/agent-keys", map[string]string{"name": "Forbidden"}, 401)
	for _, header := range []string{"Origin", "Sec-Fetch-Site", "Sec-Fetch-Dest", "X-Forwarded-For", "Forwarded"} {
		r := httptest.NewRequest("GET", "/v1/auth/me", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("Authorization", "Bearer "+agent.key)
		r.Header.Set(header, "browser-or-proxy")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("accepted browser/proxy agent key with %s", header)
		}
	}
	owner.request("DELETE", "/v1/auth/agent-keys/"+key["id"].(string), nil, 204)
	agent.request("GET", "/v1/auth/me", nil, 401)
}

func TestTemplatesKeepIndependentSnapshots(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "templates@example.test")
	board := owner.request("POST", "/v1/boards", map[string]string{"title": "Source"}, 201)
	template := owner.request("POST", "/v1/templates", map[string]any{"title": "Reusable", "boardId": board["id"], "revision": 1}, 201)
	owner.request("DELETE", "/v1/boards/"+board["id"].(string), map[string]int{"revision": 1}, 204)
	copy := owner.request("POST", "/v1/boards", map[string]any{"title": "Copy", "templateId": template["id"]}, 201)
	snapshot := copy["snapshot"].(map[string]any)
	if len(snapshot["past"].([]any)) != 0 || snapshot["board"].(map[string]any)["title"] != "Copy" {
		t.Fatal("template did not reset history/title")
	}
}

func TestMigratesExistingDataAndKeepsSessionsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "opsis.sqlite")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE historical_pipeline(id TEXT PRIMARY KEY,payload TEXT); INSERT INTO historical_pipeline VALUES('old','keep me'); CREATE TABLE boards_v2(id TEXT PRIMARY KEY,title TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO boards_v2 VALUES('4a909073-6e3a-42e6-b577-8263f72767df','Old board','{"board":null,"past":[],"future":[]}',1,1);`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner := signup(t, s, "legacy@example.test")
	owner.request("GET", "/v1/boards/4a909073-6e3a-42e6-b577-8263f72767df", nil, 200)
	s.Close()
	restarted, err := New(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	owner.server = restarted
	owner.request("GET", "/v1/auth/me", nil, 200)
	var payload string
	if err := restarted.db.QueryRow(`SELECT payload FROM historical_pipeline WHERE id='old'`).Scan(&payload); err != nil || payload != "keep me" {
		t.Fatal("historical data lost")
	}
}

func TestFallbackPreservesStreaming(t *testing.T) {
	fallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = io.WriteString(w, "{\"type\":\"result\"}\n")
	})
	s, err := New(":memory:", fallback)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/v1/speech", nil))
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestRenameNullBoardCreatesDocumentEvenWithDefaultTitle(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "empty@example.test")
	path := "/v1/boards/4a909073-6e3a-42e6-b577-8263f72767df"
	owner.request("PUT", path, map[string]any{"snapshot": map[string]any{"board": nil, "past": []any{}, "future": []any{}}, "revision": 0}, 200)
	renamed := owner.request("PATCH", path, map[string]any{"title": "Untitled canvas", "revision": 1}, 200)
	snapshot := renamed["snapshot"].(map[string]any)
	if snapshot["board"] == nil || renamed["revision"] != float64(2) {
		t.Fatal("renaming an empty snapshot did not create a board")
	}
	owner.request("PATCH", path, map[string]any{"title": "Invalid revision", "revision": 1e30}, 400)
}

func TestDesktopIsALocalInstance(t *testing.T) {
	c := &testClient{t: t, server: newTestServer(t)}
	got := c.request("GET", "/v1/instance", nil, 200)
	if got["signup"] != true || got["accountExecutablePaths"] != true || len(got) != 2 {
		t.Fatalf("desktop instance = %v, want open sign-up and account CLI paths", got)
	}
}

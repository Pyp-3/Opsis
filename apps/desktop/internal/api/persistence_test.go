package api

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestArchiveCopiesAndPrivateRevisionHistory(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "archive-owner@example.test")
	viewer := signup(t, s, "archive-viewer@example.test")
	original := owner.request("POST", "/v1/boards", map[string]any{"title": "Original"}, 201)
	id := original["id"].(string)
	path := "/v1/boards/" + id
	owner.request("PATCH", path, map[string]any{"revision": 1, "title": "Updated"}, 200)
	owner.request("PATCH", path, map[string]any{"revision": 2, "visibility": "public"}, 200)
	viewer.request("GET", path, nil, 200)
	viewer.request("GET", path+"/revisions", nil, 404)
	viewer.request("GET", path+"/revisions/1", nil, 404)
	viewer.request("POST", path+"/duplicate", map[string]any{"revision": 2}, 404)
	owner.request("POST", path+"/duplicate", map[string]any{"revision": 1}, 409)
	copy := owner.request("POST", path+"/duplicate", map[string]any{"revision": 2}, 201)
	copied := copy["snapshot"].(map[string]any)
	if copy["visibility"] != "private" || copy["id"] == id || len(copied["past"].([]any)) != 0 || copied["board"].(map[string]any)["title"] != "Updated (copy)" {
		t.Fatal("copy is not independent/private")
	}
	archived := owner.request("PATCH", path, map[string]any{"revision": 2, "archived": true}, 200)
	if archived["revision"] != float64(3) || archived["archived"] != true {
		t.Fatal("archive not revision guarded")
	}
	viewer.request("GET", path, nil, 404)
	owner.request("PUT", path, map[string]any{"revision": 2, "snapshot": original["snapshot"]}, 409)
	revision := owner.request("GET", path+"/revisions/1", nil, 200)
	if revision["board"].(map[string]any)["title"] != "Original" {
		t.Fatal("history changed")
	}
	owner.request("GET", path+"/revisions?before=nope", nil, 400)
	restored := owner.request("POST", path+"/duplicate", map[string]any{"revision": 3, "fromRevision": 1}, 201)
	if restored["snapshot"].(map[string]any)["board"].(map[string]any)["title"] != "Original (copy)" || restored["archived"] != false {
		t.Fatal("revision copy incorrect")
	}
	owner.request("PATCH", path, map[string]any{"revision": 3, "archived": false}, 200)
	viewer.request("GET", path, nil, 200)
	owner.request("DELETE", path, map[string]any{"revision": 4}, 204)
	owner.request("GET", path+"/revisions", nil, 404)
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM board_revisions WHERE board_id=?`, id).Scan(&count); err != nil || count != 0 {
		t.Fatal("deleted revisions retained", err)
	}
	owner.request("PUT", path, map[string]any{"revision": 0, "snapshot": original["snapshot"]}, 409)
}

func TestMigratesAndRestoresArchivedDataWithHistory(t *testing.T) {
	folder := t.TempDir()
	source := filepath.Join(folder, "source.sqlite")
	backup := filepath.Join(folder, "backup.sqlite")
	restored := filepath.Join(folder, "restored.sqlite")
	old, err := sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = old.Exec(`CREATE TABLE boards_v2(id TEXT PRIMARY KEY,title TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL); CREATE TABLE legacy_data(value TEXT); INSERT INTO legacy_data VALUES('keep'); INSERT INTO boards_v2 VALUES('8f572533-39fc-41ca-8d76-f55266eab2dd','Legacy','{"board":null,"past":[],"future":[]}',5,100);`)
	old.Close()
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(source, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	owner := signup(t, s, "backup@example.test")
	path := "/v1/boards/8f572533-39fc-41ca-8d76-f55266eab2dd"
	owner.request("PATCH", path, map[string]any{"revision": 5, "archived": true}, 200)
	if err := ImportDatabase(source, backup); err != nil {
		t.Fatal(err)
	}
	if err := ImportDatabase(backup, restored); err != nil {
		t.Fatal(err)
	}
	copied, err := New(restored, nil)
	if err != nil {
		t.Fatal(err)
	}
	reader := &testClient{t: t, server: copied, cookie: owner.cookie}
	board := reader.request("GET", path, nil, 200)
	if board["archived"] != true || board["revision"] != float64(6) {
		t.Fatal("archived state lost")
	}
	reader.request("GET", path+"/revisions/5", nil, 200)
	reader.request("GET", path+"/revisions/6", nil, 200)
	var legacy string
	if err := copied.db.QueryRow(`SELECT value FROM legacy_data`).Scan(&legacy); err != nil || legacy != "keep" {
		t.Fatal("legacy data lost", err)
	}
	copied.Close()
	reopened, err := New(restored, nil)
	if err != nil {
		t.Fatal("migration not idempotent", err)
	}
	defer reopened.Close()
	var count int
	if err := reopened.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil || count != 1 {
		t.Fatal("migration ledger incorrect", err)
	}
}

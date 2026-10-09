package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
)

// Deleting a chat thread, or the board holding it, removes that account's native CLI sessions,
// transcripts included, and leaves the reader's other CLI sessions alone.
func TestDeletingChatThreadsRemovesTheirCLISessions(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	t.Setenv("TEMP", os.Getenv("TMPDIR"))
	t.Setenv("TMP", os.Getenv("TMPDIR"))
	s := newTestServer(t)
	homes := harness.TranscriptHomes{Claude: filepath.Join(t.TempDir(), "claude"), Codex: filepath.Join(t.TempDir(), "codex")}
	s.transcriptHomes = homes
	owner := signup(t, s, "owner@example.com")
	editor := signup(t, s, "editor@example.com")
	accountOf := func(c *testClient) string {
		return c.request("GET", "/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	}
	board := owner.request("POST", "/v1/boards", map[string]any{"title": "Shared"}, 201)
	path := "/v1/boards/" + board["id"].(string)
	owner.request("PUT", path+"/editors", map[string]any{"email": "editor@example.com", "enabled": true, "revision": 1}, 200)

	write := func(file string) string {
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
		return file
	}
	exists := func(file string) bool { _, err := os.Stat(file); return err == nil }
	// Each thread has used one session; the reader also has an unrelated Claude session.
	type thread struct {
		client     *testClient
		id         string
		provider   string
		session    string
		transcript string
	}
	threads := []thread{
		{owner, "6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d", "claude", "00000000-0000-4000-8000-000000000001", ""},
		{owner, "7f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d", "codex", "0f0e0d0c-0b0a-4908-8706-050403020100", ""},
		{editor, "8f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d", "claude", "00000000-0000-4000-8000-000000000003", ""},
	}
	readers := write(filepath.Join(homes.Claude, "projects", "-home-reader", "11111111-2222-4333-8444-555555555555.jsonl"))
	for index := range threads {
		item := &threads[index]
		if item.provider == "claude" {
			item.transcript = write(filepath.Join(homes.Claude, "projects", "-tmp-opsis-thread", item.session+".jsonl"))
		} else {
			item.transcript = write(filepath.Join(homes.Codex, "sessions", "2026", "10", "09", "rollout-2026-10-09T10-00-00-"+item.session+".jsonl"))
		}
		item.client.request("PUT", path+"/chat", map[string]any{"revision": 0, "thread": map[string]any{
			"id": item.id, "agent": "demo", "model": "built-in",
			"messages": []map[string]string{{"role": "user", "text": "Explain this"}},
		}}, 200)
		state := `{"provider":"` + item.provider + `","model":"m","id":"` + item.session + `","turns":1,"transcripts":[{"provider":"` + item.provider + `","id":"` + item.session + `","day":"2026-10-09"}]}`
		if err := harness.WriteSession(accountOf(item.client)+"/"+item.id, state); err != nil {
			t.Fatal(err)
		}
	}

	// Another account deleting the same thread id removes only its own (absent) session.
	editor.request("DELETE", path+"/chat/"+threads[0].id, nil, 204)
	if !exists(threads[0].transcript) {
		t.Fatal("another account's delete removed the owner's transcript")
	}
	owner.request("DELETE", path+"/chat/"+threads[0].id, nil, 204)
	if exists(threads[0].transcript) || !exists(threads[1].transcript) {
		t.Fatal("deleting a thread did not remove exactly its transcript")
	}
	directory, _ := harness.SessionDirectory(accountOf(owner) + "/" + threads[0].id)
	if exists(directory) {
		t.Fatal("the deleted thread's session directory remains")
	}
	current := owner.request("GET", path, nil, 200)
	owner.request("DELETE", path, map[string]any{"revision": current["revision"]}, 204)
	if exists(threads[1].transcript) || exists(threads[2].transcript) {
		t.Fatal("deleting the board left its threads' transcripts")
	}
	if !exists(readers) {
		t.Fatal("an unrelated CLI session was removed")
	}
}

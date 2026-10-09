package harness

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveSessionValidatesIdsAndSearchesEveryDayWithoutOne(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	t.Setenv("TEMP", os.Getenv("TMPDIR"))
	t.Setenv("TMP", os.Getenv("TMPDIR"))
	homes := TranscriptHomes{Claude: filepath.Join(t.TempDir(), "claude"), Codex: filepath.Join(t.TempDir(), "codex")}
	const id = "0f0e0d0c-0b0a-4908-8706-050403020100"
	rollout := filepath.Join(homes.Codex, "sessions", "2025", "01", "31", "rollout-2025-01-31T10-00-00-"+id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(rollout), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rollout, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	// A state from before sessions were listed names only its current session, without a day.
	key := "account-1/6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d"
	state := `{"provider":"codex","model":"m","id":"` + id + `","turns":3,"transcripts":[{"provider":"claude","id":"../../escape"},{"provider":"kimi","id":"` + id + `"}]}`
	if err := WriteSession(key, state); err != nil {
		t.Fatal(err)
	}
	if listed := sessionTranscripts(state); len(listed) != 1 || listed[0].Provider != "codex" || listed[0].Day != "" {
		t.Fatalf("unexpected sessions: %+v", listed)
	}
	removed, err := RemoveSession(key, homes)
	if err != nil || removed != 1 {
		t.Fatalf("removed %d: %v", removed, err)
	}
	if _, err := os.Stat(rollout); !os.IsNotExist(err) {
		t.Fatal("rollout remains")
	}
	if _, err := RemoveSession("../escape/x", homes); err == nil {
		t.Fatal("unsafe key accepted")
	}
}

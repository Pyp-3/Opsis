package generation

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
)

const sessionThread = "6f9d4c3a-1b2e-4f5a-8c7d-9e0f1a2b3c4d"
const codexSession = "0f0e0d0c-0b0a-4908-8706-050403020100"

// sessionRunner answers like Codex and records how each turn ran.
type sessionRunner struct {
	graph string
	runs  []harness.Request
}

func (r *sessionRunner) Run(_ context.Context, request harness.Request, _ func(string)) (string, error) {
	if len(request.Args) == 1 && request.Args[0] == "--version" {
		return "codex-cli 0.159.0", nil
	}
	r.runs = append(r.runs, request)
	message, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]string{"type": "agent_message", "text": r.graph}})
	return `{"type":"thread.started","thread_id":"` + codexSession + `"}` + "\n" + string(message) + "\n", nil
}

func TestChatThreadsResumeTheirCodexSessionPerAccount(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	t.Setenv("TEMP", os.Getenv("TMPDIR"))
	t.Setenv("TMP", os.Getenv("TMPDIR"))
	file := filepath.Join(t.TempDir(), "codex"+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", file)
	runner := &sessionRunner{}
	engine := engineFor(t, runner)
	demo, err := engine.Run(context.Background(), "generate", []byte(`{"agent":"demo","prompt":"email"}`), nil)
	var answer map[string]json.RawMessage
	if err != nil || json.Unmarshal(demo.Body, &answer) != nil || answer["turn"] == nil {
		t.Fatalf("demo reply missing: %v %s", err, demo.Body)
	}
	delete(answer, "turn")
	graph, _ := json.Marshal(answer)
	runner.graph = string(graph)
	body, _ := json.Marshal(map[string]any{"agent": "codex", "prompt": "Explain email", "thread": sessionThread})
	for turn := 0; turn < 2; turn++ {
		result, err := engine.RunAs(context.Background(), "generate", body, "account-1", nil)
		if err != nil || result.Status != 200 {
			t.Fatalf("turn %d: %v %s", turn, err, result.Body)
		}
	}
	directory, err := harness.SessionDirectory("account-1/" + sessionThread)
	if err != nil {
		t.Fatal(err)
	}
	first, second := runner.runs[0], runner.runs[1]
	if first.Directory != directory || second.Directory != directory {
		t.Fatalf("session directory not stable: %s %s", first.Directory, second.Directory)
	}
	if strings.Contains(strings.Join(first.Args, " "), "--ephemeral") {
		t.Fatal("a thread's first turn was not saved")
	}
	if !strings.Contains(strings.Join(second.Args, " "), "exec resume "+codexSession+" -") {
		t.Fatalf("second turn did not resume: %v", second.Args)
	}
	if !strings.HasPrefix(second.Stdin, "Continue as Opsis in this session") {
		t.Fatal("resumed turn resent the full instructions")
	}
	// Without an account, or for another account, nothing is resumed.
	if _, err := engine.RunAs(context.Background(), "generate", body, "", nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(runner.runs[2].Args, " "), "--ephemeral") {
		t.Fatal("a request without an account used a session")
	}
	if _, err := engine.RunAs(context.Background(), "generate", body, "account-2", nil); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(runner.runs[3].Args, " "), "resume") {
		t.Fatal("another account resumed the session")
	}
	if _, err := harness.SessionDirectory("../escape/" + sessionThread); err == nil {
		t.Fatal("unsafe session key accepted")
	}
}

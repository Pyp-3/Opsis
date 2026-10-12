package generation

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
)

// limitRunner plays both CLIs' no-call limit checks.
type limitRunner struct {
	mu     sync.Mutex
	checks map[string]int
	t      *testing.T
}

func (f *limitRunner) Run(_ context.Context, request harness.Request, _ func(string)) (string, error) {
	codex := strings.Contains(filepath.Base(request.Executable), "codex")
	if len(request.Args) == 1 && request.Args[0] == "--version" {
		if codex {
			return "codex-cli 0.159.0", nil
		}
		return "2.1.296 (Claude Code)", nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if codex {
		f.checks["codex"]++
		if !slices.Equal(request.Args, []string{"app-server"}) || request.Until == nil ||
			!strings.Contains(request.Stdin, `"account/rateLimits/read"`) {
			f.t.Errorf("codex check: %v", request.Args)
		}
		answer := `{"id":2,"result":{"ordinaryUsageAllowed":true,"rateLimits":{"limitId":"codex","primary":{"usedPercent":28,"windowDurationMins":10080,"resetsAt":1792295860},"planType":"prolite"}}}`
		if request.Until(`{"id":1,"result":{}}`) || !request.Until(answer) {
			f.t.Error("codex check stops on the wrong line")
		}
		return `{"id":1,"result":{}}` + "\n" + answer + "\n", nil
	}
	f.checks["claude"]++
	if !slices.Contains(request.Args, "/usage") || !slices.Contains(request.Args, "opsis-limit-check-no-model-call") ||
		!slices.Contains(request.Environment, "TZ=UTC") || request.Until != nil {
		f.t.Errorf("claude check: %v", request.Args)
	}
	return `{"type":"result","is_error":false,"num_turns":0,"result":"Current session: 12% used · resets Oct 12, 9:30pm (UTC)\nCurrent week (all models): 41% used · resets Oct 17, 11am (UTC)"}`, nil
}

func fakeExecutable(t *testing.T, agent string) {
	file := filepath.Join(t.TempDir(), agent+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_"+strings.ToUpper(agent)+"_BIN", file)
}

func TestLimitsCheckBothCLIsOnceAndMergeRequestReports(t *testing.T) {
	fakeExecutable(t, "claude")
	fakeExecutable(t, "codex")
	runner := &limitRunner{checks: map[string]int{}, t: t}
	engine, err := New(runner)
	if err != nil {
		t.Fatal(err)
	}
	limits := NewLimits(engine)
	limits.Refresh(context.Background(), LimitProviders)
	limits.Refresh(context.Background(), LimitProviders)
	if runner.checks["claude"] != 1 || runner.checks["codex"] != 1 {
		t.Fatalf("checks within the interval: %v", runner.checks)
	}
	read := func() map[string]map[string]any {
		data, _ := json.Marshal(limits.Snapshot())
		var snapshot struct {
			Providers []map[string]any `json:"providers"`
		}
		_ = json.Unmarshal(data, &snapshot)
		result := map[string]map[string]any{}
		for _, item := range snapshot.Providers {
			result[item["provider"].(string)] = item
		}
		return result
	}
	snapshot := read()
	codex := snapshot["codex"]["limits"].(map[string]any)
	if codex["plan"] != "prolite" || codex["windows"].([]any)[0].(map[string]any)["usedPercent"] != 28.0 {
		t.Fatalf("codex limits: %v", snapshot["codex"])
	}
	claude := snapshot["claude"]["limits"].(map[string]any)
	if len(claude["windows"].([]any)) != 2 || snapshot["claude"]["problem"] != nil {
		t.Fatalf("claude limits: %v", snapshot["claude"])
	}

	// A request's report updates only the window it names.
	limits.Observe(context.Background(), json.RawMessage(`{"provider":"claude","status":"warning","windows":[{"id":"session","label":"Session (5 hours)","models":null,"usedPercent":85,"resetsAt":"2026-10-12T21:30:00.000Z","windowMinutes":300}],"plan":null,"observedAt":"2026-10-12T18:00:00.000Z","source":"request"}`))
	windows := read()["claude"]["limits"].(map[string]any)["windows"].([]any)
	if len(windows) != 2 || windows[0].(map[string]any)["usedPercent"] != 85.0 || windows[1].(map[string]any)["usedPercent"] != 41.0 {
		t.Fatalf("merged windows: %v", windows)
	}
	limits.Observe(context.Background(), json.RawMessage(`{"provider":"grok"}`))
	if _, ok := read()["grok"]; ok {
		t.Fatal("unknown provider recorded")
	}
}

func TestLimitsReportAMissingCLI(t *testing.T) {
	t.Setenv("OPSIS_CLAUDE_BIN", filepath.Join(t.TempDir(), "missing"))
	engine, err := New(&limitRunner{checks: map[string]int{}, t: t})
	if err != nil {
		t.Fatal(err)
	}
	limits := NewLimits(engine)
	limits.Refresh(context.Background(), []string{"claude"})
	data, _ := json.Marshal(limits.Snapshot())
	if !strings.Contains(string(data), "not installed") {
		t.Fatalf("missing CLI: %s", data)
	}
}

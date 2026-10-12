package harness

import (
	"context"
	"encoding/json"
	"os"
	"time"
)

// LimitCheck is the shared no-call limit check (apps/api/src/harness/limits.ts): Claude's local
// `/usage` command, or Codex's `account/rateLimits/read` over its app-server's stdio.
type LimitCheck struct {
	Executable  string
	Args        []string
	Stdin       string
	Environment map[string]string
	// UntilResponseID keeps stdin open until the JSON-RPC response with this ID arrives.
	UntilResponseID *int
	Timeout         time.Duration
}

// CheckLimits runs a limit check in a private, disposable directory and returns its stdout.
func CheckLimits(ctx context.Context, runner Runner, check LimitCheck) (string, error) {
	directory, err := os.MkdirTemp("", "opsis-limits-")
	if err != nil {
		return "", Error("harness_missing")
	}
	defer os.RemoveAll(directory)
	environment := ChildEnvironment()
	for key, value := range check.Environment {
		environment = append(environment, key+"="+value)
	}
	request := Request{
		Executable:  check.Executable,
		Args:        check.Args,
		Stdin:       check.Stdin,
		Directory:   directory,
		Environment: environment,
		Timeout:     min(max(check.Timeout, time.Second), 60*time.Second),
		MaxInput:    4096,
		MaxOutput:   2_000_000,
		MaxError:    2_000_000,
	}
	if check.UntilResponseID != nil {
		id := *check.UntilResponseID
		request.Until = func(line string) bool {
			var message struct {
				ID *int `json:"id"`
			}
			return json.Unmarshal([]byte(line), &message) == nil && message.ID != nil && *message.ID == id
		}
	}
	return runner.Run(ctx, request, nil)
}

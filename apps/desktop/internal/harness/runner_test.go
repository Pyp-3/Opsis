package harness

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunnerStreamsAndBoundsRealChildProcesses(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node needed for fake CLI fixtures")
	}
	runner := ProcessRunner{Node: node}
	directory := t.TempDir()
	script := filepath.Join(directory, "fake.mjs")
	if err := os.WriteFile(script, []byte(`process.stdout.write('first\n'); setTimeout(() => process.stdout.write('last\n'), 30);`), 0600); err != nil {
		t.Fatal(err)
	}
	// Successful startup is not a deadline test: loaded race-test runners can take
	// more than a second to launch Node. The deadline behavior is checked below.
	request := Request{Executable: script, Directory: directory, Environment: ChildEnvironment(), Timeout: 15 * time.Second, MaxInput: 100, MaxOutput: 100, MaxError: 100}
	lines := []string{}
	output, err := runner.Run(context.Background(), request, func(line string) { lines = append(lines, line) })
	if err != nil || output != "first\nlast\n" || len(lines) != 2 {
		t.Fatalf("stream: %q %v %v", output, lines, err)
	}
	request.MaxOutput = 2
	_, err = runner.Run(context.Background(), request, nil)
	if !errors.Is(err, Error("harness_overflow")) {
		t.Fatal(err)
	}
	request.MaxOutput = 100
	request.Stdin = strings.Repeat("x", 101)
	_, err = runner.Run(context.Background(), request, nil)
	if !errors.Is(err, Error("harness_overflow")) {
		t.Fatal(err)
	}
}

func TestRunnerCancelsAndTimesOutRealChildProcesses(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node needed for fake CLI fixtures")
	}
	runner := ProcessRunner{Node: node}
	directory := t.TempDir()
	script := filepath.Join(directory, "fake.mjs")
	if err := os.WriteFile(script, []byte(`process.stdout.write('ready\n'); setInterval(() => {}, 1000);`), 0600); err != nil {
		t.Fatal(err)
	}
	request := Request{Executable: script, Directory: directory, Environment: ChildEnvironment(), Timeout: 100 * time.Millisecond, MaxInput: 100, MaxOutput: 100, MaxError: 100}
	_, err = runner.Run(context.Background(), request, nil)
	if !errors.Is(err, Error("harness_timeout")) {
		t.Fatal(err)
	}
	// Reproduce startup slower than the old one-second cancellation-test deadline.
	// Cancellation must be driven by readiness, with a separate watchdog for hangs.
	if err := os.WriteFile(script, []byte(`setTimeout(() => process.stdout.write('ready\n'), 1500); setInterval(() => {}, 1000);`), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request.Timeout = 15 * time.Second
	ready := false
	_, err = runner.Run(ctx, request, func(line string) {
		if line != "ready" {
			t.Errorf("unexpected readiness line: %q", line)
			return
		}
		ready = true
		cancel()
	})
	if !ready {
		t.Fatal("child never signalled readiness before cancellation", err)
	}
	if !errors.Is(err, Error("harness_cancelled")) {
		t.Fatal(err)
	}
}

func TestDiscoveryDoesNotSkipAnUnsafeFirstInstallation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not available on Windows")
	}
	first, second := t.TempDir(), t.TempDir()
	for _, directory := range []string{first, second} {
		if err := os.WriteFile(filepath.Join(directory, "codex"), []byte("fixture"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(filepath.Join(first, "codex"), 0777); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", "")
	t.Setenv("PATH", first+string(os.PathListSeparator)+second)
	if _, err := ResolveAgent("codex"); !errors.Is(err, Error("harness_config")) {
		t.Fatal("unsafe first CLI was skipped", err)
	}
	t.Setenv("OPSIS_CODEX_BIN", filepath.Join(second, "codex"))
	if _, err := ResolveAgent("codex"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", "relative/codex")
	if _, err := ResolveAgent("codex"); !errors.Is(err, Error("harness_config")) {
		t.Fatal("relative override accepted", err)
	}
}

func TestCompletionTimeoutIsBounded(t *testing.T) {
	for seconds, want := range map[int]time.Duration{0: 180 * time.Second, 180: 180 * time.Second, 600: 600 * time.Second, 3600: MaxCompletionTimeout} {
		if got := completionTimeout(seconds); got != want {
			t.Errorf("completionTimeout(%d) = %v, want %v", seconds, got, want)
		}
	}
}

func TestRunnerKeepsInputOpenUntilTheAnswer(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node needed for fake CLI fixtures")
	}
	runner := ProcessRunner{Node: node}
	directory := t.TempDir()
	script := filepath.Join(directory, "app-server.mjs")
	// Like Codex's app-server: answers each request line, and exits as soon as input ends.
	if err := os.WriteFile(script, []byte(`process.stdin.on('end', () => process.exit(3));
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let at; (at = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(at + 1)) {
    const message = JSON.parse(buffer.slice(0, at));
    setTimeout(() => process.stdout.write(JSON.stringify({ id: message.id }) + '\n'), 20);
  }
});`), 0600); err != nil {
		t.Fatal(err)
	}
	request := Request{Executable: script, Stdin: "{\"id\":1}\n{\"id\":2}\n", Directory: directory, Environment: ChildEnvironment(), Timeout: 15 * time.Second, MaxInput: 100, MaxOutput: 100, MaxError: 100, Until: func(line string) bool { return line == `{"id":2}` }}
	output, err := runner.Run(context.Background(), request, nil)
	if err != nil || output != "{\"id\":1}\n{\"id\":2}\n" {
		t.Fatalf("answer: %q %v", output, err)
	}
	request.Until = func(string) bool { return false }
	request.Timeout = 300 * time.Millisecond
	if _, err := runner.Run(context.Background(), request, nil); !errors.Is(err, Error("harness_timeout")) {
		t.Fatalf("an answer that never comes must time out: %v", err)
	}
}

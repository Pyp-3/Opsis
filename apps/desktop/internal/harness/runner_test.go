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
	request := Request{Executable: script, Directory: directory, Environment: ChildEnvironment(), Timeout: time.Second, MaxInput: 100, MaxOutput: 100, MaxError: 100}
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
	_ = os.WriteFile(script, []byte(`process.stdout.write('ready\n'); setInterval(() => {}, 1000);`), 0600)
	request := Request{Executable: script, Directory: directory, Environment: ChildEnvironment(), Timeout: 100 * time.Millisecond, MaxInput: 100, MaxOutput: 100, MaxError: 100}
	_, err = runner.Run(context.Background(), request, nil)
	if !errors.Is(err, Error("harness_timeout")) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request.Timeout = time.Second
	_, err = runner.Run(ctx, request, func(string) { cancel() })
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

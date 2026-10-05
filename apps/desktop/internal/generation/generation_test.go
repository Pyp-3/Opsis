package generation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
)

type fakeRunner struct {
	t             *testing.T
	graph         string
	attempts      int
	invalidFirst  bool
	failure       bool
	sawAttachment bool
	expectedImage []byte
	stagedImage   string
}

// Windows discovery only runs .exe files directly.
var executableSuffix = map[bool]string{true: ".exe"}[runtime.GOOS == "windows"]

func (f *fakeRunner) Run(_ context.Context, request harness.Request, onLine func(string)) (string, error) {
	if len(request.Args) == 1 && request.Args[0] == "--version" {
		return "codex-cli 0.159.0", nil
	}
	if request.Executable == "pdftotext" {
		if !strings.HasPrefix(request.Stdin, "%PDF") {
			f.t.Error("PDF bytes did not cross the native boundary")
		}
		return "uploaded text with enough extracted characters to count as a PDF text layer", nil
	}
	for _, arg := range request.Args {
		if path, ok := strings.CutPrefix(arg, "--image="); ok {
			data, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(data, f.expectedImage) {
				f.t.Error("image bytes changed during staging", err)
			}
			info, err := os.Stat(path)
			if err != nil || (runtime.GOOS != "windows" && info.Mode().Perm() != 0600) {
				f.t.Error("attachment is not private")
			}
			f.stagedImage = path
		}
	}
	f.attempts++
	if f.failure {
		return "", harness.Error("harness_exit")
	}
	if !strings.Contains(strings.Join(request.Args, " "), "--sandbox read-only") {
		f.t.Error("provider tools changed")
	}
	if strings.Contains(request.Stdin, "uploaded text") {
		f.sawAttachment = true
	}
	if onLine != nil {
		onLine(`{"type":"turn.started"}`)
		onLine(`{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":8,"cached_input_tokens":0}}`)
	}
	graph := f.graph
	if f.invalidFirst && f.attempts == 1 {
		graph = `{"invalid":true}`
	}
	message, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]string{"type": "agent_message", "text": graph}})
	return string(message) + "\n", nil
}

func engineFor(t *testing.T, runner harness.Runner) *Engine {
	t.Helper()
	engine, err := New(runner)
	if err != nil {
		t.Fatal(err)
	}
	return engine
}
func request(t *testing.T, engine *Engine, body any) Outcome {
	t.Helper()
	raw, _ := json.Marshal(body)
	result, err := engine.Run(context.Background(), "generate", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestNativeWorkflowRunsSharedDemoAndIllustrationPolicies(t *testing.T) {
	engine := engineFor(t, nil)
	result := request(t, engine, map[string]any{"prompt": "Explain email", "agent": "demo"})
	if result.Status != 200 || !strings.Contains(string(result.Body), "outgoing") {
		t.Fatalf("demo: %d %s", result.Status, result.Body)
	}
	var graph map[string]any
	_ = json.Unmarshal(result.Body, &graph)
	graph["version"] = 2
	graph["positions"] = map[string]any{}
	graph["agent"] = "demo"
	raw, _ := json.Marshal(map[string]any{"agent": "demo", "board": graph})
	drawings, err := engine.Run(context.Background(), "illustrate", raw, nil)
	if err != nil || drawings.Status != 200 || !strings.Contains(string(drawings.Body), "illustrations") {
		t.Fatalf("illustration: %v %s", err, drawings.Body)
	}
	invalid := request(t, engine, map[string]any{"prompt": "Something", "agent": "demo", "settings": map[string]string{"model": "default"}})
	if invalid.Status != 400 {
		t.Fatal("implicit model accepted")
	}
}

func TestNativeWorkflowRepairsOnceAndPreservesAttachmentAndReviewPolicy(t *testing.T) {
	fake := &fakeRunner{t: t, invalidFirst: true}
	engine := engineFor(t, fake)
	demo := request(t, engine, map[string]any{"prompt": "email", "agent": "demo"})
	fake.graph = string(demo.Body)
	file := filepath.Join(t.TempDir(), "codex"+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", file)
	result := request(t, engine, map[string]any{"prompt": "Explain this document", "agent": "codex", "attachments": []any{map[string]string{"name": "notes.txt", "mediaType": "text/plain", "data": "dXBsb2FkZWQgdGV4dA=="}}})
	if result.Status != 200 || fake.attempts != 2 || !fake.sawAttachment {
		t.Fatalf("repair/attachment: status %d attempts %d attachment %v: %s", result.Status, fake.attempts, fake.sawAttachment, result.Body)
	}
	var board map[string]any
	_ = json.Unmarshal(demo.Body, &board)
	board["version"] = 2
	board["positions"] = map[string]any{}
	board["agent"] = "codex"
	board["nodes"].([]any)[0].(map[string]any)["label"] = "User edit"
	result = request(t, engine, map[string]any{"prompt": "Explain more", "agent": "codex", "board": board})
	if result.Status != 409 || !strings.Contains(string(result.Body), "candidate") {
		t.Fatalf("review skipped: %s", result.Body)
	}
}

func TestNativeWorkflowDoesNotRetryProcessFailures(t *testing.T) {
	fake := &fakeRunner{t: t, failure: true}
	engine := engineFor(t, fake)
	file := filepath.Join(t.TempDir(), "codex"+executableSuffix)
	_ = os.WriteFile(file, []byte("fake"), 0700)
	t.Setenv("OPSIS_CODEX_BIN", file)
	result := request(t, engine, map[string]any{"prompt": "Explain DNS", "agent": "codex"})
	if result.Status != 502 || fake.attempts != 1 {
		t.Fatalf("process failure retried: %d %d", result.Status, fake.attempts)
	}
}

func TestNativeAttachmentsCrossPDFAndImageBoundariesAndAreRemoved(t *testing.T) {
	fake := &fakeRunner{t: t, expectedImage: []byte("test image bytes")}
	engine := engineFor(t, fake)
	fake.graph = string(request(t, engine, map[string]any{"prompt": "email", "agent": "demo"}).Body)
	file := filepath.Join(t.TempDir(), "codex"+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", file)
	result := request(t, engine, map[string]any{"prompt": "Explain the attachments", "agent": "codex", "attachments": []any{
		map[string]string{"name": "notes.pdf", "mediaType": "application/pdf", "data": base64.StdEncoding.EncodeToString([]byte("%PDF fixture"))},
		map[string]string{"name": "image.png", "mediaType": "image/png", "data": base64.StdEncoding.EncodeToString(fake.expectedImage)},
	}})
	if result.Status != 200 || !fake.sawAttachment || fake.stagedImage == "" {
		t.Fatalf("native attachment boundary failed: %d", result.Status)
	}
	if _, err := os.Stat(fake.stagedImage); !os.IsNotExist(err) {
		t.Fatal("staged image survived completion")
	}
}

func TestConfiguredPathRequestLimitAndUsage(t *testing.T) {
	fake := &fakeRunner{t: t}
	engine := engineFor(t, fake)
	demo := request(t, engine, map[string]any{"prompt": "email", "agent": "demo"})
	fake.graph = string(demo.Body)
	file := filepath.Join(t.TempDir(), "selected-codex"+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	settings := map[string]any{"model": "gpt-6-luna", "effort": "low", "executablePath": file, "maxRequestCharacters": 1000}
	raw, _ := json.Marshal(map[string]any{"agent": "codex", "settings": settings})
	checked, err := engine.Run(context.Background(), "check-agent", raw, nil)
	if err != nil || checked.Status != 200 || fake.attempts != 0 {
		t.Fatalf("no-call check: %v %s", err, checked.Body)
	}
	limited := request(t, engine, map[string]any{"agent": "codex", "prompt": "Explain email", "settings": settings})
	if limited.Status != 400 || !strings.Contains(string(limited.Body), "character limit") || fake.attempts != 0 {
		t.Fatalf("request limit failed: %d %s attempts=%d", limited.Status, limited.Body, fake.attempts)
	}
	delete(settings, "maxRequestCharacters")
	raw, _ = json.Marshal(map[string]any{"agent": "codex", "prompt": "Explain email", "settings": settings})
	var measurements []json.RawMessage
	generated, err := engine.Run(context.Background(), "generate", raw, func(event json.RawMessage) {
		if strings.Contains(string(event), "\"type\":\"usage\"") {
			measurements = append(measurements, event)
		}
	})
	if err != nil || generated.Status != 200 || len(measurements) != 1 || !strings.Contains(string(measurements[0]), "\"inputTokens\":0") {
		t.Fatalf("reported usage: %v %s %s", err, generated.Body, measurements)
	}
}

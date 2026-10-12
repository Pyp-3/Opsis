package generation

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
)

// Inspect the actual file staged by the native host, rather than only the TS transformer.
type codexSchemaRunner struct {
	fakeRunner
	sawSchema bool
}

func (f *codexSchemaRunner) Run(ctx context.Context, request harness.Request, onLine func(string)) (string, error) {
	for index, arg := range request.Args {
		if arg != "--output-schema" {
			continue
		}
		data, err := os.ReadFile(request.Args[index+1])
		if err != nil {
			f.t.Fatal(err)
		}
		var schema map[string]any
		if err := json.Unmarshal(data, &schema); err != nil {
			f.t.Fatal(err)
		}
		checkCodexSchema(f.t, schema)
		f.sawSchema = true
	}
	return f.fakeRunner.Run(ctx, request, onLine)
}

func checkCodexSchema(t *testing.T, value any) {
	t.Helper()
	switch node := value.(type) {
	case map[string]any:
		if _, tuple := node["items"].([]any); tuple {
			t.Fatal("draft-7 tuple reached Codex Structured Outputs")
		}
		if node["type"] == "object" {
			properties, ok := node["properties"].(map[string]any)
			if !ok || node["additionalProperties"] != false {
				t.Fatal("Codex object is not closed")
			}
			required, ok := node["required"].([]any)
			if !ok || len(required) != len(properties) {
				t.Fatal("Codex optional fields were not made required and nullable")
			}
		}
		for _, child := range node {
			checkCodexSchema(t, child)
		}
	case []any:
		for _, child := range node {
			checkCodexSchema(t, child)
		}
	}
}

func TestNativeCodexUsesCompatibleSchemaAndRestoresOptionalOmissions(t *testing.T) {
	fake := &codexSchemaRunner{fakeRunner: fakeRunner{t: t}}
	engine := engineFor(t, fake)
	demo := request(t, engine, map[string]any{"prompt": "email", "agent": "demo"})
	var graph map[string]any
	if err := json.Unmarshal(demo.Body, &graph); err != nil {
		t.Fatal(err)
	}
	graph["drawings"] = nil
	output, err := json.Marshal(graph)
	if err != nil {
		t.Fatal(err)
	}
	fake.graph = string(output)
	file := filepath.Join(t.TempDir(), "codex"+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", file)
	result := request(t, engine, map[string]any{"prompt": "Explain email", "agent": "codex"})
	if result.Status != 200 || fake.attempts != 1 || !fake.sawSchema {
		t.Fatalf("Codex schema/answer boundary failed: status %d attempts %d schema %v", result.Status, fake.attempts, fake.sawSchema)
	}
}

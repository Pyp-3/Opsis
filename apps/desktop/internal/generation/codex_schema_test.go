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

// Inspect the actual file staged by the native host, rather than only the TS transformer.
type codexSchemaRunner struct {
	fakeRunner
	sawSchema bool
	sawArrow  bool
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
		f.sawArrow = checkCodexSchema(f.t, schema) > 0
		f.sawSchema = true
	}
	return f.fakeRunner.Run(ctx, request, onLine)
}

func checkCodexSchema(t *testing.T, value any) int {
	t.Helper()
	arrows := 0
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
			if shape, ok := properties["shape"].(map[string]any); ok {
				if shapes, ok := shape["enum"].([]any); ok {
					for _, name := range shapes {
						if name == "arrow" {
							points, ok := properties["points"].(map[string]any)
							if !ok || points["type"] != "array" || points["minItems"] != float64(2) || points["maxItems"] != float64(2) {
								t.Fatal("Codex arrow schema does not require exactly two points")
							}
							arrows++
						}
					}
				}
			}
		}
		for _, child := range node {
			arrows += checkCodexSchema(t, child)
		}
	case []any:
		for _, child := range node {
			arrows += checkCodexSchema(t, child)
		}
	}
	return arrows
}

func TestNativeCodexUsesCompatibleSchemaAndRestoresOptionalOmissions(t *testing.T) {
	fake := &codexSchemaRunner{fakeRunner: fakeRunner{t: t}}
	engine := engineFor(t, fake)
	demo := request(t, engine, map[string]any{"prompt": "email", "agent": "demo"})
	var graph map[string]any
	if err := json.Unmarshal(demo.Body, &graph); err != nil {
		t.Fatal(err)
	}
	graph["drawings"] = []any{map[string]any{
		"id": "arrow", "shape": "arrow", "ink": "ink", "strokeWidth": 2, "line": "solid",
		"points": [][]int{{0, 0}, {10, 10}}, "endMarker": nil, "x": nil, "d": nil,
	}}
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
	if result.Status != 200 || fake.attempts != 1 || !fake.sawSchema || !fake.sawArrow {
		t.Fatalf("Codex schema/answer boundary failed: status %d attempts %d schema %v", result.Status, fake.attempts, fake.sawSchema)
	}
}

type codexDeadlineRunner struct{ fakeRunner }

func (f *codexDeadlineRunner) Run(ctx context.Context, request harness.Request, onLine func(string)) (string, error) {
	if len(request.Args) == 1 && request.Args[0] == "--version" {
		return f.fakeRunner.Run(ctx, request, onLine)
	}
	f.attempts++
	return "", harness.Error("harness_timeout")
}

func TestNativeCodexDeadlineIsNotReportedAsLoginFailure(t *testing.T) {
	fake := &codexDeadlineRunner{fakeRunner{t: t}}
	engine := engineFor(t, fake)
	file := filepath.Join(t.TempDir(), "codex"+executableSuffix)
	if err := os.WriteFile(file, []byte("fake"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPSIS_CODEX_BIN", file)
	result := request(t, engine, map[string]any{"prompt": "Explain email", "agent": "codex"})
	if result.Status != 502 || fake.attempts != 1 || !strings.Contains(string(result.Body), "took too long") || strings.Contains(string(result.Body), "CLI login") {
		t.Fatalf("deadline: status %d attempts %d body %s", result.Status, fake.attempts, result.Body)
	}
}

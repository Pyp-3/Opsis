package contracts

import (
	"encoding/json"
	"testing"
)

func TestSharedContractsValidateAndBoundHistory(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := c.Apply("empty", "First")
	if err != nil {
		t.Fatal(err)
	}
	for range 45 {
		snapshot, err = c.Apply("rename", map[string]any{"snapshot": snapshot, "title": "Changed"})
		if err != nil {
			t.Fatal(err)
		}
	}
	var result struct {
		Past   []json.RawMessage
		Future []json.RawMessage
	}
	if err := json.Unmarshal(snapshot, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Past) != 40 || len(result.Future) != 0 {
		t.Fatalf("history: %d/%d", len(result.Past), len(result.Future))
	}
	if _, err := c.Apply("save", map[string]any{"snapshot": snapshot, "revision": -1}); err == nil {
		t.Fatal("invalid revision accepted")
	}
	if _, err := c.Apply("create", map[string]any{"title": "   "}); err == nil {
		t.Fatal("empty title accepted")
	}
	if _, err := c.Apply("signup", map[string]any{"name": " Test ", "email": "USER@EXAMPLE.TEST", "password": "12345678"}); err != nil {
		t.Fatal(err)
	}
}

func TestConceptSourceLinksUsePortableValidation(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Fatal(err)
	}
	for _, link := range []string{"https://example.com/reference", "http://localhost:8100/source?q=1#section"} {
		board := map[string]any{"version": 2, "agent": "demo", "title": "Sources", "description": "", "positions": map[string]any{}, "nodes": []any{map[string]any{"id": "source", "label": "Source", "icon": "file", "explanation": "Source document", "summary": "Source document", "kind": "note", "references": []any{map[string]any{"title": "Reference", "url": link}}}}, "edges": []any{}}
		if _, err := c.Apply("board", board); err != nil {
			t.Fatalf("valid source %q rejected: %v", link, err)
		}
		board["nodes"].([]any)[0].(map[string]any)["references"] = []any{map[string]any{"title": "Unsafe", "url": "javascript:alert(1)"}}
		if _, err := c.Apply("board", board); err == nil {
			t.Fatal("non-HTTP source accepted")
		}
	}
}

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

package api

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func usageRecord(at int, boardID string) map[string]any {
	record := map[string]any{
		"id": uuid.NewString(), "at": at, "agent": "claude", "model": "haiku", "effort": "low", "purpose": "diagram",
		"attempts": []any{map[string]any{"inputTokens": 10, "outputTokens": nil, "cachedInputTokens": nil, "cacheWriteTokens": nil, "estimatedCostUSD": 0.01}},
	}
	if boardID != "" {
		record["boardId"] = boardID
	}
	return record
}

func TestAccountSettingsAndUsageBelongToTheAccount(t *testing.T) {
	s := newTestServer(t)
	ada := signup(t, s, "ada-settings@example.test")
	bob := signup(t, s, "bob-settings@example.test")
	preferences := map[string]any{"claude": map[string]any{"model": "sonnet", "effort": "medium"}}
	ada.request("PUT", "/v1/account/settings/model-preferences", map[string]any{"value": preferences}, 204)
	for key, value := range map[string]any{
		"model-preferences": map[string]any{"claude": map[string]any{"model": "", "effort": "low"}},
		"model-profiles":    "not a list",
		"unknown-key":       map[string]any{},
		"provider-limits":   map[string]any{"enabled": true, "caps": map[string]any{}},
	} {
		ada.request("PUT", "/v1/account/settings/"+key, map[string]any{"value": value}, 400)
	}
	values := ada.request("GET", "/v1/account/settings", nil, 200)["values"].(map[string]any)
	if fmt.Sprint(values["model-preferences"]) != fmt.Sprint(preferences) || len(values) != 1 {
		t.Fatalf("settings not kept: %v", values)
	}
	if len(bob.request("GET", "/v1/account/settings", nil, 200)["values"].(map[string]any)) != 0 {
		t.Fatal("settings leaked to another account")
	}
	projection := map[string]any{"price": "custom", "customRates": map[string]any{"input": 1, "output": 5, "cacheRead": 0.1, "cacheWrite": 1.25}, "requestsPerDay": 10, "inputTokens": 1000, "outputTokens": 1000, "cacheReadTokens": 0, "cacheWriteTokens": 0}
	ada.request("PUT", "/v1/account/settings/cost-projection", map[string]any{"value": projection}, 204)
	stored := ada.request("GET", "/v1/account/settings", nil, 200)["values"].(map[string]any)["cost-projection"].(map[string]any)
	if stored["requestsPerDay"] != float64(10) || stored["price"] != "custom" {
		t.Fatal("projection not kept", stored)
	}
	projection["requestsPerDay"] = -1
	ada.request("PUT", "/v1/account/settings/cost-projection", map[string]any{"value": projection}, 400)
	if len(bob.request("GET", "/v1/account/settings", nil, 200)["values"].(map[string]any)) != 0 {
		t.Fatal("projection leaked to another account")
	}
	boardID := uuid.NewString()
	fallback := map[string]any{"claude": map[string]any{"id": "backup", "name": "Backup", "agent": "codex", "settings": map[string]any{"model": "gpt-6-luna", "effort": "low"}}}
	ada.request("PUT", "/v1/account/settings/model-fallbacks", map[string]any{"value": fallback}, 204)
	if ada.request("GET", "/v1/account/settings", nil, 200)["values"].(map[string]any)["model-fallbacks"] == nil {
		t.Fatal("fallback not kept")
	}
	if len(bob.request("GET", "/v1/account/settings", nil, 200)["values"].(map[string]any)) != 0 {
		t.Fatal("fallback leaked to another account")
	}
	ada.request("POST", "/v1/account/usage", usageRecord(1, boardID), 204)
	bad := usageRecord(2, "")
	bad["attempts"] = "x"
	ada.request("POST", "/v1/account/usage", bad, 400)
	listed := ada.raw("GET", "/v1/account/usage", nil, 200).([]any)
	first := listed[0].(map[string]any)
	if len(listed) != 1 || first["boardId"] != boardID || first["attempts"].([]any)[0].(map[string]any)["outputTokens"] != nil {
		t.Fatalf("usage not kept with nullable measurements: %v", listed)
	}
	if len(bob.raw("GET", "/v1/account/usage", nil, 200).([]any)) != 0 {
		t.Fatal("usage leaked to another account")
	}
	for at := 2; at <= 1001; at++ {
		ada.request("POST", "/v1/account/usage", usageRecord(at, ""), 204)
	}
	kept := ada.raw("GET", "/v1/account/usage", nil, 200).([]any)
	if len(kept) != 1000 || kept[0].(map[string]any)["at"] != float64(2) {
		t.Fatalf("usage not bounded to the newest records: %d", len(kept))
	}
	ada.request("DELETE", "/v1/account/usage", nil, 204)
	if len(ada.raw("GET", "/v1/account/usage", nil, 200).([]any)) != 0 {
		t.Fatal("usage not cleared")
	}
}

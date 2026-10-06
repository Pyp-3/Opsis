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
	boardID := uuid.NewString()
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

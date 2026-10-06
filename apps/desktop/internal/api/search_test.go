package api

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestSearchCoversOwnedAndInvitedBoardsOnly(t *testing.T) {
	s := newTestServer(t)
	ada := signup(t, s, "ada-search@example.test")
	bob := signup(t, s, "bob-search@example.test")
	save := func(c *testClient, title string, label string) map[string]any {
		created := c.request("POST", "/v1/boards", map[string]any{"title": title}, 201)
		snapshot := created["snapshot"].(map[string]any)
		board := snapshot["board"].(map[string]any)
		node := map[string]any{"id": "spam", "label": label, "icon": "mail", "summary": "Checks messages.", "explanation": "Rejects unwanted mail.", "kind": "step"}
		board["nodes"] = []any{node}
		board["positions"] = map[string]any{"spam": map[string]any{"x": 0, "y": 0}}
		saved := c.request("PUT", "/v1/boards/"+created["id"].(string), map[string]any{"snapshot": snapshot, "revision": created["revision"]}, 200)
		saved["id"] = created["id"]
		return saved
	}
	mine := save(ada, "Mail flow", "Spam filter")
	theirs := save(bob, "Bob mail", "Spam filter")
	invited := save(bob, "Shared mail", "Spam filter")
	bob.request("PUT", "/v1/boards/"+invited["id"].(string)+"/editors", map[string]any{"email": "ada-search@example.test", "enabled": true, "revision": invited["revision"]}, 200)
	bob.request("PATCH", "/v1/boards/"+theirs["id"].(string), map[string]any{"visibility": "public", "revision": theirs["revision"]}, 200)

	found := ada.request("GET", "/v1/search?q="+url.QueryEscape("SPAM filter"), nil, 200)["results"].([]any)
	boards := map[string]string{}
	for _, entry := range found {
		hit := entry.(map[string]any)
		boards[hit["boardId"].(string)] = hit["access"].(string)
		if hit["conceptId"] != "spam" || hit["field"] != "label" {
			t.Fatalf("unexpected hit: %v", hit)
		}
	}
	if len(boards) != 2 || boards[mine["id"].(string)] != "owner" || boards[invited["id"].(string)] != "editor" {
		t.Fatalf("search scope wrong: %v", boards)
	}
	ada.request("PATCH", "/v1/boards/"+mine["id"].(string), map[string]any{"archived": true, "revision": mine["revision"]}, 200)
	afterArchive := ada.request("GET", "/v1/search?q=spam", nil, 200)["results"].([]any)
	if len(afterArchive) != 1 {
		data, _ := json.Marshal(afterArchive)
		t.Fatalf("archived board still searched: %s", data)
	}
	ada.request("GET", "/v1/search?q=a", nil, 400)
}

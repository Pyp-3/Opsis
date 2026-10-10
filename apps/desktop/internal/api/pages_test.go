package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

// A board shared by link opens for signed-out guests through the embedded shared rules, which
// leave out hidden pages unless the reader opened that page's own link.
func TestLinkSharingAndHiddenPages(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "owner@example.com")
	editor := signup(t, s, "editor@example.com")
	viewer := signup(t, s, "viewer@example.com")
	guest := &testClient{t: t, server: s}
	linked := owner.request("POST", "/v1/boards", map[string]any{"title": "Linked"}, 201)
	created := owner.request("POST", "/v1/boards", map[string]any{"title": "Pitch"}, 201)
	path := "/v1/boards/" + created["id"].(string)
	guestPath := "/v1/guest/boards/" + created["id"].(string)
	concept := func(id, label, link string) map[string]any {
		node := map[string]any{"id": id, "label": label, "icon": "server", "summary": label + " summary", "explanation": label + " explanation", "kind": "step"}
		if link != "" {
			node["linkedBoardId"] = link
		}
		return node
	}
	board := map[string]any{
		"version": 2, "title": "Pitch", "description": "", "agent": "claude",
		"nodes": []any{concept("idea", "Idea", "")}, "edges": []any{},
		"positions": map[string]any{"idea": map[string]any{"x": 0, "y": 0}},
		"pages": []any{
			map[string]any{"id": "cover-page-00001", "title": "Cover"},
			map[string]any{"id": "secret-page-0001", "title": "Pricing", "hidden": true, "content": map[string]any{
				"nodes": []any{concept("price", "Secret price", linked["id"].(string))}, "edges": []any{},
				"positions": map[string]any{"price": map[string]any{"x": 0, "y": 0}},
			}},
		},
	}
	owner.request("PUT", path, map[string]any{"snapshot": map[string]any{"board": board, "past": []any{nil}, "future": []any{}}, "revision": 1}, 200)
	owner.request("PUT", path+"/editors", map[string]any{"email": "editor@example.com", "enabled": true, "revision": 2}, 200)

	guest.request("GET", guestPath, nil, 404)
	guest.request("GET", guestPath+"?page=secret-page-0001", nil, 404)
	viewer.request("GET", path, nil, 404)

	owner.request("PATCH", path, map[string]any{"revision": 2, "visibility": "link"}, 200)
	read := func(c *testClient, url string) (map[string]any, string) {
		result := c.request("GET", url, nil, 200)
		data, _ := json.Marshal(result)
		return result, string(data)
	}
	for _, c := range []*testClient{guest, viewer} {
		url := guestPath
		if c == viewer {
			url = path
		}
		result, body := read(c, url)
		if result["access"] != "viewer" || strings.Contains(body, "Secret price") || strings.Contains(body, "secret-page-0001") {
			t.Fatal("a hidden page or its link reached a viewer", body)
		}
		if history := result["snapshot"].(map[string]any)["past"].([]any); len(history) != 0 {
			t.Fatal("a viewer received the editors' undo history", history)
		}
		if _, body := read(c, url+"?page=secret-page-0001"); !strings.Contains(body, "Secret price") {
			t.Fatal("the hidden page's link did not open it", body)
		}
	}
	if list := viewer.raw("GET", "/v1/boards/public", nil, 200).([]any); len(list) != 0 {
		t.Fatal("a link-shared board was listed", list)
	}
	viewer.request("PUT", path, map[string]any{"snapshot": map[string]any{"board": board, "past": []any{}, "future": []any{}}, "revision": 2}, 403)
	for _, c := range []*testClient{owner, editor} {
		if _, body := read(c, path); !strings.Contains(body, "Secret price") {
			t.Fatal("an owner or editor lost a hidden page", body)
		}
	}

	// Backlinks from a hidden page are listed for its editors only.
	owner.request("PATCH", "/v1/boards/"+linked["id"].(string), map[string]any{"revision": 1, "visibility": "public"}, 200)
	owner.request("PATCH", path, map[string]any{"revision": 2, "visibility": "public"}, 200)
	links := owner.raw("GET", "/v1/boards/"+linked["id"].(string)+"/backlinks", nil, 200).([]any)
	if len(links) != 1 || links[0].(map[string]any)["pageId"] != "secret-page-0001" {
		t.Fatal("missing the hidden page's backlink", links)
	}
	if links := viewer.raw("GET", "/v1/boards/"+linked["id"].(string)+"/backlinks", nil, 200).([]any); len(links) != 0 {
		t.Fatal("a viewer saw a hidden page's backlink", links)
	}

	owner.request("PATCH", path, map[string]any{"revision": 2, "visibility": "private"}, 200)
	guest.request("GET", guestPath, nil, 404)
	viewer.request("GET", path, nil, 404)
}

// Someone without an account hears only the script of a board shared with them by link.
func TestGuestNarrationReadsOnlyTheBoardsScript(t *testing.T) {
	t.Setenv("OPSIS_RATE_LIMIT", "10000")
	var spoken []string
	speech := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		spoken = append(spoken, body.Text)
		w.WriteHeader(200)
	})
	s, err := New(filepath.Join(t.TempDir(), "opsis.sqlite"), speech)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	owner := signup(t, s, "owner@example.com")
	guest := &testClient{t: t, server: s}
	created := owner.request("POST", "/v1/boards", map[string]any{"title": "Pitch"}, 201)
	path := "/v1/boards/" + created["id"].(string)
	board := map[string]any{
		"version": 2, "title": "Pitch", "description": "", "agent": "claude",
		"narration": "Here is how it works.",
		"nodes":     []any{map[string]any{"id": "idea", "label": "Idea", "icon": "server", "summary": "An idea.", "explanation": "An idea.", "kind": "step", "narration": "It starts with an idea."}},
		"edges":     []any{}, "positions": map[string]any{"idea": map[string]any{"x": 0, "y": 0}},
	}
	owner.request("PUT", path, map[string]any{"snapshot": map[string]any{"board": board, "past": []any{}, "future": []any{}}, "revision": 1}, 200)
	line := func(text string) map[string]any {
		return map[string]any{"text": text, "voice": "bf_emma", "board": map[string]any{"id": created["id"]}}
	}
	guest.request("POST", "/v1/speech", line("Here is how it works."), 403)
	owner.request("PATCH", path, map[string]any{"revision": 2, "visibility": "link"}, 200)
	guest.request("POST", "/v1/speech", line("Here is how it works."), 200)
	guest.request("POST", "/v1/speech", line("It starts with an idea."), 200)
	guest.request("POST", "/v1/speech", line("Read out anything at all."), 403)
	guest.request("POST", "/v1/speech", map[string]any{"text": "Here is how it works.", "voice": "bf_emma"}, 403)
	owner.request("POST", "/v1/speech", map[string]any{"text": "Read out anything at all.", "voice": "bf_emma"}, 200)
	if strings.Join(spoken, "|") != "Here is how it works.|It starts with an idea.|Read out anything at all." {
		t.Fatal("unexpected lines reached the speech service", spoken)
	}
}

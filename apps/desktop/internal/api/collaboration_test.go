package api

import "testing"

func TestNamedEditorsAndRevocation(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "owner@example.com")
	editor := signup(t, s, "editor@example.com")
	created := owner.request("POST", "/v1/boards", map[string]any{"title": "Shared"}, 201)
	path := "/v1/boards/" + created["id"].(string)
	editor.request("GET", path, nil, 404)
	owner.request("PUT", path+"/editors", map[string]any{"email": "editor@example.com", "enabled": true, "revision": 1}, 200)
	shared := editor.request("GET", path, nil, 200)
	if shared["access"] != "editor" {
		t.Fatal("missing editor access", shared)
	}
	editor.request("PUT", path, map[string]any{"snapshot": created["snapshot"], "revision": 1}, 200)
	owner.request("PUT", path, map[string]any{"snapshot": created["snapshot"], "revision": 1}, 409)
	editor.request("GET", path+"/revisions", nil, 404)
	editor.request("DELETE", path, map[string]any{"revision": 2}, 404)
	editor.request("PUT", path+"/editors", map[string]any{"email": "owner@example.com", "enabled": true, "revision": 2}, 404)
	owner.request("PUT", path+"/editors", map[string]any{"email": "editor@example.com", "enabled": false, "revision": 2}, 200)
	editor.request("GET", path, nil, 404)
	editor.request("PUT", path, map[string]any{"snapshot": created["snapshot"], "revision": 2}, 404)
	owner.request("GET", path, nil, 200)
}

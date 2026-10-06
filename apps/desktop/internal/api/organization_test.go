package api

import (
	"fmt"
	"strings"
	"testing"
)

func TestTagsAndSmartCollectionsArePrivateOrganization(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "tagger@example.test")
	stranger := signup(t, s, "tag-stranger@example.test")
	board := owner.request("POST", "/v1/boards", map[string]any{"title": "Tagged"}, 201)
	path := "/v1/boards/" + board["id"].(string)
	tagged := owner.request("PUT", path+"/tags", map[string]any{"tags": []string{" Networking ", "networking", "Exam"}}, 200)
	if fmt.Sprint(tagged["tags"]) != "[Networking Exam]" {
		t.Fatalf("tags not normalized: %v", tagged["tags"])
	}
	owner.request("PUT", path+"/tags", map[string]any{"tags": []string{strings.Repeat("x", 31)}}, 400)
	stranger.request("PUT", path+"/tags", map[string]any{"tags": []string{"mine"}}, 404)
	listed := owner.raw("GET", "/v1/boards", nil, 200).([]any)[0].(map[string]any)
	if fmt.Sprint(listed["tags"]) != "[Networking Exam]" || listed["revision"] != board["revision"] || listed["agent"] == nil {
		t.Fatalf("listing lacks tags/agent or tagging changed the revision: %v", listed)
	}
	copy := owner.request("POST", path+"/duplicate", map[string]any{"revision": board["revision"]}, 201)
	for _, entry := range owner.raw("GET", "/v1/boards", nil, 200).([]any) {
		listing := entry.(map[string]any)
		if listing["id"] == copy["id"] && fmt.Sprint(listing["tags"]) != "[Networking Exam]" {
			t.Fatal("copy lost its tags")
		}
	}

	owner.request("POST", "/v1/smart-collections", map[string]any{"name": "Empty", "rule": map[string]any{}}, 400)
	smart := owner.request("POST", "/v1/smart-collections", map[string]any{"name": "Exam prep", "rule": map[string]any{"tagsAll": []string{"exam"}}}, 201)
	owner.request("POST", "/v1/smart-collections", map[string]any{"name": "exam PREP", "rule": map[string]any{"agent": "demo"}}, 409)
	updated := owner.request("PUT", "/v1/smart-collections/"+smart["id"].(string), map[string]any{"name": "Exam prep", "rule": map[string]any{"tagsAny": []string{"exam", "quiz"}}}, 200)
	if fmt.Sprint(updated["rule"]) != "map[tagsAny:[exam quiz]]" {
		t.Fatalf("rule not replaced: %v", updated["rule"])
	}
	if len(stranger.raw("GET", "/v1/smart-collections", nil, 200).([]any)) != 0 {
		t.Fatal("smart collections leaked to another account")
	}
	stranger.request("DELETE", "/v1/smart-collections/"+smart["id"].(string), nil, 404)
	owner.request("DELETE", "/v1/smart-collections/"+smart["id"].(string), nil, 204)

	// Deleting a board removes its tags with it.
	owner.request("DELETE", path, map[string]any{"revision": board["revision"]}, 204)
	var remaining int
	if err := s.db.QueryRow(`SELECT count(*) FROM board_tags WHERE board_id=?`, board["id"]).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("deleted board kept its tags", err)
	}
}

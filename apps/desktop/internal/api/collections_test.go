package api

import (
	"strings"
	"testing"
)

func listedCollection(t *testing.T, c *testClient, boardID string) any {
	t.Helper()
	data := c.raw("GET", "/v1/boards", nil, 200)
	for _, entry := range data.([]any) {
		board := entry.(map[string]any)
		if board["id"] == boardID {
			return board["collectionId"]
		}
	}
	t.Fatalf("board %s not listed", boardID)
	return nil
}

func TestCollectionsFileOwnedBoardsPrivately(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "collector@example.test")
	stranger := signup(t, s, "stranger@example.test")
	for _, name := range []string{"", " ", strings.Repeat("x", 61)} {
		owner.request("POST", "/v1/collections", map[string]any{"name": name}, 400)
	}
	collection := owner.request("POST", "/v1/collections", map[string]any{"name": "Work"}, 201)
	collectionID := collection["id"].(string)
	owner.request("POST", "/v1/collections", map[string]any{"name": "work"}, 409)
	if list := stranger.raw("GET", "/v1/collections", nil, 200).([]any); len(list) != 0 {
		t.Fatal("collections leaked to another account")
	}
	stranger.request("PATCH", "/v1/collections/"+collectionID, map[string]any{"name": "Mine"}, 404)
	stranger.request("DELETE", "/v1/collections/"+collectionID, nil, 404)

	filed := owner.request("POST", "/v1/boards", map[string]any{"title": "Filed", "collectionId": collectionID}, 201)
	loose := owner.request("POST", "/v1/boards", map[string]any{"title": "Loose"}, 201)
	looseID := loose["id"].(string)
	if listedCollection(t, owner, filed["id"].(string)) != collectionID || listedCollection(t, owner, looseID) != nil {
		t.Fatal("collection not filed at creation")
	}
	owner.request("PUT", "/v1/boards/"+looseID+"/collection", map[string]any{"collectionId": collectionID}, 200)
	moved := owner.request("GET", "/v1/boards/"+looseID, nil, 200)
	if moved["revision"] != loose["revision"] || listedCollection(t, owner, looseID) != collectionID {
		t.Fatal("filing changed the revision or did not persist")
	}
	stranger.request("PUT", "/v1/boards/"+looseID+"/collection", map[string]any{"collectionId": nil}, 404)
	theirs := stranger.request("POST", "/v1/boards", map[string]any{"title": "Theirs"}, 201)
	stranger.request("PUT", "/v1/boards/"+theirs["id"].(string)+"/collection", map[string]any{"collectionId": collectionID}, 404)
	stranger.request("POST", "/v1/boards", map[string]any{"title": "Sneaky", "collectionId": collectionID}, 404)

	copy := owner.request("POST", "/v1/boards/"+filed["id"].(string)+"/duplicate", map[string]any{"revision": filed["revision"]}, 201)
	if listedCollection(t, owner, copy["id"].(string)) != collectionID {
		t.Fatal("copy not filed beside its source")
	}
	renamed := owner.request("PATCH", "/v1/collections/"+collectionID, map[string]any{"name": "Projects"}, 200)
	if renamed["name"] != "Projects" {
		t.Fatal("collection not renamed")
	}
	owner.request("DELETE", "/v1/collections/"+collectionID, nil, 204)
	boards := owner.raw("GET", "/v1/boards", nil, 200).([]any)
	if len(boards) != 3 {
		t.Fatal("deleting a collection deleted boards")
	}
	for _, entry := range boards {
		if entry.(map[string]any)["collectionId"] != nil {
			t.Fatal("board still filed in a deleted collection")
		}
	}
}

func TestNestedCollectionsPreserveBoardsAndRejectCycles(t *testing.T) {
	s := newTestServer(t)
	owner := signup(t, s, "nested@example.test")
	stranger := signup(t, s, "othernested@example.test")
	create := func(name string, parent any) string {
		return owner.request("POST", "/v1/collections", map[string]any{"name": name, "parentId": parent}, 201)["id"].(string)
	}
	education := create("Education", nil)
	ai := create("Artificial Intelligence", education)
	topic := create("Topic 1: 日本語", ai)
	board := owner.request("POST", "/v1/boards", map[string]any{"title": "Lesson", "collectionId": topic}, 201)
	direct := owner.request("POST", "/v1/boards", map[string]any{"title": "Overview", "collectionId": ai}, 201)
	owner.request("PATCH", "/v1/collections/"+education, map[string]any{"parentId": topic}, 400)
	owner.request("PATCH", "/v1/collections/"+ai, map[string]any{"parentId": ai}, 400)
	stranger.request("POST", "/v1/collections", map[string]any{"name": "Sneaky", "parentId": topic}, 404)
	stranger.request("PATCH", "/v1/collections/"+ai, map[string]any{"parentId": nil}, 404)
	owner.request("POST", "/v1/collections", map[string]any{"name": "artificial INTELLIGENCE", "parentId": education}, 409)
	other := create("Topic 1: 日本語", education)
	owner.request("DELETE", "/v1/collections/"+ai, nil, 409)
	bundle := owner.request("GET", "/v1/collections/"+ai+"/bundle", nil, 200)
	if len(bundle["boards"].([]any)) != 1 {
		t.Fatal("export included child collections")
	}
	owner.request("PATCH", "/v1/collections/"+other, map[string]any{"name": "Other topic"}, 200)
	owner.request("PATCH", "/v1/collections/"+ai, map[string]any{"parentId": nil}, 200)
	owner.request("DELETE", "/v1/collections/"+ai, nil, 204)
	found := false
	for _, raw := range owner.raw("GET", "/v1/collections", nil, 200).([]any) {
		item := raw.(map[string]any)
		if item["id"] == topic {
			found = true
			if item["parentId"] != nil {
				t.Fatal("child not promoted to root")
			}
		}
	}
	if !found {
		t.Fatal("child collection was deleted")
	}
	if listedCollection(t, owner, board["id"].(string)) != topic || listedCollection(t, owner, direct["id"].(string)) != nil {
		t.Fatal("boards lost their filing")
	}
	after := owner.request("GET", "/v1/boards/"+board["id"].(string), nil, 200)
	if after["revision"] != board["revision"] {
		t.Fatal("organization changed the board revision")
	}
}

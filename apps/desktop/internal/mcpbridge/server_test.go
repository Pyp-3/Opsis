package mcpbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"testing"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/api"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestNativeMCPKeepsToolsAndUndoableEdits(t *testing.T) {
	native, err := api.New(filepath.Join(t.TempDir(), "opsis.sqlite"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer native.Close()
	web := httptest.NewServer(native)
	defer web.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	post := func(path string, body any) map[string]any {
		t.Helper()
		data, _ := json.Marshal(body)
		response, err := client.Post(web.URL+path, "application/json", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 201 {
			t.Fatal(response.StatusCode)
		}
		var value map[string]any
		if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	post("/v1/auth/signup", map[string]string{"name": "Native MCP", "email": "mcp@example.test", "password": "test-password"})
	key := post("/v1/auth/agent-keys", map[string]string{"name": "Test"})["key"].(string)
	server, err := New(web.URL, key, web.URL)
	if err != nil {
		t.Fatal(err)
	}
	left, right := mcp.NewInMemoryTransports()
	ss, err := server.Connect(context.Background(), left, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(context.Background(), right, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	slices.Sort(names)
	expected := []string{
		"opsis_add_concept", "opsis_connect", "opsis_create_board", "opsis_disconnect",
		"opsis_get_board", "opsis_list_boards", "opsis_list_public_boards", "opsis_remove_concept",
		"opsis_search_boards", "opsis_update_board", "opsis_update_concept", "opsis_write_diagram",
	}
	if !slices.Equal(names, expected) {
		t.Fatalf("tools: got %v, want %v", names, expected)
	}
	call := func(name string, args map[string]any) map[string]any {
		t.Helper()
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if result.IsError {
			t.Fatalf("tool error: %v", result.Content)
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(result.Content[0].(*mcp.TextContent).Text), &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	created := call("opsis_create_board", map[string]any{"title": "Native board"})
	id := created["id"].(string)
	call("opsis_add_concept", map[string]any{"boardId": id, "label": "Source", "summary": "Start here"})
	response, err := client.Get(web.URL + "/v1/boards/" + id)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var board struct {
		Revision int
		Snapshot struct {
			Past  []json.RawMessage
			Board struct{ Nodes []json.RawMessage }
		}
	}
	if err := json.NewDecoder(response.Body).Decode(&board); err != nil {
		t.Fatal(err)
	}
	if board.Revision != 2 || len(board.Snapshot.Past) != 1 || len(board.Snapshot.Board.Nodes) != 1 {
		t.Fatalf("MCP edit lost history: %+v", board)
	}
	read := call("opsis_get_board", map[string]any{"boardId": id})
	if read["open"] != web.URL+"/canvas?board="+id {
		t.Fatal(read["open"])
	}
}

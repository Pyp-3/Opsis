package mcpbridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
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
		"opsis_add_concept", "opsis_add_drawings", "opsis_connect", "opsis_create_board",
		"opsis_create_collection", "opsis_disconnect", "opsis_file_board", "opsis_get_board",
		"opsis_group_drawings", "opsis_list_boards", "opsis_list_collections", "opsis_list_public_boards",
		"opsis_list_symbols", "opsis_place_symbols", "opsis_remove_concept", "opsis_remove_drawings",
		"opsis_render_board", "opsis_repeat_drawings", "opsis_search_boards", "opsis_transform_drawings",
		"opsis_update_board", "opsis_update_concept", "opsis_update_drawing", "opsis_write_diagram",
	}
	if !slices.Equal(names, expected) {
		t.Fatalf("tools: got %v, want %v", names, expected)
	}
	callInto := func(name string, args map[string]any, value any) {
		t.Helper()
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if result.IsError {
			t.Fatalf("tool error: %v", result.Content)
		}
		if err := json.Unmarshal([]byte(result.Content[0].(*mcp.TextContent).Text), value); err != nil {
			t.Fatal(err)
		}
	}
	call := func(name string, args map[string]any) map[string]any {
		t.Helper()
		var value map[string]any
		callInto(name, args, &value)
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

	// Filing through MCP is organization on the native host too: no new revision.
	collection := call("opsis_create_collection", map[string]any{"name": "Native"})["id"].(string)
	call("opsis_file_board", map[string]any{"boardId": id, "collectionId": collection})
	var collections []struct {
		ID     string
		Name   string
		Boards int
	}
	callInto("opsis_list_collections", map[string]any{}, &collections)
	if len(collections) != 1 || collections[0].ID != collection || collections[0].Boards != 1 {
		t.Fatalf("collections: %+v", collections)
	}
	var boards []struct {
		ID           string
		Revision     int
		CollectionID *string
	}
	callInto("opsis_list_boards", map[string]any{}, &boards)
	if len(boards) != 1 || boards[0].Revision != 2 || boards[0].CollectionID == nil || *boards[0].CollectionID != collection {
		t.Fatalf("filed board: %+v", boards)
	}
}

// Board previews: symbols are placed through the embedded tools, the native host forwards the
// preview to its Node service to rasterise, and the bridge returns the PNG as an image. Without
// that service the tool answers with the SVG markup instead.
func TestNativeMCPRendersBoardPreviews(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nfake")
	var forwarded string
	rasteriser := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Svg string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		forwarded = body.Svg
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(png)})
	})
	for _, fallback := range []http.Handler{rasteriser, nil} {
		native, err := api.New(filepath.Join(t.TempDir(), "opsis.sqlite"), fallback)
		if err != nil {
			t.Fatal(err)
		}
		web := httptest.NewServer(native)
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
			var value map[string]any
			_ = json.NewDecoder(response.Body).Decode(&value)
			return value
		}
		post("/v1/auth/signup", map[string]string{"name": "Preview", "email": "preview@example.test", "password": "test-password"})
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
		session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(context.Background(), right, nil)
		if err != nil {
			t.Fatal(err)
		}
		call := func(name string, args map[string]any) *mcp.CallToolResult {
			t.Helper()
			result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
			if err != nil || result.IsError {
				t.Fatalf("%s: %v %v", name, err, result)
			}
			return result
		}
		var board map[string]any
		_ = json.Unmarshal([]byte(call("opsis_create_board", map[string]any{"title": "Plant"}).Content[0].(*mcp.TextContent).Text), &board)
		id := board["id"].(string)
		call("opsis_place_symbols", map[string]any{"boardId": id, "symbols": []map[string]any{{"symbol": "pump", "x": 100, "y": 100, "label": "P-1"}}})
		call("opsis_transform_drawings", map[string]any{"boardId": id, "groups": []string{"pump-1"}, "rotate": 90})
		result := call("opsis_render_board", map[string]any{"boardId": id})
		if fallback != nil {
			image, ok := result.Content[0].(*mcp.ImageContent)
			if !ok || image.MIMEType != "image/png" || !bytes.Equal(image.Data, png) {
				t.Fatalf("render: got %#v", result.Content[0])
			}
			if !strings.Contains(forwarded, "P-1") || !strings.HasPrefix(forwarded, "<svg") {
				t.Fatalf("forwarded preview: %.80s", forwarded)
			}
		} else if text := result.Content[0].(*mcp.TextContent).Text; !strings.Contains(text, "<svg") {
			t.Fatalf("render without a rasteriser: %.120s", text)
		}
		session.Close()
		ss.Close()
		web.Close()
		native.Close()
	}
}

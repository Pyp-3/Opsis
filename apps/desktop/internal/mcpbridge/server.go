package mcpbridge

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

//go:embed dist/tools.js
var source string
var once sync.Once
var program *goja.Program
var compileError error

type Bridge struct {
	Base, Key, Web string
	client         *http.Client
}
type catalog struct {
	Instructions string      `json:"instructions"`
	Tools        []*mcp.Tool `json:"tools"`
}

func New(base, key, web string) (*mcp.Server, error) {
	once.Do(func() { program, compileError = goja.Compile("opsis-tools.js", source, true) })
	if compileError != nil {
		return nil, compileError
	}
	address, err := url.Parse(base)
	if err != nil || address.Scheme != "http" || address.User != nil || address.RawQuery != "" || !loopback(address.Hostname()) {
		return nil, errors.New("MCP requires a direct loopback Opsis API address")
	}
	b := &Bridge{Base: base, Key: key, Web: web, client: &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	_, definitions, err := b.vm(context.Background())
	if err != nil {
		return nil, err
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "opsis", Version: "0.1.0"}, &mcp.ServerOptions{Instructions: definitions.Instructions})
	for _, tool := range definitions.Tools {
		name := tool.Name
		server.AddTool(tool, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return b.call(ctx, name, request.Params.Arguments)
		})
	}
	return server, nil
}

func loopback(host string) bool { return host == "127.0.0.1" || host == "::1" || host == "localhost" }

func (b *Bridge) vm(ctx context.Context) (*goja.Runtime, catalog, error) {
	vm := goja.New()
	_ = vm.Set("nativeURL", func(relative, base string) string {
		origin, err := url.Parse(base)
		if err != nil {
			panic(vm.NewGoError(errors.New("invalid URL")))
		}
		ref, err := url.Parse(relative)
		if err != nil {
			panic(vm.NewGoError(errors.New("invalid URL")))
		}
		return origin.ResolveReference(ref).String()
	})
	_ = vm.Set("nativeFetch", func(address, options string) string {
		var request struct {
			Method  string            `json:"method"`
			Body    string            `json:"body"`
			Headers map[string]string `json:"headers"`
		}
		if json.Unmarshal([]byte(options), &request) != nil {
			return `{"error":"invalid request"}`
		}
		target, err := url.Parse(address)
		expected, _ := url.Parse(b.Base)
		if err != nil || target.Scheme != expected.Scheme || target.Host != expected.Host || !strings.HasPrefix(target.Path, "/v1/") {
			return `{"error":"invalid API destination"}`
		}
		if request.Method == "" {
			request.Method = "GET"
		}
		r, err := http.NewRequestWithContext(ctx, request.Method, address, strings.NewReader(request.Body))
		if err != nil {
			return `{"error":"invalid request"}`
		}
		for name, value := range request.Headers {
			r.Header.Set(name, value)
		}
		response, err := b.client.Do(r)
		if err != nil {
			return `{"error":"local API unavailable"}`
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 20_000_001))
		if err != nil || len(body) > 20_000_000 {
			return `{"error":"invalid API response"}`
		}
		encoded, _ := json.Marshal(map[string]any{"status": response.StatusCode, "body": string(body)})
		return string(encoded)
	})
	if _, err := vm.RunProgram(program); err != nil {
		return nil, catalog{}, err
	}
	initialize, ok := goja.AssertFunction(vm.Get("OpsisTools").ToObject(vm).Get("initialize"))
	if !ok {
		return nil, catalog{}, errors.New("missing MCP catalog")
	}
	value, err := initialize(goja.Undefined(), vm.ToValue(b.Base), vm.ToValue(b.Key), vm.ToValue(b.Web))
	if err != nil {
		return nil, catalog{}, err
	}
	var definitions catalog
	err = json.Unmarshal([]byte(value.String()), &definitions)
	return vm, definitions, err
}

func (b *Bridge) call(ctx context.Context, name string, args json.RawMessage) (*mcp.CallToolResult, error) {
	if len(args) > 1024*1024 {
		return nil, errors.New("tool arguments are too large")
	}
	if len(args) == 0 {
		args = json.RawMessage(`{}`)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	vm, _, err := b.vm(ctx)
	if err != nil {
		return nil, errors.New("could not initialize Opsis tools")
	}
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt("tool cancelled")
		case <-finished:
		}
	}()
	call, _ := goja.AssertFunction(vm.Get("OpsisTools").ToObject(vm).Get("call"))
	value, err := call(goja.Undefined(), vm.ToValue(name), vm.ToValue(string(args)))
	if err != nil {
		return nil, errors.New("Opsis tool did not complete")
	}
	promise, ok := value.Export().(*goja.Promise)
	if !ok || promise.State() != goja.PromiseStateFulfilled {
		return nil, errors.New("Opsis tool did not complete")
	}
	var result struct {
		IsError bool `json:"isError"`
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal([]byte(promise.Result().String()), &result); err != nil {
		return nil, err
	}
	content := []mcp.Content{}
	for _, item := range result.Content {
		content = append(content, &mcp.TextContent{Text: item.Text})
	}
	return &mcp.CallToolResult{IsError: result.IsError, Content: content}, nil
}

func Run(ctx context.Context, base, key, web string) error {
	server, err := New(base, key, web)
	if err != nil {
		return err
	}
	return server.Run(ctx, &mcp.StdioTransport{})
}

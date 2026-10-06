package generation

import (
	"context"
	"encoding/json"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type providerCLIRunner struct {
	t         *testing.T
	provider  string
	graph     string
	completed int
}

func (f *providerCLIRunner) Run(_ context.Context, r harness.Request, _ func(string)) (string, error) {
	if len(r.Args) == 1 {
		switch f.provider {
		case "kimi":
			return "kimi 1.52.0", nil
		case "grok":
			return "grok 1.0.46", nil
		default:
			return "agy 1.3.0", nil
		}
	}
	f.completed++
	if f.provider == "kimi" {
		data, err := os.ReadFile(filepath.Join(r.Directory, "opsis-agent.yaml"))
		if err != nil || !strings.Contains(string(data), "tools: []") {
			f.t.Fatal("missing isolated Kimi agent", err)
		}
	}
	if f.provider == "antigravity" {
		data, err := os.ReadFile(filepath.Join(r.Directory, ".gemini/antigravity-cli/settings.json"))
		if err != nil || !strings.Contains(string(data), "command(*)") {
			f.t.Fatal("missing Antigravity policy", err)
		}
		if !strings.Contains(strings.Join(r.Environment, "\n"), "HOME="+r.Directory) {
			f.t.Fatal("home not isolated")
		}
		var input map[string]any
		if json.Unmarshal([]byte(r.Stdin), &input) != nil || input["event"] != "user" {
			f.t.Fatal("invalid streaming input")
		}
		data, _ = json.Marshal(map[string]any{"event": "result", "result": map[string]string{"status": "SUCCESS", "response": f.graph}})
		return string(data), nil
	}
	return f.graph, nil
}

func TestNativeCLIProvidersUseSharedAdapters(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	demo := request(t, engineFor(t, nil), map[string]any{"agent": "demo", "prompt": "Explain email"})
	for _, provider := range APIProviders {
		executable := filepath.Join(home, provider+executableSuffix)
		if err := os.WriteFile(executable, []byte("fixture"), 0700); err != nil {
			t.Fatal(err)
		}
		runner := &providerCLIRunner{t: t, provider: provider, graph: string(demo.Body)}
		engine := engineFor(t, runner)
		result := request(t, engine, map[string]any{"agent": provider, "prompt": "Explain email", "settings": map[string]any{"connection": "cli", "model": "explicit-model", "effort": "low", "executablePath": executable}})
		if result.Status != 200 || runner.completed != 1 {
			t.Fatalf("%s: %d %s", provider, result.Status, result.Body)
		}
	}
}

type providerRoundTrip func(*http.Request) (*http.Response, error)

func (f providerRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestProviderKeysPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.sqlite")
	keys, err := NewProviderKeys(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = keys.Set("kimi", "fixture-secret"); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewProviderKeys(path)
	if err != nil || reopened.Get("kimi") != "fixture-secret" {
		t.Fatal("key did not persist", err)
	}
	status, _ := json.Marshal(reopened.Status())
	if strings.Contains(string(status), "fixture-secret") {
		t.Fatal("secret in status")
	}
	t.Setenv("OPSIS_KIMI_API_KEY", "fixture-environment")
	if reopened.Get("kimi") != "fixture-environment" {
		t.Fatal("environment override ignored")
	}
	if err = reopened.Set("kimi", ""); err != nil {
		t.Fatal(err)
	}
	if reopened.Get("kimi") != "fixture-environment" {
		t.Fatal("removal changed environment")
	}
}
func TestProviderTransportBoundsAndRedaction(t *testing.T) {
	original := providerHTTPClient
	defer func() { providerHTTPClient = original }()
	calls := 0
	providerHTTPClient = &http.Client{Transport: providerRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.moonshot.ai" || r.Header.Get("Authorization") != "Bearer fixture-secret" {
			t.Fatal("wrong endpoint or credential header")
		}
		return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader("fixture-secret provider debug")), Header: http.Header{}}, nil
	})}
	session := &providerSession{pending: map[string]string{}}
	_, err := session.send(context.Background(), providerRequest{Provider: "kimi", Method: "POST", Path: "/v1/chat/completions", Key: "fixture-secret", Body: "{}"})
	if err == nil || err.Error() != "provider_auth" || calls != 1 {
		t.Fatal("authentication failure not sanitized", err, calls)
	}
	_, err = session.send(context.Background(), providerRequest{Provider: "kimi", Method: "POST", Path: "https://example.com", Key: "fixture-secret"})
	if err == nil || calls != 1 {
		t.Fatal("unapproved endpoint reached transport")
	}
}
func TestProviderSessionCancelsBackgroundWorkAfterVMInterruption(t *testing.T) {
	original := providerHTTPClient
	defer func() { providerHTTPClient = original }()
	paths := []string{}
	providerHTTPClient = &http.Client{Transport: providerRoundTrip(func(r *http.Request) (*http.Response, error) {
		paths = append(paths, r.URL.Path)
		body := `{"id":"fixture","status":"in_progress"}`
		if strings.HasSuffix(r.URL.Path, ":cancel") {
			body = `{"id":"fixture","status":"cancelled"}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}
	session := &providerSession{pending: map[string]string{}}
	_, err := session.send(context.Background(), providerRequest{Provider: "antigravity", Method: "POST", Path: "/v1beta/interactions", Key: "fixture-secret", Body: "{}"})
	if err != nil {
		t.Fatal(err)
	}
	session.close()
	if len(paths) != 2 || paths[1] != "/v1beta/interactions/fixture:cancel" || len(session.pending) != 0 {
		t.Fatal(paths, session.pending)
	}
}

func TestNativeAPIProvidersUseSharedGenerationAndInstanceKeys(t *testing.T) {
	original := providerHTTPClient
	defer func() { providerHTTPClient = original }()
	engine := engineFor(t, nil)
	demo := request(t, engine, map[string]any{"agent": "demo", "prompt": "Explain email"})
	if demo.Status != 200 {
		t.Fatal(string(demo.Body))
	}
	keys, err := NewProviderKeys(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	engine.ProviderKeys = keys
	for _, provider := range APIProviders {
		if err := keys.Set(provider, "fixture-secret"); err != nil {
			t.Fatal(err)
		}
		calls := 0
		providerHTTPClient = &http.Client{Transport: providerRoundTrip(func(r *http.Request) (*http.Response, error) {
			calls++
			data, _ := io.ReadAll(r.Body)
			if strings.Contains(string(data), "fixture-secret") {
				t.Fatal("credential in prompt body")
			}
			var response any
			switch provider {
			case "kimi":
				response = map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(demo.Body)}}}}
			case "grok":
				response = map[string]any{"status": "completed", "output": []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]string{"type": "output_text", "text": string(demo.Body)}}}}}
			default:
				response = map[string]any{"id": "fixture", "status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]string{"type": "text", "text": string(demo.Body)}}}}}
			}
			body, _ := json.Marshal(response)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body))), Header: http.Header{}}, nil
		})}
		result := request(t, engine, map[string]any{"agent": provider, "prompt": "Explain email"})
		if result.Status != 200 || calls != 1 {
			t.Fatalf("%s: status=%d calls=%d body=%s", provider, result.Status, calls, result.Body)
		}
	}
}

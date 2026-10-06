package generation

import (
	"context"
	"encoding/json"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type providerRequest struct {
	Provider string `json:"provider"`
	Method   string `json:"method"`
	Path     string `json:"path"`
	Key      string `json:"key"`
	Body     string `json:"body"`
}
type providerSession struct{ pending map[string]string }

var interactionPath = regexp.MustCompile(`^/v1beta/interactions(?:/[A-Za-z0-9_-]+(?::cancel)?)?$`)
var interactionID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
var providerHTTPClient = &http.Client{Timeout: 180 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

func (s *providerSession) send(ctx context.Context, input providerRequest) (json.RawMessage, error) {
	origin := ""
	switch input.Provider {
	case "kimi":
		if input.Path == "/v1/chat/completions" && input.Method == "POST" {
			origin = "https://api.moonshot.ai"
		}
	case "grok":
		if input.Path == "/v1/responses" && input.Method == "POST" {
			origin = "https://api.x.ai"
		}
	case "antigravity":
		if interactionPath.MatchString(input.Path) && (input.Method == "GET" || input.Method == "POST") {
			origin = "https://generativelanguage.googleapis.com"
		}
	}
	if len(input.Path) > 1100 || len(input.Key) > 4096 || origin == "" || !apiKeyPattern.MatchString(input.Key) || len(input.Body) > 40_000_000 {
		return nil, harness.Error("harness_config")
	}
	if strings.HasSuffix(input.Path, ":cancel") {
		local, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		ctx = local
	}
	request, err := http.NewRequestWithContext(ctx, input.Method, origin+input.Path, strings.NewReader(input.Body))
	if err != nil {
		return nil, harness.Error("provider_failed")
	}
	request.Header.Set("Content-Type", "application/json")
	if input.Provider == "antigravity" {
		request.Header.Set("x-goog-api-key", input.Key)
		request.Header.Set("Api-Revision", "2026-05-20")
	} else {
		request.Header.Set("Authorization", "Bearer "+input.Key)
	}
	response, err := providerHTTPClient.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, harness.Error("harness_cancelled")
		}
		return nil, harness.Error("provider_failed")
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 {
		return nil, harness.Error("provider_auth")
	}
	if response.StatusCode == 429 {
		return nil, harness.Error("provider_quota")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, harness.Error("provider_failed")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if err != nil {
		return nil, harness.Error("provider_failed")
	}
	if len(data) > 4*1024*1024 {
		return nil, harness.Error("harness_overflow")
	}
	if !json.Valid(data) {
		return nil, harness.Error("harness_malformed")
	}
	if input.Provider == "antigravity" {
		var result struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		}
		if json.Unmarshal(data, &result) == nil && len(result.ID) <= 1024 && interactionID.MatchString(result.ID) {
			if result.Status == "in_progress" {
				s.pending[result.ID] = input.Key
			} else {
				delete(s.pending, result.ID)
			}
		}
		if strings.HasSuffix(input.Path, ":cancel") {
			delete(s.pending, strings.TrimSuffix(strings.TrimPrefix(input.Path, "/v1beta/interactions/"), ":cancel"))
		}
	}
	return data, nil
}

// VM interruption can bypass JS finally; the host still cancels known background jobs.
func (s *providerSession) close() {
	for id, key := range s.pending {
		_, _ = s.send(context.Background(), providerRequest{Provider: "antigravity", Method: "POST", Path: "/v1beta/interactions/" + id + ":cancel", Key: key})
	}
}

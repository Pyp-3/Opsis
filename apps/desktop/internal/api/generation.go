package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/generation"
)

func (s *Server) EnableGeneration(engine *generation.Engine) {
	engine.ProviderKeys = s.providerKeys
	limits := generation.NewLimits(engine)
	member := func(r *http.Request) error {
		who := current(r)
		if who.User == nil || who.ViaAgent {
			return failure(401, "Sign in to see provider limits.")
		}
		return nil
	}
	s.handle("GET /v1/providers/limits", func(w http.ResponseWriter, r *http.Request) error {
		if err := member(r); err != nil {
			return err
		}
		writeJSON(w, 200, limits.Snapshot())
		return nil
	})
	s.handle("POST /v1/providers/limits/refresh", func(w http.ResponseWriter, r *http.Request) error {
		if err := member(r); err != nil {
			return err
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
		if err != nil {
			return failure(413, "Request body is too large.")
		}
		providers := generation.LimitProviders
		if len(strings.TrimSpace(string(body))) > 0 {
			var request struct {
				Providers []string `json:"providers"`
			}
			decoder := json.NewDecoder(strings.NewReader(string(body)))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&request) != nil || len(request.Providers) == 0 || len(request.Providers) > len(generation.LimitProviders) {
				return failure(400, "Choose Claude or Codex.")
			}
			for _, provider := range request.Providers {
				if provider != "claude" && provider != "codex" {
					return failure(400, "Choose Claude or Codex.")
				}
			}
			providers = request.Providers
		}
		limits.Refresh(r.Context(), providers)
		writeJSON(w, 200, limits.Snapshot())
		return nil
	})
	s.handle("GET /v1/agents", func(w http.ResponseWriter, r *http.Request) error {
		if _, err := requireUser(r); err != nil {
			return err
		}
		result, err := engine.Agents(r.Context())
		if err != nil {
			return err
		}
		writeJSON(w, 200, result)
		return nil
	})
	for _, operation := range []string{"generate", "illustrate", "check-agent"} {
		s.handle("POST /v1/boards/"+operation, func(w http.ResponseWriter, r *http.Request) error {
			user, err := requireUser(r)
			if err != nil {
				return err
			}
			if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
				return failure(415, "Expected application/json.")
			}
			limit := int64(40_000_000)
			if operation == "check-agent" {
				limit = 8192
			}
			if operation == "illustrate" {
				limit = 4_000_000
			}
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
			if err != nil {
				return failure(413, "Request body is too large.")
			}
			if !json.Valid(body) {
				return failure(400, "Invalid JSON.")
			}
			ctx, cancel := context.WithTimeout(r.Context(), agentDeadline(body))
			defer cancel()
			stream := strings.Contains(r.Header.Get("Accept"), "application/x-ndjson")
			send := func(value any) { _ = json.NewEncoder(w).Encode(value); _ = http.NewResponseController(w).Flush() }
			if stream {
				w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.WriteHeader(200)
			}
			result, err := engine.RunAs(ctx, operation, body, user.ID, func(progress json.RawMessage) {
				// The provider's own report of its limits is the instance's to keep.
				var event struct {
					Type   string          `json:"type"`
					Limits json.RawMessage `json:"limits"`
				}
				if json.Unmarshal(progress, &event) == nil && event.Type == "limits" {
					// Merging runs the shared rule in its own VM; the stream does not wait for it.
					go limits.Observe(context.Background(), event.Limits)
				}
				if stream {
					send(map[string]any{"type": "progress", "progress": progress})
				}
			})
			if err != nil {
				result = generation.Outcome{Status: 502, Body: json.RawMessage(`{"message":"The agent could not complete the request. Your board is unchanged."}`)}
			}
			if r.Context().Err() != nil {
				return nil
			}
			if stream {
				send(map[string]any{"type": "result", "status": result.Status, "body": result.Body})
			} else {
				writeJSON(w, result.Status, result.Body)
			}
			return nil
		})
	}
}

// agentDeadline matches the shared agentDeadlineMs: three minutes, or ten when the request
// runs its agent with full access, which may use tools before it answers.
func agentDeadline(body []byte) time.Duration {
	var request struct {
		Settings struct {
			Access string `json:"access"`
		} `json:"settings"`
	}
	if json.Unmarshal(body, &request) == nil && request.Settings.Access == "full" {
		return 600 * time.Second
	}
	return 180 * time.Second
}

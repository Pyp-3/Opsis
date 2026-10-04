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
			if _, err := requireUser(r); err != nil {
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
			ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
			defer cancel()
			stream := strings.Contains(r.Header.Get("Accept"), "application/x-ndjson")
			send := func(value any) { _ = json.NewEncoder(w).Encode(value); _ = http.NewResponseController(w).Flush() }
			if stream {
				w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.WriteHeader(200)
			}
			result, err := engine.Run(ctx, operation, body, func(progress json.RawMessage) {
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

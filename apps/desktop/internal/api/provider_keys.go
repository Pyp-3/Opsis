package api

import (
	"encoding/json"
	"net/http"
)

func (s *Server) providerKeyRoutes() {
	session := func(r *http.Request) error {
		who := current(r)
		if who.User == nil || who.ViaAgent {
			return failure(401, "Sign in locally to manage this instance’s API keys.")
		}
		return nil
	}
	s.handle("GET /v1/instance/provider-keys", func(w http.ResponseWriter, r *http.Request) error {
		if err := session(r); err != nil {
			return err
		}
		writeJSON(w, 200, s.providerKeys.Status())
		return nil
	})
	s.handle("PUT /v1/instance/provider-keys/{provider}", func(w http.ResponseWriter, r *http.Request) error {
		if err := session(r); err != nil {
			return err
		}
		data, err := rawBody(w, r, 8192)
		if err != nil {
			return err
		}
		var body map[string]string
		if json.Unmarshal(data, &body) != nil || len(body) != 1 || body["key"] == "" {
			return failure(400, "Enter a valid API key.")
		}
		if err := s.providerKeys.Set(r.PathValue("provider"), body["key"]); err != nil {
			return failure(400, "Could not save instance provider key.")
		}
		w.WriteHeader(204)
		return nil
	})
	s.handle("DELETE /v1/instance/provider-keys/{provider}", func(w http.ResponseWriter, r *http.Request) error {
		if err := session(r); err != nil {
			return err
		}
		if err := s.providerKeys.Set(r.PathValue("provider"), ""); err != nil {
			return failure(400, "Could not remove instance provider key.")
		}
		w.WriteHeader(204)
		return nil
	})
}

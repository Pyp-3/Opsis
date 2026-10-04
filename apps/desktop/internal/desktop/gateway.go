package desktop

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Gateway preserves the HTTP/NDJSON contract behind Wails' asset server. WebKit's
// custom scheme does not provide normal HTTP cookie persistence: the native host
// holds its own session, separately from browsers and the MCP agent-key channel.
type Gateway struct {
	proxy       *httputil.ReverseProxy
	mu          sync.Mutex
	session     string
	sessionFile string
	requests    map[string]context.CancelFunc
	cancelled   map[string]time.Time
	closed      bool
}

func NewGateway(target *url.URL, data string) *Gateway {
	g := &Gateway{sessionFile: filepath.Join(data, "desktop-session.json"), requests: make(map[string]context.CancelFunc), cancelled: make(map[string]time.Time)}
	if content, err := os.ReadFile(g.sessionFile); err == nil {
		_ = json.Unmarshal(content, &g.session)
	}
	g.proxy = &httputil.ReverseProxy{
		FlushInterval: -1,
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(target)
			request.Out.Header.Del("Authorization")
			request.Out.Header.Del("Cookie")
			request.Out.Header.Del("X-Opsis-Request-ID")
			// Never make a WebView request qualify for local-only agent-key auth.
			request.Out.Header.Set("Sec-Fetch-Site", "same-origin")
			g.mu.Lock()
			session := g.session
			g.mu.Unlock()
			if session != "" {
				request.Out.AddCookie(&http.Cookie{Name: "opsis_session", Value: session})
			}
		},
		ModifyResponse: func(response *http.Response) error {
			for _, cookie := range response.Cookies() {
				if cookie.Name != "opsis_session" {
					continue
				}
				g.mu.Lock()
				g.session = cookie.Value
				if cookie.MaxAge < 0 {
					g.session = ""
				}
				content, _ := json.Marshal(g.session)
				// Credentials stay in a private user-data directory and never enter JS.
				err := os.WriteFile(g.sessionFile+".tmp", content, 0600)
				if err == nil {
					err = os.Rename(g.sessionFile+".tmp", g.sessionFile)
				}
				g.mu.Unlock()
				if err != nil {
					return err
				}
			}
			response.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, _ error) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"message":"The local Opsis service is unavailable. Restart Opsis to reconnect."}`))
		},
	}
	return g
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/v1/") {
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	id := r.Header.Get("X-Opsis-Request-ID")
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		http.Error(w, "Opsis is closing", 503)
		return
	}
	if id != "" {
		if _, cancelled := g.cancelled[id]; cancelled {
			delete(g.cancelled, id)
			g.mu.Unlock()
			http.Error(w, "Request cancelled", 499)
			return
		}
		if len(id) > 80 || g.requests[id] != nil {
			g.mu.Unlock()
			http.Error(w, "Invalid request ID", 400)
			return
		}
		g.requests[id] = cancel
	}
	g.mu.Unlock()
	defer func() { g.mu.Lock(); delete(g.requests, id); g.mu.Unlock() }()
	g.proxy.ServeHTTP(w, r.WithContext(ctx))
}

// Cancel supplements fetch.abort: custom WebKit schemes do not reliably propagate
// disconnects to net/http. This cancels the upstream request and its agent work.
func (g *Gateway) Cancel(id string) {
	if id == "" || len(id) > 80 {
		return
	}
	g.mu.Lock()
	cancel := g.requests[id]
	if cancel == nil {
		// Abort can overtake the custom-scheme request. Keep bounded tombstones.
		for key, at := range g.cancelled {
			if time.Since(at) > time.Minute {
				delete(g.cancelled, key)
			}
		}
		if len(g.cancelled) < 1024 {
			g.cancelled[id] = time.Now()
		}
	}
	g.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (g *Gateway) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.closed = true
	for _, cancel := range g.requests {
		cancel()
	}
}

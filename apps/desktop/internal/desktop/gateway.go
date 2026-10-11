package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
//
// It forwards to this computer's own service, or to a personal Opsis server the person
// connected to (see server.go). Each server keeps its own session file, so switching back and
// forth keeps both sign-ins, and a session is only ever sent to the server that issued it.
type Gateway struct {
	proxy     *httputil.ReverseProxy
	data      string
	local     *url.URL
	mu        sync.Mutex
	target    *url.URL
	remote    bool
	session   string
	requests  map[string]context.CancelFunc
	cancelled map[string]time.Time
	closed    bool
}

func NewGateway(target *url.URL, data string) *Gateway {
	g := &Gateway{data: data, local: target, requests: make(map[string]context.CancelFunc), cancelled: make(map[string]time.Time)}
	g.useTarget(target, false)
	g.proxy = &httputil.ReverseProxy{
		FlushInterval: -1,
		Rewrite: func(request *httputil.ProxyRequest) {
			g.mu.Lock()
			target, remote, session := g.target, g.remote, g.session
			g.mu.Unlock()
			// The server's path (such as /opsis) comes before the API path.
			request.SetURL(target)
			request.Out.Header.Del("Authorization")
			request.Out.Header.Del("Cookie")
			request.Out.Header.Del("X-Opsis-Request-ID")
			// Never make a WebView request qualify for local-only agent-key auth.
			request.Out.Header.Set("Sec-Fetch-Site", "same-origin")
			if remote {
				// A server accepts writes only from pages on its own origin. These pages are the
				// app's own, so they speak for that origin; nothing else reaches this proxy.
				request.Out.Header.Set("Origin", target.Scheme+"://"+target.Host)
				request.Out.Header.Del("Referer")
			}
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
				// A response from the server used before a switch must not sign into the new one.
				if !strings.HasPrefix(response.Request.URL.String(), g.target.String()+"/") {
					g.mu.Unlock()
					continue
				}
				g.session = cookie.Value
				if cookie.MaxAge < 0 {
					g.session = ""
				}
				err := g.storeSession()
				g.mu.Unlock()
				if err != nil {
					return err
				}
			}
			response.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, _ error) {
			g.mu.Lock()
			message := "The local Opsis service is unavailable. Restart Opsis to reconnect."
			if g.remote {
				message = "Could not reach " + ServerLabel(g.target) + ". Check your connection; your unsaved work is kept on this computer."
			}
			g.mu.Unlock()
			body, _ := json.Marshal(map[string]string{"message": message})
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write(body)
		},
	}
	return g
}

// sessionFile is where the session for the current server is kept: this computer's has its
// own file, and each remote server one named after its address.
func (g *Gateway) sessionFile() string {
	if !g.remote {
		return filepath.Join(g.data, "desktop-session.json")
	}
	sum := sha256.Sum256([]byte(g.target.String()))
	return filepath.Join(g.data, "server-session-"+hex.EncodeToString(sum[:8])+".json")
}

// storeSession writes the current session; the caller holds g.mu.
func (g *Gateway) storeSession() error {
	content, _ := json.Marshal(g.session)
	// Credentials stay in a private user-data directory and never enter JS.
	file := g.sessionFile()
	err := os.WriteFile(file+".tmp", content, 0600)
	if err == nil {
		err = os.Rename(file+".tmp", file)
	}
	return err
}

// useTarget points the gateway at a server and loads that server's session; the caller holds
// g.mu (or is constructing the gateway).
func (g *Gateway) useTarget(target *url.URL, remote bool) {
	g.target, g.remote, g.session = target, remote, ""
	if content, err := os.ReadFile(g.sessionFile()); err == nil {
		_ = json.Unmarshal(content, &g.session)
	}
}

// UseServer switches to a remote server, or back to this computer's service when address is
// nil. Requests still running against the previous server are cancelled.
func (g *Gateway) UseServer(address *url.URL) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, cancel := range g.requests {
		cancel()
	}
	if address == nil {
		g.useTarget(g.local, false)
	} else {
		g.useTarget(address, true)
	}
}

// Server is the remote server in use, or nil for this computer.
func (g *Gateway) Server() *url.URL {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.remote {
		return nil
	}
	copy := *g.target
	return &copy
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

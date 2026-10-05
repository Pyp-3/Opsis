package desktop

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestGatewayKeepsNativeSessionsPrivateAndPersistent(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("native requests must not forward agent keys")
		}
		if r.Header.Get("Sec-Fetch-Site") == "" {
			t.Error("native requests must not qualify as internal agent requests")
		}
		switch r.URL.Path {
		case "/v1/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "opsis_session", Value: "test-session", Path: "/", HttpOnly: true})
		case "/v1/auth/logout":
			http.SetCookie(w, &http.Cookie{Name: "opsis_session", MaxAge: -1})
		case "/v1/auth/me":
			cookie, err := r.Cookie("opsis_session")
			if err != nil || cookie.Value != "test-session" {
				w.WriteHeader(401)
			}
		}
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	directory := t.TempDir()
	gateway := NewGateway(target, directory)
	request := func(g *Gateway, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer test-agent-key")
		r.Header.Set("Cookie", "opsis_session=untrusted")
		w := httptest.NewRecorder()
		g.ServeHTTP(w, r)
		return w
	}
	if request(gateway, "/v1/auth/me").Code != 401 {
		t.Fatal("expected signed out")
	}
	login := request(gateway, "/v1/auth/login")
	if login.Header().Get("Set-Cookie") != "" {
		t.Fatal("session escaped native storage")
	}
	if request(gateway, "/v1/auth/me").Code != 200 {
		t.Fatal("session lost")
	}
	info, err := os.Stat(filepath.Join(directory, "desktop-session.json"))
	// Windows has no POSIX mode bits; the profile directory ACL provides privacy there.
	if err != nil || (runtime.GOOS != "windows" && info.Mode().Perm() != 0600) {
		t.Fatal("session must be private")
	}
	restarted := NewGateway(target, directory)
	if request(restarted, "/v1/auth/me").Code != 200 {
		t.Fatal("session did not survive restart")
	}
	request(restarted, "/v1/auth/logout")
	if request(NewGateway(target, directory), "/v1/auth/me").Code != 401 {
		t.Fatal("logout did not persist")
	}
}

func TestGatewayStreamsAndCancelsUpstream(t *testing.T) {
	ended := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = io.WriteString(w, "{\"type\":\"progress\"}\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(ended)
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	gateway := NewGateway(target, t.TempDir())
	server := httptest.NewServer(gateway)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/v1/boards/generate", nil)
	r.Header.Set("X-Opsis-Request-ID", "stream")
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	line, err := bufio.NewReader(response.Body).ReadString('\n')
	if err != nil || !strings.Contains(line, "progress") {
		t.Fatal("progress must arrive before completion")
	}
	gateway.Cancel("stream")
	select {
	case <-ended:
	case <-time.After(time.Second):
		t.Fatal("upstream generation survived cancellation")
	}
}

func TestCancellationBeforeRequestAndClosedGateway(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("cancelled request reached service") }))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	gateway := NewGateway(target, t.TempDir())
	gateway.Cancel("early")
	r := httptest.NewRequest("GET", "/v1/boards", nil)
	r.Header.Set("X-Opsis-Request-ID", "early")
	w := httptest.NewRecorder()
	gateway.ServeHTTP(w, r)
	if w.Code != 499 {
		t.Fatal(w.Code)
	}
	gateway.Close()
	w = httptest.NewRecorder()
	gateway.ServeHTTP(w, httptest.NewRequest("GET", "/v1/boards", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}

package desktop

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerAddressAcceptsOnlyPlainHTTPSAddresses(t *testing.T) {
	for raw, want := range map[string]string{
		"opsis.example.com/opsis":           "https://opsis.example.com/opsis",
		" https://Example.COM/opsis/ ":      "https://example.com/opsis",
		"https://example.com":               "https://example.com",
		"https://example.com:8443/a/b-c_d~": "https://example.com:8443/a/b-c_d~",
		"http://127.0.0.1:8000":             "http://127.0.0.1:8000",
		"http://localhost:3000/opsis":       "http://localhost:3000/opsis",
	} {
		address, err := ServerAddress(raw)
		if err != nil || address.String() != want {
			t.Errorf("ServerAddress(%q) = %v, %v; want %s", raw, address, err, want)
		}
	}
	for _, raw := range []string{
		"", "http://example.com", "ftp://example.com", "javascript:alert(1)",
		"https://user:secret@example.com", "https://example.com/?next=x", "https://example.com/#x",
		"https://example.com/a b", "https://example.com/%2e%2e/x", "https://", "file:///etc/passwd",
		"https://example.com/" + strings.Repeat("a", 2100),
	} {
		if address, err := ServerAddress(raw); err == nil {
			t.Errorf("ServerAddress(%q) = %v; want an error", raw, address)
		}
	}
	if label := ServerLabel(&url.URL{Scheme: "https", Host: "opsis.example.com", Path: "/opsis"}); label != "opsis.example.com/opsis" {
		t.Fatal(label)
	}
}

func TestProbeServerChecksItIsACompatibleOpsisServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/current/v1/instance":
			_, _ = w.Write([]byte(`{"signup":false,"accountExecutablePaths":false,"api":1}`))
		case "/older/v1/instance":
			_, _ = w.Write([]byte(`{"signup":false,"accountExecutablePaths":false}`))
		case "/newer/v1/instance":
			_, _ = w.Write([]byte(`{"signup":false,"accountExecutablePaths":false,"api":2}`))
		case "/website/v1/instance":
			_, _ = w.Write([]byte(`<html>Not Opsis</html>`))
		case "/moved/v1/instance":
			http.Redirect(w, r, "https://elsewhere.example/v1/instance", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	probe := func(path string) error {
		address, err := ServerAddress(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		return ProbeServer(context.Background(), address, 1)
	}
	if err := probe("/current"); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{
		"/older":   "older version",
		"/newer":   "newer version",
		"/website": "does not look like an Opsis server",
		"/moved":   "does not look like an Opsis server",
		"/missing": "does not look like an Opsis server",
	} {
		if err := probe(path); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("probe %s = %v; want %q", path, err, want)
		}
	}
	unreachable, _ := ServerAddress("http://127.0.0.1:1")
	if err := ProbeServer(context.Background(), unreachable, 1); err == nil || !strings.Contains(err.Error(), "Could not reach") {
		t.Fatal(err)
	}
}

func TestServerChoiceIsRememberedPrivately(t *testing.T) {
	directory := t.TempDir()
	if LoadServerChoice(directory) != nil {
		t.Fatal("a new install should use this computer")
	}
	address, _ := ServerAddress("https://opsis.example.com/opsis")
	if err := SaveServerChoice(directory, address); err != nil {
		t.Fatal(err)
	}
	if got := LoadServerChoice(directory); got == nil || got.String() != address.String() {
		t.Fatalf("remembered %v", got)
	}
	// A tampered choice falls back to this computer rather than to an unchecked address.
	_ = os.WriteFile(filepath.Join(directory, "server.json"), []byte(`{"url":"http://example.com"}`), 0600)
	if LoadServerChoice(directory) != nil {
		t.Fatal("an invalid remembered address was used")
	}
	if err := SaveServerChoice(directory, nil); err != nil || LoadServerChoice(directory) != nil {
		t.Fatal("could not return to this computer")
	}
	if err := SaveServerChoice(directory, nil); err != nil {
		t.Fatal("forgetting twice should succeed")
	}
}

func TestGatewaySwitchesServersKeepingEachSessionToItsOwnServer(t *testing.T) {
	signedIn := func(name string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := strings.TrimPrefix(r.URL.Path, "/opsis")
			switch path {
			case "/v1/auth/login":
				http.SetCookie(w, &http.Cookie{Name: "opsis_session", Value: name + "-session", Path: "/", Secure: true})
			case "/v1/boards":
				if r.Method == "POST" {
					w.Header().Set("X-Origin", r.Header.Get("Origin"))
					w.Header().Set("X-Referer", r.Header.Get("Referer"))
				}
				fallthrough
			case "/v1/auth/me":
				cookie, err := r.Cookie("opsis_session")
				if err != nil || cookie.Value != name+"-session" {
					w.WriteHeader(401)
					return
				}
				_, _ = w.Write([]byte(name + ":" + path))
			}
		})
	}
	local := httptest.NewServer(signedIn("local"))
	defer local.Close()
	remote := httptest.NewServer(signedIn("remote"))
	defer remote.Close()
	localURL, _ := url.Parse(local.URL)
	remoteURL, _ := ServerAddress(remote.URL + "/opsis")
	directory := t.TempDir()
	gateway := NewGateway(localURL, directory)
	call := func(method, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Origin", "wails://wails")
		r.Header.Set("Referer", "wails://wails/canvas")
		w := httptest.NewRecorder()
		gateway.ServeHTTP(w, r)
		return w
	}

	call("GET", "/v1/auth/login")
	if body := call("GET", "/v1/auth/me").Body.String(); body != "local:/v1/auth/me" {
		t.Fatalf("local: %q", body)
	}
	gateway.UseServer(remoteURL)
	if gateway.Server().String() != remoteURL.String() {
		t.Fatal(gateway.Server())
	}
	// The local session is never sent to the remote server.
	if call("GET", "/v1/auth/me").Code != 401 {
		t.Fatal("a session crossed servers")
	}
	call("GET", "/v1/auth/login")
	if body := call("GET", "/v1/auth/me").Body.String(); body != "remote:/v1/auth/me" {
		t.Fatalf("remote: %q (the server's path must come first)", body)
	}
	// Writes speak for the server's own origin, and say nothing of the app's pages.
	write := call("POST", "/v1/boards")
	if write.Header().Get("X-Origin") != "http://"+remoteURL.Host || write.Header().Get("X-Referer") != "" {
		t.Fatalf("origin %q, referer %q", write.Header().Get("X-Origin"), write.Header().Get("X-Referer"))
	}
	files, _ := filepath.Glob(filepath.Join(directory, "server-session-*.json"))
	if len(files) != 1 {
		t.Fatalf("remote session files: %v", files)
	}

	// Each server keeps its own sign-in through switches and restarts.
	gateway.UseServer(nil)
	if gateway.Server() != nil || call("GET", "/v1/auth/me").Body.String() != "local:/v1/auth/me" {
		t.Fatal("the local sign-in was lost")
	}
	gateway = NewGateway(localURL, directory)
	gateway.UseServer(remoteURL)
	if call("GET", "/v1/auth/me").Body.String() != "remote:/v1/auth/me" {
		t.Fatal("the remote sign-in did not survive a restart")
	}
}

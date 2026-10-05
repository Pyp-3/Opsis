package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type fixture struct {
	manifest  []byte
	signature string
	installer []byte
	name      string
	size      int64
}

func newFixture(t *testing.T, key ed25519.PrivateKey, build int, installer []byte) *fixture {
	t.Helper()
	name := "opsis-0.1.0-build.7.1.gabc-windows-x64-setup.exe"
	digest := sha256.Sum256(installer)
	manifest := map[string]any{
		"schema": 1, "version": "0.1.0-build.7.1.gabc", "build": build, "attempt": 1, "commit": "abc",
		"installer": map[string]any{"name": name, "size": len(installer), "sha256": hex.EncodeToString(digest[:])},
	}
	content, _ := json.Marshal(manifest)
	return &fixture{
		manifest:  content,
		signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, content)),
		installer: installer,
		name:      name,
		size:      int64(len(installer)),
	}
}

func serve(t *testing.T, f *fixture) (*Client, ed25519.PublicKey) {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/o/r/releases":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				// The newest release is a branch build without a manifest; it is skipped.
				{"html_url": server.URL + "/branch", "assets": []map[string]any{}},
				{"html_url": server.URL + "/release", "assets": []map[string]any{
					{"name": ManifestName, "browser_download_url": server.URL + "/manifest", "size": len(f.manifest)},
					{"name": ManifestName + ".sig", "browser_download_url": server.URL + "/sig", "size": len(f.signature)},
					{"name": f.name, "browser_download_url": server.URL + "/setup", "size": f.size},
				}},
			})
		case "/manifest":
			_, _ = w.Write(f.manifest)
		case "/sig":
			_, _ = w.Write([]byte(f.signature + "\n"))
		case "/setup":
			_, _ = w.Write(f.installer)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return &Client{HTTP: server.Client(), API: server.URL + "/repos/o/r"}, nil
}

func keys(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return public, private
}

func TestFindsDownloadsAndVerifiesANewerSignedUpdate(t *testing.T) {
	public, private := keys(t)
	f := newFixture(t, private, 7, []byte("installer bytes"))
	client, _ := serve(t, f)
	client.PublicKey = public
	update, err := client.Latest(context.Background(), Build{Number: 6, Attempt: 1})
	if err != nil || update == nil || update.Build != 7 || !strings.HasSuffix(update.Page, "/release") {
		t.Fatalf("update not found: %+v %v", update, err)
	}
	path, err := client.Download(context.Background(), update, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if content, _ := os.ReadFile(path); string(content) != "installer bytes" {
		t.Fatal("installer content changed")
	}
}

func TestIgnoresCurrentAndOlderBuilds(t *testing.T) {
	public, private := keys(t)
	client, _ := serve(t, newFixture(t, private, 7, []byte("x")))
	client.PublicKey = public
	for _, current := range []Build{{Number: 7, Attempt: 1}, {Number: 8, Attempt: 1}} {
		if update, err := client.Latest(context.Background(), current); err != nil || update != nil {
			t.Fatalf("offered a non-newer build to %+v: %+v %v", current, update, err)
		}
	}
}

func TestRejectsManifestsSignedByAnotherKeyOrAltered(t *testing.T) {
	public, private := keys(t)
	_, other := keys(t)
	client, _ := serve(t, newFixture(t, other, 7, []byte("x")))
	client.PublicKey = public
	if _, err := client.Latest(context.Background(), Build{}); err == nil {
		t.Fatal("accepted a manifest signed by another key")
	}
	altered := newFixture(t, private, 7, []byte("x"))
	altered.manifest = []byte(strings.Replace(string(altered.manifest), `"build":7`, `"build":9`, 1))
	client, _ = serve(t, altered)
	client.PublicKey = public
	if _, err := client.Latest(context.Background(), Build{}); err == nil {
		t.Fatal("accepted an altered manifest")
	}
}

func TestRejectsAnInstallerThatDoesNotMatchItsManifest(t *testing.T) {
	public, private := keys(t)
	f := newFixture(t, private, 7, []byte("expected"))
	client, _ := serve(t, f)
	client.PublicKey = public
	update, err := client.Latest(context.Background(), Build{})
	if err != nil || update == nil {
		t.Fatal(err)
	}
	f.installer = []byte("tampered") // same length, different digest
	directory := t.TempDir()
	if _, err := client.Download(context.Background(), update, directory); err == nil {
		t.Fatal("accepted a tampered installer")
	}
	if entries, _ := os.ReadDir(directory); len(entries) != 0 {
		t.Fatal("tampered installer was left on disk")
	}
}

func TestRejectsUnexpectedInstallerNames(t *testing.T) {
	public, private := keys(t)
	f := newFixture(t, private, 7, []byte("x"))
	f.manifest = []byte(strings.Replace(string(f.manifest), f.name, "..\\evil.exe", 1))
	f.signature = base64.StdEncoding.EncodeToString(ed25519.Sign(private, f.manifest))
	client, _ := serve(t, f)
	client.PublicKey = public
	if _, err := client.Latest(context.Background(), Build{}); err == nil {
		t.Fatal("accepted an unsafe installer name")
	}
}

func TestEmbeddedPublicKeyIsValid(t *testing.T) {
	if _, err := New(); err != nil {
		t.Fatal(err)
	}
}

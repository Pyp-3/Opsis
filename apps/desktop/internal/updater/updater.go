// Package updater finds, verifies and downloads Windows desktop updates from
// GitHub Releases. Release manifests are trusted only when their Ed25519
// signature matches the public key compiled into the application; the
// installer must then match the size and SHA-256 recorded in that manifest.
package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// PublicKey verifies update manifests. Its private half is the CI secret
// OPSIS_UPDATE_SIGNING_KEY; rotating it requires users to reinstall once.
const PublicKey = "gMRtMfNhZKSnQt3dXQ6A/00scYudgp9MieYA+IibL44="

const (
	ManifestName  = "opsis-update-windows-x64.json"
	maxManifest   = 64 * 1024
	maxSignature  = 1024
	maxInstaller  = 1024 * 1024 * 1024
	maxReleaseAPI = 4 * 1024 * 1024
)

var installerName = regexp.MustCompile(`^opsis-[0-9A-Za-z.-]+-windows-x64-setup\.exe$`)

// Build identifies a CI build; zero means a local development build.
type Build struct {
	Version string
	Number  int
	Attempt int
}

func (b Build) newerThan(other Build) bool {
	return b.Number > other.Number || b.Number == other.Number && b.Attempt > other.Attempt
}

type Manifest struct {
	Schema    int    `json:"schema"`
	Version   string `json:"version"`
	Build     int    `json:"build"`
	Attempt   int    `json:"attempt"`
	Commit    string `json:"commit"`
	Installer struct {
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		SHA256 string `json:"sha256"`
	} `json:"installer"`
}

// Update is a verified manifest plus where its installer can be downloaded.
type Update struct {
	Manifest
	Page         string
	installerURL string
}

type Client struct {
	HTTP      *http.Client
	API       string // https://api.github.com/repos/OWNER/REPO
	PublicKey ed25519.PublicKey
}

func New() (*Client, error) {
	key, err := base64.StdEncoding.DecodeString(PublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return nil, errors.New("invalid update public key")
	}
	return &Client{
		HTTP:      &http.Client{Timeout: 10 * time.Minute},
		API:       "https://api.github.com/repos/Pyp-3/Opsis",
		PublicKey: key,
	}, nil
}

type asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}
type release struct {
	Draft  bool    `json:"draft"`
	Page   string  `json:"html_url"`
	Assets []asset `json:"assets"`
}

func (c *Client) get(ctx context.Context, url string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Opsis-desktop-updater")
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update server returned %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errors.New("update response is too large")
	}
	return body, nil
}

// Latest returns the newest signed update when it is newer than current, or nil.
func (c *Client) Latest(ctx context.Context, current Build) (*Update, error) {
	body, err := c.get(ctx, c.API+"/releases?per_page=20", maxReleaseAPI)
	if err != nil {
		return nil, err
	}
	var releases []release
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil, errors.New("invalid release list")
	}
	// Releases are listed newest first; only main-branch builds carry a manifest.
	for _, candidate := range releases {
		if candidate.Draft {
			continue
		}
		assets := map[string]asset{}
		for _, item := range candidate.Assets {
			assets[item.Name] = item
		}
		manifestAsset, ok := assets[ManifestName]
		signatureAsset, signed := assets[ManifestName+".sig"]
		if !ok || !signed {
			continue
		}
		manifest, err := c.verifiedManifest(ctx, manifestAsset.URL, signatureAsset.URL)
		if err != nil {
			return nil, err
		}
		installer, ok := assets[manifest.Installer.Name]
		if !ok || installer.Size != manifest.Installer.Size {
			return nil, errors.New("signed installer is missing from its release")
		}
		if !(Build{Number: manifest.Build, Attempt: manifest.Attempt}).newerThan(current) {
			return nil, nil
		}
		return &Update{Manifest: manifest, Page: candidate.Page, installerURL: installer.URL}, nil
	}
	return nil, nil
}

func (c *Client) verifiedManifest(ctx context.Context, manifestURL, signatureURL string) (Manifest, error) {
	var manifest Manifest
	content, err := c.get(ctx, manifestURL, maxManifest)
	if err != nil {
		return manifest, err
	}
	encoded, err := c.get(ctx, signatureURL, maxSignature)
	if err != nil {
		return manifest, err
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil || !ed25519.Verify(c.PublicKey, content, signature) {
		return manifest, errors.New("update signature is not valid")
	}
	if err := json.Unmarshal(content, &manifest); err != nil || manifest.Schema != 1 {
		return manifest, errors.New("unsupported update manifest")
	}
	digest, err := hex.DecodeString(manifest.Installer.SHA256)
	if manifest.Build < 1 || manifest.Attempt < 1 || !installerName.MatchString(manifest.Installer.Name) ||
		manifest.Installer.Size < 1 || manifest.Installer.Size > maxInstaller || err != nil || len(digest) != sha256.Size {
		return manifest, errors.New("invalid update manifest")
	}
	return manifest, nil
}

// Download saves the installer into directory and verifies its size and digest.
func (c *Client) Download(ctx context.Context, update *Update, directory string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, update.installerURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", "Opsis-desktop-updater")
	response, err := c.HTTP.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("update download returned %d", response.StatusCode)
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, update.Installer.Name)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0700)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, update.Installer.Size+1))
	closeErr := file.Close()
	if copyErr == nil {
		copyErr = closeErr
	}
	if copyErr == nil && (written != update.Installer.Size || hex.EncodeToString(hash.Sum(nil)) != strings.ToLower(update.Installer.SHA256)) {
		copyErr = errors.New("downloaded update does not match its signed manifest")
	}
	if copyErr != nil {
		_ = os.Remove(path)
		return "", copyErr
	}
	return path, nil
}

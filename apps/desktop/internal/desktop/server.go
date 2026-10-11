package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// The desktop app works with its own local service by default, or with a personal Opsis server
// the person connects to (docs/SERVER.md). Only the API is remote: the pages stay the ones
// bundled with the app, so no server-supplied code runs in the window that holds the native
// file and clipboard bridges.

// serverPath is what may follow the host: the path a server is mounted under, such as /opsis.
var serverPath = regexp.MustCompile(`^(?:/[A-Za-z0-9._~-]+)*$`)

// ServerAddress reads what a person typed as a server address. HTTPS is required, except for a
// server on this computer; credentials, queries and fragments are refused, and a missing scheme
// means HTTPS.
func ServerAddress(raw string) (*url.URL, error) {
	text := strings.TrimSpace(raw)
	if text == "" || len(text) > 2048 {
		return nil, errors.New("Enter the server's address, such as https://example.com/opsis.")
	}
	if !strings.Contains(text, "://") {
		text = "https://" + text
	}
	address, err := url.Parse(text)
	if err != nil || address.Host == "" || address.Opaque != "" {
		return nil, errors.New("That is not a web address.")
	}
	if address.User != nil || address.RawQuery != "" || address.Fragment != "" || address.ForceQuery {
		return nil, errors.New("Use the server's address alone, without a name, password, ? or #.")
	}
	host := address.Hostname()
	loopback := host == "localhost"
	if ip := net.ParseIP(host); ip != nil {
		loopback = ip.IsLoopback()
	}
	switch {
	case address.Scheme == "https":
	case address.Scheme == "http" && loopback:
	default:
		return nil, errors.New("Opsis servers must use https://.")
	}
	path := strings.TrimRight(address.EscapedPath(), "/")
	if !serverPath.MatchString(path) {
		return nil, errors.New("The address's path can only hold letters, digits and . _ ~ -.")
	}
	return &url.URL{Scheme: address.Scheme, Host: strings.ToLower(address.Host), Path: path}, nil
}

// ServerLabel is how the app names a server: its host and path, without the scheme.
func ServerLabel(address *url.URL) string { return address.Host + address.Path }

// ProbeServer checks that an address is an Opsis server whose API generation matches the
// bundled app's. Redirects are not followed, so a server cannot hand the app to another host.
func ProbeServer(ctx context.Context, address *url.URL, wantAPI int) error {
	client := &http.Client{
		Timeout:       10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	request, err := http.NewRequestWithContext(ctx, "GET", address.String()+"/v1/instance", nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("Could not reach %s. Check the address and your connection.", ServerLabel(address))
	}
	defer response.Body.Close()
	var instance struct {
		Signup                 *bool `json:"signup"`
		AccountExecutablePaths *bool `json:"accountExecutablePaths"`
		API                    int   `json:"api"`
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil || response.StatusCode != 200 || json.Unmarshal(body, &instance) != nil ||
		instance.Signup == nil || instance.AccountExecutablePaths == nil {
		return fmt.Errorf("%s does not look like an Opsis server.", ServerLabel(address))
	}
	if instance.API != wantAPI {
		if instance.API < wantAPI {
			return fmt.Errorf("%s runs an older version of Opsis. Update the server, then connect again.", ServerLabel(address))
		}
		return fmt.Errorf("%s runs a newer version of Opsis. Update this app, then connect again.", ServerLabel(address))
	}
	return nil
}

type serverChoice struct {
	URL string `json:"url"`
}

func serverChoiceFile(data string) string { return filepath.Join(data, "server.json") }

// LoadServerChoice returns the server the app was last connected to, or nil for this computer.
// A choice that no longer reads as a valid address falls back to this computer.
func LoadServerChoice(data string) *url.URL {
	content, err := os.ReadFile(serverChoiceFile(data))
	if err != nil {
		return nil
	}
	var choice serverChoice
	if json.Unmarshal(content, &choice) != nil || choice.URL == "" {
		return nil
	}
	address, err := ServerAddress(choice.URL)
	if err != nil {
		return nil
	}
	return address
}

// SaveServerChoice remembers the server to use on the next start; nil means this computer.
func SaveServerChoice(data string, address *url.URL) error {
	file := serverChoiceFile(data)
	if address == nil {
		if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	content, _ := json.Marshal(serverChoice{URL: address.String()})
	if err := os.WriteFile(file+".tmp", content, 0600); err != nil {
		return err
	}
	return os.Rename(file+".tmp", file)
}

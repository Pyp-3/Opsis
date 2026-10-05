package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/api"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/desktop"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/generation"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/mcpbridge"
	"github.com/Pyp-3/Opsis/apps/desktop/internal/updater"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:assets
var frontend embed.FS

//go:embed bundle/runtime.tar.gz
var bundle []byte

//go:embed smoke.js
var smokeScript string

// CI sets these with -ldflags -X; local builds stay "development" and never update.
var (
	version      = "development"
	buildNumber  = "0"
	buildAttempt = "0"
)

type Desktop struct {
	ctx     context.Context
	gateway *desktop.Gateway
	smoke   bool
	result  chan string
	updates *updater.Client
	mu      sync.Mutex
	pending *updater.Update
}

type UpdateStatus struct {
	Supported  bool   `json:"supported"`
	Available  bool   `json:"available"`
	Current    string `json:"current"`
	Version    string `json:"version"`
	CanInstall bool   `json:"canInstall"`
}

func currentBuild() updater.Build {
	number, _ := strconv.Atoi(buildNumber)
	attempt, _ := strconv.Atoi(buildAttempt)
	return updater.Build{Version: version, Number: number, Attempt: attempt}
}

// CheckForUpdate asks GitHub Releases for a newer signed Windows build.
// OPSIS_UPDATES=off, development builds and smoke tests never contact the network.
func (d *Desktop) CheckForUpdate() (UpdateStatus, error) {
	status := UpdateStatus{Current: version}
	build := currentBuild()
	if goruntime.GOOS != "windows" || d.updates == nil || d.smoke || build.Number == 0 || os.Getenv("OPSIS_UPDATES") == "off" {
		return status, nil
	}
	status.Supported = true
	ctx, cancel := context.WithTimeout(d.ctx, 30*time.Second)
	defer cancel()
	update, err := d.updates.Latest(ctx, build)
	if err != nil {
		return status, errors.New("could not check for updates")
	}
	d.mu.Lock()
	d.pending = update
	d.mu.Unlock()
	if update != nil {
		status.Available, status.Version, status.CanInstall = true, update.Version, updater.Installed()
	}
	return status, nil
}

// InstallUpdate downloads and verifies the pending installer, starts it, and
// quits so it can replace this executable. The installer reopens Opsis.
func (d *Desktop) InstallUpdate() error {
	if err := d.startPendingInstaller(); err != nil {
		return err
	}
	runtime.Quit(d.ctx)
	return nil
}

func (d *Desktop) startPendingInstaller() error {
	d.mu.Lock()
	update := d.pending
	d.mu.Unlock()
	if update == nil || !updater.Installed() {
		return errors.New("no installable update is available")
	}
	path, err := d.updates.Download(d.ctx, update, filepath.Join(os.TempDir(), "opsis-update"))
	if err != nil {
		return err
	}
	return updater.Launch(path)
}

// runUpdateCommand backs --check-update and --install-update with the same
// verification as the in-app notice, printing the status as JSON.
func runUpdateCommand(install bool) error {
	client, err := updater.New()
	if err != nil {
		return err
	}
	app := &Desktop{ctx: context.Background(), updates: client}
	status, err := app.CheckForUpdate()
	if err != nil {
		return err
	}
	encoded, _ := json.Marshal(status)
	fmt.Println(string(encoded))
	if !install || !status.Available {
		return nil
	}
	if err := app.startPendingInstaller(); err != nil {
		return err
	}
	fmt.Println("Update installer started; Opsis will reopen when it finishes.")
	return nil
}

// OpenUpdatePage opens the pending update's GitHub release in the browser.
func (d *Desktop) OpenUpdatePage() {
	d.mu.Lock()
	update := d.pending
	d.mu.Unlock()
	if update != nil && strings.HasPrefix(update.Page, "https://github.com/") {
		runtime.BrowserOpenURL(d.ctx, update.Page)
	}
}

func (d *Desktop) CancelRequest(id string) { d.gateway.Cancel(id) }

// Only a user-selected destination is writable through the frontend bridge.
func (d *Desktop) SaveFile(name, encoded string) (bool, error) {
	if len(encoded) > 48*1024*1024 {
		return false, errors.New("export is too large")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return false, errors.New("invalid export data")
	}
	path, err := runtime.SaveFileDialog(d.ctx, runtime.SaveDialogOptions{DefaultFilename: filepath.Base(name), Title: "Export from Opsis"})
	if err != nil || path == "" {
		return false, err
	}
	if err := os.WriteFile(path, content, 0600); err != nil {
		return false, err
	}
	return true, nil
}

func (d *Desktop) CopyText(text string) error {
	if len(text) > 1024*1024 {
		return errors.New("clipboard text is too large")
	}
	return runtime.ClipboardSetText(d.ctx, text)
}

// The smoke reporter is inert during ordinary use and cannot access files.
func (d *Desktop) ReportSmoke(result string) {
	if d.smoke && len(result) < 64*1024 {
		select {
		case d.result <- result:
		default:
		}
	}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	mode := ""
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	if mode != "" && mode != "--mcp" && mode != "--diagnose" && mode != "--smoke-test" && mode != "--serve" && mode != "--import-database" && mode != "--backup-database" && mode != "--check-update" && mode != "--install-update" {
		return errors.New("usage: opsis [--mcp | --diagnose | --smoke-test | --serve | --import-database PATH | --backup-database NEW_PATH | --check-update | --install-update]")
	}
	if mode == "--check-update" || mode == "--install-update" {
		return runUpdateCommand(mode == "--install-update")
	}
	paths, err := desktop.UserPaths()
	if err != nil {
		return err
	}
	if mode == "--backup-database" {
		if len(os.Args) != 3 {
			return errors.New("usage: opsis --backup-database NEW_PATH")
		}
		if err := api.ImportDatabase(paths.Database, os.Args[2]); err != nil {
			return err
		}
		fmt.Println("Database backup created at " + os.Args[2])
		return nil
	}
	if mode == "--import-database" {
		if len(os.Args) != 3 {
			return errors.New("usage: opsis --import-database PATH")
		}
		lock, err := desktop.LockProfile(paths.Data)
		if err != nil {
			return err
		}
		defer lock.Close()
		if err := api.ImportDatabase(os.Args[2], paths.Database); err != nil {
			return err
		}
		fmt.Println("Existing database copied to " + paths.Database)
		return nil
	}
	endpointFile := filepath.Join(paths.Data, "desktop-api.json")
	if mode == "--mcp" {
		if os.Getenv("OPSIS_API_URL") == "" {
			content, err := os.ReadFile(endpointFile)
			if err != nil {
				return errors.New("start the Opsis desktop application before its MCP server")
			}
			var endpoint string
			if json.Unmarshal(content, &endpoint) != nil || !strings.HasPrefix(endpoint, "http://127.0.0.1:") {
				return errors.New("invalid desktop API address")
			}
			_ = os.Setenv("OPSIS_API_URL", endpoint)
		}
		base := os.Getenv("OPSIS_API_URL")
		web := os.Getenv("OPSIS_WEB_URL")
		if web == "" {
			web = base
		}
		return mcpbridge.Run(context.Background(), base, os.Getenv("OPSIS_AGENT_KEY"), web)
	}
	runtimeDir, err := desktop.ExtractRuntime(bundle, paths.Cache)
	if err != nil {
		return fmt.Errorf("prepare packaged runtime: %w", err)
	}
	if mode == "--smoke-test" && (os.Getenv("OPSIS_DATA_DIR") == "" || os.Getenv("OPSIS_SPEECH") != "off") {
		return errors.New("smoke tests require an isolated OPSIS_DATA_DIR and OPSIS_SPEECH=off")
	}
	lock, err := desktop.LockProfile(paths.Data)
	if err != nil {
		return err
	}
	defer lock.Close()
	service, err := harness.Start(context.Background(), runtimeDir, paths.Models)
	if err != nil {
		return err
	}
	defer service.Close()
	compatibility := httputil.NewSingleHostReverseProxy(service.URL)
	compatibility.FlushInterval = -1
	nativeAPI, err := api.New(paths.Database, compatibility)
	if err != nil {
		return err
	}
	defer nativeAPI.Close()
	workflows, err := generation.New(harness.ProcessRunner{Node: harness.NodePath(runtimeDir)})
	if err != nil {
		return err
	}
	nativeAPI.EnableGeneration(workflows)
	assets, err := fs.Sub(frontend, "assets")
	if err != nil {
		return err
	}
	port := "0"
	if mode == "--serve" {
		port = os.Getenv("PORT")
		if port == "" {
			port = "8000"
		}
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		return err
	}
	files := http.FileServer(http.FS(assets))
	server := &http.Server{ReadHeaderTimeout: 10 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") {
			nativeAPI.ServeHTTP(w, r)
			return
		}
		// Browser mode preserves history routes and worker isolation headers.
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "credentialless")
		if _, err := fs.Stat(assets, strings.TrimPrefix(r.URL.Path, "/")); err != nil && !strings.Contains(filepath.Base(r.URL.Path), ".") {
			r.URL.Path = "/"
		}
		files.ServeHTTP(w, r)
	})}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	apiURL, _ := url.Parse("http://" + listener.Addr().String())
	if mode == "--diagnose" {
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Get(apiURL.String() + "/v1/health")
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return errors.New("local service health check failed")
		}
		fmt.Println("Packaged runtime and local service: OK")
		return nil
	}
	endpoint, _ := json.Marshal(apiURL.String())
	if err := os.WriteFile(endpointFile, endpoint, 0600); err != nil {
		return err
	}
	defer func() {
		// Do not remove a newer instance's discovery record.
		if current, err := os.ReadFile(endpointFile); err == nil && string(current) == string(endpoint) {
			_ = os.Remove(endpointFile)
		}
	}()
	if mode == "--serve" {
		fmt.Println("Opsis listening on " + apiURL.String())
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		select {
		case <-ctx.Done():
			return nil
		case <-service.Done():
			return errors.New("the speech service stopped")
		}
	}
	gateway := desktop.NewGateway(apiURL, paths.Data)
	defer gateway.Close()
	app := &Desktop{gateway: gateway, smoke: mode == "--smoke-test", result: make(chan string, 1)}
	if updates, err := updater.New(); err == nil {
		app.updates = updates
	}
	smokeCompleted := make(chan string, 1)
	err = wails.Run(&options.App{
		Title: "Opsis", Width: 1100, Height: 680, MinWidth: 640, MinHeight: 480,
		StartHidden:      app.smoke,
		BackgroundColour: options.NewRGB(15, 23, 30),
		AssetServer: &assetserver.Options{
			Assets: assets,
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/v1/") {
						gateway.ServeHTTP(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Linux:     &linux.Options{ProgramName: "opsis", WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand},
		OnStartup: func(ctx context.Context) { app.ctx = ctx },
		OnDomReady: func(ctx context.Context) {
			if !app.smoke {
				return
			}
			files, _ := fs.ReadDir(assets, "assets")
			names := []string{}
			for _, file := range files {
				names = append(names, "/assets/"+file.Name())
			}
			encoded, _ := json.Marshal(names)
			runtime.WindowExecJS(ctx, "window.__OPSIS_SMOKE_ASSETS="+string(encoded)+";"+smokeScript)
			go func() {
				var smokeResult string
				select {
				case smokeResult = <-app.result:
				case <-time.After(90 * time.Second):
					smokeResult = `{"ok":false,"error":"WebView smoke test timed out"}`
				}
				smokeCompleted <- smokeResult
				runtime.Quit(ctx)
			}()
		},
		OnShutdown: func(context.Context) { gateway.Close(); service.Close() },
		Bind:       []interface{}{app},
	})
	if err != nil {
		return err
	}
	if app.smoke {
		var smokeResult string
		select {
		case smokeResult = <-smokeCompleted:
		default:
			return errors.New("WebView closed before the smoke test completed")
		}
		fmt.Println(smokeResult)
		var result struct {
			OK bool `json:"ok"`
		}
		if json.Unmarshal([]byte(smokeResult), &result) != nil || !result.OK {
			return errors.New("desktop smoke test failed")
		}
	}
	return nil
}

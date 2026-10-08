package harness

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// ChildEnvironment matches the existing provider boundary. Provider credentials
// stay in their own local CLI login; unrelated environment secrets are excluded.
func ChildEnvironment() []string {
	values := []string{"HOME=" + os.Getenv("HOME"), "LANG=" + valueOr("LANG", "C.UTF-8"), "TMPDIR=" + os.TempDir(), "PATH=" + valueOr("PATH", "/usr/local/bin:/usr/bin:/bin")}
	for _, name := range []string{"USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "COMSPEC", "TEMP", "TMP", "XDG_CONFIG_HOME", "XDG_DATA_HOME"} {
		if value, ok := os.LookupEnv(name); ok {
			values = append(values, name+"="+value)
		}
	}
	return values
}
func valueOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func ResolveAgent(agent string) (string, error) {
	return ResolveAgentPath(agent, "")
}
func ResolveAgentPath(agent, configuredPath string) (string, error) {
	if agent != "claude" && agent != "codex" && agent != "kimi" && agent != "grok" && agent != "antigravity" {
		return "", Error("harness_config")
	}
	// Windows has no POSIX mode bits (Go reports 0666), and extensionless npm
	// shims there are sh scripts. Only .exe files and Node entrypoints run
	// directly; .cmd/.bat shims would need cmd.exe, which the harness never uses.
	windows := runtime.GOOS == "windows"
	usable := func(path string) (string, bool) {
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return "", false
		}
		info, err := os.Stat(resolved)
		if err != nil || !info.Mode().IsRegular() {
			return "", false
		}
		ext := strings.ToLower(filepath.Ext(resolved))
		script := ext == ".js" || ext == ".mjs" || ext == ".cjs"
		if !script && (windows && ext != ".exe" || !windows && info.Mode().Perm()&0111 == 0) {
			return "", false
		}
		return resolved, true
	}
	validate := func(path string) (string, error) {
		info, err := os.Stat(path)
		if err != nil {
			return "", Error("harness_missing")
		}
		if !windows && info.Mode().Perm()&0022 != 0 {
			return "", Error("harness_config")
		}
		return path, nil
	}
	packageName := "@openai/codex"
	if agent == "claude" {
		packageName = "@anthropic-ai/claude-code"
	}
	npmEntry := func(directory string) (string, bool) {
		if agent == "kimi" || agent == "grok" || agent == "antigravity" {
			return "", false
		}
		root := filepath.Join(directory, "node_modules", packageName)
		content, err := os.ReadFile(filepath.Join(root, "package.json"))
		if err != nil {
			return "", false
		}
		var manifest struct {
			Bin json.RawMessage `json:"bin"`
		}
		if json.Unmarshal(content, &manifest) != nil {
			return "", false
		}
		var entry string
		if json.Unmarshal(manifest.Bin, &entry) != nil {
			var bins map[string]string
			if json.Unmarshal(manifest.Bin, &bins) != nil {
				return "", false
			}
			entry = bins[agent]
		}
		if entry == "" || filepath.IsAbs(entry) {
			return "", false
		}
		candidate := filepath.Join(root, entry)
		relative, err := filepath.Rel(root, candidate)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			return "", false
		}
		return usable(candidate)
	}
	override := strings.TrimSpace(configuredPath)
	if override == "" {
		override = strings.TrimSpace(os.Getenv("OPSIS_" + strings.ToUpper(agent) + "_BIN"))
	}
	if override != "" {
		if !filepath.IsAbs(override) {
			return "", Error("harness_config")
		}
		ext := strings.ToLower(filepath.Ext(override))
		if windows && (ext == ".cmd" || ext == ".bat" || ext == ".ps1") {
			info, err := os.Stat(override)
			if err != nil || !info.Mode().IsRegular() {
				return "", Error("harness_missing")
			}
			// Recognize the installed npm launcher by name, then read its package
			// manifest. Never interpret or execute the shell launcher's contents.
			if strings.EqualFold(filepath.Base(override), agent+ext) {
				if path, ok := npmEntry(filepath.Dir(override)); ok {
					return validate(path)
				}
			}
			return "", Error("harness_config")
		}
		if path, ok := usable(override); ok {
			return validate(path)
		}
		return "", Error("harness_missing")
	}
	home, _ := os.UserHomeDir()
	directories := append(filepath.SplitList(os.Getenv("PATH")), filepath.Join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", filepath.Join(home, ".npm-global/bin"))
	directories = append(directories, filepath.Join(home, ".grok", "bin"))
	if os.Getenv("LOCALAPPDATA") != "" {
		directories = append(directories, filepath.Join(os.Getenv("LOCALAPPDATA"), "agy", "bin"))
	}
	if windows && os.Getenv("APPDATA") != "" {
		directories = append(directories, filepath.Join(os.Getenv("APPDATA"), "npm"))
	}
	for _, directory := range directories {
		if !filepath.IsAbs(directory) {
			continue
		}
		name := agent
		if agent == "antigravity" {
			name = "agy"
		}
		if windows {
			name += ".exe"
		}
		if path, ok := usable(filepath.Join(directory, name)); ok {
			return validate(path)
		}
		if path, ok := npmEntry(directory); ok {
			return validate(path)
		}
	}
	return "", Error("harness_missing")
}

func Probe(ctx context.Context, runner Runner, agent string) (string, string, error) {
	return ProbePath(ctx, runner, agent, "")
}
func ProbePath(ctx context.Context, runner Runner, agent, configuredPath string) (string, string, error) {
	executable, err := ResolveAgentPath(agent, configuredPath)
	if err != nil {
		return "", "", err
	}
	directory, err := os.MkdirTemp("", "opsis-harness-version-")
	if err != nil {
		return "", "", Error("harness_missing")
	}
	defer os.RemoveAll(directory)
	args := []string{"--version"}
	if agent == "grok" {
		args = []string{"version"}
	}
	output, err := runner.Run(ctx, Request{Executable: executable, Args: args, Directory: directory, Environment: ChildEnvironment(), Timeout: 5 * time.Second, MaxInput: 768 * 1024, MaxOutput: 4096, MaxError: 4096}, nil)
	return executable, output, err
}

type File struct {
	Name string `json:"name"`
	Data []byte `json:"data"`
	Kind string `json:"kind"`
}
type Completion struct {
	Executable string `json:"executable"`
	Provider   string `json:"provider"`
	Schema     string `json:"schema"`
	Request    struct {
		System string `json:"system"`
		User   string `json:"user"`
	} `json:"request"`
	Files          []File            `json:"files"`
	WorkspaceFiles map[string]string `json:"workspaceFiles"`
	Environment    map[string]string `json:"environment"`
	// Session is a chat thread's server-derived key ("account/thread"). The CLI then works
	// in the thread's stable directory, where it finds its saved session again.
	Session string `json:"session"`
}

var sessionSegment = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

// SessionDirectory is the stable working directory of a chat thread's native CLI session,
// matching the browser-development API's layout.
func SessionDirectory(key string) (string, error) {
	parts := strings.Split(key, "/")
	if len(parts) != 2 || !sessionSegment.MatchString(parts[0]) || !sessionSegment.MatchString(parts[1]) {
		return "", Error("harness_config")
	}
	return filepath.Join(os.TempDir(), "opsis-sessions", parts[0], parts[1]), nil
}

// sessionStateFile holds which session a thread resumes; see sessions.ts.
func sessionStateFile(key string) (string, error) {
	directory, err := SessionDirectory(key)
	if err != nil {
		return "", err
	}
	return filepath.Join(directory, "session.json"), nil
}

// ReadSession returns a thread's saved session state, or "" when it has none.
func ReadSession(key string) (string, error) {
	path, err := sessionStateFile(key)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil || len(data) > 4096 {
		return "", Error("harness_exit")
	}
	return string(data), nil
}

// WriteSession records a thread's session state after a successful turn.
func WriteSession(key, state string) error {
	path, err := sessionStateFile(key)
	if err != nil {
		return err
	}
	if len(state) > 4096 {
		return Error("harness_config")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return Error("harness_exit")
	}
	if err := os.WriteFile(path, []byte(state), 0600); err != nil {
		return Error("harness_exit")
	}
	return nil
}

// ClearSession forgets a thread's session, so its next turn starts a new one.
func ClearSession(key string) error {
	path, err := sessionStateFile(key)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return Error("harness_exit")
	}
	return nil
}

func Complete(ctx context.Context, runner Runner, input Completion, argumentsFor func(string, []string) ([]string, error), onLine func(string)) (string, error) {
	if input.Provider == "agy" && len(input.Files) > 0 {
		return "", Error("provider_attachment")
	}
	if input.Provider == "grok" {
		if len(input.Files) > 0 {
			return "", Error("provider_attachment")
		}
		home, _ := os.UserHomeDir()
		entries, err := os.ReadDir(filepath.Join(home, ".grok"))
		if err != nil && !os.IsNotExist(err) {
			return "", Error("harness_config")
		}
		for _, entry := range entries {
			switch entry.Name() {
			case "auth.json", "sessions", "logs", "downloads", "bin", "cache":
			default:
				return "", Error("harness_config")
			}
		}
	}
	if input.Provider == "kimi" {
		if len(input.Files) > 0 {
			return "", Error("provider_attachment")
		}
		home, _ := os.UserHomeDir()
		entries, err := os.ReadDir(filepath.Join(home, ".kimi", "plugins"))
		if (err != nil && !os.IsNotExist(err)) || len(entries) > 0 {
			return "", Error("harness_config")
		}
	}
	// A run in a thread's session works in its stable directory; the schema and uploads still
	// go in a disposable folder, inside it.
	cwd, parent := "", ""
	if input.Session != "" {
		if input.Provider != "claude" && input.Provider != "codex" {
			return "", Error("harness_config")
		}
		session, err := SessionDirectory(input.Session)
		if err != nil {
			return "", err
		}
		if err := os.MkdirAll(session, 0700); err != nil {
			return "", Error("harness_exit")
		}
		cwd, parent = session, session
	}
	directory, err := os.MkdirTemp(parent, "opsis-harness-")
	if err != nil {
		return "", Error("harness_exit")
	}
	defer os.RemoveAll(directory)
	if cwd == "" {
		cwd = directory
	}
	for name, content := range input.WorkspaceFiles {
		if (filepath.Base(name) != name && name != ".gemini/antigravity-cli/settings.json") || name == "." || name == ".." || len(content) > 1_000_000 {
			return "", Error("harness_config")
		}
		if err := os.MkdirAll(filepath.Dir(filepath.Join(directory, name)), 0700); err != nil {
			return "", Error("harness_exit")
		}
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0600); err != nil {
			return "", Error("harness_exit")
		}
	}
	schemaPath := filepath.Join(directory, "response-schema.json")
	if err := os.WriteFile(schemaPath, []byte(input.Schema), 0600); err != nil {
		return "", Error("harness_exit")
	}
	paths := []string{}
	if len(input.Files) > 0 {
		folder := filepath.Join(directory, "attachments")
		if err := os.Mkdir(folder, 0700); err != nil {
			return "", Error("harness_exit")
		}
		for _, file := range input.Files {
			if filepath.Base(file.Name) != file.Name || file.Name == "." || file.Name == ".." || len(file.Data) > 10*1024*1024 {
				return "", Error("harness_config")
			}
			path := filepath.Join(folder, file.Name)
			output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				return "", Error("harness_exit")
			}
			_, writeErr := output.Write(file.Data)
			closeErr := output.Close()
			if writeErr != nil || closeErr != nil {
				return "", Error("harness_exit")
			}
			paths = append(paths, path)
		}
	}
	args, err := argumentsFor(schemaPath, paths)
	if err != nil {
		return "", Error("harness_config")
	}
	limit := 1024 * 1024
	if input.Provider == "claude" {
		limit = 32 * 1024 * 1024
	}
	environment := ChildEnvironment()
	for key, value := range input.Environment {
		if value == "." && input.Provider == "agy" && (key == "HOME" || key == "USERPROFILE" || key == "APPDATA" || key == "LOCALAPPDATA" || key == "XDG_CONFIG_HOME" || key == "XDG_DATA_HOME") {
			value = directory
		} else if !strings.HasPrefix(key, "GROK_") || value != "0" {
			return "", Error("harness_config")
		}
		filtered := []string{}
		for _, entry := range environment {
			if !strings.HasPrefix(entry, key+"=") {
				filtered = append(filtered, entry)
			}
		}
		environment = append(filtered, key+"="+value)
	}
	stdin := input.Request.System + "\n\n" + input.Request.User
	if input.Provider == "grok" {
		stdin = ""
	}
	if input.Provider == "agy" {
		encoded, _ := json.Marshal(map[string]any{"event": "user", "message": map[string]string{"content": stdin}})
		stdin = string(encoded) + "\n"
	}
	return runner.Run(ctx, Request{Executable: input.Executable, Args: args, Stdin: stdin, Directory: cwd, Environment: environment, Timeout: 180 * time.Second, MaxInput: 768 * 1024, MaxOutput: limit, MaxError: 64 * 1024}, onLine)
}

func NodePath(directory string) string {
	name := "node"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(directory, name)
}

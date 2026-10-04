package harness

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
	if agent != "claude" && agent != "codex" {
		return "", Error("harness_config")
	}
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
		if !script && info.Mode().Perm()&0111 == 0 {
			return "", false
		}
		return resolved, true
	}
	validate := func(path string) (string, error) {
		info, err := os.Stat(path)
		if err != nil {
			return "", Error("harness_missing")
		}
		if info.Mode().Perm()&0022 != 0 {
			return "", Error("harness_config")
		}
		return path, nil
	}
	override := strings.TrimSpace(configuredPath)
	if override == "" {
		override = strings.TrimSpace(os.Getenv("OPSIS_" + strings.ToUpper(agent) + "_BIN"))
	}
	if override != "" {
		if !filepath.IsAbs(override) {
			return "", Error("harness_config")
		}
		if path, ok := usable(override); ok {
			return validate(path)
		}
		return "", Error("harness_missing")
	}
	home, _ := os.UserHomeDir()
	directories := append(filepath.SplitList(os.Getenv("PATH")), filepath.Join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", filepath.Join(home, ".npm-global/bin"))
	packageName := "@openai/codex"
	if agent == "claude" {
		packageName = "@anthropic-ai/claude-code"
	}
	for _, directory := range directories {
		if !filepath.IsAbs(directory) {
			continue
		}
		if path, ok := usable(filepath.Join(directory, agent)); ok {
			return validate(path)
		}
		root := filepath.Join(directory, "node_modules", packageName)
		content, err := os.ReadFile(filepath.Join(root, "package.json"))
		if err != nil {
			continue
		}
		var manifest struct {
			Bin json.RawMessage `json:"bin"`
		}
		if json.Unmarshal(content, &manifest) != nil {
			continue
		}
		var entry string
		if json.Unmarshal(manifest.Bin, &entry) != nil {
			var bins map[string]string
			if json.Unmarshal(manifest.Bin, &bins) != nil {
				continue
			}
			entry = bins[agent]
		}
		if entry == "" {
			continue
		}
		candidate := filepath.Join(root, entry)
		relative, err := filepath.Rel(root, candidate)
		if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
			continue
		}
		if path, ok := usable(candidate); ok {
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
	output, err := runner.Run(ctx, Request{Executable: executable, Args: []string{"--version"}, Directory: directory, Environment: ChildEnvironment(), Timeout: 5 * time.Second, MaxInput: 768 * 1024, MaxOutput: 4096, MaxError: 4096}, nil)
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
	Files []File `json:"files"`
}

func Complete(ctx context.Context, runner Runner, input Completion, argumentsFor func(string, []string) ([]string, error), onLine func(string)) (string, error) {
	directory, err := os.MkdirTemp("", "opsis-harness-")
	if err != nil {
		return "", Error("harness_exit")
	}
	defer os.RemoveAll(directory)
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
	return runner.Run(ctx, Request{Executable: input.Executable, Args: args, Stdin: input.Request.System + "\n\n" + input.Request.User, Directory: directory, Environment: ChildEnvironment(), Timeout: 180 * time.Second, MaxInput: 768 * 1024, MaxOutput: limit, MaxError: 64 * 1024}, onLine)
}

func NodePath(directory string) string {
	name := "node"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(directory, name)
}

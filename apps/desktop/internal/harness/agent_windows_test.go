package harness

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsNPMLauncherOverridesResolveWithoutAShell(t *testing.T) {
	for _, agent := range []string{"claude", "codex"} {
		t.Run(agent, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "With spaces")
			packageName, entry := "@openai/codex", "bin/codex.js"
			if agent == "claude" {
				packageName, entry = "@anthropic-ai/claude-code", "bin/claude.exe"
			}
			root := filepath.Join(directory, "node_modules", packageName)
			if err := os.MkdirAll(filepath.Join(root, "bin"), 0700); err != nil {
				t.Fatal(err)
			}
			manifest, _ := json.Marshal(map[string]any{"bin": map[string]string{agent: entry}})
			if err := os.WriteFile(filepath.Join(root, "package.json"), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			expected := filepath.Join(root, entry)
			if err := os.WriteFile(expected, []byte("fixture, never executed"), 0600); err != nil {
				t.Fatal(err)
			}
			for _, extension := range []string{".cmd", ".bat", ".ps1"} {
				launcher := filepath.Join(directory, agent+extension)
				if err := os.WriteFile(launcher, []byte("fixture, never interpreted"), 0600); err != nil {
					t.Fatal(err)
				}
				resolved, err := ResolveAgentPath(agent, launcher)
				if err != nil {
					t.Fatalf("%s: %q %v", extension, resolved, err)
				}
				// Windows runners may expose TEMP through an 8.3 path. Resolution
				// expands it, so compare file identity rather than path spelling.
				actualInfo, err := os.Stat(resolved)
				if err != nil {
					t.Fatal(err)
				}
				expectedInfo, err := os.Stat(expected)
				if err != nil || !os.SameFile(actualInfo, expectedInfo) {
					t.Fatalf("%s resolved %q instead of %q", extension, resolved, expected)
				}
			}
			custom := filepath.Join(directory, "custom.cmd")
			if err := os.WriteFile(custom, nil, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := ResolveAgentPath(agent, custom); !errors.Is(err, Error("harness_config")) {
				t.Fatal("custom shell launcher accepted", err)
			}
			if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"bin":"../../outside.js"}`), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := ResolveAgentPath(agent, filepath.Join(directory, agent+".cmd")); !errors.Is(err, Error("harness_config")) {
				t.Fatal("out-of-package entry accepted", err)
			}
		})
	}
}

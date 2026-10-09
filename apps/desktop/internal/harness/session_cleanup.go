package harness

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// A deleted chat thread's native CLI sessions are removed with it, matching cli-sessions.ts:
// every session its state lists (see sessions.ts) is deleted from the CLI's own store by its
// validated id, then the thread's directory goes. The reader's own CLI sessions are never touched.

var (
	sessionUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	sessionDay  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// TranscriptHomes are where Claude and Codex keep their saved sessions.
type TranscriptHomes struct{ Claude, Codex string }

// DefaultTranscriptHomes follows the CLIs' own defaults and overrides.
func DefaultTranscriptHomes() TranscriptHomes {
	home, _ := os.UserHomeDir()
	homes := TranscriptHomes{Claude: filepath.Join(home, ".claude"), Codex: filepath.Join(home, ".codex")}
	if value := os.Getenv("CLAUDE_CONFIG_DIR"); value != "" {
		homes.Claude = value
	}
	if value := os.Getenv("CODEX_HOME"); value != "" {
		homes.Codex = value
	}
	return homes
}

type sessionTranscript struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
	Day      string `json:"day"`
}

// sessionTranscripts lists the validated sessions a thread's state records, current one included.
func sessionTranscripts(state string) []sessionTranscript {
	var value struct {
		Provider    string              `json:"provider"`
		ID          string              `json:"id"`
		Transcripts []sessionTranscript `json:"transcripts"`
	}
	if json.Unmarshal([]byte(state), &value) != nil {
		return nil
	}
	listed := append(value.Transcripts, sessionTranscript{Provider: value.Provider, ID: value.ID})
	seen := map[string]bool{}
	var valid []sessionTranscript
	for _, item := range listed {
		if (item.Provider != "claude" && item.Provider != "codex") || !sessionUUID.MatchString(item.ID) || seen[item.Provider+item.ID] {
			continue
		}
		seen[item.Provider+item.ID] = true
		if !sessionDay.MatchString(item.Day) {
			item.Day = ""
		}
		valid = append(valid, item)
	}
	return valid
}

// RemoveSession removes a deleted thread's native sessions and directory. It reports how many
// sessions had files removed; a thread that never used one has nothing to remove.
func RemoveSession(key string, homes TranscriptHomes) (int, error) {
	directory, err := SessionDirectory(key)
	if err != nil {
		return 0, err
	}
	state, _ := os.ReadFile(filepath.Join(directory, "session.json"))
	removed := 0
	for _, transcript := range sessionTranscripts(string(state)) {
		var found bool
		if transcript.Provider == "claude" {
			found = removeClaudeSession(homes.Claude, transcript.ID)
		} else {
			found = removeCodexSession(homes.Codex, transcript)
		}
		if found {
			removed++
		}
	}
	return removed, os.RemoveAll(directory)
}

func entryNames(directory string) []string {
	entries, _ := os.ReadDir(directory)
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

func removePath(path string) bool {
	if _, err := os.Lstat(path); err != nil {
		return false
	}
	return os.RemoveAll(path) == nil
}

// Claude saves a session as projects/<directory>/<id>.jsonl, with a folder of the same id,
// plus per-session folders and to-do files elsewhere in its home.
func removeClaudeSession(home, id string) bool {
	removed := false
	projects := filepath.Join(home, "projects")
	for _, project := range entryNames(projects) {
		removed = removePath(filepath.Join(projects, project, id+".jsonl")) || removed
		removed = removePath(filepath.Join(projects, project, id)) || removed
	}
	for _, folder := range []string{"file-history", "session-env"} {
		removed = removePath(filepath.Join(home, folder, id)) || removed
	}
	for _, name := range entryNames(filepath.Join(home, "todos")) {
		if strings.HasPrefix(name, id+"-") {
			removed = removePath(filepath.Join(home, "todos", name)) || removed
		}
	}
	return removed
}

// Codex saves a session as sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl under the local date
// it started; the recorded day and its neighbours are searched, or every date without one.
func removeCodexSession(home string, transcript sessionTranscript) bool {
	sessions := filepath.Join(home, "sessions")
	var days []string
	if day, err := time.ParseInLocation("2006-01-02", transcript.Day, time.Local); err == nil {
		for offset := -1; offset <= 1; offset++ {
			days = append(days, day.AddDate(0, 0, offset).Format(filepath.Join("2006", "01", "02")))
		}
	} else {
		for _, year := range entryNames(sessions) {
			for _, month := range entryNames(filepath.Join(sessions, year)) {
				for _, date := range entryNames(filepath.Join(sessions, year, month)) {
					days = append(days, filepath.Join(year, month, date))
				}
			}
		}
	}
	removed := false
	for _, day := range days {
		folder := filepath.Join(sessions, day)
		for _, name := range entryNames(folder) {
			if strings.HasPrefix(name, "rollout-") && strings.HasSuffix(name, "-"+transcript.ID+".jsonl") {
				removed = removePath(filepath.Join(folder, name)) || removed
			}
		}
	}
	return removed
}

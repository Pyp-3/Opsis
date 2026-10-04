package desktop

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type Paths struct {
	Data     string
	Cache    string
	Database string
	Models   string
}

// Data is independent of the installation and its extracted, replaceable runtime.
// OPSIS_DB_PATH remains an explicit opt-in for opening an existing database.
func UserPaths() (Paths, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, err
	}
	data := os.Getenv("OPSIS_DATA_DIR")
	if data == "" {
		if runtime.GOOS == "windows" {
			data = os.Getenv("LOCALAPPDATA")
			if data == "" {
				data = filepath.Join(home, "AppData", "Local")
			}
		} else if runtime.GOOS == "darwin" {
			data = filepath.Join(home, "Library", "Application Support")
		} else {
			data = os.Getenv("XDG_DATA_HOME")
		}
		if data == "" {
			data = filepath.Join(home, ".local", "share")
		}
		data = filepath.Join(data, "opsis")
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return Paths{}, err
	}
	cache = filepath.Join(cache, "opsis")
	for _, dir := range []string{data, cache} {
		if !filepath.IsAbs(dir) {
			return Paths{}, fmt.Errorf("Opsis data and cache directories must be absolute")
		}
		if err := os.MkdirAll(dir, 0700); err != nil {
			return Paths{}, err
		}
	}
	db := os.Getenv("OPSIS_DB_PATH")
	if db == "" {
		db = filepath.Join(data, "opsis.sqlite")
	}
	models := os.Getenv("OPSIS_MODEL_DIR")
	if models == "" {
		models = filepath.Join(cache, "models")
	}
	return Paths{Data: data, Cache: cache, Database: db, Models: models}, nil
}

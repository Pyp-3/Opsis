package api

import (
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
)

// ImportDatabase takes a consistent SQLite snapshot, including committed WAL
// content. It never replaces an existing destination or modifies the source.
func ImportDatabase(source, destination string) error {
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Lstat(destination + suffix); err == nil {
			return errors.New("destination has SQLite sidecar files; choose a new database path")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if _, err := os.Stat(destination); err == nil {
		return errors.New("destination database already exists; choose a new OPSIS_DATA_DIR")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	absolute, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	if info, err := os.Stat(absolute); err != nil || !info.Mode().IsRegular() {
		return errors.New("source database is not a regular file")
	}
	dsn := (&url.URL{Scheme: "file", Path: absolute, RawQuery: "mode=ro&_busy_timeout=5000"}).String()
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	var check string
	if err := db.QueryRow(`PRAGMA quick_check`).Scan(&check); err != nil || check != "ok" {
		return errors.New("source database did not pass SQLite integrity checks")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(destination), ".import-*.sqlite")
	if err != nil {
		return err
	}
	file.Close()
	defer os.Remove(file.Name())
	if _, err := db.Exec(`VACUUM INTO ?`, file.Name()); err != nil {
		return err
	}
	// An exclusive hard link is atomic and cannot overwrite a concurrently-created DB.
	if err := os.Link(file.Name(), destination); err != nil {
		return err
	}
	return nil
}

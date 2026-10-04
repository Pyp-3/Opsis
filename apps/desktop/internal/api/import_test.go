package api

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestImportsLiveWALWithoutReplacingData(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source.sqlite")
	destination := filepath.Join(directory, "destination.sqlite")
	db, err := sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; CREATE TABLE original(value TEXT); INSERT INTO original VALUES('preserve');`); err != nil {
		t.Fatal(err)
	}
	if err := ImportDatabase(source, destination); err != nil {
		t.Fatal(err)
	}
	copy, err := sql.Open("sqlite3", destination)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	var value string
	if err := copy.QueryRow(`SELECT value FROM original`).Scan(&value); err != nil || value != "preserve" {
		t.Fatal("WAL data not imported")
	}
	if err := ImportDatabase(source, destination); err == nil {
		t.Fatal("existing destination replaced")
	}
	info, err := os.Stat(destination)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("database not private")
	}
}

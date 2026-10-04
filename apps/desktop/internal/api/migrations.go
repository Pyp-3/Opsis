package api

import (
	"encoding/json"
	"errors"
)

// Both hosts execute the same append-only SQL catalogue in one transaction.
func (s *Server) applyMigrations() error {
	raw, err := s.contracts.Apply("migrations", nil)
	if err != nil {
		return err
	}
	var migrations []struct {
		Version int
		Name    string
		SQL     string
	}
	if err := json.Unmarshal(raw, &migrations); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL)`); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return err
	}
	applied := map[int]bool{}
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			rows.Close()
			return err
		}
		applied[version] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for version := range applied {
		known := false
		for _, migration := range migrations {
			if migration.Version == version {
				known = true
			}
		}
		if !known {
			return errors.New("this database requires a newer version of Opsis")
		}
	}
	for _, migration := range migrations {
		if applied[migration.Version] {
			continue
		}
		if _, err := tx.Exec(migration.SQL); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations VALUES(?,?)`, migration.Version, migration.Name); err != nil {
			return err
		}
	}
	return tx.Commit()
}

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Database = require('better-sqlite3');
const directory = mkdtempSync(join(tmpdir(), 'opsis-install-'));
try {
  const db = new Database(join(directory, 'probe.sqlite'));
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE probe(value TEXT NOT NULL)');
    db.prepare('INSERT INTO probe VALUES(?)').run('native SQLite ready');
    assert.equal(db.prepare('SELECT value FROM probe').get().value, 'native SQLite ready');
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    db.close();
  }
  console.log('Clean-install native SQLite write/read/WAL check passed.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}

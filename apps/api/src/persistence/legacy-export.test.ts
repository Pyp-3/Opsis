import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { LegacyBundleSchema } from '@opsis/schema';
import { exportLegacyDatabase } from './legacy-export';
it('exports a legacy database read-only, reports invalid records and refuses output overwrite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'opsis-legacy-'));
  try {
    const source = join(directory, 'old.sqlite'),
      destination = join(directory, 'bundle.json');
    const db = new Database(source);
    db.exec(
      'CREATE TABLE osg_documents(id TEXT PRIMARY KEY,document TEXT NOT NULL,updated_at INTEGER)',
    );
    const original = readFileSync(resolve('fixtures/osg/sun-east.osg.json'), 'utf8');
    db.prepare('INSERT INTO osg_documents VALUES(?,?,0)').run('sun', original);
    db.prepare('INSERT INTO osg_documents VALUES(?,?,0)').run('broken', '{}');
    db.close();
    const bytes = readFileSync(source);
    expect(exportLegacyDatabase(source, destination)).toEqual({ converted: 1, rejected: 1 });
    const bundle = LegacyBundleSchema.parse(JSON.parse(readFileSync(destination, 'utf8')));
    expect(bundle.boards[0]?.board.groups).toHaveLength(1);
    expect(bundle.boards[0]?.board.nodes.some((node) => node.icon === 'sun')).toBe(true);
    expect(bundle.boards[0]?.board.nodes[0]?.references?.[0]?.excerpt).toContain('sun');
    expect(readFileSync(source)).toEqual(bytes);
    expect(() => exportLegacyDatabase(source, destination)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

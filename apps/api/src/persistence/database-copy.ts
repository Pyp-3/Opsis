import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

/** SQLite creates a consistent copy including committed WAL writes. Publication is exclusive. */
export function copyDatabase(source: string, destination: string) {
  const input = resolve(source),
    output = resolve(destination);
  if (!statSync(input).isFile()) throw new Error('Source database must be a regular file.');
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(output + suffix))
      throw new Error('Destination already exists. Choose a new database path.');
  }
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(dirname(output), '.opsis-database-'));
  chmodSync(temporary, 0o700);
  const file = join(temporary, 'snapshot.sqlite');
  let db: Database.Database | undefined;
  try {
    db = new Database(input, { readonly: true, fileMustExist: true });
    const checks = db.pragma('quick_check') as { quick_check: string }[];
    if (checks.length !== 1 || checks[0]?.quick_check !== 'ok')
      throw new Error('Source database failed integrity checks.');
    db.prepare('VACUUM INTO ?').run(file);
    chmodSync(file, 0o600);
    linkSync(file, output);
  } finally {
    db?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
  return output;
}

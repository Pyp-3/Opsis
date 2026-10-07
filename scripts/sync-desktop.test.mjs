import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fingerprint } from './sync-desktop.mjs';

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'opsis-sync-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  for (const name of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(directory, name), name);
  writeFileSync(join(directory, '.gitignore'), 'ignored.txt\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  return { directory, git, write: (name, text) => writeFileSync(join(directory, name), text) };
}

test('the desktop fingerprint follows file content, not commits', () => {
  const { directory, git, write } = repository();
  try {
    const initial = fingerprint(['.'], directory);
    // A change to any file, not only the first listed, is a new build.
    write('c.txt', 'changed');
    const edited = fingerprint(['.'], directory);
    assert.notEqual(edited, initial);
    // Committing the same content does not require another build.
    git('commit', '-qam', 'edit');
    assert.equal(fingerprint(['.'], directory), edited);
    // New untracked files count; ignored files do not.
    write('ignored.txt', 'local');
    assert.equal(fingerprint(['.'], directory), edited);
    write('d.txt', 'new');
    const added = fingerprint(['.'], directory);
    assert.notEqual(added, edited);
    // Deleting a tracked file is a change; restoring it returns to the same content.
    rmSync(join(directory, 'b.txt'));
    assert.notEqual(fingerprint(['.'], directory), added);
    git('checkout', '--', 'b.txt');
    assert.equal(fingerprint(['.'], directory), added);
    // A narrower path list ignores changes elsewhere.
    const narrow = fingerprint(['a.txt'], directory);
    write('c.txt', 'changed again');
    assert.equal(fingerprint(['a.txt'], directory), narrow);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

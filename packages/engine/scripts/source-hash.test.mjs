import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sourceHash } from './source-hash.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(reverse = false) {
  const root = mkdtempSync(join(tmpdir(), 'opsis-engine-hash-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'src', 'operations'), { recursive: true });
  const files = [
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    'scripts/build.mjs',
    'scripts/source-hash.mjs',
    'src/lib.rs',
    'src/operations/sort.rs',
    'src/operations/filter.rs',
  ];
  for (const file of reverse ? files.reverse() : files) writeFileSync(join(root, file), file);
  return root;
}

it('hashes the same source tree independently of file creation order', () => {
  expect(sourceHash(fixture())).toBe(sourceHash(fixture(true)));
});

it('invalidates for nested source changes, additions, removals and renames', () => {
  const root = fixture();
  let previous = sourceHash(root);
  const changed = () => {
    const next = sourceHash(root);
    expect(next).not.toBe(previous);
    previous = next;
  };
  writeFileSync(join(root, 'src/operations/sort.rs'), 'changed');
  changed();
  writeFileSync(join(root, 'src/operations/new.rs'), 'new');
  changed();
  renameSync(join(root, 'src/operations/new.rs'), join(root, 'src/operations/renamed.rs'));
  changed();
  rmSync(join(root, 'src/operations/renamed.rs'));
  changed();
  writeFileSync(join(root, 'scripts/source-hash.mjs'), 'updated hashing logic');
  changed();
  writeFileSync(join(root, 'src/operations/notes.md'), 'not Rust source');
  expect(sourceHash(root)).toBe(previous);
});

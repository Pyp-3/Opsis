import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Include nested Rust modules and file names, independent of directory entry order. */
export function sourceHash(root) {
  const rustSources = (directory) =>
    readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return rustSources(path);
      return entry.isFile() && entry.name.endsWith('.rs') ? [path] : [];
    });
  const sources = [
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    'scripts/build.mjs',
    'scripts/source-hash.mjs',
    ...rustSources('src'),
  ].sort();
  const hash = createHash('sha256');
  for (const path of sources) {
    const contents = readFileSync(join(root, path));
    hash.update(`${path}\0${contents.length}\0`);
    hash.update(contents);
  }
  return hash.digest('hex');
}

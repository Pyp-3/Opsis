import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceHash } from './source-hash.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const digest = () => sourceHash(root);
const stamp = join(root, 'dist', '.source-hash');
if (
  existsSync(stamp) &&
  existsSync(join(root, 'dist', 'opsis_engine_bg.wasm')) &&
  existsSync(join(root, 'dist', 'opsis_engine.js')) &&
  existsSync(join(root, 'dist', 'opsis_engine.d.ts')) &&
  readFileSync(stamp, 'utf8') === digest()
) {
  console.log('Opsis engine is up to date.');
} else {
  const cli = join(root, '..', '..', 'node_modules', 'wasm-pack', 'run.js');
  const built = spawnSync(
    process.execPath,
    [
      cli,
      'build',
      '--target',
      'web',
      '--out-dir',
      'dist',
      '--out-name',
      'opsis_engine',
      '--release',
      '--no-pack',
      '--no-opt',
      '--',
      '--locked',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (built.error) throw built.error;
  if (built.status !== 0) process.exit(built.status ?? 1);
  writeFileSync(stamp, digest());
}

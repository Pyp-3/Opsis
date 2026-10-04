import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktop = join(root, 'apps/desktop');
const output = join(root, 'output/desktop');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch))
  throw new Error('The desktop target currently supports Linux x64/arm64 native builds.');
mkdirSync(output, { recursive: true });
run('node', ['scripts/build-desktop-code.mjs']);
run('pnpm', ['engine:build']);
run('pnpm', ['--filter', 'web', 'build']);
rmSync(join(desktop, 'assets'), { recursive: true, force: true });
cpSync(join(root, 'apps/web/dist'), join(desktop, 'assets'), { recursive: true });
mkdirSync(join(desktop, 'bundle'), { recursive: true });

if (!process.argv.includes('--reuse-runtime')) {
  const stage = mkdtempSync(join(output, '.stage-'));
  try {
    const runtime = join(stage, 'runtime');
    mkdirSync(runtime);
    for (const [name, filter, entry, filename, external] of [
      [
        'api',
        'api',
        'apps/api/src/desktop.ts',
        'desktop.mjs',
        ['fastify', 'better-sqlite3', 'kokoro-js', '@huggingface/transformers', 'lru-cache', 'zod'],
      ],
    ]) {
      const destination = join(runtime, name);
      run('pnpm', ['--filter', filter, 'deploy', '--prod', '--legacy', destination]);
      // pnpm's legacy deploy includes a self-reference back to the source checkout.
      // The bundled entry does not need it, and a shipped runtime must be relocatable.
      rmSync(join(destination, 'node_modules/.pnpm/node_modules', filter), { force: true });
      // Only installed dependencies and the bundled entrypoint belong in the runtime.
      for (const item of readdirSync(destination)) {
        if (!['node_modules', 'package.json'].includes(item))
          rmSync(join(destination, item), { recursive: true, force: true });
      }
      await build({
        entryPoints: [join(root, entry)],
        outfile: join(destination, filename),
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'esm',
        external,
      });
      // Narration explicitly uses CPU inference. Other operating systems, CPU
      // architectures and CUDA/TensorRT providers are not part of this target.
      const store = join(destination, 'node_modules/.pnpm');
      for (const packageName of readdirSync(store)) {
        if (!packageName.startsWith('onnxruntime-node@')) continue;
        const native = join(store, packageName, 'node_modules/onnxruntime-node/bin/napi-v3');
        for (const platform of readdirSync(native)) {
          if (platform !== 'linux')
            rmSync(join(native, platform), { recursive: true, force: true });
        }
        for (const architecture of readdirSync(join(native, 'linux'))) {
          if (architecture !== process.arch)
            rmSync(join(native, 'linux', architecture), { recursive: true, force: true });
        }
        for (const library of [
          'libonnxruntime_providers_cuda.so',
          'libonnxruntime_providers_tensorrt.so',
        ])
          rmSync(join(native, 'linux', process.arch, library), { force: true });
      }
    }
    // Bundle an official Node build, not the distro binary (which may depend on
    // distro-specific ICU/Abseil versions). Its version matches native addons.
    const archiveName = `node-${process.version}-linux-${process.arch}.tar.xz`;
    const base = `https://nodejs.org/dist/${process.version}/`;
    const archive = join(output, archiveName);
    const checksums = await fetch(`${base}SHASUMS256.txt`);
    if (!checksums.ok) throw new Error('Could not verify the Node runtime release.');
    const checksum = (await checksums.text())
      .split('\n')
      .find((line) => line.endsWith(`  ${archiveName}`))
      ?.split(' ')[0];
    if (!checksum) throw new Error('Node release checksum is missing.');
    if (!existsSync(archive)) {
      const response = await fetch(base + archiveName);
      if (!response.ok) throw new Error('Could not download the Node runtime.');
      writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }
    if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== checksum)
      throw new Error('Node runtime checksum mismatch; remove the cached archive and retry.');
    const unpack = join(stage, 'node');
    mkdirSync(unpack);
    run('tar', ['-xJf', archive, '--strip-components=1', '-C', unpack]);
    cpSync(join(unpack, 'bin/node'), join(runtime, 'node'));
    cpSync(join(unpack, 'LICENSE'), join(runtime, 'NODE-LICENSE'));
    chmodSync(join(runtime, 'node'), 0o755);
    run(
      join(runtime, 'node'),
      [
        '--input-type=module',
        '-e',
        "await import('kokoro-js'); await import('@huggingface/transformers');",
      ],
      join(runtime, 'api'),
    );
    run('tar', ['-czf', join(desktop, 'bundle/runtime.tar.gz'), '-C', runtime, '.']);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
if (!existsSync(join(desktop, 'bundle/runtime.tar.gz')))
  throw new Error('Build the runtime before using --reuse-runtime.');
run(
  'go',
  [
    'build',
    '-trimpath',
    '-tags',
    'desktop,production,webkit2_41',
    '-ldflags',
    '-s -w',
    '-o',
    join(output, 'opsis'),
    '.',
  ],
  desktop,
);
console.log(`Desktop executable: ${resolve(output, 'opsis')}`);

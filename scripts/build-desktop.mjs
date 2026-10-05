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
import { releaseVersion } from './package-release.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktop = join(root, 'apps/desktop');
const output = join(root, 'output/desktop');
const windows = process.platform === 'win32';
// pnpm is a .cmd shim on Windows, which execFile can only start through a shell.
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: windows && command === 'pnpm' });
if (
  !(process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) &&
  !(windows && process.arch === 'x64')
)
  throw new Error('The desktop target supports Linux x64/arm64 and Windows x64 native builds.');
const executable = join(output, windows ? 'opsis.exe' : 'opsis');
// GNU tar from MSYS/Git would read `C:\...` as a remote host; use Windows' bsdtar.
const tar = windows ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar';
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
      // Windows cannot recreate pnpm's symlinked layout without elevated rights,
      // so the runtime uses a flat, link-free node_modules there.
      run('pnpm', [
        '--filter',
        filter,
        'deploy',
        '--prod',
        '--legacy',
        ...(windows ? ['--config.node-linker=hoisted'] : []),
        destination,
      ]);
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
      const platform = windows ? 'win32' : 'linux';
      const store = join(destination, 'node_modules/.pnpm');
      const packages = existsSync(store)
        ? readdirSync(store)
            .filter((name) => name.startsWith('onnxruntime-node@'))
            .map((name) => join(store, name, 'node_modules/onnxruntime-node'))
        : [join(destination, 'node_modules/onnxruntime-node')].filter((path) => existsSync(path));
      for (const onnx of packages) {
        const native = join(onnx, 'bin/napi-v3');
        for (const item of readdirSync(native)) {
          if (item !== platform) rmSync(join(native, item), { recursive: true, force: true });
        }
        for (const architecture of readdirSync(join(native, platform))) {
          if (architecture !== process.arch)
            rmSync(join(native, platform, architecture), { recursive: true, force: true });
        }
        for (const library of windows
          ? ['onnxruntime_providers_cuda.dll', 'onnxruntime_providers_tensorrt.dll']
          : ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_tensorrt.so'])
          rmSync(join(native, platform, process.arch, library), { force: true });
      }
    }
    // Bundle an official Node build, not the distro binary (which may depend on
    // distro-specific ICU/Abseil versions). Its version matches native addons.
    const archiveName = windows
      ? `node-${process.version}-win-${process.arch}.zip`
      : `node-${process.version}-linux-${process.arch}.tar.xz`;
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
    // Windows' bundled bsdtar also extracts the official zip archive.
    run(tar, [windows ? '-xf' : '-xJf', archive, '--strip-components=1', '-C', unpack]);
    const node = join(runtime, windows ? 'node.exe' : 'node');
    cpSync(join(unpack, windows ? 'node.exe' : 'bin/node'), node);
    cpSync(join(unpack, 'LICENSE'), join(runtime, 'NODE-LICENSE'));
    chmodSync(node, 0o755);
    run(
      node,
      [
        '--input-type=module',
        '-e',
        "await import('kokoro-js'); await import('@huggingface/transformers');",
      ],
      join(runtime, 'api'),
    );
    run(tar, ['-czf', join(desktop, 'bundle/runtime.tar.gz'), '-C', runtime, '.']);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
// CI builds carry their release version and build number, which the Windows updater
// compares; local builds stay "development" and never offer updates.
const stamp = [];
if (process.env.GITHUB_ACTIONS === 'true') {
  const { GITHUB_RUN_NUMBER: number, GITHUB_RUN_ATTEMPT: attempt, GITHUB_SHA: sha } = process.env;
  const base = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  stamp.push(
    `-X main.version=${releaseVersion(base, number, attempt, sha)}`,
    `-X main.buildNumber=${number}`,
    `-X main.buildAttempt=${attempt}`,
  );
}
if (!existsSync(join(desktop, 'bundle/runtime.tar.gz')))
  throw new Error('Build the runtime before using --reuse-runtime.');
if (windows) {
  // Embed the icon, manifest (per-monitor DPI, long paths) and version information.
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  run(
    'go',
    [
      'run',
      'github.com/tc-hib/go-winres@v0.3.3',
      'make',
      '--in',
      'winres/winres.json',
      '--out',
      'rsrc',
      '--arch',
      'amd64',
      '--product-version',
      version,
      '--file-version',
      version,
    ],
    desktop,
  );
}
run(
  'go',
  [
    'build',
    '-trimpath',
    '-tags',
    windows ? 'desktop,production' : 'desktop,production,webkit2_41',
    '-ldflags',
    // A GUI-subsystem binary opens no console window; piped stdio (MCP) still works.
    [windows ? '-s -w -H windowsgui' : '-s -w', ...stamp].join(' '),
    '-o',
    executable,
    '.',
  ],
  desktop,
);
console.log(`Desktop executable: ${resolve(executable)}`);

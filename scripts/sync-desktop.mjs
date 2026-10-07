// Keeps the local Linux desktop executable in step with the checkout.
//
// `pnpm desktop:sync` rebuilds output/desktop/opsis when the sources changed since
// its last build, then installs it for the current user (~/.local/opt/opsis, a
// ~/.local/bin/opsis link and an application-menu entry). Git hooks installed with
// `--install-hooks` run it in the background after commits, merges, pulls, rebases
// and branch checkouts. On other platforms, or without GTK/WebKitGTK development
// files, it reports why it skipped and exits successfully, so hooks never block git.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  lstatSync,
  readlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'output/desktop');
const executable = join(output, 'opsis');
const stampPath = join(output, '.sync-stamp.json');
const lockPath = join(output, '.sync.lock');
const logPath = join(output, 'sync.log');
const hooksDirectory = '.githooks';
const args = new Set(process.argv.slice(2));

// Inputs packaged into the speech runtime archive. When none changed, the build can
// reuse the existing archive instead of redeploying dependencies and Node.
const runtimeInputs = [
  'apps/api',
  'packages/schema',
  'pnpm-lock.yaml',
  'package.json',
  'scripts/build-desktop.mjs',
];

const git = (...gitArgs) =>
  execFileSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });

function unavailableReason() {
  if (process.platform !== 'linux')
    return `desktop sync builds on Linux only (${process.platform})`;
  if (!['x64', 'arm64'].includes(process.arch)) return `unsupported architecture ${process.arch}`;
  if (process.env.OPSIS_DESKTOP_SYNC === 'off') return 'OPSIS_DESKTOP_SYNC=off';
  if (process.env.CI) return 'CI builds the desktop in its own job';
  for (const tool of ['go', 'cargo', 'pkg-config']) {
    try {
      execFileSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' });
    } catch {
      return `${tool} is not installed`;
    }
  }
  try {
    execFileSync('pkg-config', ['--exists', 'gtk+-3.0', 'webkit2gtk-4.1'], { stdio: 'ignore' });
  } catch {
    return 'GTK 3 / WebKitGTK 4.1 development files are not installed';
  }
  return undefined;
}

const files = (...gitArgs) =>
  git(...gitArgs, '-z')
    .split('\0')
    .filter(Boolean);

// Hashes the working-tree content of every tracked and untracked (non-ignored) file,
// so committing unchanged content does not trigger a rebuild, while uncommitted
// edits are never mistaken for the commit they started from.
function fingerprint(paths) {
  const blobs = new Map();
  for (const line of files('ls-files', '--stage', '--', ...paths)) {
    const [meta, path] = line.split('\t');
    blobs.set(path, meta.split(' ')[1]);
  }
  const changed = [
    ...files('ls-files', '--modified', '--', ...paths),
    ...files('ls-files', '--others', '--exclude-standard', '--', ...paths),
  ];
  for (const path of changed) blobs.delete(path);
  const present = [...new Set(changed)].filter((path) => existsSync(join(root, path)));
  if (present.length) {
    const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], {
      cwd: root,
      encoding: 'utf8',
      input: present.join('\n'),
      maxBuffer: 64 * 1024 * 1024,
    })
      .trim()
      .split('\n');
    present.forEach((path, index) => blobs.set(path, hashes[index]));
  }
  const hash = createHash('sha256');
  hash.update(process.version);
  for (const [path, blob] of [...blobs].sort(([a], [b]) => (a < b ? -1 : 1)))
    hash.update(`${path}\0${blob}\0`);
  return hash.digest('hex');
}

const sourceFingerprint = () => fingerprint(['.']);
const runtimeFingerprint = () => fingerprint(runtimeInputs);

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// One build at a time. A request that arrives during a build marks the lock pending;
// the running build re-checks the fingerprint before releasing it.
function acquireLock() {
  mkdirSync(output, { recursive: true });
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    return true;
  } catch {
    let holder;
    try {
      holder = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      holder = undefined;
    }
    if (holder?.pid && processAlive(holder.pid)) {
      writeFileSync(lockPath, JSON.stringify({ ...holder, pending: true }));
      return false;
    }
    rmSync(lockPath, { force: true });
    return acquireLock();
  }
}

function takePending() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.pending) writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
  return Boolean(lock.pending);
}

function build(stamp) {
  const runtime = runtimeFingerprint();
  const reuse =
    stamp?.runtime === runtime && existsSync(join(root, 'apps/desktop/bundle/runtime.tar.gz'));
  const source = sourceFingerprint();
  console.log(
    `Building desktop at ${git('rev-parse', '--short', 'HEAD').trim()}${reuse ? ' (reusing speech runtime)' : ''}`,
  );
  execFileSync('node', ['scripts/build-desktop.mjs', ...(reuse ? ['--reuse-runtime'] : [])], {
    cwd: root,
    stdio: 'inherit',
  });
  const next = {
    source,
    runtime,
    commit: git('rev-parse', 'HEAD').trim(),
    builtAt: new Date().toISOString(),
  };
  writeFileSync(stampPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// Replace by rename: the running app keeps its old inode, and the next launch uses
// the new build. Its runtime extracts into a digest-named cache directory.
function install(stamp) {
  const home = homedir();
  const data = process.env.XDG_DATA_HOME || join(home, '.local/share');
  const installDirectory = join(home, '.local/opt/opsis');
  const installed = join(installDirectory, 'opsis');
  const installedSource = join(installDirectory, '.source');
  mkdirSync(installDirectory, { recursive: true });
  const current =
    existsSync(installed) && existsSync(installedSource)
      ? readFileSync(installedSource, 'utf8').trim()
      : '';
  if (current === stamp.source) return;
  const staging = `${installed}.new`;
  copyFileSync(executable, staging);
  chmodSync(staging, 0o755);
  renameSync(staging, installed);
  writeFileSync(installedSource, `${stamp.source}\n`);

  const bin = join(home, '.local/bin');
  const link = join(bin, 'opsis');
  mkdirSync(bin, { recursive: true });
  let linked = false;
  try {
    const existing = lstatSync(link);
    linked = existing.isSymbolicLink() && readlinkSync(link) === installed;
    if (!linked && !existing.isSymbolicLink())
      console.warn(`Leaving existing ${link} untouched; it is not an Opsis link.`);
    else if (!linked) rmSync(link);
  } catch {
    // No existing command.
  }
  if (!linked && !existsSync(link)) symlinkSync(installed, link);

  const icons = join(data, 'icons/hicolor/256x256/apps');
  mkdirSync(icons, { recursive: true });
  copyFileSync(join(root, 'apps/desktop/winres/icon.png'), join(icons, 'opsis.png'));
  const applications = join(data, 'applications');
  mkdirSync(applications, { recursive: true });
  writeFileSync(
    join(applications, 'opsis.desktop'),
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Opsis',
      'Comment=Turn explanations into editable visual diagrams',
      `Exec=${installed}`,
      `TryExec=${installed}`,
      'Icon=opsis',
      'Terminal=false',
      'Categories=Graphics;Office;',
      'StartupWMClass=opsis',
      '',
    ].join('\n'),
  );
  console.log(`Installed ${installed} (command: opsis, application menu: Opsis)`);
}

function notify(summary, body) {
  try {
    execFileSync('notify-send', ['--app-name=Opsis', summary, body], {
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch {
    // Notifications are a convenience; the log records the outcome.
  }
}

function installHooks() {
  const configured = (() => {
    try {
      return git('config', '--get', 'core.hooksPath').trim();
    } catch {
      return '';
    }
  })();
  if (configured && configured !== hooksDirectory) {
    throw new Error(`core.hooksPath is already ${configured}; not replacing it.`);
  }
  for (const hook of ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite'])
    chmodSync(join(root, hooksDirectory, hook), 0o755);
  git('config', 'core.hooksPath', hooksDirectory);
  console.log(`Git hooks enabled for this clone (core.hooksPath=${hooksDirectory}).`);
  console.log('Disable with `git config --unset core.hooksPath` or OPSIS_DESKTOP_SYNC=off.');
}

function sync() {
  const reason = unavailableReason();
  if (reason) {
    console.log(`Desktop sync skipped: ${reason}.`);
    return;
  }
  if (!acquireLock()) {
    console.log('A desktop build is already running; it will pick up these changes.');
    return;
  }
  try {
    let stamp = readStamp();
    let built = false;
    do {
      if (!args.has('--force') && existsSync(executable) && stamp?.source === sourceFingerprint()) {
        if (!built) console.log('Desktop executable is already up to date.');
        continue;
      }
      stamp = build(stamp);
      built = true;
    } while (takePending());
    if (!args.has('--no-install')) install(stamp);
    if (built && args.has('--notify'))
      notify('Opsis desktop updated', `Built ${stamp.commit.slice(0, 7)}`);
  } catch (error) {
    if (args.has('--notify')) notify('Opsis desktop build failed', `See ${logPath}`);
    throw error;
  } finally {
    rmSync(lockPath, { force: true });
  }
}

if (args.has('--install-hooks')) installHooks();
else if (args.has('--background')) {
  // Hooks return immediately; the detached build writes its output to the log.
  if (!unavailableReason()) {
    mkdirSync(output, { recursive: true });
    const log = openSync(logPath, 'a');
    const forwarded = process.argv.slice(2).filter((arg) => arg !== '--background');
    spawn(process.execPath, [fileURLToPath(import.meta.url), ...forwarded, '--notify'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', log, log],
    }).unref();
    console.log(`Opsis desktop sync started in the background (log: ${logPath}).`);
  }
} else sync();

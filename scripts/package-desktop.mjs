import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersion } from './package-release.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = Boolean(git('status', '--porcelain'));
if (process.env.GITHUB_ACTIONS === 'true' && (dirty || process.env.GITHUB_SHA !== commit))
  throw new Error('CI desktop releases require the unchanged release commit.');
const version = releaseVersion(
  readFileSync(join(root, 'VERSION'), 'utf8').trim(),
  process.env.GITHUB_RUN_NUMBER ?? '1',
  process.env.GITHUB_RUN_ATTEMPT ?? '1',
  commit,
);
const windows = process.platform === 'win32';
const platform = windows ? 'windows' : 'linux';
const executable = windows ? 'opsis.exe' : 'opsis';
const name = `opsis-${version}-${platform}-${process.arch}`;
const output = join(root, 'output/desktop-release');
mkdirSync(output, { recursive: true });
// Windows users expect a zip, which Explorer extracts without extra tools.
const archiveName = `${name}.${windows ? 'zip' : 'tar.gz'}`;
const archive = join(output, archiveName);
if (existsSync(archive)) throw new Error(`Release already exists: ${archive}`);
const temporary = mkdtempSync(join(tmpdir(), 'opsis-desktop-release-'));
try {
  const stage = join(temporary, name);
  mkdirSync(stage);
  cpSync(join(root, 'output/desktop', executable), join(stage, executable));
  cpSync(join(root, 'docs/DESKTOP.md'), join(stage, 'README.md'));
  const metadata = {
    version,
    commit,
    platform,
    architecture: process.arch,
    workspaceDirty: dirty,
  };
  writeFileSync(join(stage, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const modules = execFileSync(
    'go',
    ['list', '-m', '-f', '{{.Path}}\t{{.Version}}\t{{.Dir}}', 'all'],
    { cwd: join(root, 'apps/desktop'), encoding: 'utf8' },
  );
  let notices =
    'Opsis desktop dependencies\n\nNode and npm dependency licenses are included in the embedded speech runtime and its extracted cache.\n';
  for (const line of modules.trim().split('\n')) {
    const [name, version, directory] = line.split('\t');
    if (!version || !directory) continue;
    notices += `\n\n===== ${name} ${version} =====\n`;
    for (const file of readdirSync(directory).filter((name) =>
      /^(LICENSE|COPYING|NOTICE)(\.[\w-]+)?$/i.test(name),
    )) {
      notices += `\n${file}\n${readFileSync(join(directory, file), 'utf8')}\n`;
    }
  }
  const goroot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
  // Arch installs the Go license outside GOROOT; official SDK distributions keep it inside.
  const goLicense = [join(goroot, 'LICENSE'), '/usr/share/licenses/go/LICENSE'].find(existsSync);
  if (!goLicense) throw new Error('The installed Go runtime license could not be found.');
  notices += `\n\n===== Go runtime =====\n${readFileSync(goLicense, 'utf8')}`;
  writeFileSync(join(stage, 'THIRD-PARTY-NOTICES.txt'), notices);
  if (windows)
    // Windows' bsdtar (not an MSYS/Git GNU tar) writes the zip format selected by `-a`.
    execFileSync(
      join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe'),
      ['-a', '-cf', archive, '-C', temporary, name],
      { stdio: 'inherit' },
    );
  else execFileSync('tar', ['-czf', archive, '-C', temporary, name], { stdio: 'inherit' });
  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(`${archive}.sha256`, `${checksum}  ${archiveName}\n`);
  console.log(`Desktop release: ${archive}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

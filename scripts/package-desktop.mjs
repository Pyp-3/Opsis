import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersion } from './package-release.mjs';
import { signWindows } from './sign-windows.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = Boolean(git('status', '--porcelain'));
if (process.env.GITHUB_ACTIONS === 'true' && (dirty || process.env.GITHUB_SHA !== commit))
  throw new Error('CI desktop releases require the unchanged release commit.');
const base = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const run = process.env.GITHUB_RUN_NUMBER ?? '1';
const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
const version = releaseVersion(base, run, attempt, commit);
const windows = process.platform === 'win32';
const macos = process.platform === 'darwin';
const platform = windows ? 'windows' : macos ? 'macos' : 'linux';
const executable = windows ? 'opsis.exe' : 'opsis';
const name = `opsis-${version}-${platform}-${process.arch}`;
const output = join(root, 'output/desktop-release');
mkdirSync(output, { recursive: true });
// Windows users expect a zip, which Explorer extracts without extra tools.
const archiveName = `${name}.${windows || macos ? 'zip' : 'tar.gz'}`;
const archive = join(output, archiveName);
if (existsSync(archive)) throw new Error(`Release already exists: ${archive}`);
const temporary = mkdtempSync(join(tmpdir(), 'opsis-desktop-release-'));
try {
  const stage = join(temporary, name);
  mkdirSync(stage);
  if (macos)
    cpSync(join(root, 'output/desktop/Opsis.app'), join(stage, 'Opsis.app'), { recursive: true });
  else cpSync(join(root, 'output/desktop', executable), join(stage, executable));
  // Sign before the zip and installer copy it, so both carry the signed executable.
  if (windows) signWindows([join(stage, executable)]);
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
  else if (macos)
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stage, archive], {
      stdio: 'inherit',
    });
  else execFileSync('tar', ['-czf', archive, '-C', temporary, name], { stdio: 'inherit' });
  writeChecksum(archive);
  console.log(`Desktop release: ${archive}`);
  if (windows) packageInstaller(stage);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function writeChecksum(file) {
  const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(`${file}.sha256`, `${checksum}  ${basename(file)}\n`);
  return checksum;
}

// Per-user Inno Setup installer from the same staged files as the zip.
function packageInstaller(stage) {
  const iscc = [
    process.env.ISCC,
    join(process.env.LOCALAPPDATA ?? '', 'Programs/Inno Setup 6/ISCC.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Inno Setup 6/ISCC.exe'),
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Inno Setup 6/ISCC.exe'),
  ].find((path) => path && existsSync(path));
  if (!iscc) throw new Error('Inno Setup 6 (ISCC.exe) is required to build the installer.');
  const setupName = `${name}-setup`;
  execFileSync(
    iscc,
    [
      '/Q',
      `/DAppVersion=${version}`,
      `/DNumericVersion=${base}.${run}`,
      `/DStageDir=${stage}`,
      `/DOutputDir=${output}`,
      `/DOutputName=${setupName}`,
      join(root, 'apps/desktop/installer/opsis.iss'),
    ],
    { stdio: 'inherit' },
  );
  const setup = join(output, `${setupName}.exe`);
  signWindows([setup]);
  const sha256 = writeChecksum(setup);
  console.log(`Desktop installer: ${setup}`);
  // CI provides the key only for main-branch builds, which installed apps update to.
  const key = process.env.OPSIS_UPDATE_SIGNING_KEY?.trim();
  if (!key) {
    console.log('Update manifest skipped: OPSIS_UPDATE_SIGNING_KEY is not configured.');
    return;
  }
  const manifest = Buffer.from(
    `${JSON.stringify(
      {
        schema: 1,
        version,
        build: Number(run),
        attempt: Number(attempt),
        commit,
        installer: { name: basename(setup), size: statSync(setup).size, sha256 },
      },
      null,
      2,
    )}\n`,
  );
  const manifestPath = join(output, 'opsis-update-windows-x64.json');
  writeFileSync(manifestPath, manifest);
  const signature = sign(null, manifest, createPrivateKey(key)).toString('base64');
  writeFileSync(`${manifestPath}.sig`, `${signature}\n`);
  console.log(`Signed update manifest: ${manifestPath}`);
}

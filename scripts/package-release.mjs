import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseVersion(base, run, attempt, sha) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(base))
    throw new Error('VERSION must be major.minor.patch.');
  if (!/^[1-9]\d*$/.test(run) || !/^[1-9]\d*$/.test(attempt))
    throw new Error('Run and attempt must be positive integers.');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected a full Git commit SHA.');
  return `${base}-build.${run}.${attempt}.g${sha.slice(0, 12)}`;
}

// Ship source/configuration and explicit build outputs, never a developer's working data.
export function includeSource(path) {
  if (
    path
      .split('/')
      .some((part) => ['node_modules', 'dist', 'target', 'data', 'output', '.git'].includes(part))
  )
    return false;
  if (/(^|\/)(\.env(?:\..*)?|.*\.sqlite(?:-wal|-shm)?|.*\.local\..*)$/.test(path)) return false;
  return (
    /^(apps|packages|scripts|tests|docs|fixtures|assets)\//.test(path) ||
    /^(VERSION|README\.md|AGENTS\.md|CLAUDE\.md|opsis|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.base)?\.json|vitest\.config\.ts|playwright\.config\.ts|eslint\.config\.js|\.prettierrc\.json|\.prettierignore|\.gitignore)$/.test(
      path,
    )
  );
}

export function packageRelease(root, env = process.env) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (env.GITHUB_SHA && env.GITHUB_SHA !== sha)
    throw new Error('Checkout does not match the release commit.');
  const workspaceDirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  );
  if (env.GITHUB_ACTIONS === 'true' && workspaceDirty)
    throw new Error('CI release requires an unchanged checkout.');
  const base = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  const version = releaseVersion(
    base,
    env.GITHUB_RUN_NUMBER ?? '1',
    env.GITHUB_RUN_ATTEMPT ?? '1',
    sha,
  );
  const tag = `v${version}`;
  for (const file of [
    'apps/web/dist/index.html',
    'apps/api/dist/main.js',
    'packages/engine/dist/opsis_engine_bg.wasm',
    'packages/engine/dist/opsis_engine.js',
  ]) {
    if (!existsSync(join(root, file))) throw new Error(`Missing ${file}; run pnpm build first.`);
  }
  const output = join(root, 'output', 'releases');
  mkdirSync(output, { recursive: true });
  const archive = join(output, `opsis-${version}.zip`);
  if (existsSync(archive)) throw new Error(`Release archive already exists: ${archive}`);
  const temporary = mkdtempSync(join(tmpdir(), 'opsis-release-'));
  try {
    const bundle = join(temporary, `opsis-${version}`);
    mkdirSync(bundle);
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    for (const file of files.filter(includeSource)) {
      mkdirSync(dirname(join(bundle, file)), { recursive: true });
      cpSync(join(root, file), join(bundle, file), { dereference: false });
    }
    for (const directory of ['apps/web/dist', 'apps/api/dist', 'packages/engine/dist']) {
      cpSync(join(root, directory), join(bundle, directory), { recursive: true });
    }
    const metadata = {
      version,
      baseVersion: base,
      tag,
      commit: sha,
      workspaceDirty,
      branch: env.GITHUB_REF_NAME ?? 'local',
      run: env.GITHUB_RUN_NUMBER ?? '1',
      attempt: env.GITHUB_RUN_ATTEMPT ?? '1',
    };
    writeFileSync(join(bundle, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    execFileSync('zip', ['-qr', archive, basename(bundle)], { cwd: temporary });
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`);
    writeFileSync(join(output, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `tag=${tag}\nversion=${version}\n`);
    return { archive, metadata };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  console.log(packageRelease(root).archive);
}

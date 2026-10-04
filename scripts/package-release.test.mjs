import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { includeSource, packageRelease, releaseVersion } from './package-release.mjs';

test('versions identify the base, run, attempt and exact commit', () => {
  const sha = 'a'.repeat(40);
  assert.equal(releaseVersion('0.1.0', '42', '2', sha), '0.1.0-build.42.2.gaaaaaaaaaaaa');
  for (const base of ['01.0.0', '../oops', 'v1.0.0', '1.2'])
    assert.throws(() => releaseVersion(base, '42', '1', sha));
  assert.throws(() => releaseVersion('0.1.0', '0', '1', sha));
  assert.throws(() => releaseVersion('0.1.0', '1', '1', 'bad'));
});

test('excludes local settings, credentials, databases, caches and dependencies', () => {
  for (const file of [
    '.env',
    '.mcp.json',
    '.claude/settings.local.json',
    'apps/api/.env.production',
    'apps/api/data/opsis.sqlite',
    'apps/api/backup.sqlite-wal',
    'apps/web/node_modules/a.js',
    'packages/engine/target/debug/engine',
    'output/releases/old.zip',
  ])
    assert.equal(includeSource(file), false, file);
  for (const file of [
    'apps/api/src/main.ts',
    'packages/engine/src/lib.rs',
    'pnpm-lock.yaml',
    'VERSION',
  ])
    assert.equal(includeSource(file), true, file);
});

test('packages built output and metadata with a verified checksum, without private data', () => {
  const root = mkdtempSync(join(tmpdir(), 'opsis-package-test-'));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    put('VERSION', '0.1.0\n');
    put('apps/api/src/main.ts', 'source');
    put('apps/api/data/opsis.sqlite', 'private data');
    put('.claude/settings.local.json', 'private configuration');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Release test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-qm',
        'fixture',
      ],
      { cwd: root },
    );
    assert.throws(() => packageRelease(root, {}), /run pnpm build/);
    put('apps/web/dist/index.html', '<html>compiled web</html>');
    put('apps/api/dist/main.js', 'compiled API');
    put('packages/engine/dist/opsis_engine_bg.wasm', 'wasm fixture');
    put('packages/engine/dist/opsis_engine.js', 'wasm glue');
    assert.throws(() => packageRelease(root, { GITHUB_ACTIONS: 'true' }), /unchanged checkout/);
    const { archive, metadata } = packageRelease(root, {
      GITHUB_RUN_NUMBER: '42',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_REF_NAME: 'feature/test',
    });
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    assert.match(entries, /apps\/web\/dist\/index.html/);
    assert.match(entries, /apps\/api\/dist\/main.js/);
    assert.match(entries, /packages\/engine\/dist\/opsis_engine_bg.wasm/);
    assert.doesNotMatch(entries, /\.sqlite|settings\.local|\.git\//);
    const embedded = JSON.parse(
      execFileSync('unzip', ['-p', archive, `opsis-${metadata.version}/release.json`], {
        encoding: 'utf8',
      }),
    );
    assert.deepEqual(embedded, metadata);
    assert.equal(metadata.branch, 'feature/test');
    assert.equal(metadata.workspaceDirty, true);
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    assert.equal(readFileSync(`${archive}.sha256`, 'utf8'), `${digest}  ${basename(archive)}\n`);
    assert.throws(() => packageRelease(root, { GITHUB_RUN_NUMBER: '42' }), /already exists/);
    assert.throws(() => packageRelease(root, { GITHUB_SHA: 'b'.repeat(40) }), /does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

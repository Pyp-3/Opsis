import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const stableOnly = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const jobGate =
  "${{ !cancelled() && needs.tested.result != 'failure' && (github.event_name != 'pull_request' || github.head_ref != 'development') }}";
const untested = "needs.tested.outputs.run == ''";
const alreadyTested = "needs.tested.outputs.run != ''";
const setup = readFileSync(
  new URL('../.github/actions/setup-build-tools/action.yml', import.meta.url),
  'utf8',
);
const desktopBuild = readFileSync(
  new URL('../.github/actions/build-desktop/action.yml', import.meta.url),
  'utf8',
);

/** A job's text, up to the next job. */
const jobBlock = (job) => workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0];
/** A job's steps with their name, condition and command. */
const steps = (job) =>
  jobBlock(job)
    .split('steps:')[1]
    .split(/\n {6}- /)
    .slice(1)
    .map((text) => ({
      name: /name: (.*)/.exec(text)?.[1] ?? /uses: (.*)/.exec(text)?.[1],
      condition: /\n? {8}if: (.*)/.exec(text)?.[1] ?? null,
      text,
    }));

test('only main pushes can package, publish or prune releases', () => {
  const gates = [...workflow.matchAll(/^\s+if: (github\.event_name.*)$/gm)].map(
    (match) => match[1],
  );
  // Twelve packaging, upload and publishing gates, and the tested-run lookup itself.
  assert.equal(gates.length, 13);
  for (const gate of gates) assert.equal(gate, stableOnly);
  assert.match(jobBlock('tested'), new RegExp(`if: ${stableOnly.replace(/[|()]/g, '\\$&')}`));
  assert.match(workflow, /needs: \[check, desktop, windows-desktop, macos-desktop\]/);
  assert.match(workflow, /branches: \[main, development\]/);
  assert.match(workflow, /^name: CI\n/); // Keep the workflow run counter used by the updater.
});

test('development pushes and other PRs run every check on every platform', () => {
  for (const job of ['check', 'desktop', 'windows-desktop', 'macos-build']) {
    const block = jobBlock(job);
    assert.ok(block, `${job} exists`);
    // The job skips only a promotion PR, whose head commit the development push run already
    // checked (branch protection reads those checks from the same commit).
    const conditions = [...block.split('steps:')[0].matchAll(/^\s+if: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(conditions, [jobGate], `${job} runs everywhere but promotion PRs`);
    assert.match(block, /\n {4}needs: tested\n/);
    if (job === 'check') continue;
    const commands =
      job === 'macos-build'
        ? ['pnpm desktop:integration', '--smoke-test']
        : [
            'pnpm desktop:check',
            'pnpm desktop:test',
            'pnpm desktop:integration',
            'pnpm test:browser',
          ];
    for (const command of commands) {
      assert.ok(block.includes(command), `${job} runs ${command}`);
    }
    assert.ok(block.includes('uses: ./.github/actions/build-desktop'));
  }
  for (const [job, commands] of [
    ['macos-native', ['pnpm desktop:check', 'pnpm desktop:test']],
    ['macos-browser', ['playwright install chromium', 'pnpm test:browser --shard=']],
  ]) {
    const block = jobBlock(job);
    assert.ok(block.split('steps:')[0].includes(untested));
    assert.ok(block.split('steps:')[0].includes("github.head_ref != 'development'"));
    for (const command of commands) assert.ok(block.includes(command));
  }
  assert.ok(workflow.includes('pnpm test:qa'));
});

test('a main push already tested in development only builds, packages and publishes', () => {
  // Every check is skipped only when the lookup found a passing development run.
  const checks = [
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test:qa',
    'pnpm release:test',
    'pnpm engine:check',
    'unittest',
    'verify-install',
    'compatibility.test',
    'playwright install',
    'pnpm desktop:check',
    'pnpm desktop:test',
    'pnpm desktop:integration',
    'pnpm test:browser',
    '--smoke-test',
  ];
  const builds = ['pnpm install', 'pnpm desktop:build', 'pnpm desktop:package'];
  for (const job of ['check', 'desktop', 'windows-desktop', 'macos-build']) {
    for (const step of steps(job)) {
      if (checks.some((check) => step.text.includes(check)))
        assert.equal(step.condition, untested, `${job}: ${step.name} is a check`);
      if (builds.some((build) => step.text.includes(build)))
        assert.notEqual(step.condition, untested, `${job}: ${step.name} still builds`);
    }
  }
  // Without the QA gate, the web release is built on its own before it is packaged.
  const check = steps('check');
  const build = check.findIndex((step) => step.name === 'Build the web release');
  assert.equal(check[build]?.condition, alreadyTested);
  assert.equal(check[build + 1]?.name, 'Package versioned release');
  // The lookup compares files, not commits, and any failed lookup runs every check.
  const lookup = jobBlock('tested');
  assert.match(lookup, /branch=development&event=push&status=success/);
  assert.match(lookup, /commit\.tree\.sha/);
  assert.match(lookup, /\|\| tree=''/);
  assert.match(lookup, /\|\| continue/);
});

test('native tests overlap the macOS builds; all browser shards remain required', () => {
  const native = jobBlock('macos-native');
  const build = jobBlock('macos-build');
  for (const block of [native, build]) {
    assert.match(block, /\n {4}needs: tested\n/);
    assert.match(block, /runner: macos-15\n\s+arch: arm64/);
    assert.match(block, /runner: macos-15-intel\n\s+arch: x64/);
    assert.match(block, /fail-fast: false/);
  }
  assert.match(native, /go-cache-scope: native-checks/);
  assert.ok(!build.includes('pnpm desktop:test'));
  const browser = jobBlock('macos-browser');
  assert.match(browser, /needs: \[tested, macos-build\]/);
  assert.match(browser, /runner: macos-15\n\s+arch: arm64/);
  assert.match(browser, /runner: macos-15-intel\n\s+arch: x64/);
  const shards = [...browser.matchAll(/arch: (arm64|x64)\n\s+shard: (\d+)\n\s+shards: (\d+)/g)].map(
    ([, arch, index, count]) => [arch, Number(index), Number(count)],
  );
  assert.deepEqual(shards, [
    ['x64', 1, 3],
    ['x64', 2, 3],
    ['x64', 3, 3],
    ['arm64', 1, 2],
    ['arm64', 2, 2],
  ]);
  assert.ok(browser.includes('pnpm test:browser --shard=${{ matrix.shard }}/${{ matrix.shards }}'));
  assert.match(browser, /fail-fast: false/);
  assert.match(jobBlock('macos-desktop'), /name: macOS desktop \(\$\{\{ matrix.arch \}\}\)/);
  assert.match(jobBlock('macos-desktop'), /arch: \[arm64, x64\]/);
  assert.match(
    jobBlock('macos-desktop'),
    /needs: \[tested, macos-native, macos-build, macos-browser\]/,
  );
});

test("browser shards receive this run's built app, executable modes and WASM, not a cached app", () => {
  const build = jobBlock('macos-build');
  const browser = jobBlock('macos-browser');
  assert.match(
    build,
    /tar -cf output\/desktop\/qa-app.tar output\/desktop\/Opsis.app packages\/engine\/pkg/,
  );
  assert.ok(build.includes('name: macos-${{ matrix.arch }}-qa-app'));
  assert.ok(browser.includes('name: macos-${{ matrix.arch }}-qa-app'));
  const upload = steps('macos-build').find((step) => step.name === 'Upload browser test app');
  assert.match(upload.text, /overwrite: true/); // Immutable v4 names must support build reruns.
  assert.ok(
    browser.includes('browser-failures-${{ matrix.shard }}-attempt-${{ github.run_attempt }}'),
  );
  assert.match(browser, /tar -xf output\/desktop\/qa-app.tar/);
  assert.match(
    browser,
    /OPSIS_QA_DESKTOP_BINARY: output\/desktop\/Opsis.app\/Contents\/MacOS\/opsis/,
  );
  assert.match(browser, /rust: 'false'/);
  assert.ok(!browser.includes('desktop:build'));
  assert.ok(!browser.includes('run-id:')); // Never download a previous run's executable.
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /workers: 1/);
  assert.match(config, /reuseExistingServer: false/);
});

test('protected macOS gates reject failures, cancellations and unexpected skipped tests', () => {
  const gate = jobBlock('macos-desktop');
  assert.match(gate, /if: \$\{\{ !cancelled\(\) && \(github.event_name/);
  // Exercise the actual workflow gate, including a failed command before a later success.
  const script = gate
    .split('        run: |\n')[1]
    .trimEnd()
    .replace(/^ {10}/gm, '');
  const runGate = (tested, build, native, browser) =>
    spawnSync('bash', ['-e', '-c', script], {
      env: {
        ...process.env,
        TESTED_RUN: tested,
        BUILD_RESULT: build,
        NATIVE_RESULT: native,
        BROWSER_RESULT: browser,
      },
    }).status;
  assert.equal(runGate('', 'success', 'success', 'success'), 0);
  assert.equal(runGate('12345', 'success', 'skipped', 'skipped'), 0);
  for (const status of ['failure', 'cancelled', 'skipped', '']) {
    assert.notEqual(runGate('', status, 'success', 'success'), 0);
    assert.notEqual(runGate('12345', status, 'skipped', 'skipped'), 0);
    assert.notEqual(runGate('', 'success', status, 'success'), 0);
    assert.notEqual(runGate('', 'success', 'success', status), 0);
  }
  assert.notEqual(runGate('12345', 'success', 'failure', 'skipped'), 0);
  assert.notEqual(runGate('12345', 'success', 'skipped', 'failure'), 0);
});

test('compiled Go snapshots refresh on source changes without competing cache writers', () => {
  assert.match(setup, /cache: false/); // Replace the immutable go.sum-only bundled cache.
  assert.match(setup, /go-cache-scope:/);
  assert.match(setup, /default: desktop/);
  assert.ok(setup.includes('image-version=${ImageVersion:?}'));
  assert.ok(!setup.includes('${{ env.ImageVersion }}')); // Runner defaults are not env context.
  const cache = setup.split('key: opsis-go-v1-')[1].split('\n')[0];
  for (const input of [
    'inputs.go-cache-scope',
    'steps.go-cache.outputs.image-version',
    'steps.go.outputs.go-version',
    'apps/desktop/go.sum',
    'apps/desktop/**/*.go',
    'apps/desktop/*.ts',
    'apps/api/src/**',
    'packages/schema/src/**',
    'apps/web/src/**',
    'scripts/build-desktop-code.mjs',
    'pnpm-lock.yaml',
  ])
    assert.ok(cache.includes(input), input);
  assert.match(setup, /restore-keys:/);
  assert.ok(setup.includes('${{ steps.go-cache.outputs.build }}'));
  assert.ok(setup.includes('${{ steps.go-cache.outputs.modules }}'));
});

test('speech reuse is exact-source, target and Node-version only; app identity is always rebuilt', () => {
  assert.match(desktopBuild, /path: apps\/desktop\/bundle\/runtime.tar.gz/);
  assert.ok(!desktopBuild.includes('restore-keys:'));
  assert.ok(desktopBuild.includes('image-version=${ImageVersion:?}'));
  const key = desktopBuild.split('key: ')[1].split('\n')[0];
  for (const input of [
    'runner.os',
    'runner.arch',
    'steps.node.outputs.image-version',
    'steps.node.outputs.version',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'apps/*/package.json',
    'packages/*/package.json',
    'tsconfig*.json',
    'apps/api/src/**',
    'packages/schema/src/**',
    'scripts/build-desktop.mjs',
  ])
    assert.ok(key.includes(input), input);
  assert.ok(
    desktopBuild.includes(
      "run: pnpm desktop:build ${{ steps.runtime.outputs.cache-hit == 'true' && '--reuse-runtime' || '' }}",
    ),
  );
});

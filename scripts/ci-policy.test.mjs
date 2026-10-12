import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const stableOnly = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const jobGate =
  "${{ !cancelled() && needs.tested.result != 'failure' && (github.event_name != 'pull_request' || github.head_ref != 'development') }}";
const untested = "needs.tested.outputs.run == ''";
const alreadyTested = "needs.tested.outputs.run != ''";

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
  for (const job of ['check', 'desktop', 'windows-desktop', 'macos-desktop']) {
    const block = jobBlock(job);
    assert.ok(block, `${job} exists`);
    // The job skips only a promotion PR, whose head commit the development push run already
    // checked (branch protection reads those checks from the same commit).
    const conditions = [...block.split('steps:')[0].matchAll(/^\s+if: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(conditions, [jobGate], `${job} runs everywhere but promotion PRs`);
    assert.match(block, /\n {4}needs: tested\n/);
    if (job === 'check') continue;
    for (const command of [
      'pnpm desktop:check',
      'pnpm desktop:test',
      'pnpm desktop:build',
      'pnpm desktop:integration',
      'pnpm test:browser',
    ]) {
      assert.ok(block.includes(command), `${job} runs ${command}`);
    }
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
  for (const job of ['check', 'desktop', 'windows-desktop', 'macos-desktop']) {
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

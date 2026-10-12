import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const stableOnly = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const notPromotion = "github.event_name != 'pull_request' || github.head_ref != 'development'";

test('only main pushes can package, publish or prune releases', () => {
  const gates = [...workflow.matchAll(/^\s+if: (github\.event_name.*)$/gm)]
    .map((match) => match[1])
    .filter((gate) => gate !== notPromotion);
  assert.equal(gates.length, 12);
  for (const gate of gates) assert.equal(gate, stableOnly);
  assert.match(workflow, /needs: \[check, desktop, windows-desktop, macos-desktop\]/);
  assert.match(workflow, /branches: \[main, development\]/);
  assert.match(workflow, /^name: CI\n/); // Keep the workflow run counter used by the updater.
});

test('development pushes, main and other PRs compile and exercise every desktop platform', () => {
  for (const job of ['check', 'desktop', 'windows-desktop', 'macos-desktop']) {
    const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0];
    assert.ok(block, `${job} exists`);
    // The only condition skips a promotion PR, whose head commit the development push run
    // already checked (branch protection reads those checks from the same commit).
    const conditions = [...block.split('steps:')[0].matchAll(/^\s+if: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(conditions, [notPromotion], `${job} runs everywhere but promotion PRs`);
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

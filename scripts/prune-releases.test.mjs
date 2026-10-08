import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseArguments, planRetention } from './prune-releases.mjs';

const release = (tagName, createdAt, isDraft = false, isPrerelease = true) => ({
  tagName,
  createdAt,
  isDraft,
  isPrerelease,
});

test('keeps the five newest published releases and deletes the rest', () => {
  const releases = Array.from({ length: 8 }, (_, index) =>
    release(`v0.1.0-build.${index + 1}`, `2026-10-0${index + 1}T00:00:00Z`),
  ).reverse();
  const plan = planRetention(releases);
  assert.deepEqual(
    plan.keep,
    [8, 7, 6, 5, 4].map((n) => `v0.1.0-build.${n}`),
  );
  assert.deepEqual(
    plan.remove,
    [3, 2, 1].map((n) => `v0.1.0-build.${n}`),
  );
});

test('ranks by creation time, not list order, and never deletes drafts', () => {
  const plan = planRetention(
    [
      release('old', '2026-01-01T00:00:00Z'),
      release('publishing', '2025-01-01T00:00:00Z', true),
      release('new', '2026-03-01T00:00:00Z'),
      release('middle', '2026-02-01T00:00:00Z'),
    ],
    2,
  );
  assert.deepEqual(plan.keep, ['new', 'middle']);
  assert.deepEqual(plan.remove, ['old']);
  assert.deepEqual(plan.drafts, ['publishing']);
});

test('keeps hand-published stable releases beside the newest builds', () => {
  const plan = planRetention(
    [
      release('v1.0.0', '2025-01-01T00:00:00Z', false, false),
      release('build-2', '2026-02-01T00:00:00Z'),
      release('build-1', '2026-01-01T00:00:00Z'),
    ],
    1,
  );
  assert.deepEqual(plan.keep, ['build-2']);
  assert.deepEqual(plan.remove, ['build-1']);
  assert.deepEqual(plan.stable, ['v1.0.0']);
});

test('deletes nothing when there are no more releases than the limit', () => {
  assert.deepEqual(planRetention([release('only', '2026-01-01T00:00:00Z')]).remove, []);
  assert.deepEqual(planRetention([]).keep, []);
});

test('rejects a limit that would delete every release', () => {
  assert.throws(() => planRetention([], 0));
  assert.throws(() => parseArguments(['--keep', '0']));
  assert.throws(() => parseArguments(['--keep', 'all']));
  assert.throws(() => parseArguments(['--force']));
  assert.deepEqual(parseArguments([]), { keep: 5, dryRun: false });
  assert.deepEqual(parseArguments(['--keep=3', '--dry-run']), { keep: 3, dryRun: true });
});

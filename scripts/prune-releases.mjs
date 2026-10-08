#!/usr/bin/env node
/**
 * Release retention: keeps the newest published build releases and deletes older ones with their
 * tags.
 *
 * Every push publishes a prerelease, so without pruning the release list and its large desktop
 * downloads grow without bound. Drafts are never touched: a draft is a release another CI run is
 * still publishing. Stable (non-prerelease) releases are published by hand and are kept, as
 * automatic builds never replace them. Installed desktop builds update from the newest signed release, so deleting
 * older releases never strands an update.
 *
 *   node scripts/prune-releases.mjs [--keep 5] [--dry-run]
 *
 * Uses the `gh` CLI with GH_TOKEN and GH_REPO (as in GitHub Actions).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_KEEP = 5;

/**
 * Splits releases into those kept and those to delete. Published build prereleases are ranked
 * newest first by creation time (tag name breaks ties, so the plan is deterministic); drafts and
 * stable releases are always kept.
 */
export function planRetention(releases, keep = DEFAULT_KEEP) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Keep at least one release.');
  const published = releases
    .filter((release) => !release.isDraft && release.isPrerelease)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.tagName.localeCompare(a.tagName),
    );
  return {
    keep: published.slice(0, keep).map((release) => release.tagName),
    remove: published.slice(keep).map((release) => release.tagName),
    drafts: releases.filter((release) => release.isDraft).map((release) => release.tagName),
    stable: releases
      .filter((release) => !release.isDraft && !release.isPrerelease)
      .map((release) => release.tagName),
  };
}

export function parseArguments(argv) {
  let keep = DEFAULT_KEEP;
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--keep') keep = Number(argv[++index]);
    else if (argument.startsWith('--keep=')) keep = Number(argument.slice('--keep='.length));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a positive integer.');
  return { keep, dryRun };
}

const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function listReleases() {
  // The release API pages at 100; --limit follows pages until every release is listed.
  return JSON.parse(
    gh(['release', 'list', '--limit', '10000', '--json', 'tagName,isDraft,isPrerelease,createdAt']),
  );
}

function main() {
  const { keep, dryRun } = parseArguments(process.argv.slice(2));
  const plan = planRetention(listReleases(), keep);
  console.log(`Keeping ${plan.keep.length} newest: ${plan.keep.join(', ') || 'none'}`);
  if (plan.drafts.length) console.log(`Leaving drafts in progress: ${plan.drafts.join(', ')}`);
  if (plan.stable.length) console.log(`Leaving stable releases: ${plan.stable.join(', ')}`);
  if (!plan.remove.length) {
    console.log('Nothing to delete.');
    return;
  }
  let failed = 0;
  for (const tag of plan.remove) {
    if (dryRun) {
      console.log(`Would delete ${tag}`);
      continue;
    }
    try {
      gh(['release', 'delete', tag, '--yes', '--cleanup-tag']);
      console.log(`Deleted ${tag}`);
    } catch (error) {
      // A concurrent run may already have deleted it; anything else is reported at the end.
      const message = String(error.stderr ?? error.message);
      if (/not found|404/iu.test(message)) console.log(`Already gone: ${tag}`);
      else {
        failed++;
        console.error(`Could not delete ${tag}: ${message.trim()}`);
      }
    }
  }
  if (failed) {
    console.error(`${failed} release(s) could not be deleted.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

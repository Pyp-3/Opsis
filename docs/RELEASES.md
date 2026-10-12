# Build releases

## Automatic build releases

Every push to `development` runs CI: lint, type checks, Rust tests, the complete QA suite and
native desktop checks on Linux, Windows and macOS. It publishes nothing, and a newer
`development` push cancels an older run. Changes reach `main` only through a pull request
from `development`, which runs no separate checks: its head is `development`'s latest commit,
which that branch's push run already checked, and branch protection reads those results from
the same commit. The pull request must be up to date with `main`, so its merge commit has
exactly the files that passed.

A push to `main` first looks for a passing `development` push run whose commit has the same
files (the same Git tree). When it finds one, the `main` run does not test again: each job
installs, builds and packages, and CI publishes a GitHub **prerelease** with a Linux x64
desktop tarball, a developer ZIP, Windows and macOS packages, SHA-256 checksums and release
metadata. Without such a run (a commit pushed to `main` some other way, or a `development` run
that was cancelled or failed) the `main` run checks everything first, as before; a failed lookup
also falls back to every check. Other pull requests run the checks without publishing. Failed
pushes do not publish, and `main` pushes each keep their own run. Release tags do not trigger
another build.

After merging a promotion, fast-forward `development` to `main` so the next pull request is not
out of date; the push that does this starts a `development` run of the same files, which can be
cancelled.

`VERSION` tracks the base version (initially `0.1.0`). Each release is named
`v0.1.0-build.<run-number>.<attempt>.g<commit-prefix>` and points to the exact pushed
commit. The tracker records the full commit, branch, base version, run and attempt.
Update `VERSION` deliberately for the next major/minor/patch series; CI never commits
version bumps back to the repository. Automatic builds do not replace the latest stable
release. Re-running a build produces a new attempt version; re-running only publication
leaves an existing release untouched.

Only the **5 newest** build prereleases are kept. After each publication, CI runs the
[release retention workflow](../.github/workflows/release-retention.yml), which deletes
older build prereleases together with their tags (`scripts/prune-releases.mjs`). Drafts
still being published and hand-published stable releases are never deleted. Installed
desktop copies update from the newest signed build, so pruning never strands an update.
Runs prune one at a time. To preview or prune by hand, run **Release retention** from the
Actions tab (dry run is the default) or `node scripts/prune-releases.mjs --dry-run`
with the GitHub CLI signed in.

The ZIP includes project source, locked dependency manifests, compiled web assets,
compiled API JavaScript, and the Rust/WASM engine. It excludes installed dependencies,
databases, speech-model downloads, local agent settings and environment files. This is
a developer distribution, **not a standalone executable or offline installer**. Unzip
it, install the [getting-started prerequisites](GETTING-STARTED.md#prerequisites), then run `./opsis dev` (or
`pnpm install --frozen-lockfile` and `pnpm dev`). The MCP server and shared contracts
retain their existing TypeScript entrypoints. The prebuilt web assets live in
`apps/web/dist`; serving them separately requires forwarding `/v1` to the API.

For a local bundle after building, run `pnpm release:package` (requires Git and `zip`).
Output is under the ignored `output/releases/` directory. Packaging tests run with
`pnpm release:test` and require `unzip` too. Local builds use run/attempt `1/1` unless
overridden via `GITHUB_RUN_NUMBER` / `GITHUB_RUN_ATTEMPT`; an existing ZIP is never
silently overwritten. Local archives flag uncommitted changes in `release.json`;
CI refuses to publish a modified checkout.

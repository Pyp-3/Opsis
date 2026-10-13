# Development and stable releases

`main` holds the latest promoted, validated version. Commit and push ongoing work to
`development`. Multiple features can accumulate there before you choose to release
them. No automated job merges development into main.

Every development push runs lint, type checks, Rust checks/tests, web QA and the
Linux, Windows, macOS Intel and macOS ARM desktop builds, native tests, packaged
database/MCP integration, browser parity and hidden WebView smoke tests. Superseded
development runs are cancelled. Development never publishes a release or updater.

To promote a batch, open a pull request from development to main. Main requires an
up-to-date branch and these five passing checks: `check`, `Linux desktop`, `Windows
desktop`, `macOS desktop (x64)` and `macOS desktop (arm64)`. Resolve review discussions,
then merge manually when you are satisfied. The repository owner can merge their
own PR without a second reviewer. Admins are also subject to protection; force
pushes and deletion are disabled. Automatic merging is disabled repository-wide.

After a manual merge, CI looks for a passing development run with the exact same
Git tree. A match skips repeated checks but still builds and packages the new main
commit; without a match (including lookup failure), all checks run. Only if every
gate passes does it publish the desktop/developer release and run retention. Failed
main runs do not publish. CI keeps the original workflow and increasing run counter
used by the Windows updater; skipped development releases create harmless gaps.
Release metadata retains the existing prerelease format and retention policy.

The workflow policy lives in `.github/workflows/ci.yml`; `pnpm release:test` verifies
release gating and platform coverage. GitHub branch protection is repository
configuration, independently inspected through the GitHub API. If a gate fails,
fix it on development and use another manual promotion PR.

## CI latency and isolation

On macOS, native vet/race tests run alongside the production build in separate
checkouts. The build still verifies database/MCP integration and the hidden native
WebView. Its app bundle and generated WASM are transferred in a tar artifact so
executable permissions survive; three Intel and two ARM browser jobs each use their
own API process, temporary database/profile and Vite server. This fits the standard
five-concurrent-macOS-job limit, giving the slower architecture more shards.
Tests stay single-worker inside each shard. The entire suite runs, with only its
existing platform-specific skips. Shards are file-based, so their times may differ.

The protected `macOS desktop (x64)` and `macOS desktop (arm64)` names are final gates
over every macOS build, native check and browser shard. A failed, cancelled or
unexpectedly skipped dependency fails the gate. Only an exact tested-tree promotion
allows the native/browser jobs to be skipped. Release publication still depends on
all five protected gates; no branch-protection change is necessary.

Go caches include source fingerprints and restore a compatible previous snapshot
for incremental compilation. Native-test and production-build jobs save separate
keys rather than racing to save incomplete snapshots. Speech-runtime reuse has no
prefix fallback: source, dependency/configuration inputs, OS/architecture, runner
image and exact Node version must match. The web assets, Go executable and main
release version are rebuilt even on a speech cache hit. Cache eviction/misses only
cost time; they never omit a check. First-run timings include cache population.

These changes use standard runners. Workflow/action changes intentionally hold the
frozen-dependency VPS updater until its baseline is separately reviewed and approved.
Changing the default checkout to development is a local working preference; main
remains the repository's default branch for stable source and releases.

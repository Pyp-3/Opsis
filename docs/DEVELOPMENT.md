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

After a manual merge, CI rechecks the merged main commit. Only if every gate passes
does it package and publish the desktop/developer release and run retention. Failed
main runs do not publish. CI keeps the original workflow and increasing run counter
used by the Windows updater; skipped development releases create harmless gaps.
Release metadata retains the existing prerelease format and retention policy.

The workflow policy lives in `.github/workflows/ci.yml`; `pnpm release:test` verifies
release gating and platform coverage. GitHub branch protection is repository
configuration, independently inspected through the GitHub API. If a gate fails,
fix it on development and use another manual promotion PR.

The first promotion must include this workflow change. Until it is merged, main
continues using its previous workflow; development and promotion PRs use the new
policy. Changing the default checkout to development is a local working preference;
main remains the repository's default branch for stable source and releases.

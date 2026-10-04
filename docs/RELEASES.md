# Build releases

## Automatic build releases

Every branch push runs CI. After lint, type checks, Rust tests, and the complete QA
suite and native desktop checks pass, CI publishes a GitHub **prerelease** with a
Linux x64 desktop tarball, a developer ZIP, SHA-256 checksums, and release metadata. Pull requests run checks without publishing. Failed pushes
do not publish; rapid successive pushes each retain their own run. Release tags do not
trigger another build.

`VERSION` tracks the base version (initially `0.1.0`). Each release is named
`v0.1.0-build.<run-number>.<attempt>.g<commit-prefix>` and points to the exact pushed
commit. The tracker records the full commit, branch, base version, run and attempt.
Update `VERSION` deliberately for the next major/minor/patch series; CI never commits
version bumps back to the repository. Automatic builds do not replace the latest stable
release. Re-running a build produces a new attempt version; re-running only publication
leaves an existing release untouched.

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

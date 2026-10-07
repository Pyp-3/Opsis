# Opsis desktop

Opsis runs as a Linux or Windows desktop executable using Wails, Go, and the existing React
canvas. The executable includes the frontend, Rust/WASM engine, shared rules,
and a private Node runtime for Kokoro speech. Running it does not require Node,
pnpm, Go, Rust, a checkout, or a separately started API.

This is a Linux native build, not a fully static executable. GTK 3 and WebKitGTK
4.1 must be installed. Linux x64 is validated; Linux arm64 can be built natively
but has not been verified. Windows x64 is built, tested and released by CI (see
[Windows](#windows)). macOS bundles and CI validation are being added (see
[macOS](#macos)); their first native CI run is pending. The browser
development target remains available on every platform.

## Run

Download and unpack the `opsis-…-linux-x64.tar.gz` release, then run `./opsis` from
that extracted directory. It opens one application window. On Hyprland, run it
from the workspace where you want the window. It uses the current Wayland display;
`GDK_BACKEND=wayland ./opsis` explicitly selects Wayland. No browser is opened.

On Arch Linux the runtime packages are `gtk3` and `webkit2gtk-4.1`. On Ubuntu
24.04 they are `libgtk-3-0t64` and `libwebkit2gtk-4.1-0`. PDF text attachments also
need Poppler (`poppler` on Arch, `poppler-utils` on Ubuntu).

Start with the built-in examples and Demo agent. Claude/Codex must still be
installed and authenticated separately for provider generation. Readiness checks
run `--version`; they do not generate paid requests or prove model entitlement.
Speech models download on first use/startup and are cached. `OPSIS_SPEECH=off`
disables the native speech service's inference; the frontend may use its existing
browser/device fallback.

`./opsis --serve` serves the same packaged app and Go API on `127.0.0.1:8000`
without creating a window. `PORT` changes this port. Desktop windows use an
automatically chosen loopback port. `HOST` does not expose the native API remotely.

## Existing data

Desktop defaults are independent of the development checkout:

| Data                                    | Default location                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Database, session, local discovery/lock | `$XDG_DATA_HOME/opsis` or `~/.local/share/opsis`                              |
| Extracted, versioned runtime            | `$XDG_CACHE_HOME/opsis/runtime-<digest>` or `~/.cache/opsis/runtime-<digest>` |
| Downloaded speech model                 | `$XDG_CACHE_HOME/opsis/models` or `~/.cache/opsis/models`                     |

To copy your existing development database **before the first desktop launch**:

```sh
./output/desktop/opsis --import-database "$PWD/apps/api/data/opsis.sqlite"
```

Import takes a consistent SQLite snapshot, including committed WAL contents. It
preserves accounts, password hashes, boards, templates, revisions, history, agent
keys, tombstones, and historical tables. It leaves the source database intact and
refuses to overwrite an existing destination. Browser recovery/localStorage and
browser settings are not inside SQLite; save any unsaved browser work first.
Log in with your existing account after import.

If you have already launched the desktop app, choose a new absolute
`OPSIS_DATA_DIR` for the import and use that same value when launching it.
`OPSIS_DB_PATH` explicitly opens a particular database in place instead; copying
is preferable when keeping development and desktop data independent.
`OPSIS_MODEL_DIR` can point to an existing downloaded model cache. For example:

```sh
OPSIS_MODEL_DIR="$PWD/apps/api/data/models" ./output/desktop/opsis
```

One desktop/server process may use a profile at a time. Its session is stored in
a private native file; it is not exposed to JavaScript. Browser sessions are
separate. Public boards remain read-only to other accounts on the same local API.

For whole-database backups, run `./opsis --backup-database /absolute/path/new-backup.sqlite`.
Restore with `--import-database` into a new profile. See [Persistence and recovery](PERSISTENCE.md)
for retention, revision history, and credential considerations.

## MCP

Create a key in **Account → Agent keys** and configure your MCP client with the
absolute installed binary path:

```json
{
  "mcpServers": {
    "opsis": {
      "command": "/absolute/path/to/opsis",
      "args": ["--mcp"],
      "env": { "OPSIS_AGENT_KEY": "your-local-agent-key" }
    }
  }
}
```

Keep the desktop app running. The MCP process discovers its loopback endpoint
from the same data profile. Set the same `OPSIS_DATA_DIR` if using a custom
profile. `OPSIS_API_URL` explicitly selects another local Opsis instance;
`OPSIS_WEB_URL` overrides URLs returned by the open-board tool. Opening those
URLs in a browser requires a separate browser login. Never commit agent keys.
Revocation takes effect on the next API request.

All 12 canvas tools, including cross-board search, are available. Tool edits use the same schemas, ownership
checks, revisions and bounded undo history as interactive edits. The original
TypeScript MCP entrypoint remains available for browser development.

## Build and verify

Build prerequisites: Node 22+, pnpm 10.34.5, Go 1.25+, a C/C++ compiler, pkg-config,
GTK 3/WebKitGTK 4.1 development headers, Rust/rustup, tar and xz. The Rust toolchain
is pinned by `packages/engine/rust-toolchain.toml`. No global Wails CLI is needed.
On Ubuntu 24.04 the native build packages are `build-essential pkg-config
libgtk-3-dev libwebkit2gtk-4.1-dev`.

```sh
pnpm install --frozen-lockfile
pnpm desktop:build
./output/desktop/opsis
```

The build downloads and verifies an official Node runtime matching the build
Node version, packages speech dependencies, embeds web/WASM assets, and compiles
Go with the `desktop,production,webkit2_41` tags. The resulting binary is under
`output/desktop/opsis`. Build on the oldest supported distribution; the locally
built Arch binary is not an Ubuntu portability test. CI builds on Ubuntu 24.04.

`node scripts/build-desktop.mjs --reuse-runtime` is an incremental option only
when speech code/dependencies and the build Node version have not changed.
`pnpm desktop:package` creates a tarball, metadata, notices and SHA-256 checksum.
Generated assets, runtime archives, extracted models and test profiles are ignored.

```sh
pnpm desktop:check
pnpm desktop:test
pnpm desktop:integration
OPSIS_QA_DESKTOP_BINARY=output/desktop/opsis pnpm test:browser
OPSIS_DATA_DIR="$(mktemp -d)" OPSIS_SPEECH=off ./output/desktop/opsis --smoke-test
```

The last command creates a **hidden** Wails window on the current display and
exits with a JSON report and failure exit code if checks fail. It verifies actual
WebKit/React rendering, native account/session/board operations, NDJSON generation,
SQLite saving, and a real Rust/WASM worker calculation. It requires an isolated
profile and speech disabled. In headless CI, use `xvfb-run -a env GDK_BACKEND=x11`
before it. `--diagnose` checks the packaged runtime and local API without a window;
use an isolated profile to avoid touching your normal account data.

Browser tests use isolated servers, a temporary database and fake/demo providers.
Override `OPSIS_QA_API_PORT` and `OPSIS_QA_WEB_PORT` when default ports 8100/3100
are occupied. No test should stop an unrelated local server or make paid calls.

### Keep a local Linux build in sync

`pnpm desktop:sync` keeps a development checkout's desktop app matching the web
application. It rebuilds `output/desktop/opsis` only when tracked or untracked
source files differ from its last build. It reuses the packaged speech runtime
unless the API, schema, lockfile, build script or Node version changed. The app
is then installed for the current user without root:

| Item             | Location                                                |
| ---------------- | ------------------------------------------------------- |
| Executable       | `~/.local/opt/opsis/opsis`                              |
| Command          | `~/.local/bin/opsis` (a link; an existing file is kept) |
| Application menu | `$XDG_DATA_HOME/applications/opsis.desktop` and icon    |

An already running app keeps its current build; the next launch uses the new one.
Data and profiles are unaffected. `--force` rebuilds regardless, and `--no-install`
only builds.

To rebuild automatically, run `pnpm desktop:sync --install-hooks` once per clone.
It sets `core.hooksPath` to `.githooks` (and refuses to replace another hooks
path). After each commit, merge/pull, rebase/amend and branch checkout, the hook
starts a detached background sync and returns immediately. Output goes to
`output/desktop/sync.log`, with a desktop notification when `notify-send` is
available. Only one build runs at a time; changes made during a build trigger one
follow-up check. Uncommitted edits are included the next time a sync runs.

The sync does nothing, and exits successfully, on non-Linux systems, in CI, without
Go/Rust/pkg-config or GTK 3/WebKitGTK 4.1 development files, or with
`OPSIS_DESKTOP_SYNC=off`. Disable the hooks with `git config --unset core.hooksPath`.

## Windows

### Install and update

Download `opsis-…-windows-x64-setup.exe` from a release and run it. It installs for
the current user only, to `%LOCALAPPDATA%\Programs\Opsis`, with no administrator
prompt. It adds a Start-menu entry, an optional desktop shortcut, and an uninstaller
under **Settings → Apps**. Opsis needs the Microsoft Edge WebView2 runtime, which
Windows 11 includes. `opsis-…-windows-x64.zip` is a portable alternative: extract it
and run `opsis.exe`. Until releases are code-signed, SmartScreen may warn on first
launch (**More info → Run anyway**); compare the download with its `.sha256` file.

Installed copies check GitHub Releases at startup and every six hours for a newer
build from `main`. When one exists, a notice offers **Install and restart**. Nothing
downloads until you choose it. Opsis then downloads the installer, checks that it
matches the release's update manifest (size and SHA-256), checks that the manifest
carries a valid Ed25519 signature from the CI release key, installs silently, and
reopens. Your data in `%LOCALAPPDATA%\opsis` is not touched. Portable copies get a
**Download** button that opens the release page instead. Local development builds
never check. Set `OPSIS_UPDATES=off` to stop checks; the check sends only an
anonymous request to `api.github.com`. `opsis.exe --check-update` prints the update
status as JSON, and `opsis.exe --install-update` installs an available update.

`opsis.exe --mcp` works as the MCP command; use the installed path, for example
`%LOCALAPPDATA%\Programs\Opsis\opsis.exe`.

### Release signing

Two separate signatures protect releases:

- **Update manifest (active).** CI signs `opsis-update-windows-x64.json` with the
  Ed25519 key in the `OPSIS_UPDATE_SIGNING_KEY` Actions secret, for `main` builds
  only. The public key is compiled into `internal/updater`. If the secret is lost or
  replaced, put the new public key in `updater.PublicKey`; copies built with the old
  key must then be updated once by hand.
- **Authenticode (switches on with a certificate).** `scripts/sign-windows.mjs` signs
  `opsis.exe` before both the zip and installer are made, then signs the installer,
  with an RFC 3161 timestamp. Add a code-signing certificate as Actions secrets:
  `WINDOWS_CERTIFICATE` (a base64-encoded PFX, for example from
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))`) and
  `WINDOWS_CERTIFICATE_PASSWORD`. Optionally set `WINDOWS_TIMESTAMP_URL`. Without
  them, packaging logs that signing was skipped. Certificates whose keys must stay
  in a cloud HSM (most new OV certificates, Azure Artifact Signing, SignPath) need
  their provider's signing call in place of the PFX `signtool` call in that script.

### Build

On Windows 11 x64, `pnpm desktop:build` produces `output\desktop\opsis.exe`. It
uses the system WebView2 runtime instead of GTK/WebKitGTK and bundles the official
`node.exe`. Build prerequisites: Node 22+, pnpm 10.34.5, Go 1.25+ (an older Go with
`GOTOOLCHAIN=auto` downloads it), Rust/rustup, a MinGW-w64 `gcc` on `PATH` for
cgo/SQLite (for example MSYS2 UCRT64), and Visual Studio C++ build tools for the
`better-sqlite3` native addon. Set `CGO_ENABLED=1`. Use a current Node 22 release:
the `better-sqlite3` 13 Windows prebuild crashes on Node 22.3, and the build bundles
whichever Node version runs it. `go-winres` embeds the icon (rendered from
`apps/web/public/favicon.svg`), a per-monitor-DPI manifest, and version information
from `VERSION`. In CI the executable also records its release version and build
number, which the updater compares. The build uses Windows' own `tar.exe` and a
flat, link-free `node_modules` for the speech runtime, because extracting symlinks
needs elevated rights on Windows.

`pnpm desktop:package` also needs Inno Setup 6 (`ISCC.exe`, or set `ISCC`). It
writes the zip, the installer (`apps/desktop/installer/opsis.iss`) and their
SHA-256 checksums to `output\desktop-release`. With `OPSIS_UPDATE_SIGNING_KEY` set,
it also writes the signed update manifest.

The executable is a GUI-subsystem program: it opens no console window, so
`--diagnose`/`--smoke-test`/`--check-update` output is only visible when stdout is
redirected (MCP's piped stdio is unaffected). The database, extracted runtime and
downloaded models all live under `%LOCALAPPDATA%\opsis`. Windows has no POSIX mode
bits, so file privacy relies on the per-user profile ACL. Claude/Codex discovery
runs only `.exe` files or Node entry points directly; npm installs resolve to the
package's `claude.exe` or `codex.js`. An explicit npm `claude.cmd`/`codex.cmd`
(also `.bat` or `.ps1`) path resolves through that package's manifest, matching
the browser-development host. Arbitrary shell launchers are rejected; the harness
never interprets shim contents or starts `cmd.exe`.

The `Windows desktop` CI job (windows-2025) runs native race tests, packaged
database/MCP integration, the browser suite against `opsis.exe`, and the hidden
WebView2 smoke test. It then packages and (when configured) signs the zip,
installer and update manifest, and attaches them to the same prerelease as the
Linux tarball. The pixel-baseline browser test runs only on Linux, where its
baseline fonts live.

## macOS

Native builds support Intel (`x64`) and Apple Silicon (`arm64`) separately.
Run `pnpm desktop:build` on macOS 15 or newer with Xcode command-line tools,
Node 22, pnpm, Go and Rust installed. It produces `output/desktop/Opsis.app`
and the CLI binary `output/desktop/opsis`. The bundle includes its own Node
speech runtime and a macOS icon. `pnpm desktop:package` writes a versioned zip
containing the app, release metadata, notices and a SHA-256 checksum.

CI uses native macOS 15 runners for each architecture: Go race tests,
database/MCP integration, browser scenarios against the bundled executable,
hidden WKWebView smoke and an extracted-package diagnostic. All these steps
passed on both architectures in [CI run 37439376513](https://github.com/Pyp-3/Opsis/actions/runs/37439376513)
on 2026-10-06. An interactive check on a user's Mac remains outstanding.

The bundle currently has an ad-hoc signature, which verifies its local integrity
but does not identify a trusted publisher. It is not notarized. Publicly trusted
distribution requires an Apple Developer account, Developer ID signing and
notarization; none is configured. No automatic macOS updater is implemented.
Application data lives in `~/Library/Application Support/opsis`, independently
of the app bundle; extracted runtime and models use `~/Library/Caches/opsis`.
Use `Opsis.app/Contents/MacOS/opsis` for MCP and diagnostic commands.

## Feature ownership and migration coverage

| Feature                                                        | Desktop owner                                        | Verification                                        |
| -------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| Session shell, canvas, editing, navigation                     | Existing React application                           | Browser suite + hidden WebKit smoke                 |
| Accounts, password hashing, sessions, agent keys               | Go `internal/api`                                    | Native API/race tests + browser suite               |
| SQLite boards, templates, privacy, revisions, tombstones       | Go `internal/api`                                    | Native API/import tests + browser suite             |
| Recovery, save ordering, polling, proposal review, undo/redo   | Existing React + shared schema rules                 | Existing unit/browser tests + native API/MCP tests  |
| Generation, illustrations, model selection, repair policy      | Shared TS workflow in restricted Go VM               | Shared unit tests + native fake-provider tests      |
| CLI discovery, process limits/cancellation, attachment staging | Go `internal/harness`                                | Real fake-process tests + native workflow tests     |
| PDF text extraction                                            | Go harness invoking local `pdftotext`                | Shared attachment tests; requires installed Poppler |
| MCP protocol and tools                                         | Go SDK + shared tool catalogue/rules                 | Native protocol tests and packaged stdio smoke      |
| Speech                                                         | Packaged Kokoro Node inference service behind Go API | Real local audio smoke for all four voices          |
| Process calculations                                           | Unchanged Rust/WASM worker                           | Rust tests + actual WebKit worker smoke             |
| JSON/OSG import; image/JSON/Markdown export                    | Existing React; native save dialog bridge            | Browser suite + bridge unit tests                   |
| Clipboard                                                      | Native Wails bridge with browser fallback            | Bridge unit tests                                   |

The embedded JavaScript VMs execute fixed bundled code, not code from boards or
providers. They have no general filesystem, process or network APIs. Go exposes
only the operations needed by the shared workflow/tool modules, including bounded
HTTP requests to fixed official provider origins. Instance API keys stay in a
separate host-owned secret file; see [provider setup](PROVIDERS.md). This preserves a
single contract implementation and avoids a second independent schema in Go.

The speech adapter is an explicit retained dependency, not a Go reimplementation
of Kokoro. Native save dialogs and clipboard still need an interactive desktop
check; automated smoke tests do not open dialogs or overwrite the user's clipboard.
No paid-provider entitlement, trusted release signing or Linux arm64 validation
is claimed. Both macOS architectures have hosted CI coverage, with interactive
verification still outstanding.

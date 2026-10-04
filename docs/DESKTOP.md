# Opsis desktop

Opsis runs as a Linux desktop executable using Wails, Go, and the existing React
canvas. The executable includes the frontend, Rust/WASM engine, shared rules,
and a private Node runtime for Kokoro speech. Running it does not require Node,
pnpm, Go, Rust, a checkout, or a separately started API.

This is a Linux native build, not a fully static executable. GTK 3 and WebKitGTK
4.1 must be installed. Linux x64 is validated; Linux arm64 can be built natively
but has not been verified. Windows and macOS desktop packaging are not implemented.
The existing browser development target remains available on those platforms.

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

All 11 existing tools remain available. Tool edits use the same schemas, ownership
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
only the operations needed by the shared workflow/tool modules. This preserves a
single contract implementation and avoids a second independent schema in Go.

The speech adapter is an explicit retained dependency, not a Go reimplementation
of Kokoro. Native save dialogs and clipboard still need an interactive desktop
check; automated smoke tests do not open dialogs or overwrite the user's clipboard.
No paid-provider entitlement, Windows/macOS desktop, or Linux arm64 validation is
claimed by this migration.

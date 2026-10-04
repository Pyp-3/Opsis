# Getting started

[Documentation index](README.md) · [User guide](USER-GUIDE.md)

## Prerequisites

- Node.js 20.19 or newer; CI uses Node.js 22.
- pnpm 10.34.5, matching `package.json`.
- Rust installed through rustup. The repository pins Rust 1.89.0 and the WASM target.
- A native compiler/linker for Rust and, when needed, SQLite's native dependency.
- Git if you clone the repository instead of downloading a release.

Claude and Codex are optional. The built-in email and DNS examples work without
an agent subscription or model calls.

## Install and launch

Clone the public repository without needing an SSH key:

```sh
git clone https://github.com/Pyp-3/Opsis.git
cd Opsis
```

On Linux, macOS, or WSL:

```sh
./opsis dev
```

The launcher installs locked dependencies, checks SQLite, builds the WASM engine,
and starts the application. To install without starting servers, run `./opsis install`.

On native Windows, or when running the steps manually:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:3000**. The API listens on **http://127.0.0.1:8000**.
Stop the servers with Ctrl+C. Keep the API on loopback; the development setup is
not a hardened public application server.

## Create your first board

1. Create an Opsis account on the local sign-up page.
2. Open the email or DNS example from the home page.
3. Select a concept to read its explanation, or drag it to move it.
4. Give the board a name and wait for **Saved** before closing the tab.
5. Open **Manage boards** to find it again or save it as a reusable template.

Your account and boards live in the local API's SQLite database. An account on one
computer is not a hosted account or cross-device synchronization service.

To generate other diagrams, install and sign in to your preferred agent CLI
separately, then select it in the composer. Choose the model and effort before
submitting. Agent generation can consume your provider subscription or quota.
See [agent configuration](AGENT-CONFIGURATION.md).

## Download a versioned release

Open [GitHub Releases](https://github.com/Pyp-3/Opsis/releases) and choose an Opsis
prerelease. Download the **`opsis-<version>.zip` asset**, rather than GitHub's
automatically generated source archive, to include the compiled web, API, and WASM
files. Download its matching `.sha256` checksum if you want to verify the ZIP.

Extract it, open a terminal in the extracted directory, and follow the same launch
steps above. Dependencies and prerequisites are still required: this is a developer
bundle, not a standalone desktop installer. `release.json` identifies the exact
commit and CI run. See [release versioning](RELEASES.md).

## Troubleshooting

| Symptom                                 | What to check                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The launcher rejects pnpm               | Run `pnpm --version`; use the version pinned in `package.json`.                                                                                                                              |
| SQLite reports a missing native binding | Run `pnpm approve-builds`, approve only `better-sqlite3` if prompted, then `pnpm rebuild better-sqlite3`. A native compiler toolchain may be required.                                       |
| Rust or WASM compilation fails          | Check that `rustup` and `cargo` are on PATH and the platform's native linker is installed. Run `pnpm engine:build` to see the build error.                                                   |
| The web page cannot reach the API       | Keep both processes running and check ports 3000/8000. Read the terminal error before starting a second copy.                                                                                |
| An agent is unavailable                 | Confirm its CLI is installed and signed in, then restart the API so it sees the updated PATH.                                                                                                |
| Natural narration takes time to start   | The API may be downloading/loading its local speech model. A device voice is available as a fallback. `OPSIS_SPEECH=off` disables the API speech engine, not every browser narration option. |
| A PDF cannot be read                    | Text-layer extraction requires Poppler's `pdftotext`. Scanned-PDF support differs between agents; see [document upload details](FEATURES.md).                                                |

If the issue persists, [report it](https://github.com/Pyp-3/Opsis/issues/new)
with your OS, Node/pnpm versions, commit or release version, and a minimal
reproduction. Remove keys, personal documents, account details, and database contents
from logs and screenshots before posting.

# Opsis

**See what you mean.** Opsis turns explanations into editable, connected icons on a 2D blueprint canvas. Ask an agent to explain a process, follow the arrows, and select a concept when you want the details.

The aim is visual understanding: short labels on the canvas, deeper explanations on demand, and agents that can extend the diagram as your questions develop.

## Current capabilities

- Frameless Lucide icons on a pannable, zoomable engineering-style grid.
- Curved arrows that follow dragged icons, four reusable connection ports, branching and merging, and endpoint reconnection.
- Downward, bounded-width layout: long processes grow vertically, with wrapped labels and obstacle-aware arrow routing. Scroll to follow the flow without automatically shrinking it. Use **Arrange downward** for existing boards (undoable), **Read from top** for 100% reading, and **Fit diagram** for an explicit overview.
- Two-way interactions: requests, responses, feedback and retries have explicit connection types. Return paths use dashed amber arrows and type labels. Edit a connection’s type in its details panel. The DNS example shows queries and replies without using a model; **Show return paths** prepares an agent follow-up for existing boards (review before submitting; normal model usage applies).
- Claude and Codex integration through locally installed, authenticated CLIs.
- Per-agent model and reasoning-effort controls, custom model IDs, economical defaults, and no automatic upgrade to a larger model.
- Follow-up prompts that include the current graph and selected concept; existing node positions are retained.
- Concept explanations, editable labels and icons, searchable navigation, and incoming/outgoing relationship navigation.
- Named SQLite-backed boards, reusable private templates, persistent undo/redo, and browser recovery copies.
- Explicit review of agent changes to existing content; one bounded invalid-output repair attempt.
- Topic-specific next steps in a small menu above the composer (hidden until opened), per-concept uncertainty annotations, and a guided walkthrough.
- **Play the process**: a scrubbable, video-like playback with captions and an optional British narrator. Agents write a short spoken script alongside each diagram (an opening, plus a line for every object and arrow, in playback order), so the narration reads as connected, grammatical prose rather than read-out labels. Older boards without a script are narrated from their summaries; editing an object or arrow by hand drops its now-stale line. The natural voices (Emma, George, Isabella, Fable) come from the open [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) speech model, run locally by the API. The model (about 330 MB) downloads/loads in the background when the API starts, into the gitignored `apps/api/data/models/` directory. Later starts reuse the cached model; the four voice files are bundled in the ignored `node_modules` directory. You can use the app while it prepares; narration waits for readiness if you play immediately. If the API has speech turned off, the browser runs a smaller copy of the model itself, which is slower. If neither is available, your device's own voices are used.
- Motion graphics during playback: the current arrow draws itself in and a packet travels along it, the current object pops in with a pulse, and new boards assemble one concept at a time. Everything stops when reduced motion is requested.
- **Evolving icons**: during playback the current icon comes alive the way its subject does. Wind streams, gears turn, hearts beat, rain falls, and anything else draws itself in. Press **Illustrate** in the player and the agent draws an animated illustration for each object, such as air streaming past, a seed sprouting or a letter dropping into an inbox. As playback reaches an object, its icon evolves into that drawing. The drawing plays while the object is current and rests once playback has passed it. Drawings arrive while the film plays, are saved with the board and can be undone. Closing the player brings the icons back. Illustrations are declarative, validated data (shapes, inks and keyframed motions on a 100 × 100 canvas) rendered as SVG animation, never raw markup from a model. They are not sent back to agents on follow-ups, and an object keeps its drawing unless its icon changes. Illustrating is a separate, explicit model call, which normal usage applies to. The demo agent illustrates the email example without one.
- **Document uploads**: attach up to five files (PDF, text, Markdown, CSV, JSON, code, or PNG/JPEG/GIF/WebP images; 10 MB each) for the agent to diagram. Text and PDF text layers (extracted with Poppler’s `pdftotext`, which must be installed) are sent inline to both agents. Claude reads images and scanned PDFs itself with its read-only Read tool, limited to a private temporary folder; Codex attaches images with `--image` and cannot read scanned PDFs. Document contents are treated as untrusted data.
- JSON/legacy OSG import and JSON, SVG, PNG, and Markdown export.
- An email-flow demo that works without an agent subscription or model call.

Opsis is a local-first development application. The current interface is entirely 2D. The older renderer and pipeline APIs have been retired; strict legacy OSG JSON import remains supported. See [GOALS.md](GOALS.md) for the implemented baseline and prioritized roadmap.

### Terminal-flow foundation prototype

On a new or empty canvas, ask `cat users.txt | head -10` (or “What does `cat users.txt | head -10` do?”). Opsis recognises this reference case automatically, with any agent selected, and builds a local icon flow without a model call: text file → read command → line filter → terminal output. Commands appear beneath the icons. Select a command for a terminal-style preview: expandable sample input, `$` prompt, concrete example output, green success status, and expandable failure/remedy lines. The reference uses twelve synthetic usernames, consistently showing the first ten after `head`. Terminal steps replace the prose explanation with this compact visual. No commands execute and no file is read. Use a Unix shell such as Bash on Linux, macOS or WSL for the semantics in this example; native PowerShell differs.

This first model covers missing files, permissions, empty/short input, unavailable utilities, upstream errors hidden by a successful final command, and conditional SIGPIPE behaviour when `head` stops early. It treats stdout and stderr separately and describes concurrent data flow. `head -n 10 users.txt` is the simpler equivalent for this particular task. The reference follows the [GNU head manual](https://www.gnu.org/s/coreutils/manual/html_node/head-invocation.html) and [Bash pipeline manual](https://www.gnu.org/software/bash/manual/html_node/Pipelines).

Local recognition is deliberately limited to this pipeline (including `head -n 10`) and short explanation questions. Attachments, existing nonempty boards, and other commands follow the normal agent path. For supported text transformations, Claude and Codex supply a synthetic source and structured operations; the Rust engine calculates intermediate outputs instead of relying on the model to invent them. Other commands retain explicit illustrative previews. Terminal metadata and process operations persist with editable JSON; command captions appear in image exports and terminal previews in Markdown. Scenario branches and real machine context remain future work. There is no terminal mode selector.

### Calculated process engine

`@opsis/engine` is a deterministic Rust core compiled to WebAssembly and loaded in a browser worker. Process contract v3 supports synthetic sources, pass-through, head/tail, sorting, literal filtering, adjacent unique, count, cut, character translation, concat and paste. It calculates intermediate text, row counts, provenance and playback paths. Failures propagate along dependencies while independent branches continue.

Select a source icon and edit **Sample data → Update sample** to recalculate connected previews without a model call. This is one undoable, synchronized edit. Existing boards without process metadata retain their explanatory previews. The engine never executes commands or reads local files. See [the engine contract](docs/PROCESS-ENGINE.md) for limits, exact operation semantics and build instructions.

## Quick start

Requirements: Node.js **20.19+**, **pnpm 10.34.5** and [Rust via rustup](https://rustup.rs/). The engine pins Rust **1.89.0** and the browser WASM target in `packages/engine/rust-toolchain.toml`; rustup installs these on its first build. Native Rust tests require your platform's C/C++ linker (Windows: Visual Studio Build Tools with Desktop development with C++; macOS: Xcode command-line tools; Linux: a C compiler).

```sh
git clone git@github.com:Pyp-3/Opsis.git
cd Opsis
./opsis dev
```

Open **http://localhost:3000**. The API listens on **127.0.0.1:8000**, and the web development server proxies `/v1` requests to it. Start with the email example to explore without spending tokens.

On Linux, macOS, or WSL, `./opsis dev` (or just `./opsis`) checks prerequisites,
installs locked dependencies, verifies SQLite, and runs the existing development
command, which builds the WASM engine before starting both servers. Use `./opsis install`
to prepare dependencies and WASM without starting servers, and `./opsis help` for usage.
The launcher works from any working directory and preserves environment settings such
as `OPSIS_SPEECH=off`. Stop both servers with Ctrl+C. It does not install global tools
or automatically approve dependency build scripts.

On native Windows, use `pnpm install --frozen-lockfile` followed by `pnpm dev`.

The API uses the native `better-sqlite3` dependency even when working with the new canvas. If a fresh installation reports a missing native binding, run `pnpm approve-builds`, approve only the reviewed dependency `better-sqlite3`, then run `pnpm rebuild better-sqlite3`. A platform without a matching prebuilt binary may also need Python and a C/C++ build toolchain.

## Automatic build releases

Every branch push runs CI. After lint, type checks, Rust tests, and the complete QA
suite pass, CI publishes a GitHub **prerelease** with a compiled ZIP, SHA-256 checksum,
and `release.json` tracker. Pull requests run checks without publishing. Failed pushes
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
it, install the Quick start prerequisites above, then run `./opsis dev` (or
`pnpm install --frozen-lockfile` and `pnpm dev`). The MCP server and shared contracts
retain their existing TypeScript entrypoints. The prebuilt web assets live in
`apps/web/dist`; serving them separately requires forwarding `/v1` to the API.

For a local bundle after building, run `pnpm release:package` (requires Git and `zip`).
Output is under the ignored `output/releases/` directory. Packaging tests run with
`pnpm release:test` and require `unzip` too. Local builds use run/attempt `1/1` unless
overridden via `GITHUB_RUN_NUMBER` / `GITHUB_RUN_ATTEMPT`; an existing ZIP is never
silently overwritten. Local archives flag uncommitted changes in `release.json`;
CI refuses to publish a modified checkout.

## Agents and model configuration

Install and sign in to your preferred agent CLI separately. Opsis uses that CLI's existing local login; it does **not** read, copy, or require you to paste subscription credential files.

In the prompt panel at the bottom of the canvas:

1. Choose **Agent**: Claude, Codex, or Demo.
2. Open **Model** in the prompt panel: choose a versioned preset, a CLI alias, or **Custom model ID…**. The settings show the exact ID sent to the agent.
3. Choose **Effort**, if supported by the model.
4. Submit the prompt. Reading details, editing the graph, and changing settings do not generate model calls.

Claude initially selects Haiku; Codex initially selects GPT-6 Luna with low effort. These are application presets, not a guarantee of account availability. Haiku's effort selector is disabled. Unsupported models or effort levels return an error rather than silently switching to an expensive model. Settings are remembered separately for each agent.

Claude presets include Haiku 4.5, Sonnet 5.5, Opus 5.5, Fable 5.1, and earlier Sonnet/Opus 4.6. The `haiku`, `sonnet`, and `opus` options are explicitly marked as CLI aliases: their resolved version depends on your CLI configuration and provider. Choose a versioned ID for a specific generation. Codex presets include GPT-6 Luna, GPT-6.1 Sol, GPT-6 Sol, and GPT-6 Astra. These lists follow the [Claude model documentation](https://platform.claude.com/docs/en/models/overview) and [OpenAI model documentation](https://learn.chatgpt.com/docs/models); selecting a preset does not grant account access.

CLI readiness checks installation/version, not subscription entitlement. An actual generation is needed to verify model access. Effort is **not** a token or spending cap; usage remains subject to your provider's subscription and limits. There is no dedicated model-management page or actual token-usage dashboard yet.

### Configuration

| Variable           | Purpose                                   | Default                      |
| ------------------ | ----------------------------------------- | ---------------------------- |
| `OPSIS_CLAUDE_BIN` | Claude CLI executable override            | Auto-discovered              |
| `OPSIS_CODEX_BIN`  | Codex CLI executable override             | Auto-discovered              |
| `HOST`             | API listen address                        | `127.0.0.1`                  |
| `PORT`             | API port                                  | `8000`                       |
| `OPSIS_DB_PATH`    | SQLite database for v2 and legacy boards  | `apps/api/data/opsis.sqlite` |
| `OPSIS_SPEECH`     | `off` disables the API's natural narrator | on                           |
| `OPSIS_MODEL_DIR`  | Where the narrator's speech model is kept | `apps/api/data/models`       |

Use absolute executable paths when overriding the CLI locations. Executables and versions are validated by the harness. Model and effort settings come from the canvas request; the retired pipeline’s `OPSIS_LLM_*` configuration is no longer used. See [API documentation](apps/api/README.md) for current settings.

CLI discovery searches the API process's `PATH`, then common user/system installation locations on Windows, Linux, and macOS (including Apple Silicon Homebrew). Windows npm installs are resolved to their package's native executable or JavaScript entry point; `.cmd`/`.ps1` npm overrides are supported without invoking a shell. Custom shell wrappers are unsupported. Restart the API after installing a CLI or changing its `PATH`. An explicit override takes precedence and fails if invalid instead of silently selecting another installation. Readiness checks do not verify login or model entitlement.

## Persistence: what is saved today?

| Data                                                     | Storage                                                        | Scope                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Named 2D boards, positions, connection sides and history | SQLite `boards_v2` table                                       | Multiple boards in the local API database              |
| Active-board recovery snapshot                           | Browser local/session storage, key `opsis:library-recovery:v1` | Per-tab recovery plus a last-used browser copy         |
| Agent/model/effort preferences                           | Browser `localStorage`, key `opsis:model-settings:v1`          | Per-agent preferences on that browser/origin           |
| Undo/redo history                                        | SQLite and recovery snapshot                                   | Up to 40 past/future states per board, survives reload |
| Historical OSG records, explanations and share tokens    | Existing SQLite tables left untouched                          | Retained data; retired API access is unavailable       |

Use **Manage boards** to create empty named boards, search, reopen, rename and delete them. Deletion requires confirmation and removes that board’s undo history; export a backup first if needed. The home page lists recent boards and examples; inside a canvas the sidebar shows only that canvas. **Board name** also supports inline renaming. **New canvas** saves the previous board before opening a fresh draft. Open views using the same API automatically check for saved updates every 1.5 seconds and on window focus; they retain their own active-board selection. Incoming updates wait during dragging, playback, generation and proposal review. Stale saves reconcile changes field by field and retry: unrelated edits are retained, and the retried local edit wins when both views change the same field. The other saved version is retained in undo history. If a board was deleted, repeated conflicts persist, or a combined board would exceed limits, unsaved edits are preserved as a separate board instead of blocking on a revision conflict. A clean view of a deleted board opens a fresh draft. Network/storage failures still retain local recovery and may block switching until saved. Wait for **Saved** before treating an edit as durably saved.

The original `opsis:board:v2` browser board is imported on first use when no newer recovery snapshot exists; its old copy is retained. Clearing site data does not delete saved SQLite boards; reopen them from the manager. Pending edits can still be lost if both the API save and browser recovery fail. A drag is one undoable edit; intermediate pointer positions are not autosaved. Sync covers views connected to the same local API, with recovery baselines stored per tab. There is no hosted cross-device sync, archive UI, or unlimited revision archive yet.

Use **Export → Editable board** for portable JSON backups and **Import** to reopen them. SVG and PNG are images; Markdown includes explanations and outgoing relationships. **Import** also accepts legacy OSG JSON: it creates a separate v2 board and marks flattened concepts as simplified. 3D geometry, animations and drill-down behavior are not preserved; unknown primitives become generic icons. Oversized/invalid imports are rejected, and original files remain unchanged. Existing legacy database records are not bulk-migrated automatically.

## Accounts and sharing

In **Manage boards → My boards**, use a board’s **Save as template** action and give it a name. Open **Templates**, select a template, and name the new project board. Templates persist privately in SQLite for your account, preserving board content, layout, and appearance. Each use creates an independent private board with fresh undo/redo history. Editing or deleting the source board does not change its templates; deleting a template does not remove boards created from it.

Opsis asks you to sign up or log in (name, email, password; no 2FA yet). Passwords are stored
as salted scrypt hashes; sessions are HttpOnly cookies that last 30 days. Every board belongs
to an account and starts **private**. Make one **public** from its **Look & details** page or
the board manager, and anyone signed in to the same Opsis server can open it from **Public
boards** or its link (`/canvas?board=<id>`), play it, and **Save a copy** to edit their own.
They can never change yours. Boards saved before accounts existed go to the first account
created on that database.

## Agent access over MCP

`apps/mcp` is an MCP server that lets your own agents (Claude Code, Codex, any MCP client) read
and edit canvases directly: create boards, add and connect concepts, recolour them or write a
whole diagram. Edits go through the local API, so an open canvas updates live and each agent
edit can be undone. Agents authenticate with an agent key from **Account → Agent keys**, which
works only for local agents (never from a browser or another machine). Claude Code in this
repository picks the server up from `.mcp.json` with `OPSIS_AGENT_KEY` set in your shell; see
[apps/mcp/README.md](apps/mcp/README.md) for other agents.

## Follow-up safety and learning

The server compares every existing node and connection with the candidate graph. Removals, rewrites and changed metadata require review. The workspace also previews pure additions and other prompt updates to nonempty boards before applying them. **Proposed** shows the actual candidate layout, icons, arrows and command captions; switch to **Current** to compare, or zoom and scroll for detail. Nothing is saved until **Apply reviewed changes**; **Keep current board** discards the candidate. First-time generation on an empty canvas still opens directly.

Invalid JSON/schema output gets at most one repair attempt using the same model and effort, with validation feedback and a shared 180-second deadline. This may consume an extra model call. Login, process, cancellation and timeout failures are not automatically retried. Generation displays elapsed time and coarse stages, not percentage completion; nodes are not streamed incrementally yet.

Generated graphs request two or three relevant suggestion prompts, plus qualitative `normal`, `simplified` or `uncertain` annotations and caveats per concept. These are model judgments, not calibrated confidence scores. Old boards without suggestions show no unrelated email chips. **Start walkthrough** visits each concept once through outgoing paths, handling branches and cycles without changing the graph.

## Development

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm engine:test
pnpm engine:check
```

Targeted new-workspace coverage:

```sh
pnpm exec vitest run apps/web/src/workspace apps/api/src/boards.test.ts
```

`pnpm test:browser` runs the current workspace suite in `tests/workspace`; `pnpm test:qa` builds and runs unit/API and browser tests. Isolated test servers use ports 3100/8100 and an in-memory database; no paid agent calls or credentials are required. Tests cover board management/history, repeated dragging, the 50-node/100-edge limit, review, imports/exports, cancellation, walkthrough, accessibility and mobile overflow. See [the stress-test report](docs/QA-STRESS.md) for scope and limitations. Obsolete pipeline and 3D scenarios have been removed; current coverage lives under `tests/workspace`. Pixel-perfect baselines and broader performance budgets remain future work. The build still warns about large chunks, including lazy-loaded ELK.

An optional real Opus smoke check uses your local Claude login: `OPSIS_LIVE_OPUS=1 pnpm --filter api exec tsx ../../scripts/live-opus-smoke.ts`. It is excluded from CI, runs two application requests at medium effort, and caps CLI completions at three including repairs. This is a call-count guard, not a token/quota guarantee. Its report is written under `apps/api/output/qa/`.

### Repository layout

```text
apps/web/src/workspace/  Canvas composition, feature components, board persistence and playback
apps/web/src/auth/       Account entry screens and session requests
apps/api/src/boards/     Prompts, agent workflows, validation and response streaming
apps/api/src/harness/    Validated local CLI integration
apps/api/src/storage.ts  SQLite accounts, owned boards and revision transactions
apps/mcp/               Agent tools for reading and editing canvases
packages/schema/        Shared board contracts/rules and legacy OSG import validation
packages/engine/        Rust/WASM contracts, operations, evaluation and drawing
tests/workspace/        Current browser regression suite
docs/                   Current reference docs and marked historical design notes
```

Read [AGENTS.md](AGENTS.md) before changing code. [CLAUDE.md](CLAUDE.md) points to the same guide. [The refactoring record](docs/REFACTORING.md) explains module ownership, preserved contracts and intentional removals.

## Local-use boundaries

Keep the API on loopback. Opsis has accounts, board ownership and local-only agent keys, but public hosting still requires a separate deployment-hardening review. Legacy pipeline and OSG sharing routes are removed. Prompts and graph context are sent through your selected agent provider when you generate; local storage does not mean model inference is offline.

Agent generation runs with bounded input/output and a deadline, validates the returned graph, and restricts CLI tools. Failures preserve the current diagram. Credentials, environment files, local databases, browser traces, and generated build/test output should never be committed.

For current API and engine behavior, see [API documentation](apps/api/README.md) and [the engine contract](docs/PROCESS-ENGINE.md). `PLAN.md`, `PROMPT.md` and [the 2D workspace notes](docs/OPSIS-2D.md) describe historical work; [GOALS.md](GOALS.md) tracks the current product direction.

# Opsis

**See what you mean.** Opsis turns explanations into editable, connected icons on a 2D blueprint canvas. Ask an agent to explain a process, follow the arrows, and select a concept when you want the details.

The aim is visual understanding: short labels on the canvas, deeper explanations on demand, and agents that can extend the diagram as your questions develop.

## Current capabilities

- Frameless Lucide icons on a pannable, zoomable engineering-style grid.
- Curved arrows that follow dragged icons, four reusable connection ports, branching and merging, and endpoint reconnection.
- Claude and Codex integration through locally installed, authenticated CLIs.
- Per-agent model and reasoning-effort controls, custom model IDs, economical defaults, and no automatic upgrade to a larger model.
- Follow-up prompts that include the current graph and selected concept; existing node positions are retained.
- Concept explanations, editable labels and icons, searchable navigation, and incoming/outgoing relationship navigation.
- Named SQLite-backed boards, persistent undo/redo, and browser recovery copies.
- Explicit review of agent changes to existing content; one bounded invalid-output repair attempt.
- Topic-specific suggestions, per-concept uncertainty annotations, and a guided walkthrough.
- JSON/legacy OSG import and JSON, SVG, PNG, and Markdown export.
- An email-flow demo that works without an agent subscription or model call.

Opsis is a local-first development application. The current interface is entirely 2D; the older renderer and pipeline remain in the repository for compatibility. See [GOALS.md](GOALS.md) for the implemented baseline and prioritized roadmap.

## Quick start

Requirements: Node.js **20.19+** and **pnpm 10.34.5** (the version pinned in `package.json`).

```sh
git clone git@github.com:Pyp-3/Opsis.git
cd Opsis
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:3000**. The API listens on **127.0.0.1:8000**, and the web development server proxies `/v1` requests to it. Start with the email example to explore without spending tokens.

The API uses the native `better-sqlite3` dependency even when working with the new canvas. If a fresh installation reports a missing native binding, run `pnpm approve-builds`, approve only the reviewed dependency `better-sqlite3`, then run `pnpm rebuild better-sqlite3`. A platform without a matching prebuilt binary may also need Python and a C/C++ build toolchain.

## Agents and model configuration

Install and sign in to your preferred agent CLI separately. Opsis uses that CLI's existing local login; it does **not** read, copy, or require you to paste subscription credential files.

In the prompt panel at the bottom of the canvas:

1. Choose **Agent**: Claude, Codex, or Demo.
2. Choose **Model**: a preset or **Custom model ID…**.
3. Choose **Effort**, if supported by the model.
4. Submit the prompt. Reading details, editing the graph, and changing settings do not generate model calls.

Claude initially selects Haiku; Codex initially selects GPT-6 Luna with low effort. These are application presets, not a guarantee of account availability. Haiku's effort selector is disabled. Unsupported models or effort levels return an error rather than silently switching to an expensive model. Settings are remembered separately for each agent.

CLI readiness checks installation/version, not subscription entitlement. An actual generation is needed to verify model access. Effort is **not** a token or spending cap; usage remains subject to your provider's subscription and limits. There is no dedicated model-management page or actual token-usage dashboard yet.

### Configuration

| Variable           | Purpose                                  | Default                      |
| ------------------ | ---------------------------------------- | ---------------------------- |
| `OPSIS_CLAUDE_BIN` | Claude CLI executable                    | `~/.local/bin/claude`        |
| `OPSIS_CODEX_BIN`  | Codex CLI executable                     | `/usr/bin/codex`             |
| `HOST`             | API listen address                       | `127.0.0.1`                  |
| `PORT`             | API port                                 | `8000`                       |
| `OPSIS_DB_PATH`    | SQLite database for v2 and legacy boards | `apps/api/data/opsis.sqlite` |

Use absolute executable paths when overriding the CLI locations. Executables and versions are validated by the harness. The `OPSIS_LLM_*` settings described in the [legacy API documentation](apps/api/README.md) configure the older pipeline; the new canvas sends its model selection from the UI.

## Persistence: what is saved today?

| Data                                                               | Storage                                                        | Scope                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------ |
| Named 2D boards, positions, connection sides and history           | SQLite `boards_v2` table                                       | Multiple boards in the local API database              |
| Active-board recovery snapshot                                     | Browser local/session storage, key `opsis:library-recovery:v1` | Per-tab recovery plus a last-used browser copy         |
| Agent/model/effort preferences                                     | Browser `localStorage`, key `opsis:model-settings:v1`          | Per-agent preferences on that browser/origin           |
| Undo/redo history                                                  | SQLite and recovery snapshot                                   | Up to 40 past/future states per board, survives reload |
| Legacy OSG diagrams, cached results, explanations and share tokens | SQLite through `better-sqlite3` and Drizzle                    | Local API database                                     |

Use **Saved boards** to reopen work and **Board name** to rename it. **New canvas** saves the previous board before opening a fresh one. A failed save blocks switching; retry, export, or use **Save as separate board** to recover a write conflict. Revision checks reject stale writes from another tab. Wait for **Saved to SQLite** before treating an edit as durably saved.

The original `opsis:board:v2` browser board is imported on first use when no newer recovery snapshot exists; its old copy is retained. Clearing site data does not delete saved SQLite boards; reopen them from the list. Pending edits can still be lost if both the API save and browser recovery fail. There is no cross-device sync, board deletion/archive UI, or unlimited revision archive yet.

Use **Export → Editable board** for portable JSON backups and **Import** to reopen them. SVG and PNG are images; Markdown includes explanations and outgoing relationships. **Import** also accepts legacy OSG JSON: it creates a separate v2 board and marks flattened concepts as simplified. 3D geometry, animations and drill-down behavior are not preserved; unknown primitives become generic icons. Oversized/invalid imports are rejected, and original files remain unchanged. Existing legacy database records are not bulk-migrated automatically.

## Follow-up safety and learning

The server compares every existing node and connection with the candidate graph. Removals, rewrites and changed metadata trigger a review panel with current/proposed content; nothing is applied until **Apply reviewed changes**. **Keep current board** discards the candidate. Pure additions may apply directly. All existing changes require review, even to the selected concept, because the server cannot reliably infer intended edits from prose alone.

Invalid JSON/schema output gets at most one repair attempt using the same model and effort, with validation feedback and a shared 180-second deadline. This may consume an extra model call. Login, process, cancellation and timeout failures are not automatically retried. Generation displays elapsed time and coarse stages, not percentage completion; nodes are not streamed incrementally yet.

Generated graphs request two or three relevant suggestion prompts, plus qualitative `normal`, `simplified` or `uncertain` annotations and caveats per concept. These are model judgments, not calibrated confidence scores. Old boards without suggestions show no unrelated email chips. **Start walkthrough** visits each concept once through outgoing paths, handling branches and cycles without changing the graph.

## Development

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Targeted new-workspace coverage:

```sh
pnpm exec vitest run apps/web/src/workspace apps/api/src/boards.test.ts
```

`pnpm test:browser` runs the current workspace suite in `tests/workspace`; `pnpm test:qa` builds and runs unit/API and browser tests. Isolated test servers use ports 3100/8100 and an in-memory database; no paid agent calls or credentials are required. Tests cover saved boards/history, review, branching/dragging, exports, walkthrough, accessibility and mobile overflow. Retired scenarios remain under `tests/e2e`, `tests/visual` and `tests/perf` as historical references, excluded from the current default gate. Pixel-perfect screenshot baselines and large-graph performance coverage remain future work. The production build still warns about large chunks, including the lazily loaded ELK engine.

### Repository layout

```text
apps/web/src/workspace/   Current React Flow canvas, controls, layout and exports
apps/web/src/LegacyApp.tsx Previous application, retained for compatibility
apps/api/src/boards.ts   Agent discovery and v2 graph generation
apps/api/src/harness/    Validated local CLI integration
apps/api/src/storage.ts  SQLite persistence for v2 and legacy boards
apps/api/src/board-library.ts V2 library list/load/save endpoints
packages/schema/        Shared Zod contracts, including v2 boards
packages/pipeline/      Legacy parsing, metaphor, layout and explanation pipeline
tests/workspace/        Current workspace browser regression suite
docs/                   Design notes and implementation documentation
```

## Local-use boundaries

Keep the API on loopback. Opsis has no user accounts or production authorization layer, and legacy ID-based write routes are unauthenticated. Do not expose it publicly without authentication and access controls. Prompts and graph context are sent through your selected agent provider when you generate; local storage does not mean model inference is offline.

Agent generation runs with bounded input/output and a deadline, validates the returned graph, and restricts CLI tools. Failures preserve the current diagram. Credentials, environment files, local databases, browser traces, and generated build/test output should never be committed.

For further implementation details, see [the 2D workspace notes](docs/OPSIS-2D.md). `PLAN.md` and older design documents describe historical work; [GOALS.md](GOALS.md) tracks the current product direction.

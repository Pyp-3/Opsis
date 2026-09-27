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
- Undo/redo, current-board autosave, JSON import/export, and SVG export.
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

| Variable           | Purpose                             | Default                      |
| ------------------ | ----------------------------------- | ---------------------------- |
| `OPSIS_CLAUDE_BIN` | Claude CLI executable               | `~/.local/bin/claude`        |
| `OPSIS_CODEX_BIN`  | Codex CLI executable                | `/usr/bin/codex`             |
| `HOST`             | API listen address                  | `127.0.0.1`                  |
| `PORT`             | API port                            | `8000`                       |
| `OPSIS_DB_PATH`    | Legacy API SQLite database location | `apps/api/data/opsis.sqlite` |

Use absolute executable paths when overriding the CLI locations. Executables and versions are validated by the harness. The `OPSIS_LLM_*` settings described in the [legacy API documentation](apps/api/README.md) configure the older pipeline; the new canvas sends its model selection from the UI.

## Persistence: what is saved today?

| Data                                                               | Storage                                               | Scope                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| Current 2D board, positions and connection sides                   | Browser `localStorage`, key `opsis:board:v2`          | One current board per browser profile and origin |
| Agent/model/effort preferences                                     | Browser `localStorage`, key `opsis:model-settings:v1` | Per-agent preferences on that browser/origin     |
| Undo/redo history                                                  | Memory                                                | Current session only                             |
| Legacy OSG diagrams, cached results, explanations and share tokens | SQLite through `better-sqlite3` and Drizzle           | Local API database                               |

**The new 2D canvas does not yet save its boards to SQLite.** Closing and reopening the same browser/origin restores the current board, but clearing site data removes it. `localhost` and `127.0.0.1` are different storage origins. There is no cross-device sync or named-board library yet.

Use **Export → JSON** for portable backups and **Import** to reopen them. Export before starting another board if you want to keep the previous one. SVG is for sharing/viewing, not editable round-trip import. Old OSG documents are not automatically migrated to the v2 format. SQLite-backed v2 boards and migration are roadmap priorities.

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

The repository also contains `pnpm test:browser` and `pnpm test:qa`. Existing browser/visual/3D performance scenarios target the retired interface and need migration; they are not currently a release gate for the new workspace. Current v2 validation combines unit/API tests and direct browser checks. The production build currently emits a large-chunk warning, including for the lazily loaded ELK layout engine.

### Repository layout

```text
apps/web/src/workspace/   Current React Flow canvas, controls, layout and exports
apps/web/src/LegacyApp.tsx Previous application, retained for compatibility
apps/api/src/boards.ts   Agent discovery and v2 graph generation
apps/api/src/harness/    Validated local CLI integration
apps/api/src/storage.ts  Legacy SQLite persistence
packages/schema/        Shared Zod contracts, including v2 boards
packages/pipeline/      Legacy parsing, metaphor, layout and explanation pipeline
tests/                  Shared, golden and legacy browser test suites
docs/                   Design notes and implementation documentation
```

## Local-use boundaries

Keep the API on loopback. Opsis has no user accounts or production authorization layer, and legacy ID-based write routes are unauthenticated. Do not expose it publicly without authentication and access controls. Prompts and graph context are sent through your selected agent provider when you generate; local storage does not mean model inference is offline.

Agent generation runs with bounded input/output and a deadline, validates the returned graph, and restricts CLI tools. Failures preserve the current diagram. Credentials, environment files, local databases, browser traces, and generated build/test output should never be committed.

For further implementation details, see [the 2D workspace notes](docs/OPSIS-2D.md). `PLAN.md` and older design documents describe historical work; [GOALS.md](GOALS.md) tracks the current product direction.

# Opsis 2D workspace

Goal: turn a prompt into an understandable, editable graph of icons and short labels, with explanations available when a concept is selected. The blueprint canvas is the main workspace. There is no 3D renderer or 3D toggle in the new application entry point.

## Run

Run `pnpm dev` from the repository root and open <http://localhost:3000>. The web app proxies `/v1` to the local API on port 8000.

Use the email example to explore without an agent call. Choose Claude or Codex in the composer for other topics or to extend the example. The current diagram and selected concept travel with follow-up requests. Existing concept positions survive agent switches and graph expansions. Invalid responses and provider failures leave the current diagram intact.

## Model and usage controls

The composer exposes the model and effort before every generation:

| Agent  | Initial model | Initial effort | Other presets          |
| ------ | ------------- | -------------- | ---------------------- |
| Claude | Haiku         | Not applicable | Sonnet, Opus           |
| Codex  | GPT-6 Luna    | Low            | GPT-6 Sol, GPT-6 Astra |

Custom model IDs are supported. Availability depends on your provider account. Settings are saved separately for each agent in browser local storage. Switching agents restores that agent's settings. Opsis passes the selected model explicitly, never silently retries with a larger model, and rejects the ambiguous `default` model name. Low, medium, high, extra-high and maximum effort are exposed for models supporting them. Haiku does not support configurable effort, so its selector is disabled and no effort flag is sent. A custom model may support fewer levels; an unsupported request produces an error instead of an application-selected upgrade.

Effort is not a hard token budget. Subscription limits and provider-side routing still apply. There is no per-request token metering in this milestone.

Sources checked September 27, 2026:

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Codex model and reasoning configuration](https://learn.chatgpt.com/docs/config-file/config-reference)

## Local agent integration

Both providers use their installed CLI and existing local login. Opsis does not open or copy credential files. `GET /v1/agents` verifies CLI availability/version, not subscription entitlement; an actual generation verifies login/model access. Local defaults are `~/.local/bin/claude` and `/usr/bin/codex`; override executable locations with `OPSIS_CLAUDE_BIN` and `OPSIS_CODEX_BIN`. Model selection comes from the UI, independently of the old pipeline's environment settings.

Each generation runs in a private temporary directory with bounded input/output and a shared 180-second deadline. Invalid output receives at most one repair attempt on the same model, which can consume a second call; process/login failures do not. Cancellation propagates to the process runner. Claude runs with restricted tools; Codex uses read-only mode and ignores user tool configuration. No tools are needed to generate a graph. Prompts are supplied over stdin and generated JSON is checked for schema correctness, unique IDs, and valid edge references. Readiness probes are cached for 30 seconds and concurrent checks share one probe.

The server compares all existing nodes/edges against a follow-up. Changed or removed content returns a 409 candidate for explicit review, never a silent commit. Additions may apply directly. Suggestions and per-node qualitative uncertainty/caveats come from the model. Coarse progress and elapsed time are shown; incremental node streaming is not yet implemented.

## Editing and storage

- Click a concept to read its summary and explanation. Reading existing details consumes no agent tokens.
- Use “Explore this step” to prepare a follow-up; generation happens only on submission.
- Icons are frameless. Drag an icon or its label to rearrange it; curved arrows follow live.
- Each icon has four reusable connection dots. Drag between dots to create branches, including multiple incoming and outgoing paths. Drag an arrow endpoint just outside its connection dot to reconnect it. Connection sides persist through saves and exports.
- Collapse the sidebar for more canvas space, search concepts by name, and navigate incoming/outgoing relationships in the detail panel.
- Edit labels, summaries, explanations and icons in the detail panel. Select an edge to relabel or remove it.
- Undo/redo retains up to 40 past/future states per board in SQLite, including agent updates, and survives reload. Keyboard shortcuts: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
- Named boards autosave through revision-checked library endpoints. Switching waits for a successful save. Browser local/session storage keeps recovery snapshots; the old single-key board is imported without deleting its source. Conflicts offer a separate saved copy.
- JSON is the editable backup format. SVG/PNG provide diagram images; Markdown provides an outline of explanations and connections. Legacy OSG JSON can be imported into a separate v2 board with explicit simplification caveats.
- Guided walkthrough visits roots and outgoing paths, then any remaining cycle/disconnected nodes, without changing content.
- Demo mode supports the email flow and a delivery-failure branch; it explicitly rejects other prompts.

## Architecture and scope

`apps/web/src/workspace` is the new React Flow workspace, with Lucide icons and on-demand ELK layout. `packages/schema/src/board.ts` defines the 2D document and agent output. `apps/api/src/boards.ts` serves `/v1/agents` and `/v1/boards/generate`. The same graph schema works with either provider.

The older app, OSG pipeline, SQLite documents and component tests remain for compatibility, but the production entry point renders only the new workspace. Legacy file import is explicit; stored OSG records are not bulk-migrated. `useBoardHistory`, `useBoardLibrary`, `useBoardGeneration` and `WorkspaceSidebar` separate state/network concerns from the canvas. Workspace component tests complement API/hook tests. `pnpm test:qa` now runs the current `tests/workspace` browser suite, including accessibility/mobile checks, on isolated ports and without paid agents. Historical browser suites are retained but excluded from the default gate.

Next milestones: nested expandable subgraphs/group frames, board search/archive, real usage reporting, incremental streaming, visual screenshot baselines, and authenticated read-only sharing. The current graph remains flat, with selectable reading details and agent-generated branches.

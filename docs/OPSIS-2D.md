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

Each generation runs in a private temporary directory with bounded input/output and a 180-second deadline. Cancellation propagates to the process runner. Claude runs with restricted tools; Codex uses read-only mode and ignores user tool configuration. No tools are needed to generate a graph. Prompts are supplied over stdin and generated JSON is checked for schema correctness, unique IDs, and valid edge references.

## Editing and storage

- Click a concept to read its summary and explanation. Reading existing details consumes no agent tokens.
- Use “Explore this step” to prepare a follow-up; generation happens only on submission.
- Icons are frameless. Drag an icon or its label to rearrange it; curved arrows follow live.
- Each icon has four reusable connection dots. Drag between dots to create branches, including multiple incoming and outgoing paths. Drag an arrow endpoint just outside its connection dot to reconnect it. Connection sides persist through saves and exports.
- Collapse the sidebar for more canvas space, search concepts by name, and navigate incoming/outgoing relationships in the detail panel.
- Edit labels, summaries, explanations and icons in the detail panel. Select an edge to relabel or remove it.
- Undo/redo retains up to 40 edits in the current session, including agent updates. Keyboard shortcuts: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
- The current board autosaves on this device. Export JSON to retain separate boards; import to reopen them. SVG export includes icons, relationships and explanation titles.
- Demo mode supports the email flow and a delivery-failure branch; it explicitly rejects other prompts.

## Architecture and scope

`apps/web/src/workspace` is the new React Flow workspace, with Lucide icons and on-demand ELK layout. `packages/schema/src/board.ts` defines the 2D document and agent output. `apps/api/src/boards.ts` serves `/v1/agents` and `/v1/boards/generate`. The same graph schema works with either provider.

The older app, OSG pipeline, SQLite documents and component tests remain for compatibility, but the production entry point renders only the new workspace. Old OSG files are not yet migrated to v2. The old browser scenarios under `tests/e2e`, `tests/visual`, and the 3D performance scenario target the retired interface and need replacement before `pnpm test:qa` represents the new workspace. New functionality is covered by API, harness, layout and model-control unit tests plus direct browser checks.

Next milestones: nested expandable subgraphs/group frames, multiple named saved boards, graph-diff review for larger agent edits, real usage reporting, and a browser regression suite for the new UI. The first milestone uses a flat graph with expandable reading details and agent-generated branches.

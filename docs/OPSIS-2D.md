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
- Fresh diagrams use downward layers with a viewport-sized column limit. Overflow branches wrap to subsequent rows. Follow-up additions stay below their parent, preserving existing manual positions.
- Node height follows wrapped title lines and confidence badges. Each row reserves the largest node height plus relationship-label and connection-density clearance. Simple chains pack tightly; busier rows receive extra lane space. Existing positions change only when explicitly rearranged.
- Full label footprints are reserved; relationship labels wrap beside (not across) routed arrows. Bypasses and return paths use exterior corridors. SVG/PNG exports use the same routes.
- Ports attach to the icon, never to the invisible text footprint. Bottom-port stubs turn sideways above the title. Dragging recalculates routes from the same port offsets used by the handles and exports.
- Shared ports fan into distinct lanes. Routing penalizes shared segments and crossings; unavoidable crossings use a background knockout to distinguish them from junctions. Requests are cyan/solid, responses amber/dashed, feedback violet/dotted and retries coral/dash-dot; type labels supplement color. The sidebar legend was removed. Dense, manually overlapping graphs can still require rearrangement; labels that cannot fit nearby use an external dotted callout.
- Optional edge `kind` preserves compatibility with old boards. New generated edges distinguish flow/request/response/feedback/retry. Typed returns do not determine downward layering; they retain their real direction and use dashed amber routes with explicit type labels. Existing board content is not silently rewritten: **Show return paths** prepares a follow-up, and changes to existing relationships go through review. Prompts improve semantic guidance but cannot guarantee model accuracy.
- The built-in DNS example follows classic iterative resolution in [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034), with replies returning to the resolver, not forwarding through a chain of servers. It intentionally omits cache hits, aliases, DNSSEC and query-name minimization.
- Scroll pans vertically at the current zoom. Adding nodes or opening details no longer triggers whole-graph shrink-to-fit. Use **Arrange downward** to reflow an existing board, **Read from top** to reset reading at 100%, or **Fit diagram** for a compact overview. Rearrangement is an undoable edit and resets manual port choices to automatic routing.
- Each icon has four reusable connection dots. Drag between dots to create branches, including multiple incoming and outgoing paths. Drag an arrow endpoint just outside its connection dot to reconnect it. Connection sides persist through saves and exports.
- Collapse the sidebar for more canvas space, search concepts by name, and navigate incoming/outgoing relationships in the detail panel.
- Edit labels, summaries, explanations and icons in the detail panel. Select an edge to relabel or remove it.
- Undo/redo retains up to 40 past/future states per board in SQLite, including agent updates, and survives reload. Drags are single transactions, with intermediate previews excluded from autosave; no-op edits preserve redo. Keyboard shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y.
- Named boards autosave through revision-checked library endpoints. Switching waits for a successful save. Browser local/session storage keeps recovery snapshots; the old single-key board is imported without deleting its source. Conflicts offer a separate saved copy.
- **Manage boards** creates empty named boards, searches, renames and deletes with confirmation. Deleted IDs are tombstoned so stale saves cannot resurrect them. Deletion removes the board and its history; export first if a backup is needed. The sidebar groups board controls, five recent boards and current concepts, with examples collapsed.
- JSON is the editable backup format. SVG/PNG provide diagram images; Markdown provides an outline of explanations and connections. Legacy OSG JSON can be imported into a separate v2 board with explicit simplification caveats.
- Guided walkthrough visits roots and outgoing paths, then any remaining cycle/disconnected nodes, without changing content.
- Demo mode supports the email flow and a delivery-failure branch; it explicitly rejects other prompts.

## Architecture and scope

`apps/web/src/workspace` is the new React Flow workspace, with Lucide icons and on-demand ELK layout. `packages/schema/src/board.ts` defines the 2D document and agent output. `apps/api/src/boards.ts` serves `/v1/agents` and `/v1/boards/generate`. The same graph schema works with either provider.

The older app, OSG pipeline, SQLite documents and component tests remain for compatibility, but the production entry point renders only the new workspace. Legacy file import is explicit; stored OSG records are not bulk-migrated. `useBoardHistory`, `useBoardLibrary`, `useBoardGeneration` and `WorkspaceSidebar` separate state/network concerns from the canvas. Workspace component tests complement API/hook tests. `pnpm test:qa` now runs the current `tests/workspace` browser suite, including accessibility/mobile checks, on isolated ports and without paid agents. Historical browser suites are retained but excluded from the default gate.

Next milestones: nested expandable subgraphs/group frames, board archive/restore, real usage reporting, incremental streaming, visual screenshot baselines, and authenticated read-only sharing. The current graph remains flat, with selectable reading details and agent-generated branches. See [the stress audit](QA-STRESS.md) for tested scope and known limitations.

# Opsis goals

Last reviewed: 2026-10-04.

## Current delivery

Both P1 sections are complete as of 2026-10-04 on the web and Linux desktop:
model settings/profiles/diagnostics, reported usage and explicit limits, consent-based
suggestions, keyboard connection editing, branch metadata, pins, selective proposal
acceptance, readable framing and denser-graph routing improvements. See the P1
evidence and limitations below.

P0 persistence is complete as of 2026-10-04: private duplicates, reversible archive,
transactional database migrations, manual full-database backup/restore, and an
owner-only saved-revision browser with restore-as-copy. Both Fastify and the Linux
Go desktop host are verified. Existing data, ownership, revision guards, deletion
tombstones, and the 40-entry undo limit are preserved.

The separately requested Kimi/Grok/Antigravity providers, API-key and fallback-model
settings, pricing-based cost projections/graphs, and complete Windows/macOS packaging remain pending.
Appearance settings and initial native platform plumbing have shipped; they do not
complete those goals. The Linux desktop and browser application remain supported.

## Product goal

Make agents useful as visual hands: convert a question or explanation into an understandable, editable 2D graph, with richer information available on selection. Preserve the user's spatial arrangement as the conversation and process branch.

The current experience is close to the intended visual direction. This checklist tracks shipped behavior and remaining work; perceived design completeness is not a claim of production readiness. Unchecked items below are planned, not implemented.

## Implemented

- [x] 2D blueprint canvas as the primary application, without a 3D toggle.
- [x] Frameless icons from a shared icon library, with short labels.
- [x] Pan, zoom, fit-to-view, and manual node movement.
- [x] Bounded-width top-to-bottom arrangement with overflow branches placed on later rows.
- [x] Scroll-through reading at a stable zoom; explicit overview and undoable downward rearrangement.
- [x] Icon-attached ports, including bottom connections routed above labels; shared canvas/export geometry.
- [x] Typed request/response/feedback/retry paths, distinct return styling, and a two-way DNS example. Agent instructions distinguish actor interactions from chronological stages.
- [x] Fan-out lanes, overlap/crossing penalties, crossing knockouts, and connection type colors/patterns. The sidebar legend was removed to reduce clutter.
- [x] Compact label-sized node footprints and row spacing calculated from relationship labels and connection density, instead of fixed 360px rows.
- [x] Wrapped labels, reserved text footprints, and obstacle-aware rounded orthogonal routes shared by canvas and exports.
- [x] Curved directional connections that follow moving nodes.
- [x] Four reusable connection ports; multiple incoming/outgoing paths and endpoint reconnection.
- [x] Connection-side metadata preserved in saved v2 documents and SVG exports.
- [x] Click-to-read concept details and navigation through connected concepts.
- [x] Editable concepts, icons and relationships; add/remove concepts.
- [x] Refined header, collapsible/searchable concept sidebar and detail inspector.
- [x] Prompt-to-graph generation via local Claude and Codex CLIs.
- [x] Follow-up generation using the current graph and selected concept.
- [x] Preserve existing node positions through graph expansions.
- [x] Model presets, custom model IDs and supported effort settings.
- [x] Economical defaults, per-agent saved preferences and no silent model upgrade.
- [x] Validated agent output, bounded execution and failure handling that preserves the board.
- [x] No-call email demo, including a delivery-failure branch.
- [x] SQLite-backed named boards, browser recovery snapshots and JSON import/export.
- [x] Dedicated board manager: create empty named boards, search, rename and confirm permanent deletion. Revision checks and deletion tombstones prevent stale-tab resurrection.
- [x] Minimal grouped sidebar: board actions, five recent boards, current concepts and collapsed examples.
- [x] Transactional drags, no-op history protection, persistent undo/redo and Ctrl/Cmd+Z, Shift+Z and Y shortcuts.
- [x] SVG, PNG and Markdown exports; persistent undo/redo.
- [x] Server-side follow-up change detection and explicit apply/discard review.
- [x] One invalid-output repair attempt on the same model within a shared deadline.
- [x] Model-generated suggestions and per-node uncertainty/simplification caveats.
- [x] Elapsed generation time and coarse stage feedback.
- [x] Guided concept walkthrough with branch/cycle handling.
- [x] Legacy OSG JSON import with flattening warnings and source preservation.
- [x] Separate history, generation and persistence hooks plus sidebar component.
- [x] Cached/deduplicated agent readiness probes (30 seconds).
- [x] Portable harness supervision tests using the running Node executable, not `/usr/bin/node`.
- [x] Shared schema, API/harness and workspace unit tests; direct browser interaction checks.
- [x] Legacy OSG JSON import retained; retired pipeline tables remain untouched in existing databases.
- [x] Accounts, board ownership, read-only public boards and revocable local agent keys.
- [x] External agent canvas editing over MCP, sharing the board API and undo history.

## Completed: persistence and recovery — P0

- [x] Add a separate v2 SQLite table and revision-checked create/load/update endpoints.
- [x] Add a named-board library: create, rename and reopen; separate-copy recovery on conflicts.
- [x] Board search and confirmed deletion.
- [x] Routine private duplicate and reversible archive/unarchive actions, with revision checks.
- [x] Import the existing browser board without deleting its source; show successful database save status.
- [x] Add save-state/error feedback, retry behavior and per-tab recovery after interruption.
- [x] Add transactional, versioned database migrations, manual full-database backup/restore and documented retention behavior.
- [x] Persist bounded undo/redo history, with explicit restore actions.
- [x] Add an owner-only, paginated long-term revision archive with previews and restore-as-private-copy.

Acceptance: several boards survive API/browser restarts; edits and connection ports round-trip exactly; migration and backup/restore have automated tests. Browser storage must not be the only copy after a successful migration.

Verified 2026-10-04: 321 unit/API/schema tests, 24 Rust tests, native race tests,
lint/type checks, 29 browser scenarios against each API host, database-import/MCP
integration, 19 hidden Wayland checks, and both packaged and development backup/
restore commands. Persistence regression tests cover legacy migration and rollback,
future-version refusal, live WAL snapshots, preserved ownership/templates/tombstones,
private revision access, archive across reload, pagination beyond 40 undo states,
and copy restoration without modifying the source. See [persistence documentation](docs/PERSISTENCE.md).

Limits: revision history starts with the state present at migration; older discarded
saves cannot be reconstructed. Revisions remain until board deletion and can grow
storage use. Full backups are manual, include credential records, and restore into a
new destination without merging. There is no scheduled backup/pruning or new
Windows/macOS runtime validation in this delivery.

## Completed: model management and usage — P1

- [x] Dedicated settings page for agents, executable paths, model presets and default effort.
- [x] Add/edit/remove named model profiles without editing source code.
- [x] Show supported model/effort combinations and clear CLI/account diagnostics.
- [x] Display actual usage when reported by the provider; distinguish unavailable usage from zero.
- [x] Add explicit request/output limits where supported and warnings before expensive choices.
- [x] Optional task-based model suggestions, always requiring consent for an upgrade.

Acceptance: defaults remain inexpensive; each request shows its selected agent/model/effort; unavailable configurations fail clearly; usage estimates are never presented as actual billing.

## Completed: canvas and explanations — P1

- [x] More discoverable connection/reconnection affordances and keyboard-accessible connection editing.
- [x] Route common chains, branching bypasses and returns around node/text footprints and separate edge labels from arrows.
- [x] Further optimize crossings and routing performance for very dense or overlapping hand-arranged graphs.
- [x] Better initial framing and readable labels across small screens and large graphs.
- [x] Named branch conditions, clearer decision nodes and optional edge descriptions.
- [x] Searchable icon picker with broader categories; evaluate safe custom SVG import.
- [x] Preview changes/removals to existing content before applying agent revisions.
- [x] Let users pin positions and selectively accept generated changes.
- [x] Stronger visual hierarchy and spacing in the composer, settings and sidebars.

Acceptance: a branching process remains understandable at normal zoom; manual layout survives follow-ups; users can inspect and reject destructive graph edits.

Verified 2026-10-04: all integration gates pass (lint, typecheck, Rust checks and
24 tests, 332 unit/API/schema tests, Go vet/race tests), plus 34 browser scenarios
against each API host, packaged database-import/MCP integration and 22 hidden
Wayland WebView checks. New coverage verifies profile persistence/edit/removal,
invalid executable diagnostics without a model call, measured-zero versus missing
usage, consent before changing model/effort, keyboard endpoint/port editing,
branch metadata across reload, pins and selective acceptance as one undo action.
Mobile settings pass overflow/accessibility checks. Existing icon search/category
coverage passes on both hosts.

Dense irregular 50-node/100-edge routing benchmark on the development machine:
about 1,122 ms before versus 724 ms after; cached geometry returned below the
benchmark's 1 ms display precision. This is one fixture, not a universal latency
guarantee. Regression coverage includes dense and overlapping layouts.

Limits: profiles/defaults and the last 100 usage records are device/origin
localStorage preferences, shared across accounts in that browser profile, not
SQLite records or part of database backups. Usage is only what the CLI reports;
cost is explicitly labeled a CLI estimate, never billing. No paid provider calls
were made during verification. CLI account entitlement/quota remain unverified by
the no-call check. Output-token caps are unavailable in these CLI integrations;
request character limits and Claude budgets per attempt are enforced where
supported. Raw SVG import was evaluated and deferred in favor of the existing
validated declarative icon format. Windows/macOS packaging, new providers,
API-key/fallback settings and pricing-based cost projections remain separate work.
See [model and canvas controls](docs/P1-CONTROLS.md).

## Future features — P2

- [ ] Nested, collapsible subgraphs with optional group boundaries (no mandatory frames around individual icons).
- [x] Overview, selected-concept detail and a step-by-step walkthrough.
- [ ] Incrementally stream validated nodes instead of waiting for the complete graph.
- [ ] Reusable process templates and a richer no-call example library.
- [ ] Attach notes, references and source links to concepts.
- [ ] Document/text import with source attribution and a review step.
- [ ] Board comparison and version-history browsing.
- [x] Read-only public boards for signed-in users, with ownership controls and save-a-copy editing.
- [ ] Optional collaboration/sync after durable local persistence is reliable.

## Quality and release readiness

- [x] Default QA gate now covers v2 saved boards/history, generation review, branching/dragging, exports and walkthrough.
- [x] Add automated accessibility and mobile-overflow checks for the new workspace.
- [ ] Expand browser coverage for reconnection, legacy imports, network loss and visual screenshot baselines.
- [ ] Test larger graphs, long-running generation, cancellation and malformed responses.
- [ ] Reduce initial bundle cost and investigate the ELK chunk warning.
- [ ] Verify clean-clone installation, native SQLite setup and supported CLI versions in CI.
- [x] Define and test explicit OSG JSON import; keep source records unchanged.
- [ ] Add bulk legacy-database migration and richer primitive/geometry mapping.
- [x] Add account authentication and board authorization.
- [ ] Review deployment hardening before supporting non-loopback hosting.

## Maintenance rules

- Mark an item implemented only after its user-facing behavior and persistence implications are verified.
- Keep README capabilities aligned with this checklist; distinguish legacy functionality from v2 functionality.
- Record relevant tests and limitations when closing a goal.
- New features should improve visual understanding, control or durability. Avoid introducing 3D work into the current 2D roadmap.

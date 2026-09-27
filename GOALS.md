# Opsis goals

Last reviewed: 2026-09-27.

## Product goal

Make agents useful as visual hands: convert a question or explanation into an understandable, editable 2D graph, with richer information available on selection. Preserve the user's spatial arrangement as the conversation and process branch.

The current experience is close to the intended visual direction. This checklist tracks shipped behavior and remaining work; perceived design completeness is not a claim of production readiness. Unchecked items below are planned, not implemented.

## Implemented

- [x] 2D blueprint canvas as the primary application, without a 3D toggle.
- [x] Frameless icons from a shared icon library, with short labels.
- [x] Pan, zoom, fit-to-view, and manual node movement.
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
- [x] Current-board browser autosave and JSON import/export.
- [x] SVG export and session undo/redo.
- [x] Shared schema, API/harness and workspace unit tests; direct browser interaction checks.
- [x] Legacy SQLite storage retained for OSG documents, cache, explanations and share tokens.

## Next: persistence and recovery — P0

- [ ] Add a versioned SQLite schema and CRUD endpoints for **v2 boards**.
- [ ] Add a named-board library: create, rename, duplicate, search, archive and reopen.
- [ ] Import the existing browser board without overwriting it; confirm the database write before marking migration complete.
- [ ] Add save-state/error feedback, retry behavior and recovery after interruption.
- [ ] Add database migrations, backup/restore and documented retention behavior.
- [ ] Persist useful revision history, with explicit restore actions.

Acceptance: several boards survive API/browser restarts; edits and connection ports round-trip exactly; migration and backup/restore have automated tests. Browser storage must not be the only copy after a successful migration.

## Improve: model management and usage — P1

- [ ] Dedicated settings page for agents, executable paths, model presets and default effort.
- [ ] Add/edit/remove named model profiles without editing source code.
- [ ] Show supported model/effort combinations and clear CLI/account diagnostics.
- [ ] Display actual usage when reported by the provider; distinguish unavailable usage from zero.
- [ ] Add explicit request/output limits where supported and warnings before expensive choices.
- [ ] Optional task-based model suggestions, always requiring consent for an upgrade.

Acceptance: defaults remain inexpensive; each request shows its selected agent/model/effort; unavailable configurations fail clearly; usage estimates are never presented as actual billing.

## Improve: canvas and explanations — P1

- [ ] More discoverable connection/reconnection affordances and keyboard-accessible connection editing.
- [ ] Reduce crossing arrows and label overlap in dense, branching and cyclic graphs.
- [ ] Better initial framing and readable labels across small screens and large graphs.
- [ ] Named branch conditions, clearer decision nodes and optional edge descriptions.
- [ ] Searchable icon picker with broader categories; evaluate safe custom SVG import.
- [ ] Preview agent changes as additions/removals before applying large revisions.
- [ ] Let users pin positions and selectively accept generated changes.
- [ ] Stronger visual hierarchy and spacing in the composer, settings and sidebars.

Acceptance: a branching process remains understandable at normal zoom; manual layout survives follow-ups; users can inspect and reject destructive graph edits.

## Future features — P2

- [ ] Nested, collapsible subgraphs with optional group boundaries (no mandatory frames around individual icons).
- [ ] Multiple views of the same explanation: overview, detail and step-by-step walkthrough.
- [ ] Reusable process templates and a richer no-call example library.
- [ ] Attach notes, references and source links to concepts.
- [ ] Document/text import with source attribution and a review step.
- [ ] Board comparison and version-history browsing.
- [ ] Read-only v2 sharing after access controls and data-exposure rules are designed.
- [ ] Optional collaboration/sync after durable local persistence is reliable.

## Quality and release readiness

- [ ] Replace legacy browser scenarios with v2 generation, editing, branching, reconnect, import/export and recovery coverage.
- [ ] Add automated accessibility and responsive-layout regression checks for the new workspace.
- [ ] Test larger graphs, long-running generation, cancellation and malformed responses.
- [ ] Reduce initial bundle cost and investigate the ELK chunk warning.
- [ ] Verify clean-clone installation, native SQLite setup and supported CLI versions in CI.
- [ ] Define an OSG-to-v2 migration strategy or explicitly retire legacy formats.
- [ ] Add authentication/authorization before any non-loopback deployment.

## Maintenance rules

- Mark an item implemented only after its user-facing behavior and persistence implications are verified.
- Keep README capabilities aligned with this checklist; distinguish legacy functionality from v2 functionality.
- Record relevant tests and limitations when closing a goal.
- New features should improve visual understanding, control or durability. Avoid introducing 3D work into the current 2D roadmap.

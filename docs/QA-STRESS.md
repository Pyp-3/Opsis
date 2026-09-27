# Workspace stress audit — 2026-09-27

This audit exercises the current 2D workspace. It is not a claim that every possible graph or browser state is bug-free. Browser automation is headless; test APIs use isolated in-memory SQLite databases, not the user's saved boards.

## Reproduced bugs and fixes

- A no-op edit consumed an undo step and destroyed redo. Equivalent commits now preserve both stacks.
- Drag previews were treated as durable board state. A gesture now has a committed starting snapshot, transient previews, and one final undoable commit. Cancelling a gesture discards its preview.
- Small drags could send an arrow through a neighboring object. Actual object intersections now outrank label/spacing preferences, and side-exit stubs respect nearby objects. Topology-based routing order avoids reshuffling all lanes for a one-pixel distance change.
- Crowded paths could silently lose their labels. A dotted external callout is the fallback when adjacent label placement cannot fit.
- Cancelling generation could change the same DOM button into a submit button during its click and start another request. Separate button identities and prevented default submission stop this extra call.
- Clicking a connection label could hit the canvas instead. Labels now explicitly accept pointer events.
- Imported boards with missing positions had invisible/unrouted connections. Missing positions are laid out while retaining supplied positions.

## Automated coverage

| Area            | Checks                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History         | 100 preview updates as one gesture; 30 undo/redo cycles; 120 edits and the 40-state limit; no-op preservation; cancellation; serialized recovery; board replacement |
| Geometry        | 96 individual node perturbations across email, DNS and a real Opus-generated graph; endpoints, finite paths, labels and object/text clearance                       |
| Density         | 50 nodes, 100 connections, responses and self-loops; all routes and labels retained; input graph unchanged                                                          |
| Board library   | Empty named creation, validation, rename history, reload/restart, revision conflicts, confirmed deletion, cancelled deletion, stale-write resurrection prevention   |
| Editing         | Node label/icon edits, deletion/undo, relationship edits, connection type changes, connection deletion, branching and endpoint attachment during/after drag         |
| Browser history | Repeated gestures, autosave debounce while dragging, toolbar undo/redo, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, arrangement and reload                                        |
| Model settings  | Preset and effort persistence; Haiku effort disabled; no automatic model upgrade; existing unit tests for custom choices                                            |
| Generation      | Apply/discard review, invalid output repair, service errors, late-result cancellation, selected-node validation, agent readiness caching                            |
| Portability     | JSON export/import, SVG, PNG and Markdown downloads; invalid/oversized imports; legacy OSG migration                                                                |
| Learning/UI     | Walkthrough, suggestions, confidence annotations, empty-board handling, accessibility scan, mobile layout and board-manager overflow                                |

Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:qa`. The default suite makes no paid model calls. Browser failures retain screenshots/traces under ignored test-output directories.

Audit result: lint, typecheck and production build passed; all 662 unit/API tests passed; all 10 headless browser scenarios passed, followed by 30/30 passes with `pnpm exec playwright test --repeat-each=3`.

## Real Claude Opus check

Two application requests were made using the local Claude CLI with model `opus` and medium effort:

1. Parcel-delivery explanation: HTTP 200, 5 nodes, 8 connections, including a response.
2. Add a delivery-failure/retry path: HTTP 200, 6 nodes, 10 connections; all existing nodes and edges preserved exactly.

Exactly two CLI completions were used; no repair call was needed. Actual provider token/quota consumption is not exposed by the current adapter. No further paid calls were used for repeated stress tests. The follow-up graph is preserved as the non-private fixture `fixtures/boards/opus-parcel.json`.

The opt-in script `scripts/live-opus-smoke.ts` permits at most three completions, including repairs, and never runs in normal tests/CI. Its JSON report is ignored under `apps/api/output/qa/`.

## Limits still worth tracking

- Deliberately overlapping objects, highly dense graphs and non-planar graphs may require manual adjustment or **Arrange downward**. Crossings and external callouts are not a promise of a crossing-free drawing.
- The 50-node/100-edge routing case completed in roughly 0.6 seconds locally after candidate pruning, versus roughly 4.6 seconds before it. This is a local observation, not a portable performance guarantee or a 60fps claim at the maximum graph size.
- No new paid Codex call, cross-device sync, archive/restore UI, pixel-baseline suite, browser-engine matrix or unlimited history was tested or added here.
- Generation correctness remains model-dependent. Two successful Opus cases cannot establish correctness for all subject matter.
- Production builds still warn about large JavaScript chunks, especially the lazily loaded layout engine.

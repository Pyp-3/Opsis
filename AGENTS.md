# Working on Opsis

Opsis is a local-first React canvas application with a Fastify API, an MCP server,
shared TypeScript contracts, and a deterministic Rust/WASM process engine.
This file is the authoritative development guide for all coding agents.

## Find the owner before changing behavior

- `apps/web/src/App.tsx` owns the session shell; `workspace/` owns the current
  canvas, board library, playback, import/export, and account pages.
- `apps/api/src/` owns authentication, persistence, board generation, and speech.
  Only `harness/` may launch runtime child processes.
- `apps/mcp/src/` adapts agent tools to the same board API and edit history.
- `packages/schema/` owns contracts and pure shared board rules. It must not
  import another Opsis package or application. Search here before duplicating a rule.
- `packages/engine/` owns bounded synthetic calculations, never shell execution,
  filesystem reads, or network access from the calculation core.
- Legacy OSG JSON remains an import format, not a second application or pipeline.
  `PLAN.md`, `PROMPT.md`, and old handoffs describe historical designs; follow
  current code, tests, README, and this guide for present behavior.

## Write for the next reader

Use descriptive domain names, explicit inputs and outputs, and small, cohesive
functions. Group related behavior in feature modules. Extract a module when its
responsibility is independently understandable, not to satisfy a line-count target.
Prefer pure functions for transformations and keep side effects at clear boundaries.
Do not introduce generic utility folders, forwarding layers, or class hierarchies
without concrete reuse. Declarative catalogues can stay together.

Before adding code, search for an existing implementation and its callers. Shared
board mutations belong in the schema package; placement policies may legitimately
differ between the interactive canvas and MCP. Do not merge merely similar behavior
unless its contracts agree. Preserve useful comments explaining reasons and invariants.
See `docs/REFACTORING.md` for the principles and retirement record.

## Contracts and invariants

- Preserve board document v2, process contract v3, active HTTP/NDJSON responses,
  MCP tools, and the WASM entrypoint unless a requested change explicitly revises them.
- Preserve private ownership, read-only public viewing, account-scoped recovery,
  local-only agent keys, and revocation. Never log credentials or tokens.
- Saves use revisions; conflicts retain unrelated changes and recover unsaved work.
  Keep save ordering, stale-response guards, deletion tombstones, and paused polling.
- Board history is bounded to 40 entries. A drag or MCP edit is one undoable action;
  normal edits clear redo. Keep proposal review before applying agent changes.
- Keep explicit model choices, bounded generation and one invalid-output repair;
  never silently upgrade models or retry authentication/process failures.
- Drawings are validated declarative data. Process samples are synthetic, never
  executable commands. Preserve cancellation, deadlines, and attachment boundaries.
- Database changes must preserve existing data. Never delete a database or drop
  historical tables as incidental cleanup.
- Rust source moves must participate in the build cache fingerprint. Keep source
  order, text terminators, provenance, limits, and failure propagation deterministic.

## Verify the behavior you changed

Run targeted tests during development. Add regression tests for confirmed bugs and
for important behavior not protected before a risky extraction. Avoid tests that
only mirror private implementation details. Do not weaken assertions to make a
refactor pass. Remove tests only with explicitly retired behavior.

Final integration checks:

```sh
pnpm lint
pnpm typecheck
pnpm engine:check
pnpm engine:test
pnpm test:qa
```

Browser coverage lives in `tests/workspace/`. It runs isolated servers and an
in-memory database with speech disabled; use demo/fake agents without paid model
calls. Do not run live-provider smoke scripts without explicit authorization.

## Coordinate and deliver

For multi-agent work, assign disjoint files and communicate shared interfaces before
consumers change. One coordinator owns manifests, lockfile, shared contracts, final
integration, and commits. Workers report files changed, behavior preserved, tests,
and unresolved findings; they do not overwrite another worker's changes.

Keep structural refactors, intentional removals, and behavior fixes in separate,
reviewable commits where possible. Inspect the complete staged diff. Never commit
credentials, local databases, generated WASM/build output, recordings, or test
artifacts. Preserve existing user changes and commits. Report actual validation
results and limitations. The user's standing delivery preference is to commit and
push completed, validated work using a normal non-force push, so CI/CD runs for
each delivery. Do not ask again for routine commits and pushes. Honor an explicit
request to keep a particular task local; never include unrelated user changes.

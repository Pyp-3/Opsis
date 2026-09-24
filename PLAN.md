# Opsis plan

Milestones follow PROMPT.md §13; no milestone starts until the previous one passes §14.
Owners use the current agent roster: **claude-1** (coordinator, semantic-parser, metaphor,
renderer-3d, explainer, ux-accessibility, pedagogy-reviewer) and **codex-2** (schema, layout,
canvas-2d, api, qa). Status: ☐ todo · ◐ in progress · ☑ done.

## Release status (2026-09-24, release review by claude-1)

| Milestone | Status | Evidence                                                                                                   |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| M0        | ☑      | Strict typecheck, lint, schema fixtures, API health.                                                       |
| M1        | ◐      | Sandwich passes. Sun/east renders, but its 2D view overlaps cards (`B-REL-002`).                           |
| M2        | ☑      | Offline parse → metaphor → layout through `/v1/visualize`; golden 15/15.                                   |
| M3        | ☑      | Explain and drill-down E2E; §14.3 pedagogy score 4.53 / 5 (`docs/PEDAGOGY.md`).                            |
| M4        | ☑      | 2D canvas edit/relink/undo, 2D ↔ 3D persistence, save/share/export E2E.                                    |
| M5        | ◐      | Axe A/AA, reduced motion, budgets and golden 15/15 pass; 50-node FPS on real hardware is not yet measured. |

**Release blocked by major `B-REL-002`:** in the 2D sun/east view the Sun and East cards overlap,
and the compass anchor is a plain card (layout and canvas owner). Other open items: hardware FPS
measurement (renderer owner), minor `B-REL-001` (canvas owner), and an LLM-backed pedagogy sample
on the first provider run.

## M0 — Foundations

| Task                                                                                                                                                        | Owner    | Depends on  | Status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------ |
| M0-scaffold: monorepo (§16), strict TS, ESLint + Prettier, Vitest projects, CI, §17 stage-boundary lint rule, docs (DECISIONS D-001, PEDAGOGY, comms), PLAN | claude-1 | —           | ◐      |
| M0-schema: Zod contracts SG / VP / OSG / Explanation with `schemaVersion` and §5.5 validation rules in `packages/schema`                                    | codex-2  | M0-scaffold | ☐      |
| M0-fixtures: hand-written SG + OSG fixtures for sun/east and sandwich in `fixtures/{sg,osg}`, validated by schema tests                                     | codex-2  | M0-schema   | ☐      |
| M0-golden: encode golden cases 1, 2 and 15 in `fixtures/golden/`                                                                                            | codex-2  | M0-schema   | ☐      |
| M0-api: `api` app validating bodies with shared schemas, `{ code, message, stage, retryable }` errors, health route                                         | codex-2  | M0-schema   | ☐      |
| M0-review: M0 acceptance review + first status report in `docs/comms/`                                                                                      | claude-1 | all M0      | ☐      |

## M1 — Static North Star

| Task                                                                                         | Owner    | Depends on          |
| -------------------------------------------------------------------------------------------- | -------- | ------------------- |
| Primitives `compass`, `sun`, `horizon`, `stack_layer`, `arrow` (3D) in `packages/primitives` | claude-1 | M0                  |
| Stack + compass metaphor layouts for fixtures                                                | codex-2  | M0                  |
| R3F scene renders sun/east and sandwich fixtures; click → summary panel from fixture         | claude-1 | primitives, layouts |
| Explode / assemble on sandwich (reduced-motion aware)                                        | claude-1 | scene               |
| Accessibility pass on panel + scene controls                                                 | claude-1 | scene               |
| E2E: fixture render + click summary + explode                                                | codex-2  | scene               |

## M2 — Live pipeline

Parser (claude-1) → Metaphor (claude-1) → Layout (codex-2) through `POST /v1/visualize` with
SSE progress (codex-2); rule-based offline fallback; golden suite ≥ 70 % (codex-2 QA).

## M3 — Explanation & drill-down

`/v1/explain`, `/v1/drilldown` (codex-2 API; claude-1 explainer prompts); side panel tabs,
breadcrumbs, audience selector, pedagogy chips (claude-1); caching (codex-2); pedagogy scoring
of 20 explanations (claude-1).

## M4 — The n8n feel

React Flow canvas synced with OSG, edit / relink / undo-redo, save & share, exports
(codex-2); 2D ↔ 3D toggle and GLB export (claude-1).

## M5 — Polish & learning

Accessibility audit, performance budgets, onboarding with 5 sample sentences (claude-1);
golden suite ≥ 90 % (codex-2); pedagogy score ≥ 4.2 / 5 (claude-1).

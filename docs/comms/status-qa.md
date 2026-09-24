---
type: status
agent: qa-agent
milestone: M0-M5
---

## Done

- Added one-command QA execution: `pnpm test:qa` builds the workspace, runs unit/golden/schema-fuzz tests, then E2E, accessibility, visual, and performance checks.
- Exercised all five §14.4 flows against the real offline API, including keyboard-only and reduced-motion runs.
- Added axe WCAG A/AA integration coverage and three North Star visual baselines: sun/east, sandwich assembled, and sandwich exploded.
- Fuzzed five shared boundary schemas with 2,500 arbitrary values and rejected 500 deterministic OSG corruptions.
- Measured bundle, cached response, and a 50-node frame sample. The hardware FPS gate skips with its renderer and observed result attached when Chromium uses software rendering.
- Ran the complete offline golden pipeline: **11/15 (73.3%)**. No `OPSIS_LLM_API_KEY` / model configuration was present, so an LLM golden run was not available.
- Final verification: **483/483 unit/integration tests passed** across 38 files; browser suite **9 passed, 1 hardware-only FPS check skipped**; initial entry bundle was **71.30 KiB gzipped**; lint, formatting, strict typecheck, production builds, and `git diff --check` passed.

## Milestone gate

| Milestone | Result                         | §13 / §14 evidence                                                                                                                                                                                                                                     |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0        | **PASS**                       | Strict typecheck, ESLint/Prettier, build, shared-schema validation, fixtures, API health, and root unit suite pass.                                                                                                                                    |
| M1        | **PASS**                       | Both North Star scenes render; summary and explode flows pass; three visual baselines are checked in.                                                                                                                                                  |
| M2        | **PASS**                       | Real offline parser → metaphor → layout → API path passes **11/15 (73.3%)**, above the required 70%; SSE/API tests pass.                                                                                                                               |
| M3        | **VETO — review gate pending** | Explain-more and drill-down/breadcrumb E2E pass, but §14.3's 20-explanation pedagogy score is reserved for reviewer `claude-1` and is not yet recorded.                                                                                                |
| M4        | **PASS**                       | Browser E2E confirms relabel → 3D → save → reload persistence; canvas unit tests cover edit/relink/history/export.                                                                                                                                     |
| M5        | **VETO**                       | Axe WCAG A/AA, reduced motion, onboarding, cached <300 ms, and initial bundle <400 KiB pass. Golden is 73.3% versus the 90% target (`B-QA-001`); pedagogy score is pending; hardware FPS remains unverified because this run used a software renderer. |

## In progress

- Reviewer `claude-1`: score 20 explanations under §14.3 and add the result to this gate.
- Renderer owner: rerun the 50-node performance check on a hardware-accelerated mid-range laptop and phone-class target.

## Blocked by

- M3/M5 pedagogy gates: reviewer sample is not yet available.
- M5 golden target: `B-QA-001` (semantic parser coverage).
- M5 frame-rate claim: CI Chromium exposes a software renderer, so the hardware-specific threshold is intentionally not asserted there.

## Next

1. Semantic parser owner fixes the four structural golden gaps and raises offline results to at least 14/15.
2. Pedagogy reviewer records the required 20-explanation score and files any accuracy score of 1–2 as a major bug.
3. Renderer owner records hardware FPS at 50 nodes; ≥30 fps is required on the phone-class target and 60 fps on the laptop target.

## Risks

- Visual baselines include WebGL output and may need platform-specific approval when the CI renderer changes.
- A green CI run means all automatable gates passed; it does not override the explicit M3/M5 vetoes above.

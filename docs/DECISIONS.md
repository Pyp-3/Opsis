# Decision Records

Format: PROMPT.md §8.5. Append new records at the end; never rewrite an accepted record —
supersede it with a new one.

## D-001: Monorepo scaffold and tooling choices

- Date: 2026-09-23
- Author: claude-1 (coordinator)
- Context: M0 requires the §16 layout, CI, lint and empty web/api apps. Several details are not
  fixed by PROMPT.md: package naming, how workspace packages are consumed, the Vitest workspace
  mechanism, how the §17 stage boundary is enforced, and local dev ports.
- Options considered:
  1. Build every package to `dist/` with project references (`tsc -b`) vs. consuming TypeScript
     source directly through `exports: { ".": "./src/index.ts" }`.
  2. Legacy `vitest.workspace.ts` vs. `test.projects` in the root `vitest.config.ts` (the
     replacement in Vitest ≥ 3.2; `vitest.workspace` is deprecated).
  3. Stage boundary via `eslint-plugin-boundaries` / `eslint-plugin-import` vs. core ESLint
     `no-restricted-imports` with per-stage overrides.
  4. Scoped app names (`@opsis/web`) vs. bare `web` / `api` so `pnpm --filter api dev` works
     exactly as written in the M0 ticket.
- Decision:
  - pnpm 10 workspaces (`apps/*`, `packages/*`, `packages/pipeline/*`), pinned via
    `packageManager` for Corepack. Node ≥ 20.19 (CI uses Node 22).
  - Libraries are named `@opsis/<name>` (`@opsis/schema`, `@opsis/parse`, `@opsis/metaphor`,
    `@opsis/layout`, `@opsis/explain`, `@opsis/primitives`, `@opsis/ui`) and are source-only:
    no build step; Vite, tsx and Vitest compile them on the fly. Apps are named `web` and `api`.
  - `tsconfig.base.json` is strict (`strict`, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `moduleResolution: Bundler`.
    Each package runs `tsc --noEmit`; `apps/api` additionally emits with NodeNext for `build`.
  - Vitest 3 `test.projects` (one project per package + `tests/lint`); `pnpm test` runs all.
  - ESLint 9 flat config + typescript-eslint + react-hooks; Prettier checked in `pnpm lint`.
  - §17 is enforced with core `no-restricted-imports` regex patterns generated from the stage
    order `parse → metaphor → layout → explain`, covering both `@opsis/<stage>` specifiers and
    relative paths that escape into a sibling stage. `packages/schema` may not import any other
    Opsis package. `tests/lint/stage-boundaries.test.ts` proves the rule fires.
  - Dev servers bind to loopback: web on `127.0.0.1:3000` (Vite, proxies `/v1` → API), api on
    `127.0.0.1:8000` (override with `HOST`/`PORT`).
- Consequences:
  - No stale `dist/` between packages; if a package is later published or needs a build it
    gets its own `build` script and a follow-up record.
  - Adding a pipeline stage means updating `STAGES` in `eslint.config.js`.
  - The rule is an ESLint rule, not a type-level guarantee; CI blocks on lint so it is still
    enforced on every change.
  - Deviation from §16: `tests/lint/` was added beside `tests/{e2e,visual,perf}` to hold tests
    for repository-wide lint rules.

## D-002: Parser confidence, fallback flag and prompt loading

- Date: 2026-09-24
- Author: claude-1 (semantic-parser)
- Context: §15 requires prompts to use `"confidence": "low"` instead of inventing facts, and the
  fallback result to be flagged, but `sg/1` is strict and has no `confidence` or flag field.
- Decision:
  - Low confidence is recorded per entity as `attributes.confidence = "low"`. An unparseable
    sentence becomes one `abstract_concept` entity with low confidence plus an `ambiguity` note.
  - The flag lives on the stage result, not in the SG: `parseUtterance` returns
    `{ sg, source: 'llm' | 'llm_repaired' | 'rule_fallback', flagged, fallbackReason, diagnostics }`.
  - LLM output must echo the utterance exactly and keep spans inside it; failures go into the
    single repair prompt.
  - Prompt templates are versioned files in `packages/pipeline/parse/prompts/` (`*.v1.md`,
    `examples.v1.json`), read at runtime with `node:fs`. `@opsis/parse` is therefore server-only.
  - `LLMClient` config comes from `OPSIS_LLM_PROVIDER`, `OPSIS_LLM_MODEL`, `OPSIS_LLM_API_KEY`
    and `OPSIS_LLM_BASE_URL`. Without a key and model, the pipeline runs offline on the rule parser.
- Consequences:
  - Metaphor/UI stages show the "unsure" indicator when any entity has `confidence: "low"`.
  - The API should surface `flagged`/`source` (e.g. a response header or OSG metadata) once the
    OSG contract has a place for it; bumping to `sg/2` is an alternative for later.

## D-003: Metaphor selector rule interpretations and React-free primitive catalog

- Date: 2026-09-24
- Author: claude-1 (metaphor-agent, renderer-3d)
- Context: §10.1 is implemented in `packages/pipeline/metaphor`. A few rules need an exact reading,
  and the stage must match entities to primitives on the server without importing React.
- Options considered: import `@opsis/primitives` whole (pulls React/three into the API); copy the
  keyword list into the pipeline (two sources of truth); split the registry into pure metadata
  plus renderers.
- Decision:
  - `packages/primitives` now has a React-free `catalog.ts` (metadata, keywords, anchors) and
    `meta.ts` types; `registry.ts` attaches renderers to it. Pipeline code imports only
    `@opsis/primitives/match` (catalog, matcher, anchors). Fuzzy spelling matches need words of
    ≥ 5 letters, and `action` entities need a ≥ 0.9 keyword score, so "seat"/"cake"/"drain" are
    not drawn as meat/lake/raindrop.
  - Rule 4 "≥ 3 `precedes` relations forming a path" is read as a `precedes` path of ≥ 3 steps
    (≥ 2 relations): golden case 10 ("boil, then add, then drain") has three steps and must be a
    timeline. Mostly action/event/time steps ⇒ `timeline`, otherwise `flow`.
  - Rule 2 "layered": at least half the parts are food/layer primitives or layer words (crust,
    mantle, troposphere…), unless the whole is itself a vessel (`box`, `bowl`, `cell`) ⇒ container.
  - Rules 2–5 ignore `negated` relations. Metaphors drawn by the scene get synthetic anchors
    (`v_compass`, `v_cycle`, `v_timeline`, `v_scale`); a compass bearing is a `line` edge from the
    compass to the direction entity, whose label names the anchor (matches the renderer).
  - The LLM is asked once, only for entities with no or tied keyword match and for rule-8 anchor
    ties; every answer is checked against the registry and the asked candidates, and any failure
    keeps the deterministic rule result.
- Consequences: without an LLM the stage is a pure function of the SG. With one, output depends
  only on the validated reply, so callers should cache on the stage cache key.

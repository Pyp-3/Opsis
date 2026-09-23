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

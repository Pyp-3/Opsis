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

## D-004: 2D-first default view, curated 3D eligibility, and the CLI harness trust boundary

- Date: 2026-09-24
- Author: claude-1 (coordinator, architecture_policy)
- Context: Resolves PROMPT.md §19 open question 1 ("2D or 3D by default?"). Inputs: the baseline
  audit (M4 editor present; live 2D/3D arrowheads missing; `viewMode` hard-coded to `'3d'` in
  `apps/web/src/state/session.ts`), the oriented-flow grammar audit (left-to-right flow, clockwise
  cycles, deterministic reveal, a screen-space compass invariant), and the harness audit (Claude,
  Codex and Agy CLIs as `LLMClient` backends). Current facts: `vp/1` and `osg/1` scenes already
  carry `dimension: '2d' | '3d' | 'auto'`; §10.1 rules emit `'3d'` for compass, stack and container
  and `'auto'` for everything else; `createCacheKey(stage, input, config, modelId)` receives only
  `llm.model` (no provider) or `'offline'`; the layout key also includes the model although layout
  is deterministic.
- Options considered:
  1. §19 proposal: `'auto'` = 3D for concrete objects, 2D for abstract/process scenes, decided
     per request. Rejected as stated: "concrete" was undefined, and a model answer could flip it.
  2. 3D everywhere with a 2D toggle (current behaviour). Rejected: process, cycle and tree scenes
     read worse in 3D, the audit found no 3D arrowheads, and hardware FPS is unproven.
  3. 2D icon-oriented flow by default; 3D only for scenes that pass a deterministic, curated
     eligibility test. **Chosen.**
  4. Harness CLIs through a shell string (`exec`, `sh -c`) or by reading CLI credential files to
     call the HTTP APIs directly. Rejected: shell injection risk from utterances and model names,
     and Opsis would become a holder of third-party credentials.
- Decision:
  - **Default view.** A new diagram opens in 2D (the React Flow icon canvas using the audit's
    oriented-flow grammar). It opens in 3D only when every scene in the OSG has
    `dimension: '3d'`. `'2d'` and `'auto'` both resolve to 2D; `'auto'` stays in the enum for
    compatibility but no longer means "decide later". The learner can always toggle view; the
    toggle and preserved edit state (commit `124d94d`) are unchanged. A learner's explicit toggle
    within a session wins over the default for that diagram.
  - **Curated 3D eligibility.** The metaphor stage (stage 2) sets `dimension: '3d'` on a scene
    only if **all** of these hold, and `'2d'` otherwise:
    1. `metaphor ∈ {compass, stack, container}`. `flow`, `timeline`, `cycle`, `tree`, `scale`,
       `map` and `actor_action` are always 2D.
    2. Every non-anchor node whose primitive is not a synthetic scene anchor (`v_compass`, …) uses
       a primitive whose catalog `category ∉ {generic, flow, measure}` and whose `dimensions`
       include `'3d'`. So "a family contains parents and children" or any `generic_*` fallback
       stays 2D.
    3. No entity drawn in the scene has `attributes.confidence = "low"` and no node is a
       `rule_fallback` placeholder (`abstract_concept`).
    4. The scene has at most 12 nodes (the reveal-plan budget and the unproven 3D FPS gate).
    5. For `compass`, stage 2 consults a deterministic, versioned renderer-capability manifest in
       its configuration (initial capability id `compass-3d/v1`). That capability is `false` until
       the stage-4 invariant suite certifies the screen-space north-up/east-right invariant from the
       grammar audit: north is within 5° of screen-up, east is within 10° of screen-right, and
       the projected north vector is at least 24 px long. The suite checks initial fit, every sampled
       frame and permitted orbit limit, resize, explode, drill-down and breadcrumb back. An absent,
       unknown or uncertified capability id is `false`, so the scene emits `'2d'`.
       Stage 2's eligibility decision remains a pure function of the SG, primitive catalog, chosen
       metaphor and versioned capability manifest. The projection-based certification suite itself
       is **not** a stage-2 function: it exercises positioned layout, camera, viewport and renderer
       behaviour in stage 4. At runtime, stage 4 checks the same invariant after initial fitting, at
       sampled frames during camera movement, and after resize, explode, drill-down and breadcrumb
       back; any violation immediately fails closed to the 2D renderer for that diagram without
       mutating the OSG or asking an LLM. All five eligibility conditions are independent of a
       direct model answer: the LLM may influence which primitive an unknown entity gets (D-003,
       validated against the registry), but it never sets `dimension`, the capability flag or the
       runtime fallback. Eligibility is unit-tested per condition and snapshotted for all 15 golden
       cases; certification and runtime fallback have stage-4 integration tests.
  - **3D-only primitives.** `bowl`, `cell` and `hand` currently declare `dimensions: ['3d']`.
    2D-first requires each to gain a 2D icon before this record is fully implemented; until then
    the canvas shows its generic card with the primitive label (current behaviour).
  - **Harness trust boundary.** The Claude/Codex/Agy harness is one more `LLMClient`
    implementation, living only in `apps/api/src/harness/`. Pipeline packages keep depending on
    the `LLMClient` interface and must not import `node:child_process`; an ESLint
    `no-restricted-imports` rule restricts `node:child_process` to that directory, with a
    `tests/lint` case proving it fires.
    - _LLM stages only._ The client is passed to parse (1), metaphor (2) and explain/drill-down
      (5), exactly as today. `layoutVisualPlan` takes no client; a boundary test asserts it.
    - _No shell._ Processes start with `spawn(path, argv[], { shell: false })`. `exec`,
      `execSync`, `shell: true` and template-built command strings are forbidden. The prompt
      (system + user, including the utterance) goes only through stdin, never argv. The model name
      is the only config value placed in argv and must match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$`
      (so it cannot start with `-`). The JSON Schema goes inline (Claude) or into a file created
      with `mkdtemp` + mode `0600` (Codex, Agy) and removed after the call.
    - _No credential handling._ Opsis never opens, reads, copies, parses, logs or persists any
      CLI credential or config file (e.g. `~/.claude*`, `~/.codex/`, Agy config, keychains). The
      CLIs use their own authenticated sessions. The child gets an allowlisted environment
      (`HOME`, `LANG`, `TMPDIR`, and a fixed `PATH` of system directories); `OPSIS_LLM_API_KEY`
      and every other `OPSIS_*` variable are removed. Claude `--bare` is not used because it
      disables session auth. `cwd` is an empty private temp directory, so no repository context
      leaks in.
    - _Executables._ Selected with `OPSIS_LLM_PROVIDER=harness:claude|harness:codex|harness:agy`
      and an explicit `OPSIS_LLM_MODEL`; no default model. The binary path comes from
      `OPSIS_HARNESS_BIN` and must be absolute. There is no `PATH` lookup. At startup the API
      resolves `realpath`, checks it is a regular executable file not writable by group or
      others, runs `--version` (argv, 5 s deadline) and requires a version in the supported set
      (Claude 2.1.x, Codex 0.156.x, Agy 1.2.x initially). Failure disables the backend (offline
      mode) with a startup warning. It does not crash. `readLLMConfig` gains a harness branch that
      needs no API key.
    - _Invocation._ The argv sets in the harness audit, including the corrected Codex order
      `codex --ask-for-approval never exec - …`. Tools, slash commands, MCP servers, session
      persistence and sandbox writes are disabled.
    - _Supervision._ One `AbortSignal` per call. The deadline comes from
      `OPSIS_HARNESS_TIMEOUT_MS` (default 30 000); then `SIGTERM`, then `SIGKILL` after 2 000 ms.
      Caps: stdin 64 KiB, stdout 1 MiB, stderr 64 KiB, with kill on overflow. At most 2 concurrent
      harness processes. Stderr is never returned to clients; errors map to stable codes
      (`harness_timeout`, `harness_overflow`, `harness_exit`, `harness_malformed`,
      `harness_schema`). `temperature` and `maxOutputTokens` are reported as unsupported, not
      claimed.
    - _Output._ The final result is extracted from the envelope and handed back as raw text. The
      calling stage revalidates it with its existing Zod schema and applies its existing repair
      and fallback path. Sanitized envelope fixtures for each supported CLI version are required
      before a backend is enabled.
  - **Provider/model identity in cache keys.** `createCacheKey`'s fourth argument becomes an
    explicit identity string, built by one function in `apps/api`:
    - HTTP: `http:<provider>:<model>` (e.g. `http:anthropic:<model>`). Today's key lacks the
      provider.
    - Harness: `harness:<cli>:<model>:cli-<version>`, using the version found at startup.
    - Offline: `offline`.
      Each LLM stage's `config` also carries its prompt id(s) (`parse/v1`, …) so a prompt change
      invalidates old entries. The layout key uses `modelId = 'deterministic'`, because its inputs
      (SG, VP, seed) already capture model influence. Existing cache rows keyed by the bare model
      name are never hit again and age out. No data migration is needed.
  - **Deterministic offline fallback.** With no client, or after any provider failure
    (timeout, abort, overflow, non-zero exit, malformed envelope, missing result, schema rejection
    after the single repair), each stage returns its rule/fallback result. That result must be
    byte-identical to the result with `llm: null` for the same input and config. A stage result
    whose `source` is a fallback is cached **only** under the `offline` identity, never under the
    provider identity, so a transient failure cannot pin a degraded answer to a model key, and a
    later healthy call can still fill the provider key. Stage 2 counts as LLM-sourced only when a
    validated LLM answer changed at least one primitive or anchor choice. Otherwise its plan is
    the offline plan and is cached as `offline`. A test runs each golden case with a client that
    always fails and asserts equality with the offline output.
  - **Contracts.** `sg/1`, `vp/1` and `osg/1` remain **unchanged**. `dimension` already exists
    with the needed values. Only the values stage 2 emits change (`'2d'` instead of `'auto'` for
    ineligible scenes, `'2d'` instead of `'3d'` for ineligible compass/stack/container). Provider
    identity and `source`/`flagged` stay out of the documents: they belong to cache keys and API
    responses, not to shareable scene data. Stored OSGs with `'3d'` or `'auto'` stay valid and
    open with the new default rule. Nothing is rewritten.
- Consequences:
  - Golden VP/OSG snapshots change in their `dimension` values. This is a deliberate snapshot
    update and must be reviewed as such. It is not a contract change.
  - `session.ts` initial `viewMode` becomes derived from the loaded OSG instead of `'3d'`. The
    M1 North Star cases (sun/east, sandwich) need re-checking: sandwich (`stack` of food
    primitives) remains 3D; sun/east stays 2D until the compass invariant test passes.
  - Harness backends are dev/self-hosted conveniences. Their latency is measured separately and
    does not count toward the §13 uncached < 6 s target, which remains an HTTP-provider target.
  - **If a contract change later becomes unavoidable** (e.g. recording provenance or a per-scene
    view preference inside the OSG), it must: bump the literal (`osg/2`, etc.) in
    `packages/schema`; keep a read-only `osg/1` schema plus a pure, tested `upgradeOsg1To2`
    that API reads apply lazily to stored rows and share tokens; keep share links working;
    include `schemaVersion` in the cache-key `config` so versions never share entries; regenerate
    `json-schema.ts` prompt schemas and golden snapshots; and supersede this record with a new
    Decision Record.

## D-005: Release review — offline parser scope, curated cycles, and directed 2D edges

- Date: 2026-09-24
- Author: claude-1 (coordinator, semantic-parser, pedagogy-reviewer, ux-accessibility)
- Context: The release review found two open defects that block release under the assignment.
  (1) `B-QA-001` (major): the offline golden suite stood at 11/15, below the M5 target of 90 %.
  (2) The 2D canvas drew every edge without an arrowhead, in React Flow's default `#b1b1b7`
  stroke (about 2:1 on `ui.background`, below WCAG 1.4.11's 3:1). Animated edges were dashed, which
  clashes with the "dashed = optional" convention in PROMPT.md §10.2. In a 2D-first product
  (D-004), direction was carried only by position and the text outline.
- Options considered: (a) lower the M5 golden bar, or accept the flow defect as a known
  limitation; (b) ask the LLM path to cover the missing cases; (c) extend the deterministic rules
  and the canvas edge style. **(c) chosen**, because D-004 requires the offline fallback to stand
  on its own.
- Decision:
  - **Parser (`@opsis/parse`).** Three new offline patterns and one changed pattern:
    - a state-change chain ("X evaporates, forms Y, and falls as Z") → `precedes`;
    - an inputs → outputs pattern ("X uses A, B to make C, D") → `acts_on` for every input and
      `transforms_into` from matter inputs only;
    - a named process node, plus an adjective condition, in "X melts into Y when it gets warm";
    - a motion verb in subject–verb–object is now `moves` (was `agent_of`), matching
      `abilityRule` and `motionDirectionRule`.
      A chain closes into a `cycle` only when it matches a curated entry in `KNOWN_CYCLES`. Energy
      words never become `transforms_into` sources.
  - **Directed edges (stage 4, 2D).** `arrow` and `path` edges end in a closed arrowhead.
    `line`, `leader` and `containment` edges stay plain (a compass bearing is not a direction of
    flow). Every edge uses `ui.textMuted` at 2 px (about 7:1). Animated edges are solid: dashes
    are reserved for optional parts.
- Consequences:
  - Golden offline pass rate 15/15. The metaphor curation snapshot changed only in its rationale
    text, plus case 11 moving from `actor_action` to `flow`. Both metaphors are allowed by
    §14.2, and no `dimension` changed.
  - Visual baselines `sun-east`, `cycle-flow` and `timeline-flow` were regenerated for the new
    edge style. Contracts are unchanged.
  - Known limitation: 2D nodes have fixed left (target) and right (source) handles, so the
    returning half of a cycle ring crosses itself. This is recorded as minor bug `B-REL-001`.
  - Found in the same review but not fixed here: in 2D, the rendered card footprint is not part of
    the layout's size model, so the sun/east cards overlap (`B-REL-002`, major, release-blocking).

## D-006: Rendered 2D footprints and the compass North Star

- Date: 2026-09-24
- Author: codex-3 (release reviewer)
- Context: `B-REL-002` showed that collision-free OSG boxes did not guarantee collision-free React
  Flow nodes. OSG positions describe node centres, while `osgToFlow` treated them as top-left
  coordinates and every primitive inherited a fixed card minimum. The default North Star therefore
  overlapped Sun and East, routed edges under East, and rendered the compass as a text card.
- Options considered: (a) increase every OSG size to the generic card minimum; (b) measure nodes
  after React renders and mutate their positions; (c) define deterministic canvas footprints at the
  OSG → React Flow boundary, centre them on OSG positions, and render spatial compass primitives
  directly. **(c) chosen.** It preserves the shared OSG and deterministic layout while making the
  renderer's real geometry explicit and testable without a post-paint jump.
- Decision:
  - `canvasNodeFootprint` is the authoritative 2D pixel footprint. Generic cards use their UI
    minimum or the scaled OSG size, whichever is larger; compass, sun and rise use bounded SVG
    footprints.
  - `osgToFlow` converts centre coordinates to top-left coordinates and applies a deterministic
    collision pass with 24 px separation. Presentation styles must merge with, never replace, these
    dimensions.
  - Compass layout resolves a bearing through a relation chain. For the North Star, Sun → Rise →
    East occupies the east side in causal order; actor and modifier offsets place the Sun on the
    horizon and its motion arc above it.
  - The 2D compass renders the registered compass rose with cardinal letters and redundant
    non-colour emphasis on E. The semantic compass → East line remains in the outline but is hidden
    on canvas because the spoke already carries the relation and a visible line would cross the
    eastern-horizon composition.
- Consequences:
  - Rendered React Flow rectangles, rather than only OSG boxes, are now a browser release gate for
    the North Star, cycle and timeline presentations.
  - `B-REL-002` is resolved. M1 is complete and no release-blocking or major defect remains open.
  - Contracts and schema versions are unchanged. The deterministic canvas coordinates are a view
    projection; user drags still convert back to OSG units.
  - `B-REL-001` remains minor: cycle return edges cross and the canvas chrome still needs polish.

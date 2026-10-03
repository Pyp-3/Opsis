# Refactoring Opsis

This record accompanies the October 2026 maintainability refactor. The agreed goal
is code that a human can follow and an agent can extend without repeating domain
rules. Current UI behavior and active data contracts remain stable. Legacy product
retirement and confirmed bug fixes are deliberate exceptions, recorded below.

## Source review and working principles

The research covered all current public catalogue entries on Refactoring.Guru:
23 code smells, 66 techniques, and the intent/applicability of all 22 patterns
currently listed. Introductory principles and the explanatory smell/technique prose
were reviewed. Language-specific sample variants and paid materials were excluded.
The pattern catalogue differs from the original GoF book's 23-pattern list; it does
not include Interpreter. Sources: [refactoring catalogue](https://refactoring.guru/refactoring/catalog),
[pattern catalogue](https://refactoring.guru/design-patterns/catalog),
[pattern history](https://refactoring.guru/design-patterns/history).

Use small verified changes and distinguish behavior changes from structural work.
Tests should protect observable contracts rather than private implementation shape.
See [the refactoring process](https://refactoring.guru/refactoring/how-to).

Clarity depends on responsibility placement and unnecessary complexity, not merely
file length. Extraction has inverse techniques: inline a component or remove a
delegate when indirection is the problem. Patterns are options to evaluate, not a
checklist to impose. See [clean code](https://refactoring.guru/refactoring/what-is-refactoring),
[techniques](https://refactoring.guru/refactoring/techniques), and
[criticism of patterns](https://refactoring.guru/design-patterns/criticism).

### Applying the smell and technique families

| Family                                      | Opsis decision                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bloaters / composing methods                | Extract named UI, persistence, generation and calculation responsibilities; keep declarative icon data together.                                                 |
| Change preventers / moving responsibilities | Give board edit/history rules one owner instead of repeating them across browser, API and MCP.                                                                   |
| Dispensables / inline and remove            | Delete the approved retired application and pipeline, and avoid tiny forwarding modules or hypothetical extension points.                                        |
| Couplers / interfaces and delegation        | Keep schema independent, provider execution behind the harness, and calculation behind the engine contract.                                                      |
| Data organization                           | Preserve validated records, typed unions and serialized formats; name history limits and explicit invalidation policies.                                         |
| Conditional and call simplification         | Preserve guard order, side effects, cancellation and injected dependencies while making the normal path easier to follow.                                        |
| Object-oriented misuse / generalization     | Use idiomatic TypeScript functions and Rust enums; introduce no inheritance framework. Exhaustive Rust matches and plain validated records are appropriate here. |

These decisions apply the [smell catalogue](https://refactoring.guru/refactoring/smells)
and [technique families](https://refactoring.guru/refactoring/techniques). Their
tradeoffs matter: similar-looking code can encode different policies, and grouping
parameters must not create unwanted dependencies. Rust `Result` and stable wire
errors remain intact rather than mechanically introducing exceptions.

### Pattern applicability

- Creational patterns: existing client factories and validated value copying meet
  current needs. No new abstract factories, builders or global singletons.
- Structural patterns: provider adapters, OSG import and focused subsystem entrypoints
  are useful boundaries. No demonstrated need for Composite or Flyweight.
- Behavioral patterns: undoable edits/snapshots, subscriptions and injected providers
  already provide the useful command, memento, observer and strategy capabilities.
  Keep those idioms without adding visitor or state-class hierarchies.

These are project-specific judgments based on the
[pattern catalogue](https://refactoring.guru/design-patterns/catalog), not claims
that Opsis implements every named pattern.

## Supported architecture

| Owner                  | Responsibility                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Web session shell      | Account entry, return navigation and session expiry                                                     |
| Workspace composition  | Page selection and coordination of focused canvas components/hooks                                      |
| Board persistence hook | Ordered saves, revision reconciliation and polling; transport and recovery storage are separate modules |
| Playback hook          | Timers, narration subscriptions and cleanup; the player renders controls                                |
| API board workflows    | Prompts, client setup, generation/illustration policies, output validation and streaming                |
| API storage            | One SQLite connection, account data, owned boards and revision transactions                             |
| MCP                    | Explicit tools adapting to the board API, sharing the same pure edit rules                              |
| Shared schema          | Board contracts, history/edit operations, process metadata and strict legacy import validation          |
| Rust engine            | Contract, text, operations, evaluator and drawing modules behind the existing WASM entrypoint           |

Board document v2, process contract v3, current HTTP/NDJSON shapes, MCP tool schemas,
prompt text, and the WASM entrypoint are retained. CSS was split into six ordered
feature stylesheets; concatenated tokens and rule order match the previous file.

## Intentional removals and fixes

The disconnected 3D application, its renderer/state/UI trees, all four pipeline
packages, legacy primitive/UI packages, and exclusive tests/fixtures/dependencies
are retired. Existing Git history retains their source and obsolete screenshots.
The former visualize, explain, drilldown, OSG retrieval and token-share routes now
return normal 404 responses. Current board sharing is unchanged.

Legacy OSG JSON import remains strictly validated and tested. Historical SQLite
tables and records are left untouched; new databases no longer create those unused
tables. This change does not provide bulk migration or continued API access to
historical OSG records. Pre-account board ownership adoption remains supported.

Two corrections accompany the refactor:

- A diagram rewrite that changes both wording and icon now invalidates both old
  narration and drawings. Previously the narration branch returned before drawing
  cleanup. A regression test covers the combined edit.
- Engine build fingerprints now include nested Rust sources, file names and build
  logic, avoiding stale WASM after module moves or edits. Tests cover changes,
  additions, removals, renames and directory order.

## Verification

The pre-refactor baseline passed lint, typecheck and 821 tests in 76 files. Retired
feature tests were removed with their implementations; surviving import validation
assertions were preserved. Added coverage targets the actual App session shell,
account recovery, shared board edits, legacy data retention and build invalidation.

Required final gates are documented in [AGENTS.md](../AGENTS.md). Use the current
suite result when assessing coverage; a lower test count after explicit product
retirement is not a comparison of coverage percentages. No paid agent calls or
personal database mutations are required for these checks.

Local verification passed: production build, lint, typecheck, Rust formatting and
Clippy, 302 unit/API/schema tests across 42 files, 24 native Rust tests, and all 27
Chromium workspace scenarios. Vite still reports the existing large-chunk warning
for the application and lazy-loaded dependencies; bundle optimization is separate work.

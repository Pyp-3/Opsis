# Process engine

The model describes meaning, chooses operations and supplies synthetic source data. Rust calculates text and vector geometry. React/SVG renders the result. A dedicated worker keeps initialization and calculation off the UI thread. The same WASM asset is used by browsers on Windows, Linux and macOS; the build tools resolve their own platform binaries.

## Contract v3

Board nodes optionally carry `process`. Existing boards and unsupported operations omit it. Supported shapes:

```json
{
  "version": 3,
  "nodes": [
    { "id": "file", "process": { "op": "source", "text": "alex\nblair\ncasey" } },
    { "id": "cat", "process": { "op": "pass", "from": "file" } },
    { "id": "head", "process": { "op": "head", "from": "cat", "count": 2 } }
  ]
}
```

| Operation   | Arguments                                                          | Like                  |
| ----------- | ------------------------------------------------------------------ | --------------------- |
| `source`    | `text`                                                             | a sample file         |
| `pass`      | `from`                                                             | `cat file`            |
| `head`      | `from`, `count` (0–100)                                            | `head -n`             |
| `tail`      | `from`, `count` (0–100)                                            | `tail -n`             |
| `sort`      | `from`, `order: "asc" \| "desc"`, optional `numeric`, `ignoreCase` | `sort [-n] [-f] [-r]` |
| `filter`    | `from`, literal `text`, optional `ignoreCase`, `invert`            | `grep -F [-i] [-v]`   |
| `unique`    | `from`, optional `withCounts`                                      | `uniq [-c]`           |
| `count`     | `from`                                                             | `wc -l`               |
| `cut`       | `from`, `fields` (1–20 numbers, 1–100), optional `delimiter`       | `cut -d -f`           |
| `translate` | `from`, `set1`, `set2`                                             | `tr set1 set2`        |
| `concat`    | `from`: 2–10 step IDs                                              | `cat a b`             |
| `paste`     | `from`: 2–10 step IDs, optional `delimiter`                        | `paste -d`            |

Delimiters are one character other than a line break and default to tab. Combining steps list their inputs in command-line order and may repeat one. Dependencies may appear in any order, branch or reuse sources. Cycles and missing process sources are invalid. Diagram arrows are presentation; the explicit `from` binding defines calculated input. Agents must draw arrows matching those bindings.

Rust returns an envelope `{ok: true, result: {version: 3, nodes: [...]}}` or `{ok: false, error: {code, message}}`. The top-level error is reserved for malformed requests: unparseable or unknown shapes, an unsupported version, more than 50 nodes, invalid IDs and duplicate IDs. Every other problem belongs to one node, so the rest of the request still calculates.

Each entry in `nodes` has `status: "ok"` or `status: "failed"`, in request order. A failed entry is `{status: "failed", id, error: {code, message, source?}}`:

| Code                 | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| `missing_source`     | `from` names no process step; `source` holds that name      |
| `cycle`              | The step is part of a `from` cycle                          |
| `sample_too_long`    | A source exceeds 1000 UTF-16 code units                     |
| `input_too_long`     | Stacked inputs exceed 1000 UTF-16 code units                |
| `too_many_lines`     | A value, or stacked inputs, exceed 100 lines                |
| `count_out_of_range` | Head or tail count above 100                                |
| `filter_too_long`    | Filter text exceeds 200 UTF-16 code units                   |
| `invalid_argument`   | Malformed cut fields, delimiter, translation set, or inputs |
| `output_too_long`    | Calculated output exceeds 1000 UTF-16 code units            |
| `upstream_failed`    | An input step failed; `source` names it                     |

Failures spread only along `from` bindings: a step downstream of a failure reports `upstream_failed`, while sibling branches are unaffected. A successful entry contains:

| Field                     | Meaning                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `status`                  | `"ok"`                                                                     |
| `id`                      | Board node ID                                                              |
| `input`, `output`         | Exact text, including line endings; several inputs are stacked (see below) |
| `inputRows`, `outputRows` | Logical line counts; a final LF does not create an extra line              |
| `origins`                 | For each output row, the input rows it was made from                       |
| `inputs`                  | `{id, rows}` for each consecutive block of input rows, in `from` order     |
| `drawing.height`          | Height of the 120-unit-wide SVG trace view                                 |
| `drawing.paths`           | One path per input row, and whether it reaches an output row               |

Every input row feeds at most one output row. A line body excludes exactly one terminator, LF or CRLF; any further CR is text. Lines a step rebuilds (sort, `uniq -c`, cut, paste) keep their own terminator; an unterminated line takes the input's first terminator (LF if there is none), or CRLF when it ends in a bare CR so the CR stays part of its text.

Sources and pass-through use identity row mappings. Head and tail select lines without changing bytes. Sort compares line bodies lexically by Unicode scalar value; `numeric` compares a leading number exactly (optional blanks and minus sign, digits, optional fraction; no number counts as zero), and `ignoreCase` compares uppercase-folded text. Like GNU sort, equal keys fall back to plain comparison, then input order; descending sort reverses the result. Filter matches literal substrings in line bodies; `ignoreCase` lowercases both sides and `invert` keeps non-matching lines. Unique compares adjacent line bodies and keeps the first; `withCounts` prefixes each kept line with its run length as `%7d ` and maps the whole run to it. Count outputs the number of LF terminators, so an unterminated final line is not counted, and maps the counted rows to its single output row. Cut prints the requested fields in input order, ignoring duplicates and fields past the end, and prints lines without the delimiter whole. Translate expands `a-z` ranges, repeats the last character of a shorter `set2`, lets later duplicates in `set1` win, and changes nothing else, so rows and terminators are preserved; sets cannot contain line breaks, and ranges expand to at most 1000 characters. Neither filter nor unique silently sorts.

Combining steps stack their inputs as input rows, one block per `from` entry; an unterminated last line gains an LF in the stacked `input` so rows stay separate. Concat outputs the inputs' bytes exactly, so an unterminated last line runs into the next input's first line and both rows map to that output row. Paste joins line _n_ of every input with the delimiter, treats missing lines as empty fields, and LF-terminates every output row.

Both Zod and Rust validate their boundaries. Requests are limited to 50 nodes, 100 lines per value, 1000 UTF-16 code units per value and 512 KB of serialized input. Counts range from 0 through 100. Empty sources are valid. There are no arbitrary programs, command strings, filesystem paths or sockets in the engine contract.

## Integration

`layoutBoard` calculates supported process values before the board is displayed, reviewed or saved. The engine's output replaces terminal preview output and sample input. The workspace recalculates from process metadata when loading a board or receiving a changed source; stale calculations are hidden until the current result is available. Changing node positions does not trigger calculation. An eight-entry promise cache shares equivalent jobs, and one worker services all requests with a ten-second timeout. Errors are displayed instead of presenting cached model output as a calculated result: a request-level error replaces every calculated view, while a failed step shows its own message in terminal details and playback. Persisted boards keep the existing preview text for failed steps.

The sample editor recalculates and persists the whole updated board as one history entry; it refuses a sample that makes any step fail and names that step. Source deletion removes dependent process metadata transitively. Board sync also removes calculations whose sources disappeared during concurrent edits. Unrelated changes keep the operations. Exports preserve source operations and cached calculated terminal text; playback traces are rebuilt from the source.

The engine calculates successful example transformations. Command labels do not execute. Exit statuses, stderr, shell scheduling and failure remediation remain explanatory metadata. This slice does not replace ELK or implement a universal process simulator.

## Build and verification

```sh
pnpm install --frozen-lockfile
pnpm engine:build
pnpm engine:test
pnpm engine:check
pnpm exec vitest run packages/engine packages/schema/src/process.test.ts apps/web/src/workspace/Workspace.test.tsx
```

`pnpm dev`, `pnpm test` and `pnpm typecheck` prepare the WASM build automatically; recursive production builds honor the web package's dependency on the engine. `wasm-pack` is pinned in pnpm, `wasm-bindgen` in Cargo, and Rust in the toolchain file. Cargo.lock is committed. Compiled artifacts, WASM glue and source hashes live in ignored `dist/`; compiler caches live in ignored `target/`. The build script reuses artifacts only when Cargo sources, lockfile and toolchain match their hash.

Rust tests exercise operation boundaries, invalid inputs and per-node failure propagation. Property tests (`proptest`) check row provenance, ordering and terminator invariants for every operation over random samples, that arbitrary `from` graphs always yield one outcome per node, and that any input string returns an envelope rather than panicking. Raise `PROPTEST_CASES` for a longer run. TypeScript tests load the actual generated WASM and validate its shared contract. Workspace tests use those same WASM calculations through an in-process test transport; production uses a real worker. CI builds the asset, checks formatting/Clippy, runs native Rust tests and the existing web QA gate.

Future geometry or simulation modules should accept bounded declarative inputs, return typed results and retain deterministic fixtures. Benchmark existing routing before replacing it. Add explicit domain rules for new simulations; Rust alone does not establish the truth of an inferred process.

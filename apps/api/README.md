# Opsis API

Fastify service for accounts, saved canvases, local agent generation and narrated playback.

Run from the repository root with `pnpm --filter api dev`. The default address is
`http://127.0.0.1:8000`. The application starts speech warmup in the background.

## Routes and ownership

- `GET /v1/health` reports availability.
- `/v1/auth/*` manages accounts, cookie sessions and revocable agent keys.
- `GET /v1/agents` reports local Claude/Codex availability and the built-in demo.
- `POST /v1/boards/generate` and `POST /v1/boards/illustrate` run the selected local agent.
- `GET/POST /v1/boards` lists owned boards (including their `archived` flag) or creates one.
- `GET /v1/boards/public` lists other accounts' public boards.
- `GET/PUT/PATCH/DELETE /v1/boards/:id` reads, saves, renames/shares, archives or deletes a board.
  Archive requests use `{ revision, archived }`, separately from renaming/sharing, and
  advance the revision without adding an undo step.
- `POST /v1/boards/:id/duplicate` accepts `{ revision, title?, fromRevision? }` and creates
  an independent private copy with fresh undo history. Only the source owner may copy
  through this endpoint; stale source revisions return 409.
- `GET /v1/boards/:id/revisions?before=N` returns up to 50 saved revisions newest first;
  `GET /v1/boards/:id/revisions/:revision` returns `{ revision, board }`. Both are owner-only,
  even when a board is public. Omit `before` for the newest page and use its last revision
  as the next cursor. `fromRevision` restores one as a new private board.
- `GET/POST /v1/templates` lists private templates or saves a snapshot of an owned board;
  `DELETE /v1/templates/:id` removes an owned template. `POST /v1/boards` accepts an
  optional `templateId` to create an independent private board with fresh history.
- `GET/POST /v1/speech` checks narration availability or synthesizes speech;
  `POST /v1/speech/warm` prepares the model.

Boards require an account. Owners can edit their boards; other signed-in accounts can
read unarchived public boards. Archived boards are owner-only; unarchiving restores
their previous sharing setting. Private boards remain hidden. Agent keys work only for local,
non-browser requests and act as their owning account.

Board writes check the expected revision. Stale writes return 409, deleted boards cannot
be resurrected, and accepted content edits retain up to 40 undo steps. Changing visibility
does not create a content revision.

The separate revision archive retains saves from migration onwards until permanent
board deletion. Both hosts apply the same SQL migration catalogue. Full-database
backup/restore commands and retention details are in [Persistence and recovery](../../docs/PERSISTENCE.md).

Generation normally returns JSON. With `Accept: application/x-ndjson`, it returns
progress events followed by `{ type: "result", status, body }`. Malformed model answers
get at most one repair attempt. Provider failures never silently substitute demo content.
Changes to existing diagram content return a review candidate before application.

## Code map

- `app.ts`: application assembly, authentication requirement for generation, rate limits.
- `board-library.ts` and `storage.ts`: owned board routes, SQLite transactions and account persistence.
- `boards/`: prompt text, generation/illustration workflows, response validation and streaming.
- `harness/`: local CLI invocation, bounded process execution and progress parsing.
- `speech.ts`: narration model lifecycle and bounded generation queue.

Use shared board operations from `@opsis/schema` when changing history or editing rules.
Keep prompt edits separate from structural refactors so changes in agent output are reviewable.

## Configuration

| Variable                              | Default                      | Purpose                                   |
| ------------------------------------- | ---------------------------- | ----------------------------------------- |
| `HOST`                                | `127.0.0.1`                  | Listen address                            |
| `PORT`                                | `8000`                       | Listen port                               |
| `OPSIS_DB_PATH`                       | `apps/api/data/opsis.sqlite` | Account and board database                |
| `OPSIS_RATE_LIMIT`                    | `60`                         | Requests per client per budget window     |
| `OPSIS_RATE_WINDOW_MS`                | `60000`                      | Budget window in milliseconds             |
| `OPSIS_CLAUDE_BIN`, `OPSIS_CODEX_BIN` | PATH lookup                  | Explicit CLI executable                   |
| `OPSIS_SPEECH`                        | enabled                      | Set to `off` to disable natural narration |
| `OPSIS_MODEL_DIR`                     | application model cache      | Speech model cache directory              |

Board polling has a separate allowance ten times the normal budget. Authentication
has its own budget. Health and speech do not consume these budgets.

Models and reasoning effort come from the board request and its defaults. Agent runs use
the CLI's existing login; no HTTP provider key or legacy startup LLM adapter is needed.
Tests inject clients and speech engines without paid model calls.

## Retired pipeline

The former visualize, explain, drilldown, OSG and token-share endpoints have been removed.
Their existing SQLite tables and records are left untouched; new databases create only
the account and board tables. Existing pre-account boards still transfer to the first
account during the ownership upgrade. Public board sharing is the supported sharing flow.

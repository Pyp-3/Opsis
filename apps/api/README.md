# Opsis API

Fastify service for the Opsis parse → metaphor → layout pipeline, explanations, drill-down,
persistence, and sharing.

## Run locally

From the repository root:

```sh
corepack pnpm --filter api dev
```

The server binds to `127.0.0.1:8000` by default. `POST /v1/visualize` returns JSON normally;
send `Accept: text/event-stream` to receive `parsing`, `mapping`, `layout`, and `done` SSE events.

## Environment variables

| Variable                     | Default                      | Purpose                                                                                |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `HOST`                       | `127.0.0.1`                  | Listen address. Keep loopback unless deployment explicitly requires another interface. |
| `PORT`                       | `8000`                       | Listen port.                                                                           |
| `OPSIS_DB_PATH`              | `apps/api/data/opsis.sqlite` | SQLite file used for cache entries, OSGs, explanations, and share tokens.              |
| `OPSIS_MEMORY_CACHE_ENTRIES` | `256`                        | Maximum entries in the in-process LRU front cache.                                     |
| `OPSIS_RATE_LIMIT`           | `60`                         | Maximum non-health requests per client in one window.                                  |
| `OPSIS_RATE_WINDOW_MS`       | `60000`                      | Rate-limit window in milliseconds.                                                     |
| `OPSIS_LLM_PROVIDER`         | `anthropic`                  | `anthropic` or an OpenAI-compatible provider name.                                     |
| `OPSIS_LLM_MODEL`            | unset                        | Provider model id. Required with an API key to enable LLM calls.                       |
| `OPSIS_LLM_API_KEY`          | unset                        | Provider credential. When absent, the deterministic offline fallback is used.          |
| `OPSIS_LLM_BASE_URL`         | provider default             | Optional Anthropic or OpenAI-compatible API base URL.                                  |

No key is required for local development or tests. Requests and responses are checked against the
shared Zod contracts, and all API failures use `{ code, message, stage, retryable }`.

# Provider connections

Model choices, profiles, fallbacks and usage history belong to each Opsis account.
API credentials belong to the **server instance**, shared by every account using
that instance. Generation uses the explicit model you select; Opsis never silently
switches models or retries authentication failures. Invalid JSON gets at most one
repair on the same model.

## Instance API keys

Use Settings → API keys to save, replace or remove a Kimi, Grok or Antigravity key.
Only signed-in browser/desktop sessions can manage these settings; local MCP agent
keys cannot. In the current loopback-only application, signed-in accounts share
management of this instance setting. Responses show configured status and source,
never the saved key. Removing a key from Opsis does not revoke it at the provider.

Keys are stored outside SQLite and account/board exports in
`<database path>.provider-keys.json`. This is a local secret file, **not encrypted**.
Writes are atomic; POSIX files use mode 0600 and Windows uses the containing user
profile's ACL. Keep the database directory private to the OS account running Opsis.
Database backups do not include this file. A server restart reloads saved keys;
an in-memory test instance keeps keys only in memory.

The server environment takes precedence over saved keys:

- `OPSIS_KIMI_API_KEY`
- `OPSIS_GROK_API_KEY`
- `OPSIS_ANTIGRAVITY_API_KEY` (Google Gemini API key)

The browser sends a key only when saving it. Generation requests contain no key;
the host supplies its configured credential directly to the fixed official API.
Redirects are refused and provider error bodies are not exposed or logged.

| Connection      | Protocol                          | Limits and output                                                                              |
| --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Kimi API        | Moonshot Chat Completions         | Explicit model/effort, JSON mode, output-token cap, no tools                                   |
| Grok API        | xAI Responses                     | Explicit model, output-token cap, no tools, `store: false`                                     |
| Antigravity API | Gemini Interactions managed agent | Explicit underlying model, no tools or remote environment, background polling and cancellation |

Antigravity's preview API does not support structured-output enforcement or an
output-token cap. Opsis validates its JSON through the same review/repair workflow.
Background interactions require provider-side storage; provider retention and
billing rules apply. Cancellation requests are best-effort if the network fails.
All APIs accept images and extracted PDF text; scanned PDFs require extraction
before use. Only reported usage is counted; absent values remain unavailable and
are never invented as zero. API costs are not inferred from missing provider data.

Requests have a three-minute deadline and a configurable character limit. The
instance permits at most two API completions at a time. No paid requests are made
by Check configuration: it verifies configuration, not key validity or quota.

## Installed command-line tools

Choose CLI under the provider's connection setting. Install and authenticate the
official CLI separately on the machine running Opsis. You may set an absolute
executable path, use PATH discovery or configure `OPSIS_<PROVIDER>_BIN`.
Antigravity's command is `agy`, with override `OPSIS_ANTIGRAVITY_BIN`.
Shell scripts are never executed as launchers; existing Claude/Codex npm wrappers
resolve their known package entry point.

| CLI         | Accepted versions         | Integration                                                                                                       |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Claude Code | 2.1.x                     | Existing isolated headless integration; chat threads resume a saved session                                       |
| Codex       | 0.156.x, 0.157.x, 0.159.x | Existing read-only integration, ephemeral except for chat threads' resumed sessions                               |
| Kimi Code   | 1.52.x                    | Print mode, custom agent with no tools, explicit empty MCP configuration, one step and no provider retries        |
| Grok Build  | 1.0.46                    | Headless plain JSON answer, empty tools, no subagents/memory/search, one turn                                     |
| Antigravity | 1.3.0                     | Streaming JSON input/result envelopes, isolated settings/home, deny rules for file, shell, web and MCP operations |

Kimi 1.52 loads installed plugins even for an empty custom tool list. Opsis therefore
refuses generation when `~/.kimi/plugins` contains entries. Grok runs only with
its default configuration: custom configuration, extensions or unrecognized state
entries in `~/.grok` cause a refusal. Authentication, sessions, logs, downloads,
binary and cache directories are allowed. Compatibility scans for Claude/Cursor
extensions are disabled. Opsis never removes or changes these user files.

Chat threads resume a saved CLI session with Claude Code (`--session-id`, then
`--resume`) and Codex (`exec resume`, with the same read-only sandbox through
configuration). Each thread runs in its own directory under the system temporary
folder (`opsis-sessions/<account>/<thread>`), which the CLI uses to find its session;
uploads and the schema still go in a disposable folder inside it. The server derives
that directory from the signed-in account, never from browser input. Tools, sandboxing
and permission settings are unchanged. Opsis records only which session to resume and
its turn count; the CLI keeps the transcript in its own store. A session is replaced
after 16 turns. A resumed turn sends a short continuation instruction rather than the
full instructions again. Requests without a thread (and every other CLI) remain
ephemeral. Grok's CLI receives the whole request as one argument bounded at 24,000
characters, so long chat requests on large boards may need its API connection.

Antigravity uses the OS keyring login with a disposable home/configuration rather
than importing user permissions or extensions. If your installation cannot access
its login this way, use the API connection. Choose a model slug reported by
`agy models`, such as `gemini-3.8-flash-medium`; API model IDs and CLI slugs differ.
Kimi uses model names from its local configuration; Grok lists them with `grok models`.

The new CLI adapters accept text and extracted PDF text. Binary images are rejected
before launching them; use their API connection for images. Grok's official
headless prompt is an argv value, so Opsis caps the escaped prompt plus schema at
24,000 characters for Windows portability. It can appear in OS process inspection;
Opsis never logs it. Use the API for larger boards. CLI runs have bounded output,
cancellation and disposable working directories. Their internal billing and
provider retry behavior still belong to the installed tool.

Compatibility is covered with fake runners and official protocol examples, not
paid account entitlement tests. Live-provider smoke tests require explicit user
authorization.

## Official references

Checked 2026-10-06:

- [Kimi API](https://platform.kimi.ai/docs/api/chat), [Kimi CLI](https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html), [Kimi 1.52 source](https://github.com/MoonshotAI/kimi-cli/tree/1.52.0)
- [Grok API and installation](https://docs.x.ai/build/overview), [headless CLI](https://docs.x.ai/build/cli/headless-scripting), [CLI configuration](https://docs.x.ai/build/settings/reference)
- [Antigravity API](https://ai.google.dev/gemini-api/docs/antigravity-agent), [Interactions response format](https://ai.google.dev/api/interactions-api), [headless CLI](https://www.antigravity.google/docs/cli/headless/), [permissions](https://www.antigravity.google/docs/permissions/)

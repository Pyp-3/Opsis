# Opsis MCP server

Lets coding agents (Claude Code, Codex, or any MCP client) read and edit Opsis canvases directly.

It is a small stdio server that edits boards through the same local API the web app saves
through. So an agent's edit is an ordinary saved revision:

- a canvas you have open picks it up within about 1.5 seconds, with no reload;
- each tool call is one step on that board's undo history, so **Ctrl / ⌘ Z** undoes it;
- if you and an agent edit at the same moment, the server re-reads and re-applies its change
  instead of overwriting yours.

Every result includes an `open` link (`/canvas?board=<id>`) that opens the board in the app.

## Access: agent keys, local only

An agent acts as one Opsis account, using an **agent key** that account creates under
**Account → Agent keys** in the app (shown once; only a hash is stored; revocable there).

Agent keys are internal-only. The API accepts one only when the request reaches it directly
over loopback (127.0.0.1 / ::1) and carries none of the headers a browser (`Origin`,
`Sec-Fetch-Site`, `Sec-Fetch-Dest`) or a forwarding proxy (`X-Forwarded-For`, `Forwarded`)
adds. So a key cannot be used from a web page, or from another machine on your network.
Agents cannot create or revoke keys themselves.

With a key, an agent can edit its account's boards and read (never edit) boards other people
have made public.

## Setup

Start Opsis first (`pnpm dev`: API on :8000, web on :3000), create an agent key under
**Account → Agent keys**, then register the server with your agent. Use absolute paths; launching through `pnpm run` would print banners into the protocol
stream.

**Claude Code** — inside this repository `.mcp.json` configures it and reads the key from
your shell: `export OPSIS_AGENT_KEY=opsis_agent_…` before starting Claude Code. Elsewhere:

```sh
claude mcp add opsis --env OPSIS_AGENT_KEY=opsis_agent_… -- /path/to/Opsis/apps/mcp/node_modules/.bin/tsx /path/to/Opsis/apps/mcp/src/main.ts
```

**Codex** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.opsis]
command = "/path/to/Opsis/apps/mcp/node_modules/.bin/tsx"
args = ["/path/to/Opsis/apps/mcp/src/main.ts"]
env = { OPSIS_AGENT_KEY = "opsis_agent_…" }
```

`OPSIS_API_URL` (default `http://127.0.0.1:8000`) and `OPSIS_WEB_URL` (default
`http://127.0.0.1:3000`) point it at a different API or web origin.

## Tools

| Tool                   | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `opsis_list_boards`    | Saved boards, most recent first                                     |
| `opsis_get_board`      | Title, big-picture summary, colours, concepts (with ids) and arrows |
| `opsis_create_board`   | A new empty board                                                   |
| `opsis_update_board`   | Title, summary, background palette and icon tint                    |
| `opsis_add_concept`    | Adds a concept; `after` places it below another and draws the arrow |
| `opsis_update_concept` | Label, summary, explanation, icon or kind                           |
| `opsis_remove_concept` | Removes a concept and its arrows                                    |
| `opsis_connect`        | Draws a labelled arrow (flow, request, response, feedback or retry) |
| `opsis_disconnect`     | Removes an arrow                                                    |
| `opsis_write_diagram`  | Replaces a whole diagram in one step, or creates a board for it     |

New concepts are placed clear of existing ones; **Arrange downward** on the canvas tidies a
larger agent-built diagram. Agents cannot see or change which board your browser has open, run
generations, delete boards, change sharing, or edit anyone else's boards.

## Packaged desktop app

The Linux desktop executable also provides the same tools with `opsis --mcp`.
It discovers the running desktop API automatically; use your agent key as usual.
See [desktop MCP setup](../../docs/DESKTOP.md#mcp).

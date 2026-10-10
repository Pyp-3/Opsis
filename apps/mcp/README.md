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

| Tool                       | What it does                                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `opsis_list_boards`        | Saved boards, most recent first, with each board's collection                   |
| `opsis_search_boards`      | Concepts matching words, across boards you own or edit; best first              |
| `opsis_get_board`          | Title, summary, colours, concepts (ids, positions), arrows, drawings and scale  |
| `opsis_create_board`       | A new empty board, optionally filed in a collection                             |
| `opsis_list_collections`   | Your private collections, with how many boards each holds                       |
| `opsis_create_collection`  | A new private collection                                                        |
| `opsis_file_board`         | Moves an owned board into a collection, or out of every collection              |
| `opsis_update_board`       | Title, summary, background palette, icon tint and drawing scale                 |
| `opsis_add_concept`        | Adds a concept; `after` places it below another and draws the arrow             |
| `opsis_update_concept`     | Label, summary, explanation, icon or kind                                       |
| `opsis_remove_concept`     | Removes a concept and its arrows                                                |
| `opsis_connect`            | Draws a labelled arrow (flow, request, response, feedback or retry)             |
| `opsis_disconnect`         | Removes an arrow                                                                |
| `opsis_write_diagram`      | Replaces a whole diagram in one step, or creates a board for it                 |
| `opsis_add_drawings`       | Draws shapes, text and dimension lines beside the diagram, in one step          |
| `opsis_update_drawing`     | Moves, reshapes, relabels or restyles a drawing, or changes its concept/layer   |
| `opsis_remove_drawings`    | Removes drawings in one step                                                    |
| `opsis_list_symbols`       | The ready-made symbols, by category, with their natural size                    |
| `opsis_place_symbols`      | Draws symbols (doors, resistors, valves, pumps, people…) as groups, in one step |
| `opsis_transform_drawings` | Moves, scales, mirrors, rotates, aligns or spaces drawings and groups           |
| `opsis_repeat_drawings`    | Copies drawings or groups in a row, each a step further on                      |
| `opsis_group_drawings`     | Puts drawings in a named group, or takes them out                               |
| `opsis_render_board`       | A PNG picture of the board or a region, with rulers, to check the drawing       |
| `opsis_add_page`           | Adds an empty page after another or at the end, optionally hidden from viewers  |
| `opsis_update_page`        | Renames a page, hides or shows it, or moves it to another position              |
| `opsis_remove_page`        | Removes a page and everything on it                                             |

A board can have several pages, each its own canvas. `opsis_get_board` lists them (number, id,
title, and whether each is hidden from viewers). Every tool that reads or edits a diagram or
drawings takes an optional `page`, a page number (1 is the first) or id, and works on that page;
without it, tools use page 1. Each call is still one undoable step on the whole board, and the
returned `open` link opens the page that was read or added.

Filing a board in a collection is organization, not an edit: it adds no revision or undo step,
and only the board's owner can file it.

Drawings use canvas coordinates, where one grid square is 24 units. `opsis_get_board`
returns each concept's position, so a sketch can be placed around the diagram. A drawing
added with `movesWith` follows that concept when it is moved. A `layer` name puts it on that
layer, creating the layer if needed. Boxes, ellipses and text take a `rotation` in degrees.
Beyond boxes, lines and text, a drawing can be a closed `polygon`, an `arc` through three
points, or a `path` of SVG path data (curves, pipes, plots and outlines). Shapes with an inside
take a fill ink, fill opacity and hatching; open shapes end in arrows, dots or bars; text can
be centred, bold or on a backdrop. Placed symbols are groups of ordinary drawings, so they
transform as one and stay editable. `opsis_render_board` rasterises a schematic preview on
the Opsis host (concepts as labelled circles, drawings exactly as painted); a desktop app
without its local Node service answers with SVG markup instead. Agents cannot change drawings the reader has locked, or
drawings on locked or hidden layers, and cannot lock, hide or unlock anything themselves.

New concepts are placed clear of existing ones; **Arrange downward** on the canvas tidies a
larger agent-built diagram. Agents cannot see or change which board your browser has open, run
generations, delete boards, change sharing, or edit anyone else's boards.

## Packaged desktop app

The Linux desktop executable also provides the same tools with `opsis --mcp`.
It discovers the running desktop API automatically; use your agent key as usual.
See [desktop MCP setup](../../docs/DESKTOP.md#mcp).

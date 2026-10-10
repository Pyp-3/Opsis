# User guide

[Documentation index](README.md) · [Getting started](GETTING-STARTED.md)

## Explore and edit a board

Start with an example or ask a question in the **Chat** tab. Select a concept to read
its explanation. Drag icons to change their positions; use connection ports to
connect concepts. Select a connection to edit its label, color, or type.

Use **Arrange downward** to lay out a crowded diagram, **Read from top** for a
legible starting view, and **Fit diagram** for an overview. Undo and redo retain
up to 40 past/future states. A drag is one undoable action.

To give the canvas more room, tuck the workspace away: the sidebar button hides the
sidebar, **The big picture** folds into one line, **Hide canvas tools** shrinks the
toolbar to a single button. Board menus (**Share**, **Groups**, **Import**, **Export**)
drop down from the header and close on Escape or a click elsewhere. The toolbar
choice is remembered on this device.

The **Canvas** and **Chat** tabs sit in the header, beside the board name. Prompting
lives in **Chat**; **Open chat** and **Explore this step** take you there. On wide
screens (1100 px and up) Chat docks beside a live, editable canvas, so new concepts
and proposals appear while you talk. Drag the chat's left edge to resize it, **Expand
chat** to give it the full page with saved threads listed alongside, and **Chat beside
canvas** to dock it again; both choices are remembered on this device. On narrower
screens Chat takes the page. The reply in progress shows the agent's live activity and
**Stop generation**. A ready proposal appears as a card with **Review on canvas**, and
the review opens beside the docked chat. The Canvas tab shows a pulsing dot while an
agent works and **Review** while a proposal waits. A reply that arrives while Chat is
out of view marks the Chat tab and **Open chat**. The third (sparkle) tab is reserved
for a future feature and is disabled.

Chat threads belong to your signed-in account, even on a shared board. They are
stored with that account on this Opsis instance, separately from board documents
and exports. Pick a saved thread from the thread menu (or the list beside an expanded
chat), or start a new one. Changing provider or model
starts a separate thread on the next request; selecting a saved thread restores
its provider and model. Chat creates and refines the canvas; it is not a separate
general-purpose assistant. A board can hold up to 30 threads per account. Delete
older threads when that limit is reached. Concurrent edits report a conflict instead
of overwriting another browser's thread; use **Reload threads** to continue.

**Long conversations.** Each request sends the current diagram, your new prompt, the
12 most recent messages and the thread's **notes**. The agent replies in a sentence or
three and rewrites the notes every turn: your goal, decisions, preferences, what you
accepted or discarded, and open questions. Each reply is marked **Applied**, **Awaiting
review**, **Partly applied** or **Discarded** once you decide, and the agent sees those
outcomes, so it does not propose a discarded change again. A thread never fills up: at
80 messages its oldest messages are condensed into the notes and the conversation
continues. Open **Thread notes** above the messages to read the notes or **Clear notes**.

With Claude or Codex connected through their CLI, each thread also keeps that CLI's own
saved session, so the agent resumes with its full earlier context rather than a summary.
The chat footer says so. The session belongs to your account and the thread; another
account can never resume it. After 16 turns a fresh session starts, with the thread's
notes carrying the context, which keeps resumed context and cost bounded. If a saved
session cannot be resumed, the message fails without a retry and says so; send it again
to continue from the notes. The CLI keeps the session's transcript in its own store on
the machine running Opsis (for example under your home directory). Deleting the thread,
or its board, also removes the transcripts of every session the thread used; your other
CLI sessions are untouched. API connections and the other CLIs rely on the notes
and recent messages.

In a concept's details, choose **Linked board** to connect it to another saved
board. Linked concepts carry an arrow badge. Double-click one, or choose **Open
linked board**, to follow it; **Back to previous board** returns to your source.
The header's **Linked from** menu lists incoming links from boards you may read.
Private source boards remain hidden from other accounts. Regeneration preserves
links on concepts whose IDs remain; agents can explicitly set or clear links with
`opsis_update_concept`.

Agent proposals for an existing board are reviewed before application. Compare
**Proposed** and **Current**, then choose **Apply reviewed changes** or
**Keep current board**. Use the change checkboxes to accept only part of a proposal.
A selection with broken dependencies cannot be applied. Reading existing explanations
does not make a model call.

Pin a concept's position in its details panel to retain it during rearrangement.
Use **Connect to** and **Edit connection** for keyboard connection creation,
reconnection and port editing. Add branch conditions and descriptions in connection
details. **Settings → Agents and models** contains named profiles, CLI diagnostics,
limits and reported usage; **Appearance** keeps the theme controls.
See [model and canvas controls](P1-CONTROLS.md) for details and limitations.

## Draw on the canvas

Beside the icon diagram you can sketch directly on the canvas: floor plans, walls,
equipment outlines, zones and annotations, so one board can combine a process flow
with engineering or architectural drawings. Press the pen button at the left of the
canvas to show the drawing tools:

- **Diagram** (Esc) returns to normal canvas use: moving concepts and connecting them.
  Drawings stay visible but cannot be clicked in this mode.
- **Pen** (P) draws freehand. **Line** (L), **Arrow** (A), **Box** (R), **Ellipse** (O)
  and **Dimension** (D) draw straight shapes that snap to half a grid square. Hold Shift
  for horizontal, vertical or 45° lines and for squares and circles; hold Alt to place
  points freely.
- **Text** (T) places a label and opens it for editing.
- **Dimension** lines show their length in grid units (one fine grid square is 1 u)
  unless you give them a label such as `3.2 m`. Set the board's scale to measure in real
  units instead (see below).
- **Select drawings** (V) picks a drawing to move, restyle or delete (Delete key).
  Shift+click adds or removes drawings from the selection, and dragging across an empty
  part of the canvas selects every drawing the rectangle touches. Ctrl/⌘ A selects them all.
  Dragging any selected drawing moves the whole selection.
- **Resize handles** appear around one selected box, ellipse or freehand stroke, and at both
  ends of a line, arrow or dimension. Drag one to reshape it; it snaps like drawing does,
  Shift keeps a corner drag in proportion and Alt places it freely. Dragging a corner of a
  text changes its letter size, keeping the opposite corner in place.
- **Rotate** with the round handle above a selected shape; hold Shift to turn in 15° steps.
  A box, ellipse or text also has a **Rotation (°)** field for an exact angle, and
  **Rotate 90°** turns the selection by a quarter turn. With several drawings selected, they
  turn together about the centre of the whole selection, keeping their layout, and
  **Turn selection (°)** turns them by any angle; attached drawings stay attached. A rotated
  shape keeps its handles along its own sides.
- **Copy and paste**: Ctrl/⌘ C, X and V copy, cut and paste selected drawings, also into
  another board or browser tab. Ctrl/⌘ D, or **Duplicate**, copies them in place. Copies land
  one grid square down and right, keep following their concept on the same board, and are
  never locked.
- **Eraser** (E) removes every drawing it touches during one sweep.

The panel beside the tools chooses ink, solid/dashed/centre-line style, weight and
a translucent fill. With a drawing selected, the same controls restyle it, and
**Moves with** attaches it to a concept so that it follows the concept when you drag
or rearrange it. Lines and shapes are painted beneath icons and arrows; text and
dimension labels stay on top so they remain legible.

With a drawing selected, the panel also sets its **Opacity**; shapes with an inside take a
**Fill ink** and **Hatch** (diagonal, cross, horizontal, vertical or dots, for section cuts
and materials); lines, arrows, arcs and paths take **Start** and **End** markers (arrow, dot
or bar); and text can be aligned left, centre or right, made **Bold** or given a
**Backdrop**. Agents can also draw closed polygons, arcs through three points, curved paths and
ready-made symbols such as doors, resistors, valves and pumps. Drawings an agent grouped (a
placed symbol, say) are picked, dragged and restyled together.

With several drawings selected, the panel restyles, attaches, moves to a layer, locks or
deletes them together. **Lock** keeps a drawing from being moved, resized, restyled, erased
or deleted. A locked drawing can still be picked, so you can unlock it.

**Layers and scale** (the stacked-sheets button in the tool column) opens two settings:

- **Scale** says what one grid square measures, for example `0.5` `m`. Unlabelled dimension
  lines then read in metres (or feet, millimetres, or any unit you type). **Use grid units**
  returns to `u`.
- **Layers** group drawings, for example walls, services and notes. New drawings go on the
  layer marked with the radio button. The top of the list paints on top. Each layer can be
  renamed, moved up or down, hidden or locked. A hidden layer is left out of the canvas and
  of SVG/PNG exports. A locked layer cannot be picked or erased. Deleting a layer moves its
  drawings to the base layer rather than deleting them.

Each finished shape, move, resize, restyle, paste, eraser sweep and layer or scale change is
one undoable step. Drawings, layers and the scale are saved with the board, included in
SVG and PNG exports and JSON files, and shown read-only to public viewers. A drawing
attached to a concept that a follow-up removes stays where it was drawn.

**Sketches from chat.** For spatial subjects such as floor plans, room and site layouts or
equipment arrangements, or when you ask it to sketch or lay something out, the chat agent
may add a sketch beside the diagram. Its drawings go on their own **Agent sketch** layer.
On a new diagram, a free-standing sketch is placed to the right of the concepts; parts of
it can follow particular concepts. On a follow-up the agent is shown its own sketch and the
board's scale, and any change to its sketch appears as one item in the proposal review.
Lock or hide the Agent sketch layer to keep the agent from seeing or changing it. Edit or
restyle the sketch like any other drawing.

**Drawings in focus.** Your own drawings stay private unless you put them in focus. Select
drawings (or select a concept that has drawings attached) and then write in Chat: the
composer shows **Focus: N drawings selected**, and those drawings are sent with your
message as what it is about. The agent may propose changes to exactly those drawings;
they appear in the review as **Change your selected drawings**, and nothing changes until
you apply them. Drawings on hidden or locked layers, and locked drawings, are never sent.
Choose **×** on the focus to keep the drawings private for that message.

**Drawing first.** When drawings are in focus, a drawing tool is in hand or your message
asks for a sketch, plan or layout, the agent works drawing-first: the sketch becomes the
main result, with labels and real dimensions when the board has a scale, and the concepts
stay as they are unless you ask otherwise. The **Drawing first** button shows the current
choice; press it to switch, and **Automatic** to return to the automatic choice.

External agents connected over MCP can read and draw with `opsis_add_drawings`,
`opsis_update_drawing` and `opsis_remove_drawings`, and set the scale with
`opsis_update_board`. They cannot change anything you have locked, or hidden.

## Save and organize projects

Select a regular collection in **Boards**, then open **Share or export**. You can
make all of its current boards public/private or invite/remove an editor across
all of them, including archived boards. Adding a board later does not change its
sharing settings. Making a board private does not revoke existing editor access;
use the separate removal action. If any board or the collection membership changed
since your page loaded, the entire sharing action is rejected: refresh and retry.

**Export collection bundle** includes board content, notes, sources and tags, but
not chat threads, account preferences, credentials or revision history. **Import
collection bundle** creates a new collection with new private boards and empty
undo histories. Links between exported boards point to the imported copies; links
outside the bundle are removed. Bundles support up to 100 boards and 16 MB.

**Export read-only HTML** produces one offline file with diagrams, explanations
and internal board links. **Print walkthrough / Save PDF** opens the browser's
print dialog; choose its PDF destination to save a PDF. The HTML file can also be
opened in a browser and printed. Exports contain the collection's notes and
sources, so review that content before sharing the resulting file.

Boards autosave. Wait for **Saved** to confirm that the API accepted your changes.
Use **Manage boards** to create, search, open, rename, or delete boards. Deletion
requires confirmation and removes that board's history; export a JSON backup first
when you need to retain an editable copy.

Open views connected to the same API synchronize saved changes. Unsaved work also
has account-scoped browser recovery. This is local persistence, not hosted cloud
backup. See [persistence details](PERSISTENCE.md).

## Reuse a template

1. Open **Manage boards → My boards**.
2. On the source board, choose **Save as template** and enter a template name.
3. Open **Templates** and select the saved template.
4. Enter a new project board name and choose **Create from template**.

Templates preserve board content, layout, and appearance privately for your account.
Each use creates an independent private board with fresh history. Editing or
deleting the source does not change its templates. Deleting a template leaves
existing project boards intact.

## Group boards into collections

In **Manage boards → My boards**, choose **New collection** and name it (for
example, “Networking”). Use the folder button on a board card to move it into a
collection, or select a collection before **Create board** to start the board
there. The chips above the list show **All boards**, **Unfiled** boards, or one
collection, with a count for each. Rename or delete the selected collection from
the actions below the chips; deleting a collection keeps its boards.

To move several boards at once, choose **Select boards**, tick the boards (or
**Select all shown**), pick a collection under **Move to** and press **Move**.
Only boards shown under the current chip, tag and search are moved. The library's
address remembers the selected collection, so a reload or bookmark opens it again.

On **Home**, **Recent boards** shows each board's collection. When you have
collections, chips above the list narrow it to one, and **All in …** opens that
collection in the library.

Collections are private to your account and do not change a board's content,
history or sharing. See [collections](PERSISTENCE.md#collections). Agents connected
over MCP can list and create your collections and file your boards with
`opsis_list_collections`, `opsis_create_collection` and `opsis_file_board`.

Add tags with the tag button on a board card, then **Filter by tag**. A **smart
collection** keeps itself up to date from a rule — for example, every board tagged
“exam” that changed in the last 30 days. See
[tags and smart collections](PERSISTENCE.md#tags-and-smart-collections).

## Search all boards

Open **Search** in the sidebar, or press **Ctrl K** (**⌘ K** on macOS) anywhere.
Type at least two words or characters: Opsis finds concepts whose label, summary,
explanation, notes, sources or outgoing connection labels contain every word
(ignoring case and accents), plus board titles, descriptions and group names.
Labels and titles rank first. Select a result to open its board with that concept
selected. Search covers boards you own or were invited to edit; archived boards and
other people's public boards are not searched. Agents can use the same search with
the `opsis_search_boards` MCP tool. Search matches words, not meanings.

## Share with another local account

A board is private by default. Make it public from the board library or its
sharing controls so other signed-in accounts using the same API can view it.
Viewers can play a board or save their own copy; they cannot edit your original.

“Public” here means visible within that Opsis instance. It does not publish a board
to GitHub, create a hosted website, or make a localhost link reachable from another
computer. See [accounts and sharing](P2-WORKFLOWS.md#shared-editing-on-one-server).

## Play a process

Choose **Play the process**, then use play/pause, step controls, or the timeline to
follow the sequence. The narrator settings offer available natural or device voices.
**Illustrate** requests animated concept drawings; with a real agent this is a
separate model call. Closing the player returns to the editable canvas.

For supported synthetic terminal flows, edit **Sample data → Update sample** to
recalculate previews. These calculations do not execute displayed commands or read
files from your computer. See the [process engine](PROCESS-ENGINE.md).

## Import and export

Use **Import** for saved board JSON, legacy OSG, text/Markdown or a legacy database bundle. Inspect the preview before creating private copies. From **Export**:

| Format                   | Use                                                  |
| ------------------------ | ---------------------------------------------------- |
| Editable board (`.json`) | Back up board content or import it later.            |
| Vector image (`.svg`)    | Share a scalable diagram.                            |
| PNG image (`.png`)       | Share a raster diagram with transparency support.    |
| JPEG image (`.jpg`)      | Share a raster diagram suited to email or documents. |
| Markdown notes (`.md`)   | Read the concepts and connections as text.           |

Exports contain the board's content; check them for sensitive information before
sharing. Image and Markdown exports are not editable board backups. A board you filed in
a collection names that collection in its `.json` file, beside the board itself. Importing
the file files the new board in your collection of that name (ignoring case), creating it
if you have none; the import preview says so.

## Connect a coding agent

Create a revocable key under **Account → Agent keys**, then follow the
[MCP setup guide](../apps/mcp/README.md). Keys are local-only and act as their owning
account. Keep them out of Git commits, public issues, and screenshots.

## Groups, sources and collaboration

Use **Groups** in the board header to create nested groups, optionally
show outlines and collapse sections. Groups preserve the underlying concepts and
layout. Add personal notes and HTTP/HTTPS sources in concept details.

Owners grant/revoke editing to existing accounts under **Share** in the board header. Invitees
open boards from **Boards → Shared with you**. This works on one local Opsis server;
public visibility alone remains read-only. Idle views synchronize revisions, and
conflict recovery preserves unsaved edits. **Compare boards or saved revisions**
in Boards compares content and layout without changing either version.

See [P2 workflows](P2-WORKFLOWS.md) for exact import limits, templates, streaming
previews, collaboration behavior and persistence details.

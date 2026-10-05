# User guide

[Documentation index](README.md) · [Getting started](GETTING-STARTED.md)

## Explore and edit a board

Start with an example or ask a question in the composer. Select a concept to read
its explanation. Drag icons to change their positions; use connection ports to
connect concepts. Select a connection to edit its label, color, or type.

Use **Arrange downward** to lay out a crowded diagram, **Read from top** for a
legible starting view, and **Fit diagram** for an overview. Undo and redo retain
up to 40 past/future states. A drag is one undoable action.

To give the canvas more room, tuck the workspace away: the sidebar button hides the
sidebar, **The big picture** folds into one line, **Hide canvas tools** shrinks the
toolbar to a single button, and the composer's minimize arrow turns it into an
**Ask a follow-up** button. Board menus (**Share**, **Groups**, **Import**, **Export**)
drop down from the header and close on Escape or a click elsewhere. The toolbar and
composer choices are remembered on this device. The composer stays open on an empty
canvas and while an agent is working, and reopens when a suggestion is chosen.

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

## Save and organize projects

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

Collections are private to your account and do not change a board's content,
history or sharing. See [collections](PERSISTENCE.md#collections).

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
sharing. Image and Markdown exports are not editable board backups.

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

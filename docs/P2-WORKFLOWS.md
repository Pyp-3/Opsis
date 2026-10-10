# Groups, sources, imports and shared editing

## Nested groups

Open **Groups** (Groups and subgraphs) in the board header. Create a group, select its concepts,
and optionally choose a parent group. Each concept belongs directly to one group;
parents include all descendants. Cycles and duplicate membership are rejected.
**Show group boundary** draws an optional outline. **Collapse subgraph** substitutes
a representative concept and redirects the visible external connections. It does
not delete concepts, calculations, original endpoints or positions. Expand before
editing the hidden concepts individually. Group edits are undoable and saved with
the board, copies, templates and revisions. Deleting a group keeps its concepts.
Public viewers can expand/collapse locally under the header's **Groups** menu without
changing the owner's document. JSON includes groups; picture exports intentionally
show the full graph, and playback still follows every underlying concept.

## Notes and sources

Concept details now contain **Notes and sources**. Notes save when the field loses
focus. A source can have a title and an optional HTTP/HTTPS link. Imported text also
retains the original excerpt. These fields persist in SQLite snapshots, revisions,
templates and JSON; Markdown exports include them. Sources are reader-supplied
references, not evidence that Opsis has verified the claim. Plain text is rendered
as text, and source links open with opener isolation.

## Reviewed document and legacy imports

**Import** accepts v2 JSON, legacy OSG JSON, `.txt` and `.md`. Preview the concepts
before choosing **Import as new board**; discard leaves the active board untouched.
Text import runs locally, without an agent: paragraphs become independent concepts
with source filename/section and exact excerpts. It creates no inferred connections.
The limit is 100,000 text characters and 50 concepts; long paragraphs split at 2,800
characters. PDF/image uploads remain available through agent generation with their
existing attachment boundaries; this local importer does not parse binary documents.

For a historical SQLite database, from a developer checkout run:

```sh
pnpm database export-legacy SOURCE.sqlite NEW_BUNDLE.json
```

This opens `osg_documents` read-only and exclusively creates a bundle; it never
rewrites historical tables or overwrites an output file. Up to 100 source documents
are exported per batch. Invalid/oversized records are listed as rejected, with
source IDs but without their contents in error messages. Keep the original database
as the archival source. Import the bundle through **Import**, inspect the list and
choose **Import remaining boards**. Accepted records become independent private
boards for the signed-in account through the normal API, on either host. If a batch
stops, the open review retains the remaining queue for retry. Closing/reloading that
review discards its progress; importing the bundle again creates additional copies.
A connection loss after a server commit can leave a saved copy despite the error;
check the library before retrying. The file limit is 20 MB.

Legacy primitive names map to appropriate library icons; X/Y positions are projected,
original XYZ coordinates and source text are retained in notes/references, and scenes
become optional groups. Depth, 3D animation and executable behavior are not recreated.
The bundle is a migration artifact, not a backup of every historical table.

## Examples, templates and comparison

Home includes email, DNS, a branching approval process and a synthetic data pipeline.
All open without paid model calls. Save any owned board as a named template from
Boards; creating a board from it preserves process data, groups, notes and layout
in an independent private copy.

In Boards, open **Compare boards or saved revisions**. Choose two owned boards, or
the same board twice. Leave revisions blank for current content, or enter revision
numbers from **Saved revisions**. Comparison shows additions, removals, content,
source metadata, layout, ports and group changes without changing either version.
Revision browsing and restore-as-copy remain owner-only. The revision archive begins
with the P0 migration; it cannot recover older discarded saves.

## Streamed draft concepts

While a compatible CLI streams structured JSON, complete concepts appear in a
**Draft concepts · not saved** panel as soon as each validates. Partial objects,
duplicate IDs and invalid concepts are withheld. The preview is bounded to 50
concepts and resets for the single repair attempt. It never replaces the saved
canvas or bypasses final graph/process validation and proposal review. Cancellation,
a timeout or malformed completion retains the current board. Claude's structured
JSON deltas support early previews; Codex's current completed-message envelope only
makes concepts available when that message completes. No invented partial progress
is shown for a CLI that does not emit it.

## Shared editing on one server

An owner opens **Share** (Shared editing) in the board header and enters another existing account's email to
**Grant editing**. This changes that board only. The invitee finds it under
**Boards → Shared with you**. Owners can revoke editing at any time. Editors can
change content; they cannot change sharing, archive/delete the original, manage its
templates or browse private saved revisions. Link or public sharing alone remains read-only,
and viewers never receive pages the owner or an editor has hidden, unless they open that
page's own link (see the [user guide](USER-GUIDE.md#turn-a-board-into-pages)).
Archived boards are unavailable to editors until the owner unarchives them. Copies
are private and do not inherit invitations.

Idle views poll every 1.5 seconds; generation/review, playback, dragging and pending
saves pause polling. Every write checks the revision. Concurrent edits preserve
unrelated fields; same-field conflicts use the existing local-edit merge policy,
with the remote state retained in undo/revision history. Invalid merges recover as
private copies. This is revision-based collaboration, not simultaneous text cursors
or a CRDT. Revocation immediately blocks server writes; an editor's next failed save
can recover their unsaved content into a private copy. As with any shared document,
revocation cannot retract copies the recipient already received.

The server must be reachable within the existing supported local deployment boundary.
This delivery adds neither internet hosting nor synchronization between installations.
See [release readiness](RELEASE-READINESS.md) for the deployment review.

# Persistence, history and recovery

These operations work with both the Fastify development API and the Go desktop
host. Both use the same versioned SQLite migrations. Existing boards, accounts,
templates, sessions, keys, deletion tombstones and legacy tables stay in place.
Migrations run transactionally and are recorded in `schema_migrations`; a database
with an unknown migration version requires a newer application.

## Organize and recover boards

In **Manage boards**, each board has **Duplicate**, **Archive/Unarchive**, and
**Revision history** actions, alongside rename, template, sharing and deletion.

- Duplicate copies the saved diagram, positions, ports and appearance into an
  independent private board with fresh undo/redo history. Pending edits to the
  current board are saved first; a stale source revision requires a refresh.
- Archive hides a board from My boards, home-page recent boards and public viewers.
  The owner can find and open it under **Archive**. It retains its content and
  history; unarchiving restores its previous sharing setting. Archiving advances
  the persistence revision, so stale tabs cannot undo it with a save.
- Revision history lists saves newest first, in pages of 50. Select a revision to
  inspect its concepts and relationships, then **Restore … as private copy** to
  open the original layout. The source board is unchanged. Historical revisions
  are owner-only, even for public boards.

### Collections

Collections are private folders that group your own boards in **Manage boards →
My boards**. Use **New collection**, then the folder action on a board card
(**Move … to a collection**) to file it; the chips above the list filter by
**All boards**, **Unfiled**, or one collection. While a collection is selected,
new boards are created inside it. A board belongs to at most one collection.

- Filing is organization, not an edit: it does not advance the board's revision,
  change its update time or add an undo step, so it cannot conflict with an open
  canvas or another tab.
- Collections are per account. Names are unique per account ignoring case, 1–60
  characters, with up to 100 collections. Other accounts, editors and public
  viewers never see your collections; shared or public boards appear unfiled to them.
- A duplicate is filed beside its source. Archived boards keep their collection
  and return to it when unarchived.
- Deleting a collection never deletes boards: its boards return to **Unfiled**.
- Collections are stored in SQLite (`board_collections` and
  `boards_v2.collection_id`, migration 3), so they are included in full-database
  backups. Per-board JSON exports do not record a collection.

The revision archive starts with the saved state present when the migration is
installed and records subsequent successful content saves and archive changes.
It cannot reconstruct older saves that were never retained. Undo/redo stays
bounded to 40 entries; the separate revision archive has no automatic expiration.
Each archive entry stores the diagram once, without another copy of its undo stack.
Frequent saves of large diagrams will increase database size.

Permanent board deletion removes its current state, undo/redo and archived
revisions. A deletion tombstone remains to reject stale-tab resurrection.
Templates copied from that board remain independent. Database backups and exported
files are not changed by deletion; keep or remove those separately. There is no
scheduled backup, automatic backup pruning, or hosted cross-device sync.

## Full-database backup and restore

For the Linux desktop executable, choose a new backup filename:

```sh
./opsis --backup-database /absolute/path/opsis-backup.sqlite
```

This reads the database selected by `OPSIS_DATA_DIR` / `OPSIS_DB_PATH`, including
committed WAL writes. It can run while the desktop is open; it does not open a window.
Wait for **Saved** first: unsaved browser recovery is not part of SQLite.

Restore into a **new profile**, leaving the original intact:

```sh
OPSIS_DATA_DIR=/absolute/path/new-profile ./opsis --import-database /absolute/path/opsis-backup.sqlite
OPSIS_DATA_DIR=/absolute/path/new-profile ./opsis
```

For browser development, from the repository, use absolute paths:

```sh
pnpm database backup /absolute/path/opsis.sqlite /absolute/path/opsis-backup.sqlite
pnpm database restore /absolute/path/opsis-backup.sqlite /absolute/path/restored.sqlite
OPSIS_DB_PATH=/absolute/path/restored.sqlite pnpm dev
```

Backup/restore checks SQLite integrity and creates a consistent snapshot, rather
than copying only the main file of a live WAL database. The destination database
and its WAL/SHM sidecars must not already exist. Files are published without
overwriting existing data; source databases are unchanged. A failed copy does not
replace your database. Existing imports remain supported by `--import-database`.

Backups contain every account's boards and credential records, including password
hashes, sessions and agent-key hashes. Protect the backup as you would the original
database. POSIX backups are created with owner-only permissions; on Windows protect
the containing directory with your account's filesystem permissions. Restoring an
older backup restores its session/key state too, including any keys revoked after
that snapshot; revoke those keys again before using that restored profile.

Backups are manual and retained until you delete them. Keep dated copies on a
separate device and periodically restore to a new profile to check them. A backup
is a recovery snapshot, not a merge: restoring does not combine newer changes from
the original database. Portable per-board JSON exports remain available and do not
contain accounts, credentials or the long-term revision archive.

## Verification

- Fastify persistence tests cover legacy migration, reopening, live WAL backup and
  restore, archived states, preserved legacy tables/templates/tombstones, ownership,
  stale copies/writes, revision pagination beyond 40 undo entries and deletion.
- Native tests exercise the same migration catalogue, archived-board privacy,
  independent copies, revision restoration and live database snapshots.
- Browser coverage exercises duplication, archive across reload, revision preview,
  restore-as-copy and unarchive against both API hosts.
- Both hosts test collection privacy, case-insensitive names, filing at creation,
  unchanged revisions when filing, copies filed beside their source and deletion
  that ungroups boards. Browser coverage files boards, filters across reload and
  deletes a collection while keeping its boards.

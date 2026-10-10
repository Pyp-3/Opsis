import { apiFetch as fetch } from '../app-url';
import { SharedBoards } from './BoardSharing';
import { CollectionActions } from './CollectionActions';
import { BoardComparison } from './BoardComparison';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Globe,
  Link2,
  Grid2X2,
  Lock,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Trash2,
  Copy,
  Archive,
  ArchiveRestore,
  History,
  CopyPlus,
  FolderInput,
  Tag,
  ListChecks,
} from 'lucide-react';
import type { useBoardLibrary } from './useBoardLibrary';
import { TemplatesPanel } from './TemplatesPanel';
import type { BoardVisibility } from '@opsis/schema';
import { HomeBackdrop } from './HomeBackdrop';
import { BoardRevisionPanel } from './BoardRevisionPanel';
import { useBoardCollections } from './useBoardCollections';
import {
  BulkMoveBar,
  CollectionBar,
  EditTags,
  boardsInCollectionPath,
  collectionFilterFromSearch,
  filingTarget,
  MoveToCollection,
  inCollection,
  type CollectionFilter,
} from './BoardCollections';

export type PublicBoard = {
  id: string;
  title: string;
  updatedAt: number;
  ownerName: string;
};
/** Boards other people have made public. */
export async function fetchPublicBoards(): Promise<PublicBoard[]> {
  const response = await fetch('/v1/boards/public');
  if (!response.ok) throw new Error('Could not load public boards.');
  return (await response.json()) as PublicBoard[];
}

const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
/** The library's sharing button steps through who can open a board, one click at a time. */
const SHARING: Record<BoardVisibility, { next: BoardVisibility; change: string; title: string }> = {
  private: {
    next: 'link',
    change: 'Share with anyone who has the link:',
    title: 'Private · share by link',
  },
  link: {
    next: 'public',
    change: 'Make public:',
    title: 'Anyone with the link · make public',
  },
  public: { next: 'private', change: 'Make private:', title: 'Public · make private' },
};

export function updatedLabel(updatedAt: number, now = Date.now()) {
  const seconds = Math.round((updatedAt - now) / 1000);
  for (const [unit, size] of [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const)
    if (Math.abs(seconds) >= size)
      return `Updated ${relative.format(Math.round(seconds / size), unit)}`;
  return 'Updated just now';
}

/** The saved-board library as its own page: create, open, search, rename and delete. */
export function BoardsPage({
  library,
  onOpen,
  onCreated,
}: {
  library: ReturnType<typeof useBoardLibrary>;
  onOpen: (id: string) => Promise<void>;
  onCreated: () => void;
}) {
  const { refresh } = library;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editAction, setEditAction] = useState<'rename' | 'template'>('rename');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'mine' | 'public' | 'templates' | 'archive'>('mine');
  const [shared, setShared] = useState<PublicBoard[] | null>(null);
  const [sharedError, setSharedError] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [tagging, setTagging] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  // The address carries the filter, so home's "All in <collection>" and a reload open it.
  const [collectionFilter, setFilterState] = useState<CollectionFilter>(() =>
    collectionFilterFromSearch(location.search),
  );
  const setCollectionFilter = (filter: CollectionFilter) => {
    setFilterState(filter);
    history.replaceState(history.state, '', boardsInCollectionPath(filter));
  };
  // Selecting several boards to move them together; ids not currently shown are ignored.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const collections = useBoardCollections(refresh);
  const collectionName = (id: string | null | undefined) =>
    collections.collections.find((collection) => collection.id === id)?.name;
  // A filter for a collection that no longer exists (deleted elsewhere) shows everything.
  const activeFilter =
    collectionFilter === 'all' ||
    collectionFilter === 'unfiled' ||
    collectionName(collectionFilter) ||
    collections.smartCollections.some((smart) => `smart:${smart.id}` === collectionFilter)
      ? collectionFilter
      : 'all';
  const filingInto = filingTarget(activeFilter);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  useEffect(() => {
    if (tab !== 'public') return;
    let live = true;
    fetchPublicBoards()
      .then((list) => live && setShared(list))
      .catch((e: Error) => live && setSharedError(e.message));
    return () => {
      live = false;
    };
  }, [tab]);
  const matches = (title: string) => title.toLowerCase().includes(query.trim().toLowerCase());
  const sharedEntries = (shared ?? [])
    .filter((entry) => matches(entry.title) || matches(entry.ownerName))
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt));
  useEffect(() => {
    document.title = 'Your boards · Opsis';
    return () => {
      document.title = 'Opsis';
    };
  }, []);
  const tabEntries = library.entries.filter(
    (entry) => Boolean(entry.archived) === (tab === 'archive'),
  );
  // Collections organize the active library; the archive lists everything archived.
  const allTags = [
    ...new Map(
      tabEntries.flatMap((entry) => entry.tags ?? []).map((tag) => [tag.toLowerCase(), tag]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
  const activeTag = allTags.find((tag) => tag.toLowerCase() === tagFilter.toLowerCase()) ?? '';
  const visibleEntries = tabEntries.filter(
    (entry) =>
      (tab === 'archive' || inCollection(entry, activeFilter, collections.smartCollections)) &&
      (!activeTag ||
        (entry.tags ?? []).some((tag) => tag.toLowerCase() === activeTag.toLowerCase())),
  );
  const historyEntry = library.entries.find((entry) => entry.id === historyId);
  const entries = visibleEntries
    .filter((entry) => entry.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt));
  const canSelect = selecting && tab === 'mine';
  const selectedEntries = canSelect ? entries.filter((entry) => selectedIds.has(entry.id)) : [];
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <main className="page-main boards-main">
      <div className="boards-intro">
        <HomeBackdrop />
        <span className="eyebrow">
          <LayoutGrid size={13} /> Library
        </span>
        <h1>Your boards</h1>
        <p>
          Every board is saved to this computer. Open one to keep exploring, rename or tidy up, or
          start fresh. Make a board public to share it with friends.
        </p>
      </div>
      <SharedBoards onOpen={onOpen} />
      <BoardComparison entries={library.entries} />
      <div className="boards-tabs" role="tablist" aria-label="Boards">
        <span className="boards-tabs-thumb" data-tab={tab} aria-hidden />
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          <LayoutGrid size={14} /> My boards
        </button>
        <button role="tab" aria-selected={tab === 'public'} onClick={() => setTab('public')}>
          <Globe size={14} /> Public boards
        </button>
        <button role="tab" aria-selected={tab === 'templates'} onClick={() => setTab('templates')}>
          <Copy size={14} /> Templates
        </button>
        <button role="tab" aria-selected={tab === 'archive'} onClick={() => setTab('archive')}>
          <Archive size={14} /> Archive
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {historyEntry && (
        <BoardRevisionPanel
          key={historyEntry.id}
          entry={historyEntry}
          library={library}
          onClose={() => setHistoryId(null)}
          onCreated={onCreated}
        />
      )}
      {tab === 'archive' && (
        <p>
          Archived boards stay on this computer and are hidden from public viewing. Unarchiving
          restores their previous sharing setting.
        </p>
      )}
      {tab === 'templates' ? (
        <TemplatesPanel library={library} onCreated={onCreated} />
      ) : tab === 'public' ? (
        <section className="boards-public" aria-label="Public boards">
          <label className="concept-search">
            <Search size={14} />
            <input
              aria-label="Search public boards"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or owner"
            />
          </label>
          {sharedError && (
            <p className="workspace-error" role="alert">
              {sharedError}
            </p>
          )}
          <ul className="board-cards">
            {sharedEntries.map((entry) => (
              <li key={entry.id}>
                <button
                  className="board-card-open"
                  disabled={library.switching}
                  onClick={() => void onOpen(entry.id)}
                >
                  <span className="board-card-icon is-shared">
                    <Globe size={18} />
                  </span>
                  <strong>{entry.title}</strong>
                  <small>
                    By {entry.ownerName} · {updatedLabel(entry.updatedAt)}
                  </small>
                  <span className="board-card-go">
                    View <ArrowRight size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shared && !shared.length && (
            <p className="boards-empty">
              Nobody has shared a board yet. When friends make a board public, it appears here.
            </p>
          )}
        </section>
      ) : (
        <>
          {tab === 'mine' && (
            <CollectionBar
              collections={collections}
              boards={tabEntries}
              filter={activeFilter}
              onFilter={setCollectionFilter}
              disabled={library.switching}
            />
          )}
          {tab === 'mine' && (
            <CollectionActions
              collection={collections.collections.find((item) => item.id === filingInto)}
              boards={library.entries}
              refresh={async () => {
                await refresh();
                await collections.reload();
              }}
              imported={setCollectionFilter}
            />
          )}
          <form
            className="boards-create"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                title.trim() &&
                (await library.manage(
                  'create',
                  undefined,
                  title.trim(),
                  undefined,
                  undefined,
                  undefined,
                  tab === 'mine' ? filingInto : undefined,
                ))
              ) {
                setTitle('');
                onCreated();
              }
            }}
          >
            <label>
              {tab === 'mine' && filingInto
                ? `New board in ${collectionName(filingInto)}`
                : 'New board name'}
              <input
                value={title}
                maxLength={100}
                required
                onChange={(event) => setTitle(event.target.value)}
                disabled={library.switching}
                placeholder="e.g. How DNS works"
              />
            </label>
            <button disabled={library.switching || !title.trim()}>
              <Plus size={16} /> Create board
            </button>
          </form>
          <div className="boards-toolbar">
            <label className="concept-search">
              <Search size={14} />
              <input
                aria-label="Search boards"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name"
              />
            </label>
            {allTags.length > 0 && (
              <label className="boards-sort">
                Tag
                <select
                  aria-label="Filter by tag"
                  value={activeTag}
                  onChange={(event) => setTagFilter(event.target.value)}
                >
                  <option value="">All tags</option>
                  {allTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="boards-sort">
              Sort by
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as 'recent' | 'name')}
              >
                <option value="recent">Recently updated</option>
                <option value="name">Name</option>
              </select>
            </label>
            <span className="boards-count">
              {entries.length} of {visibleEntries.length} boards
            </span>
            {tab === 'mine' && !canSelect && entries.length > 1 && (
              <button
                type="button"
                className="boards-select"
                disabled={library.switching}
                onClick={() => {
                  setSelecting(true);
                  setSelectedIds(new Set());
                  setMoving(null);
                }}
              >
                <ListChecks size={14} /> Select boards
              </button>
            )}
          </div>
          {canSelect && (
            <BulkMoveBar
              selected={selectedEntries.length}
              shown={entries.length}
              collections={collections.collections}
              disabled={library.switching || collections.busy}
              onSelectAll={() => setSelectedIds(new Set(entries.map((entry) => entry.id)))}
              onClear={() => setSelectedIds(new Set())}
              onDone={() => setSelecting(false)}
              onMove={async (collectionId) => {
                // Boards already there need no request.
                const ids = selectedEntries
                  .filter((entry) => (entry.collectionId ?? null) !== collectionId)
                  .map((entry) => entry.id);
                const moved = ids.length ? await collections.fileMany(ids, collectionId) : 0;
                if (moved < ids.length) return;
                const count = `${selectedEntries.length} ${selectedEntries.length === 1 ? 'board' : 'boards'}`;
                setNotice(
                  collectionId
                    ? `Moved ${count} to ${collectionName(collectionId)}.`
                    : `Removed ${count} from their collections.`,
                );
                setSelectedIds(new Set());
                setSelecting(false);
              }}
            />
          )}
          {library.error && (
            <p className="workspace-error" role="alert">
              {library.error}
            </p>
          )}
          <ul className="board-cards">
            {entries.map((entry) => {
              const current = entry.id === library.activeId;
              return (
                <li
                  key={entry.id}
                  className={[
                    current ? 'is-current' : '',
                    canSelect && selectedIds.has(entry.id) ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {canSelect && ![moving, tagging, editing].includes(entry.id) && (
                    <label className="board-card-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.title}`}
                        checked={selectedIds.has(entry.id)}
                        disabled={library.switching || collections.busy}
                        onChange={() => toggleSelected(entry.id)}
                      />
                    </label>
                  )}
                  {tagging === entry.id ? (
                    <EditTags
                      title={entry.title}
                      current={entry.tags ?? []}
                      disabled={library.switching || collections.busy}
                      onCancel={() => setTagging(null)}
                      onSave={async (tags) => {
                        if (!(await collections.tag(entry.id, tags))) return;
                        setTagging(null);
                        setNotice(`Tags saved for “${entry.title}”.`);
                      }}
                    />
                  ) : moving === entry.id ? (
                    <MoveToCollection
                      title={entry.title}
                      current={entry.collectionId}
                      collections={collections.collections}
                      disabled={library.switching || collections.busy}
                      onCancel={() => setMoving(null)}
                      onMove={async (collectionId) => {
                        if (!(await collections.file(entry.id, collectionId))) return;
                        setMoving(null);
                        setNotice(
                          collectionId
                            ? `Moved “${entry.title}” to ${collectionName(collectionId)}.`
                            : `“${entry.title}” is no longer in a collection.`,
                        );
                      }}
                    />
                  ) : editing === entry.id ? (
                    <form
                      className="board-rename"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (name.trim() && (await library.manage(editAction, entry, name.trim()))) {
                          setEditing(null);
                          if (editAction === 'template')
                            setNotice(`Template “${name.trim()}” saved. Find it in Templates.`);
                        }
                      }}
                    >
                      <label>
                        {editAction === 'template' ? 'Template name' : 'Rename board'}
                        <input
                          autoFocus
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          maxLength={100}
                          required
                          disabled={library.switching}
                        />
                      </label>
                      <div>
                        <button disabled={library.switching || !name.trim()}>
                          {editAction === 'template' ? 'Save template' : 'Save name'}
                        </button>
                        <button
                          type="button"
                          disabled={library.switching}
                          onClick={() => setEditing(null)}
                        >
                          {editAction === 'template' ? 'Cancel template' : 'Cancel rename'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        className="board-card-open"
                        disabled={library.switching}
                        onClick={() => void onOpen(entry.id)}
                      >
                        <span className="board-card-icon">
                          <Grid2X2 size={18} />
                        </span>
                        <strong>{entry.title}</strong>
                        <small>
                          {current ? 'Open now · ' : ''}
                          {entry.archived ? 'Archived · ' : ''}
                          {entry.visibility === 'public'
                            ? 'Public · '
                            : entry.visibility === 'link'
                              ? 'Anyone with the link · '
                              : ''}
                          {activeFilter === 'all' && collectionName(entry.collectionId)
                            ? `${collectionName(entry.collectionId)} · `
                            : ''}
                          {updatedLabel(entry.updatedAt)}
                        </small>
                        {!!entry.tags?.length && (
                          <span className="board-card-tags" aria-label="Tags">
                            {entry.tags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </span>
                        )}
                        <span className="board-card-go">
                          Open <ArrowRight size={14} />
                        </span>
                      </button>
                      <div className="board-card-actions">
                        <button
                          aria-label={`Duplicate ${entry.title}`}
                          title="Duplicate as private board"
                          disabled={library.switching}
                          onClick={async () => {
                            if (await library.manage('duplicate', entry)) {
                              setNotice('Private copy created with fresh undo history.');
                              onCreated();
                            }
                          }}
                        >
                          <CopyPlus size={15} />
                        </button>
                        <button
                          aria-label={`${entry.archived ? 'Unarchive' : 'Archive'} ${entry.title}`}
                          title={
                            entry.archived ? 'Unarchive' : 'Archive (hide from public viewing)'
                          }
                          disabled={library.switching}
                          onClick={async () => {
                            if (
                              await library.manage(entry.archived ? 'unarchive' : 'archive', entry)
                            )
                              setNotice(
                                entry.archived
                                  ? 'Board unarchived.'
                                  : 'Board archived. Find it in Archive.',
                              );
                          }}
                        >
                          {entry.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                        </button>
                        <button
                          aria-label={`Move ${entry.title} to a collection`}
                          title="Move to collection"
                          disabled={library.switching}
                          onClick={() => {
                            setMoving(entry.id);
                            setTagging(null);
                            setEditing(null);
                            setDeleting(null);
                          }}
                        >
                          <FolderInput size={15} />
                        </button>
                        <button
                          aria-label={`Edit tags for ${entry.title}`}
                          title="Edit tags"
                          disabled={library.switching}
                          onClick={() => {
                            setTagging(entry.id);
                            setMoving(null);
                            setEditing(null);
                            setDeleting(null);
                          }}
                        >
                          <Tag size={15} />
                        </button>
                        <button
                          aria-label={`Revision history for ${entry.title}`}
                          title="Revision history"
                          disabled={library.switching}
                          onClick={() => setHistoryId(entry.id)}
                        >
                          <History size={15} />
                        </button>
                        <button
                          aria-label={`Save ${entry.title} as template`}
                          title="Save as template"
                          disabled={library.switching}
                          onClick={() => {
                            setEditing(entry.id);
                            setEditAction('template');
                            setName(entry.title);
                            setDeleting(null);
                            setNotice('');
                          }}
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          aria-label={`${SHARING[entry.visibility ?? 'private'].change} ${entry.title}`}
                          title={SHARING[entry.visibility ?? 'private'].title}
                          className={
                            (entry.visibility ?? 'private') === 'private' ? '' : 'is-public'
                          }
                          disabled={library.switching}
                          onClick={() =>
                            void library.manage(
                              'share',
                              entry,
                              undefined,
                              SHARING[entry.visibility ?? 'private'].next,
                            )
                          }
                        >
                          {entry.visibility === 'public' ? (
                            <Globe size={15} />
                          ) : entry.visibility === 'link' ? (
                            <Link2 size={15} />
                          ) : (
                            <Lock size={15} />
                          )}
                        </button>
                        <button
                          aria-label={`Rename ${entry.title}`}
                          disabled={library.switching}
                          onClick={() => {
                            setEditing(entry.id);
                            setEditAction('rename');
                            setName(entry.title);
                            setDeleting(null);
                            setMoving(null);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label={`Delete ${entry.title}`}
                          disabled={library.switching}
                          onClick={() => {
                            setDeleting(entry.id);
                            setEditing(null);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </>
                  )}
                  {deleting === entry.id && (
                    <div
                      className="board-delete-confirm"
                      role="group"
                      aria-label="Confirm board deletion"
                    >
                      <p>
                        Delete “{entry.title}”, its undo history and saved revisions? This cannot be
                        undone. Export a backup first if needed.
                      </p>
                      <div>
                        <button
                          className="danger"
                          disabled={library.switching}
                          onClick={async () => {
                            if (await library.manage('delete', entry)) setDeleting(null);
                          }}
                        >
                          Delete permanently
                        </button>
                        <button disabled={library.switching} onClick={() => setDeleting(null)}>
                          Keep board
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!visibleEntries.length ? (
            <p className="boards-empty">
              {tab === 'archive'
                ? 'No archived boards.'
                : activeTag
                  ? `No boards here are tagged “${activeTag}”.`
                  : activeFilter.startsWith('smart:')
                    ? 'No boards match this smart collection yet.'
                    : activeFilter === 'unfiled'
                      ? 'Every board is in a collection.'
                      : filingInto
                        ? 'No boards in this collection yet. Create one above, or move a board here.'
                        : 'No saved boards yet. Create your first board above.'}
            </p>
          ) : (
            !entries.length && <p className="boards-empty">No boards match “{query}”.</p>
          )}
        </>
      )}
    </main>
  );
}

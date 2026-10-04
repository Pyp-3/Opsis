import { SharedBoards } from './BoardSharing';
import { BoardComparison } from './BoardComparison';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Globe,
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
} from 'lucide-react';
import type { useBoardLibrary } from './useBoardLibrary';
import { TemplatesPanel } from './TemplatesPanel';
import { HomeBackdrop } from './HomeBackdrop';
import { BoardRevisionPanel } from './BoardRevisionPanel';

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
  const visibleEntries = library.entries.filter(
    (entry) => Boolean(entry.archived) === (tab === 'archive'),
  );
  const historyEntry = library.entries.find((entry) => entry.id === historyId);
  const entries = visibleEntries
    .filter((entry) => entry.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt));
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
          <form
            className="boards-create"
            onSubmit={async (event) => {
              event.preventDefault();
              if (title.trim() && (await library.manage('create', undefined, title.trim()))) {
                setTitle('');
                onCreated();
              }
            }}
          >
            <label>
              New board name
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
          </div>
          {library.error && (
            <p className="workspace-error" role="alert">
              {library.error}
            </p>
          )}
          <ul className="board-cards">
            {entries.map((entry) => {
              const current = entry.id === library.activeId;
              return (
                <li key={entry.id} className={current ? 'is-current' : ''}>
                  {editing === entry.id ? (
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
                          {entry.visibility === 'public' ? 'Public · ' : ''}
                          {updatedLabel(entry.updatedAt)}
                        </small>
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
                          aria-label={
                            entry.visibility === 'public'
                              ? `Make ${entry.title} private`
                              : `Make ${entry.title} public`
                          }
                          title={
                            entry.visibility === 'public'
                              ? 'Public · make private'
                              : 'Private · make public'
                          }
                          className={entry.visibility === 'public' ? 'is-public' : ''}
                          disabled={library.switching}
                          onClick={() =>
                            void library.manage(
                              'share',
                              entry,
                              undefined,
                              entry.visibility === 'public' ? 'private' : 'public',
                            )
                          }
                        >
                          {entry.visibility === 'public' ? <Globe size={15} /> : <Lock size={15} />}
                        </button>
                        <button
                          aria-label={`Rename ${entry.title}`}
                          disabled={library.switching}
                          onClick={() => {
                            setEditing(entry.id);
                            setEditAction('rename');
                            setName(entry.title);
                            setDeleting(null);
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

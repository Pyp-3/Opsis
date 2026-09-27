import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Grid2X2,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { useBoardLibrary } from './useBoardLibrary';

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
  onBack,
}: {
  library: ReturnType<typeof useBoardLibrary>;
  onOpen: (id: string) => Promise<void>;
  onBack: () => void;
}) {
  const { refresh } = library;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  useEffect(() => {
    document.title = 'Your boards · Opsis';
    return () => {
      document.title = 'Opsis';
    };
  }, []);
  const entries = library.entries
    .filter((entry) => entry.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt));
  return (
    <div className="boards-page">
      <header className="boards-topbar">
        <a
          href="/"
          className="brand"
          aria-label="Opsis workspace"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          <span className="brand-symbol">
            <Grid2X2 size={17} />
          </span>
          <span>
            opsis<span className="brand-dot">.</span>
          </span>
        </a>
        <a
          href="/"
          className="header-button boards-back"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          <ArrowLeft size={15} /> Back to workspace
        </a>
      </header>
      <main className="boards-main">
        <div className="boards-intro">
          <span className="eyebrow">
            <LayoutGrid size={13} /> Library
          </span>
          <h1>Your boards</h1>
          <p>Every board is saved to this computer. Open one to keep exploring, or start fresh.</p>
        </div>
        <form
          className="boards-create"
          onSubmit={async (event) => {
            event.preventDefault();
            if (title.trim() && (await library.manage('create', undefined, title.trim()))) {
              setTitle('');
              onBack();
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
            {entries.length} of {library.entries.length} boards
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
                      if (name.trim() && (await library.manage('rename', entry, name.trim())))
                        setEditing(null);
                    }}
                  >
                    <label>
                      Rename board
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
                      <button disabled={library.switching || !name.trim()}>Save name</button>
                      <button
                        type="button"
                        disabled={library.switching}
                        onClick={() => setEditing(null)}
                      >
                        Cancel rename
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
                        {updatedLabel(entry.updatedAt)}
                      </small>
                      <span className="board-card-go">
                        Open <ArrowRight size={14} />
                      </span>
                    </button>
                    <div className="board-card-actions">
                      <button
                        aria-label={`Rename ${entry.title}`}
                        disabled={library.switching}
                        onClick={() => {
                          setEditing(entry.id);
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
                      Delete “{entry.title}” and its undo history? This cannot be undone. Export a
                      backup first if needed.
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
        {!library.entries.length ? (
          <p className="boards-empty">No saved boards yet. Create your first board above.</p>
        ) : (
          !entries.length && <p className="boards-empty">No boards match “{query}”.</p>
        )}
      </main>
    </div>
  );
}

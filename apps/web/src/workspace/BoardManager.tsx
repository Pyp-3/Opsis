import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type { useBoardLibrary } from './useBoardLibrary';

export function BoardManager({
  library,
  onOpen,
  onClose,
}: {
  library: ReturnType<typeof useBoardLibrary>;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { refresh } = library;
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    void refresh().catch(() => undefined);
  }, [refresh]);
  return (
    <dialog
      ref={dialog}
      className="board-manager"
      aria-labelledby="boards-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!library.switching) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">Workspace</span>
          <h2 id="boards-heading">Your boards</h2>
        </div>
        <button aria-label="Close board manager" disabled={library.switching} onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (title.trim() && (await library.manage('create', undefined, title.trim()))) {
            setTitle('');
            onClose();
          }
        }}
      >
        <label>
          New board name
          <input
            autoFocus
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
      <label>
        Search boards
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name"
        />
      </label>
      {library.error && <p role="alert">{library.error}</p>}
      <ul className="managed-boards">
        {library.entries
          .filter((entry) => entry.title.toLowerCase().includes(query.toLowerCase()))
          .map((entry) => (
            <li key={entry.id}>
              {editing === entry.id ? (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (name.trim() && (await library.manage('rename', entry, name.trim())))
                      setEditing(null);
                  }}
                >
                  <label>
                    Rename board
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={100}
                      required
                      disabled={library.switching}
                    />
                  </label>
                  <button disabled={library.switching || !name.trim()}>Save name</button>
                  <button
                    type="button"
                    disabled={library.switching}
                    onClick={() => setEditing(null)}
                  >
                    Cancel rename
                  </button>
                </form>
              ) : (
                <div className="managed-board-row">
                  <button
                    className="managed-board-open"
                    disabled={library.switching}
                    onClick={() => {
                      onOpen(entry.id);
                      onClose();
                    }}
                  >
                    {entry.title}
                    {entry.id === library.activeId && <small>Current board</small>}
                  </button>
                  <button
                    aria-label={`Rename ${entry.title}`}
                    disabled={library.switching}
                    onClick={() => {
                      setEditing(entry.id);
                      setName(entry.title);
                      setDeleting(null);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    aria-label={`Delete ${entry.title}`}
                    disabled={library.switching}
                    onClick={() => {
                      setDeleting(entry.id);
                      setEditing(null);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
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
                  <button
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
              )}
            </li>
          ))}
      </ul>
      {!library.entries.length && <p>No saved boards yet. Create your first board above.</p>}
    </dialog>
  );
}

import { useState, type ReactNode } from 'react';
import { Folder, FolderPlus, Inbox, LayoutGrid, Pencil, Trash2 } from 'lucide-react';
import type { BoardCollection, useBoardCollections } from './useBoardCollections';

/** All boards, only unfiled boards, or one collection's id. */
export type CollectionFilter = 'all' | 'unfiled' | (string & {});

type Collections = ReturnType<typeof useBoardCollections>;

/** Whether a board with this collection id is shown under `filter`. */
export function inCollection(collectionId: string | null | undefined, filter: CollectionFilter) {
  if (filter === 'all') return true;
  if (filter === 'unfiled') return !collectionId;
  return collectionId === filter;
}

/**
 * Filters the library by collection and manages the collections themselves.
 * Deleting a collection keeps its boards; they return to Unfiled.
 */
export function CollectionBar({
  collections,
  boards,
  filter,
  onFilter,
  disabled,
}: {
  collections: Collections;
  boards: { collectionId?: string | null | undefined }[];
  filter: CollectionFilter;
  onFilter: (next: CollectionFilter) => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'create' | 'rename' | 'delete'>('idle');
  const [name, setName] = useState('');
  const selected = collections.collections.find((collection) => collection.id === filter);
  const count = (target: CollectionFilter) =>
    boards.filter((board) => inCollection(board.collectionId, target)).length;
  const busy = disabled || collections.busy;
  const chip = (target: CollectionFilter, label: string, icon: ReactNode) => (
    <button
      key={target}
      type="button"
      aria-pressed={filter === target}
      disabled={busy}
      onClick={() => {
        onFilter(target);
        setMode('idle');
      }}
    >
      {icon} {label} <span className="board-collection-count">{count(target)}</span>
    </button>
  );
  return (
    <section className="board-collections" aria-label="Collections">
      <div className="board-collection-chips" role="group" aria-label="Show collection">
        {chip('all', 'All boards', <LayoutGrid size={13} />)}
        {chip('unfiled', 'Unfiled', <Inbox size={13} />)}
        {collections.collections.map((collection) =>
          chip(collection.id, collection.name, <Folder size={13} />),
        )}
        <button
          type="button"
          className="board-collection-new"
          disabled={busy}
          onClick={() => {
            setMode('create');
            setName('');
          }}
        >
          <FolderPlus size={13} /> New collection
        </button>
      </div>
      {selected && mode === 'idle' && (
        <div className="board-collection-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode('rename');
              setName(selected.name);
            }}
          >
            <Pencil size={13} /> Rename collection
          </button>
          <button type="button" disabled={busy} onClick={() => setMode('delete')}>
            <Trash2 size={13} /> Delete collection
          </button>
        </div>
      )}
      {(mode === 'create' || (mode === 'rename' && selected)) && (
        <form
          className="board-rename board-collection-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            if (mode === 'create') {
              const created = await collections.create(trimmed);
              if (!created) return;
              onFilter(created.id);
            } else if (!(await collections.rename(selected!.id, trimmed))) return;
            setMode('idle');
          }}
        >
          <label>
            {mode === 'create' ? 'Collection name' : 'Rename collection'}
            <input
              autoFocus
              value={name}
              maxLength={60}
              required
              disabled={busy}
              placeholder="e.g. Networking"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div>
            <button disabled={busy || !name.trim()}>
              {mode === 'create' ? 'Create collection' : 'Save collection name'}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {mode === 'delete' && selected && (
        <div className="board-delete-confirm" role="group" aria-label="Confirm collection deletion">
          <p>
            Delete the collection “{selected.name}”? Its {count(selected.id)} boards stay in your
            library under Unfiled.
          </p>
          <div>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (!(await collections.remove(selected.id))) return;
                setMode('idle');
                onFilter('all');
              }}
            >
              Delete collection
            </button>
            <button disabled={busy} onClick={() => setMode('idle')}>
              Keep collection
            </button>
          </div>
        </div>
      )}
      {collections.error && (
        <p className="workspace-error" role="alert">
          {collections.error}
        </p>
      )}
    </section>
  );
}

/** Chooses the collection for one board; replaces the card while open, like renaming. */
export function MoveToCollection({
  title,
  current,
  collections,
  disabled,
  onMove,
  onCancel,
}: {
  title: string;
  current: string | null | undefined;
  collections: BoardCollection[];
  disabled: boolean;
  onMove: (collectionId: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(current ?? '');
  return (
    <form
      className="board-rename"
      onSubmit={async (event) => {
        event.preventDefault();
        await onMove(target || null);
      }}
    >
      <label>
        Collection for {title}
        <select
          autoFocus
          value={target}
          disabled={disabled}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">No collection (unfiled)</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button disabled={disabled || target === (current ?? '')}>Move board</button>
        <button type="button" disabled={disabled} onClick={onCancel}>
          Cancel move
        </button>
      </div>
    </form>
  );
}

import { useState, type ReactNode } from 'react';
import {
  Folder,
  FolderInput,
  FolderPlus,
  Inbox,
  LayoutGrid,
  Pencil,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import {
  matchesSmartCollection,
  normalizeTags,
  SmartCollectionRuleSchema,
  type OrganizedBoard,
  type SmartCollectionRule,
} from '@opsis/schema';
import type { BoardCollection, SmartCollection, useBoardCollections } from './useBoardCollections';

/** All boards, unfiled boards, one collection's id, or `smart:<id>` for a smart collection. */
export type CollectionFilter = 'all' | 'unfiled' | (string & {});

type Collections = ReturnType<typeof useBoardCollections>;

const SMART = 'smart:';
const smartId = (filter: CollectionFilter) =>
  filter.startsWith(SMART) ? filter.slice(SMART.length) : undefined;

/** Whether a listed board is shown under `filter`. */
export function inCollection(
  board: OrganizedBoard,
  filter: CollectionFilter,
  smartCollections: SmartCollection[] = [],
) {
  if (filter === 'all') return true;
  if (filter === 'unfiled') return !board.collectionId;
  const smart = smartId(filter);
  if (smart) {
    const rule = smartCollections.find((item) => item.id === smart)?.rule;
    return !!rule && matchesSmartCollection(board, rule);
  }
  return board.collectionId === filter;
}

/** The library opened on one collection (or smart collection) filter. */
export function boardsInCollectionPath(filter: CollectionFilter) {
  return filter === 'all' ? '/boards' : `/boards?collection=${encodeURIComponent(filter)}`;
}

/** The collection filter a library address asks for, `all` when none. */
export function collectionFilterFromSearch(search: string): CollectionFilter {
  return new URLSearchParams(search).get('collection') || 'all';
}

/** The filter's collection id when new boards should be created inside it. */
export function filingTarget(filter: CollectionFilter) {
  return filter === 'all' || filter === 'unfiled' || smartId(filter) ? undefined : filter;
}

const splitTags = (value: string) => normalizeTags(value.split(','));

/**
 * Filters the library by collection or smart collection and manages both.
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
  boards: OrganizedBoard[];
  filter: CollectionFilter;
  onFilter: (next: CollectionFilter) => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'create' | 'rename' | 'delete' | 'smart'>('idle');
  const [name, setName] = useState('');
  const selected = collections.collections.find((collection) => collection.id === filter);
  const selectedSmart = collections.smartCollections.find((item) => item.id === smartId(filter));
  const [editingSmart, setEditingSmart] = useState<SmartCollection | null>(null);
  const count = (target: CollectionFilter) =>
    boards.filter((board) => inCollection(board, target, collections.smartCollections)).length;
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
        {collections.smartCollections.map((smart) =>
          chip(SMART + smart.id, smart.name, <Sparkles size={13} />),
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
        <button
          type="button"
          className="board-collection-new"
          disabled={busy}
          onClick={() => {
            setEditingSmart(null);
            setMode('smart');
          }}
        >
          <WandSparkles size={13} /> New smart collection
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
      {selectedSmart && mode === 'idle' && (
        <div className="board-collection-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditingSmart(selectedSmart);
              setMode('smart');
            }}
          >
            <Pencil size={13} /> Edit smart collection
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await collections.removeSmart(selectedSmart.id)) onFilter('all');
            }}
          >
            <Trash2 size={13} /> Delete smart collection
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
      {mode === 'smart' && (
        <SmartCollectionForm
          key={editingSmart?.id ?? 'new'}
          initial={editingSmart}
          collections={collections.collections}
          disabled={busy}
          onCancel={() => setMode('idle')}
          onSave={async (smartName, rule) => {
            const saved = await collections.saveSmart(smartName, rule, editingSmart?.id);
            if (!saved) return;
            setMode('idle');
            onFilter(SMART + saved.id);
          }}
        />
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

/** Names a saved rule. Every filled condition must hold for a board to appear. */
function SmartCollectionForm({
  initial,
  collections,
  disabled,
  onSave,
  onCancel,
}: {
  initial: SmartCollection | null;
  collections: BoardCollection[];
  disabled: boolean;
  onSave: (name: string, rule: SmartCollectionRule) => Promise<void>;
  onCancel: () => void;
}) {
  const rule = initial?.rule;
  const [name, setName] = useState(initial?.name ?? '');
  const [tagsAll, setTagsAll] = useState(rule?.tagsAll?.join(', ') ?? '');
  const [tagsAny, setTagsAny] = useState(rule?.tagsAny?.join(', ') ?? '');
  const [visibility, setVisibility] = useState(rule?.visibility ?? '');
  const [collection, setCollection] = useState(rule?.collection ?? '');
  const [days, setDays] = useState(rule?.updatedWithinDays ? String(rule.updatedWithinDays) : '');
  const [agent, setAgent] = useState(rule?.agent ?? '');
  const [title, setTitle] = useState(rule?.titleIncludes ?? '');
  const candidate = SmartCollectionRuleSchema.safeParse({
    ...(splitTags(tagsAll).length ? { tagsAll: splitTags(tagsAll) } : {}),
    ...(splitTags(tagsAny).length ? { tagsAny: splitTags(tagsAny) } : {}),
    ...(visibility ? { visibility } : {}),
    ...(collection ? { collection } : {}),
    ...(days ? { updatedWithinDays: Number(days) } : {}),
    ...(agent ? { agent } : {}),
    ...(title.trim() ? { titleIncludes: title.trim() } : {}),
  });
  return (
    <form
      className="board-rename board-smart-form"
      aria-label={initial ? `Edit ${initial.name}` : 'New smart collection'}
      onSubmit={async (event) => {
        event.preventDefault();
        if (name.trim() && candidate.success) await onSave(name.trim(), candidate.data);
      }}
    >
      <label>
        Smart collection name
        <input
          autoFocus
          value={name}
          maxLength={60}
          required
          disabled={disabled}
          placeholder="e.g. Exam prep this month"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="board-smart-conditions">
        <label>
          Has all tags
          <input
            value={tagsAll}
            disabled={disabled}
            placeholder="comma-separated"
            onChange={(event) => setTagsAll(event.target.value)}
          />
        </label>
        <label>
          Has any tag
          <input
            value={tagsAny}
            disabled={disabled}
            placeholder="comma-separated"
            onChange={(event) => setTagsAny(event.target.value)}
          />
        </label>
        <label>
          Sharing
          <select
            value={visibility}
            disabled={disabled}
            onChange={(event) => setVisibility(event.target.value as typeof visibility)}
          >
            <option value="">Any</option>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label>
          In collection
          <select
            value={collection}
            disabled={disabled}
            onChange={(event) => setCollection(event.target.value)}
          >
            <option value="">Any</option>
            <option value="unfiled">Unfiled</option>
            {collections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Updated within (days)
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            disabled={disabled}
            onChange={(event) => setDays(event.target.value)}
          />
        </label>
        <label>
          Made with
          <select
            value={agent}
            disabled={disabled}
            onChange={(event) => setAgent(event.target.value as typeof agent)}
          >
            <option value="">Any agent</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="demo">Examples (no agent)</option>
          </select>
        </label>
        <label>
          Title contains
          <input
            value={title}
            maxLength={100}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </div>
      {!candidate.success && <p className="board-smart-hint">Choose at least one condition.</p>}
      <div>
        <button disabled={disabled || !name.trim() || !candidate.success}>
          {initial ? 'Save smart collection' : 'Create smart collection'}
        </button>
        <button type="button" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
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

/**
 * Moves the selected boards to one collection (or none) in one action. Only boards still
 * shown count as selected, so a filter change never moves something out of sight.
 */
export function BulkMoveBar({
  selected,
  shown,
  collections,
  disabled,
  onSelectAll,
  onClear,
  onMove,
  onDone,
}: {
  selected: number;
  shown: number;
  collections: BoardCollection[];
  disabled: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onMove: (collectionId: string | null) => Promise<void>;
  onDone: () => void;
}) {
  const [target, setTarget] = useState('');
  return (
    <form
      className="board-bulk"
      aria-label="Move selected boards"
      onSubmit={async (event) => {
        event.preventDefault();
        if (selected) await onMove(target || null);
      }}
    >
      <span className="board-bulk-count" role="status">
        {selected} of {shown} selected
      </span>
      <button type="button" disabled={disabled || selected === shown} onClick={onSelectAll}>
        Select all shown
      </button>
      <button type="button" disabled={disabled || !selected} onClick={onClear}>
        Clear selection
      </button>
      <label>
        Move to
        <select
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
      <button className="board-bulk-move" disabled={disabled || !selected}>
        <FolderInput size={13} /> Move {selected} {selected === 1 ? 'board' : 'boards'}
      </button>
      <button type="button" disabled={disabled} onClick={onDone}>
        Done selecting
      </button>
    </form>
  );
}

/** Edits one board's tags as a comma-separated list; replaces the card while open. */
export function EditTags({
  title,
  current,
  disabled,
  onSave,
  onCancel,
}: {
  title: string;
  current: string[];
  disabled: boolean;
  onSave: (tags: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(current.join(', '));
  const tags = splitTags(value);
  const invalid = tags.length > 10 || tags.some((tag) => tag.length > 30);
  return (
    <form
      className="board-rename"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!invalid) await onSave(tags);
      }}
    >
      <label>
        Tags for {title}
        <input
          autoFocus
          value={value}
          disabled={disabled}
          placeholder="e.g. networking, exam"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {invalid && <p className="board-smart-hint">Use up to 10 tags of 1–30 characters.</p>}
      <div>
        <button disabled={disabled || invalid}>Save tags</button>
        <button type="button" disabled={disabled} onClick={onCancel}>
          Cancel tags
        </button>
      </div>
    </form>
  );
}

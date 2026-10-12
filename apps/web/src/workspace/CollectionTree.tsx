import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { collectionPathLabel } from '@opsis/schema';
import type { BoardCollection } from './useBoardCollections';

/** Nested lists retain native button keyboard behavior, including each collapse control. */
export function CollectionTree({
  collections,
  selected,
  disabled,
  count,
  onSelect,
}: {
  collections: BoardCollection[];
  selected: string;
  disabled: boolean;
  count: (id: string) => number;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const children = (parentId: string | null) =>
    collections.filter((item) => (item.parentId ?? null) === parentId);
  const branch = (parentId: string | null) => (
    <ul className="board-collection-tree">
      {children(parentId).map((item) => {
        const hasChildren = children(item.id).length > 0;
        const expanded = !collapsed.has(item.id);
        return (
          <li key={item.id}>
            <div className="board-collection-tree-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="board-collection-toggle"
                  disabled={disabled}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${collectionPathLabel(collections, item.id)}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsed((before) => {
                      const next = new Set(before);
                      if (!next.delete(item.id)) next.add(item.id);
                      return next;
                    })
                  }
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="board-collection-toggle-space" />
              )}
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected === item.id}
                title={collectionPathLabel(collections, item.id)}
                onClick={() => onSelect(item.id)}
              >
                <Folder size={13} /> {item.name}{' '}
                <span className="board-collection-count">{count(item.id)}</span>
              </button>
            </div>
            {hasChildren && expanded && branch(item.id)}
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="board-collection-browser">
      {collections.length > 0 && (
        <label className="board-collection-search">
          Find collection
          <input
            value={query}
            placeholder="Search collection paths"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {query.trim() ? (
        <ul className="board-collection-tree">
          {collections
            .filter((item) =>
              collectionPathLabel(collections, item.id)
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected === item.id}
                  onClick={() => onSelect(item.id)}
                >
                  <Folder size={13} /> {collectionPathLabel(collections, item.id)}{' '}
                  <span className="board-collection-count">{count(item.id)}</span>
                </button>
              </li>
            ))}
        </ul>
      ) : (
        branch(null)
      )}
    </div>
  );
}

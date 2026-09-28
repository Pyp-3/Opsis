import { useState } from 'react';
import { FolderOpen, Plus, Search } from 'lucide-react';
import type { BoardDocument } from '@opsis/schema';
import type { useBoardLibrary } from './useBoardLibrary';
import { boardIcons } from './icons';
import { BrandMark } from './BrandMark';

export function WorkspaceSidebar({
  board,
  busy,
  library,
  onNew,
  onOpen,
  onManage,
  commit,
  selected,
  selectNode,
  demo,
  dnsDemo,
}: {
  board: BoardDocument | null;
  busy: boolean;
  library: ReturnType<typeof useBoardLibrary>;
  onNew: () => void;
  onOpen: (id: string) => void;
  onManage: () => void;
  commit: (board: BoardDocument) => void;
  selected: string | null;
  selectNode: (id: string) => void;
  demo: () => void;
  dnsDemo: () => void;
}) {
  const [search, setSearch] = useState({ boardId: library.activeId, query: '' });
  const nodeSearch =
    search.boardId === library.activeId && (board?.nodes.length ?? 0) > 5 ? search.query : '';
  const visibleNodes =
    board?.nodes.filter((node) => node.label.toLowerCase().includes(nodeSearch.toLowerCase())) ??
    [];
  return (
    <aside className="workspace-rail" aria-label="Workspace">
      <div className="rail-head">
        <a href="/" className="brand" aria-label="Opsis home">
          <span className="brand-symbol">
            <BrandMark />
          </span>
          <span>
            opsis<span className="brand-dot">.</span>
          </span>
        </a>
      </div>
      <div className="rail-board-actions">
        <button className="new-board" disabled={busy || !board} onClick={onNew}>
          <Plus size={16} /> New canvas
        </button>
        <a
          href="/boards"
          className="manage-boards"
          aria-disabled={busy || undefined}
          onClick={(event) => {
            event.preventDefault();
            if (!busy) onManage();
          }}
        >
          <FolderOpen size={16} /> Manage boards
        </a>
      </div>
      <div className="rail-scroll">
        <details className="rail-section" open>
          <summary className="rail-section-title">
            Recent boards <span>{library.entries.length}</span>
          </summary>
          <nav className="node-list" aria-label="Saved boards">
            {library.entries.slice(0, 5).map((entry) => (
              <button
                key={entry.id}
                disabled={busy}
                aria-current={entry.id === library.activeId ? 'true' : undefined}
                onClick={() => onOpen(entry.id)}
              >
                {entry.title}
              </button>
            ))}
          </nav>
          {!library.entries.length && (
            <p className="rail-empty">Your saved boards will appear here.</p>
          )}
        </details>
        {board && (
          <section className="rail-section">
            <h2 className="rail-section-title">Current board</h2>
            <label className="concept-search">
              <input
                key={library.activeId + board.title}
                aria-label="Board name"
                defaultValue={board.title}
                maxLength={100}
                disabled={busy}
                onBlur={(event) => {
                  const title = event.target.value.trim();
                  if (title && title !== board.title) commit({ ...board, title });
                }}
              />
            </label>
            <details open className="rail-concepts">
              <summary className="rail-section-title">
                Concepts <span>{board.nodes.length}</span>
              </summary>
              {board.nodes.length > 5 && (
                <label className="concept-search">
                  <Search size={14} />
                  <input
                    aria-label="Find a concept"
                    placeholder="Find a concept…"
                    value={nodeSearch}
                    onChange={(event) =>
                      setSearch({ boardId: library.activeId, query: event.target.value })
                    }
                  />
                </label>
              )}
              <nav className="node-list" aria-label="Diagram steps">
                {visibleNodes.map((node) => {
                  const Icon = boardIcons[node.icon];
                  return (
                    <button
                      key={node.id}
                      className={selected === node.id ? 'active' : ''}
                      aria-current={selected === node.id ? 'true' : undefined}
                      onClick={() => selectNode(node.id)}
                    >
                      <Icon size={15} />
                      <span className="list-label">{node.label}</span>
                    </button>
                  );
                })}
              </nav>
              {!visibleNodes.length && (
                <p className="rail-empty">
                  {board.nodes.length
                    ? 'No matching concepts.'
                    : 'Add a concept or ask your agent to draw.'}
                </p>
              )}
            </details>
          </section>
        )}
      </div>
      <div className="rail-bottom">
        <details>
          <summary className="rail-section-title">Examples</summary>
          <div className="node-list">
            <button disabled={busy} onClick={demo}>
              An email’s journey
            </button>
            <button disabled={busy} onClick={dnsDemo}>
              DNS requests &amp; responses
            </button>
          </div>
        </details>
        <p className="rail-footnote">
          <span className="active-dot" /> Private workspace · saved locally
        </p>
      </div>
    </aside>
  );
}

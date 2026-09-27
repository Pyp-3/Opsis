import { useState } from 'react';
import { ArrowRight, GitBranch, Grid2X2, Mail, Plus, Search } from 'lucide-react';
import type { BoardDocument } from '@opsis/schema';
import type { useBoardLibrary } from './useBoardLibrary';
import { boardIcons } from './icons';

export function WorkspaceSidebar({
  board,
  busy,
  library,
  onNew,
  onOpen,
  commit,
  selected,
  selectNode,
  demo,
}: {
  board: BoardDocument | null;
  busy: boolean;
  library: ReturnType<typeof useBoardLibrary>;
  onNew: () => void;
  onOpen: (id: string) => void;
  commit: (board: BoardDocument) => void;
  selected: string | null;
  selectNode: (id: string) => void;
  demo: () => void;
}) {
  const [nodeSearch, setNodeSearch] = useState('');
  const visibleNodes =
    board?.nodes.filter((node) => node.label.toLowerCase().includes(nodeSearch.toLowerCase())) ??
    [];
  return (
    <aside className="workspace-rail" aria-label="Workspace">
      <div className="rail-head">
        <a href="/" className="brand" aria-label="Opsis home">
          <span className="brand-symbol">
            <Grid2X2 size={17} />
          </span>
          <span>
            opsis<span className="brand-dot">.</span>
          </span>
        </a>
      </div>
      <button className="new-board" disabled={busy || !board} onClick={onNew}>
        <Plus size={16} /> New canvas
      </button>
      <div className="rail-scroll">
        <section className="rail-section">
          <h2 className="rail-section-title">Saved boards</h2>
          <nav className="node-list" aria-label="Saved boards">
            {library.entries.map((entry) => (
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
        </section>
        <section className="rail-section">
          <h2 className="rail-section-title">Canvas</h2>
          {board && (
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
          )}
          <div className="current-board">
            <span className="current-board-icon">
              <Grid2X2 size={15} />
            </span>
            <span className="current-board-text">
              <strong>{board?.title ?? 'Untitled canvas'}</strong>
              <small>
                {board
                  ? `${board.nodes.length} concepts · ${board.edges.length} connections`
                  : 'Nothing drawn yet'}
              </small>
            </span>
          </div>
        </section>
        {board ? (
          <section className="rail-section rail-concepts">
            <h2 className="rail-section-title">
              Concepts <span>{board.nodes.length}</span>
            </h2>
            <label className="concept-search">
              <Search size={14} />
              <input
                aria-label="Find a concept"
                placeholder="Find a concept…"
                value={nodeSearch}
                onChange={(event) => setNodeSearch(event.target.value)}
              />
            </label>
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
                    <span className="list-number">
                      {String(board.nodes.indexOf(node) + 1).padStart(2, '0')}
                    </span>
                    <Icon size={15} />
                    <span className="list-label">{node.label}</span>
                    {board.edges.filter((edge) => edge.source === node.id).length > 1 && (
                      <GitBranch className="list-branch" size={13} aria-label="Branches" />
                    )}
                  </button>
                );
              })}
              {!visibleNodes.length && (
                <p className="rail-empty">No concepts match “{nodeSearch}”.</p>
              )}
            </nav>
          </section>
        ) : (
          <div className="rail-intro">
            <span className="eyebrow">Made for curious minds</span>
            <h2>Follow the idea. See the connections.</h2>
            <p>Turn a question into something you can explore, one step at a time.</p>
          </div>
        )}
      </div>
      <div className="rail-bottom">
        <button className="sample-card" disabled={busy} onClick={() => void demo()}>
          <span className="sample-icon">
            <Mail size={16} />
          </span>
          <span>
            <strong>An email’s journey</strong>
            <small>Open the example canvas</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <div className="connection-guide">
          <GitBranch size={15} />
          <p>
            <strong>Ideas can branch.</strong> Drag from any connection dot to another icon.
          </p>
        </div>
        <p className="rail-footnote">
          <span className="active-dot" /> Private workspace · saved locally
        </p>
      </div>
    </aside>
  );
}

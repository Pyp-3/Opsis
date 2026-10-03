import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Eye,
  FolderOpen,
  House,
  LogOut,
  Palette,
  Plus,
  Search,
  SquareDashedMousePointer,
} from 'lucide-react';
import type { BoardDocument } from '@opsis/schema';
import type { User } from '../auth/session';
import type { useBoardLibrary } from './useBoardLibrary';
import { NodeIcon } from './NodeIcon';
import { BrandMark } from './BrandMark';
import { navigate } from '../router';

/** Which page the sidebar sits beside; each shows only what that page needs. */
export type SidebarMode = 'home' | 'boards' | 'canvas' | 'settings' | 'account';

/** On phones the sidebar overlays the page, so it gets out of the way once you go somewhere. */
function go(to: string) {
  navigate(to);
  if (window.innerWidth <= 760) window.dispatchEvent(new Event(CLOSE_RAIL));
}
export const CLOSE_RAIL = 'opsis:close-rail';

function NavLink({
  to,
  current,
  disabled,
  children,
  label,
}: {
  to: string;
  current?: boolean;
  disabled?: boolean;
  children: ReactNode;
  label?: string;
}) {
  return (
    <a
      href={to}
      className="rail-link"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        event.preventDefault();
        if (!disabled) go(to);
      }}
    >
      {children}
    </a>
  );
}

export function AppSidebar({
  mode,
  board,
  busy,
  readOnly = false,
  user,
  onSignOut,
  library,
  onNew,
  commit,
  selected,
  selectNode,
}: {
  mode: SidebarMode;
  board: BoardDocument | null;
  busy: boolean;
  readOnly?: boolean;
  user?: User | undefined;
  onSignOut?: (() => void) | undefined;
  library: ReturnType<typeof useBoardLibrary>;
  onNew: () => void;
  commit: (board: BoardDocument) => void;
  selected: string | null;
  selectNode: (id: string) => void;
}) {
  const inCanvas = mode === 'canvas' || mode === 'settings';
  return (
    <aside className={`workspace-rail is-${mode}`} aria-label="Workspace">
      <div className="rail-head">
        <a
          href="/"
          className="brand"
          aria-label="Opsis home"
          onClick={(event) => {
            event.preventDefault();
            go('/');
          }}
        >
          <span className="brand-symbol">
            <BrandMark />
          </span>
          <span>
            opsis<span className="brand-dot">.</span>
          </span>
        </a>
      </div>
      <div className="rail-board-actions">
        <button className="new-board" disabled={busy || (inCanvas && !board)} onClick={onNew}>
          <Plus size={16} /> New canvas
        </button>
      </div>
      {inCanvas ? (
        <CanvasRail
          mode={mode}
          board={board}
          busy={busy}
          readOnly={readOnly}
          library={library}
          commit={commit}
          selected={selected}
          selectNode={selectNode}
        />
      ) : (
        <>
          <div className="rail-scroll">
            <nav className="rail-nav" aria-label="Pages">
              <NavLink to="/" current={mode === 'home'}>
                <House size={16} /> Home
              </NavLink>
              <NavLink to="/boards" current={mode === 'boards'} disabled={busy}>
                <FolderOpen size={16} /> Manage boards
                <span className="rail-count">{library.entries.length}</span>
              </NavLink>
              {board && (
                <NavLink to="/canvas" label={`Open canvas: ${board.title}`}>
                  <SquareDashedMousePointer size={16} />
                  <span className="rail-link-text">
                    <small>Open canvas</small>
                    {board.title}
                  </span>
                </NavLink>
              )}
            </nav>
          </div>
        </>
      )}
      <div className="rail-bottom">
        {user ? (
          <div className="rail-account">
            <NavLink to="/account" current={mode === 'account'} label={`Account: ${user.name}`}>
              <span className="avatar" aria-hidden>
                {initials(user.name)}
              </span>
              <span className="rail-link-text">
                {user.name}
                <small>{user.email}</small>
              </span>
            </NavLink>
            <button
              className="rail-signout"
              aria-label="Log out"
              title="Log out"
              onClick={onSignOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <p className="rail-footnote">
            <span className="active-dot" /> Private workspace · saved locally
          </p>
        )}
      </div>
    </aside>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/u);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** Inside a canvas the sidebar is about that canvas only: its name, views and concepts. */
function CanvasRail({
  mode,
  board,
  busy,
  readOnly,
  library,
  commit,
  selected,
  selectNode,
}: {
  mode: 'canvas' | 'settings';
  board: BoardDocument | null;
  busy: boolean;
  readOnly: boolean;
  library: ReturnType<typeof useBoardLibrary>;
  commit: (board: BoardDocument) => void;
  selected: string | null;
  selectNode: (id: string) => void;
}) {
  const [search, setSearch] = useState({ boardId: library.activeId, query: '' });
  const nodeSearch =
    search.boardId === library.activeId && (board?.nodes.length ?? 0) > 5 ? search.query : '';
  const visibleNodes =
    board?.nodes.filter((node) => node.label.toLowerCase().includes(nodeSearch.toLowerCase())) ??
    [];
  return (
    <div className="rail-scroll">
      <NavLink to="/boards" disabled={busy}>
        <ArrowLeft size={16} /> Manage boards
      </NavLink>
      <section className="rail-section rail-canvas">
        <h2 className="rail-section-title">This canvas</h2>
        {board && readOnly ? (
          <p className="rail-viewing">
            <Eye size={14} />
            <span>
              <strong>{board.title}</strong>
              <small>Shared by {library.owner || 'someone'} · read-only</small>
            </span>
          </p>
        ) : board ? (
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
        ) : (
          <p className="rail-empty">Untitled · ask a question to begin.</p>
        )}
        <nav className="rail-tabs" aria-label="Canvas views">
          <NavLink to="/canvas" current={mode === 'canvas'}>
            <SquareDashedMousePointer size={15} /> Canvas
          </NavLink>
          {!readOnly && (
            <NavLink to="/canvas/settings" current={mode === 'settings'} disabled={!board}>
              <Palette size={15} /> Look &amp; details
            </NavLink>
          )}
        </nav>
      </section>
      {board && mode === 'canvas' && (
        <details open className="rail-section rail-concepts">
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
            {visibleNodes.map((node) => (
              <button
                key={node.id}
                className={selected === node.id ? 'active' : ''}
                aria-current={selected === node.id ? 'true' : undefined}
                onClick={() => selectNode(node.id)}
              >
                <NodeIcon node={node} size={15} />
                <span className="list-label">{node.label}</span>
              </button>
            ))}
          </nav>
          {!visibleNodes.length && (
            <p className="rail-empty">
              {board.nodes.length
                ? 'No matching concepts.'
                : 'Add a concept or ask your agent to draw.'}
            </p>
          )}
        </details>
      )}
    </div>
  );
}

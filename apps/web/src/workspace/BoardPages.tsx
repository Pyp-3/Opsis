import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  addBoardPage,
  boardPages,
  MAX_BOARD_PAGES,
  moveBoardPage,
  removeBoardPage,
  updateBoardPage,
  type BoardDocument,
} from '@opsis/schema';
import { appUrl } from '../app-url';

/** Page IDs are links to hidden pages, so they are random and unguessable. */
export const newPageId = () => crypto.randomUUID().replaceAll('-', '');

/** The address that opens this board at one page; for a hidden page, it is how viewers see it. */
export function pageLink(boardId: string, pageId: string) {
  return `${location.origin}${appUrl('/canvas')}?board=${boardId}&page=${pageId}`;
}

/**
 * The canvas's page bar: turn pages like a book (also PageUp/PageDown), or open the list to go
 * to any page. Owners and editors also add, name, order and remove pages, and hide pages from
 * people who only view the board; a hidden page opens for a viewer only through its own link.
 */
export function BoardPages({
  document: board,
  pageId,
  boardId,
  editable,
  onOpen,
  onChange,
}: {
  document: BoardDocument;
  pageId: string | null;
  boardId: string;
  /** Whether this reader may change pages (owner or editor, and not busy). */
  editable: boolean;
  onOpen: (pageId: string, direction?: 'next' | 'previous') => void;
  /** Commits a page change to the whole board as one undoable edit. */
  onChange: (board: BoardDocument) => void;
}) {
  const pages = boardPages(board);
  const index = Math.max(
    0,
    pages.findIndex((page) => page.id === pageId),
  );
  const current = pages[index];
  const menu = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const turn = (step: 1 | -1) => {
    const next = pages[index + step];
    if (next) onOpen(next.id, step === 1 ? 'next' : 'previous');
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!pages[index + (event.key === 'PageDown' ? 1 : -1)]) return;
      event.preventDefault();
      turn(event.key === 'PageDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const change = (update: () => BoardDocument) => {
    try {
      onChange(update());
      setError('');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not change the pages.');
      return false;
    }
  };
  const add = () => {
    const id = newPageId();
    const added = change(() =>
      addBoardPage(
        board,
        { id, title: `Page ${Math.max(pages.length, 1) + 1}` },
        { after: current?.id ?? null, firstPage: { id: newPageId(), title: 'Page 1' } },
      ),
    );
    if (added) onOpen(id, 'next');
  };
  const copy = (id: string) =>
    void navigator.clipboard?.writeText(pageLink(boardId, id)).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((value) => (value === id ? null : value)), 1600);
    });

  if (!current)
    return editable ? (
      <div className="board-pages is-single">
        <button type="button" onClick={add} title="Add a page to this board">
          <Plus size={14} aria-hidden /> <span className="button-label">Add page</span>
        </button>
      </div>
    ) : null;

  return (
    <nav className="board-pages" aria-label="Pages">
      <button
        type="button"
        aria-label="Previous page"
        title="Previous page (Page Up)"
        disabled={index === 0}
        onClick={() => turn(-1)}
      >
        <ChevronLeft size={16} />
      </button>
      <details
        className="board-pages-menu"
        ref={menu}
        onToggle={() => {
          setDeleting(null);
          setError('');
        }}
      >
        <summary aria-label={`Page ${index + 1} of ${pages.length}: ${current.title}. Show pages`}>
          <BookOpen size={14} aria-hidden />
          <span className="board-pages-count">
            {index + 1} / {pages.length}
          </span>
          <span className="board-pages-title">{current.title}</span>
          {current.hidden && <EyeOff size={13} aria-label="Hidden from viewers" />}
        </summary>
        <div className="board-pages-panel">
          <p className="header-menu-title">Pages</p>
          {editable && (
            <p className="board-pages-help">
              Hidden pages are left out for people who only view this board. To show one to someone,
              send them that page’s link.
            </p>
          )}
          <ol>
            {pages.map((page, at) => (
              <li key={page.id} className={page.id === current.id ? 'is-current' : ''}>
                {editable ? (
                  <input
                    aria-label={`Name of page ${at + 1}`}
                    key={`${page.id}-${page.title}`}
                    defaultValue={page.title}
                    maxLength={60}
                    onBlur={(event) => {
                      const title = event.target.value.trim();
                      if (title && title !== page.title)
                        change(() => updateBoardPage(board, page.id, { title }));
                      else event.target.value = page.title;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  className="board-pages-go"
                  aria-current={page.id === current.id ? 'page' : undefined}
                  aria-label={`Go to page ${at + 1}: ${page.title}`}
                  onClick={() => {
                    onOpen(page.id, at > index ? 'next' : 'previous');
                    if (menu.current) menu.current.open = false;
                  }}
                >
                  <span className="board-pages-number">{at + 1}</span>
                  {!editable && <span>{page.title}</span>}
                  {page.hidden && <EyeOff size={13} aria-hidden />}
                </button>
                {editable && (
                  <span className="board-pages-actions">
                    <button
                      type="button"
                      aria-pressed={page.hidden}
                      aria-label={`Hide page ${at + 1} from viewers`}
                      title={page.hidden ? 'Hidden from viewers · show it' : 'Hide from viewers'}
                      onClick={() =>
                        change(() => updateBoardPage(board, page.id, { hidden: !page.hidden }))
                      }
                    >
                      <EyeOff size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Copy link to page ${at + 1}`}
                      title={page.hidden ? 'Copy this hidden page’s link' : 'Copy page link'}
                      onClick={() => copy(page.id)}
                    >
                      {copied === page.id ? <Check size={14} /> : <Link2 size={14} />}
                    </button>
                    <button
                      type="button"
                      aria-label={`New link for page ${at + 1}`}
                      title="New link · the old link stops working"
                      onClick={() => {
                        const id = newPageId();
                        if (
                          change(() => updateBoardPage(board, page.id, { id })) &&
                          page.id === current.id
                        )
                          onOpen(id);
                      }}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move page ${at + 1} up`}
                      disabled={at === 0}
                      onClick={() => change(() => moveBoardPage(board, page.id, at - 1))}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move page ${at + 1} down`}
                      disabled={at === pages.length - 1}
                      onClick={() => change(() => moveBoardPage(board, page.id, at + 1))}
                    >
                      <ArrowDown size={14} />
                    </button>
                    {deleting === page.id ? (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => {
                          setDeleting(null);
                          change(() => removeBoardPage(board, page.id));
                        }}
                      >
                        Delete page {at + 1}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete page ${at + 1}`}
                        disabled={pages.length === 1}
                        onClick={() => setDeleting(page.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {editable && (
            <button
              type="button"
              className="secondary-button"
              disabled={pages.length >= MAX_BOARD_PAGES}
              onClick={add}
            >
              <Plus size={14} aria-hidden /> Add page
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </details>
      <button
        type="button"
        aria-label="Next page"
        title="Next page (Page Down)"
        disabled={index === pages.length - 1}
        onClick={() => turn(1)}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Expand, LogIn, ZoomIn, ZoomOut } from 'lucide-react';
import { boardPage, resolvePageId } from '@opsis/schema';
import { BoardEntrySchema } from './board-library-api';
import { BoardPages } from './BoardPages';
import { BrandMark } from './BrandMark';
import { boardSvg } from './export';
import { navigate } from '../router';
import { apiFetch as fetch, appPath, appUrl } from '../app-url';
import './styles/canvas.css';
import './styles/shared-board.css';

type Entry = ReturnType<typeof BoardEntrySchema.parse>;
type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entry: Entry };

const ZOOMS = [0.5, 0.75, 1, 1.5, 2];

/**
 * A shared board for someone who is not signed in: the owner chose "Anyone with the link" (or
 * Public). It is read-only: the picture of each page, its concepts, and the pages to turn.
 * Hidden pages never arrive, except the one whose own link was opened.
 */
export function GuestBoard({
  boardId,
  pageId,
  onUnavailable,
}: {
  boardId: string;
  pageId: string | null;
  /** The board is not shared by link: it may still be the reader's own, after signing in. */
  onUnavailable: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [requested, setRequested] = useState(pageId);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/v1/guest/boards/${encodeURIComponent(boardId)}${pageId ? `?page=${encodeURIComponent(pageId)}` : ''}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (response.status === 404 || response.status === 400)
          return { status: 'missing' } as const;
        if (!response.ok) throw new Error('Opsis could not open this board. Try again soon.');
        return { status: 'ready', entry: BoardEntrySchema.parse(await response.json()) } as const;
      })
      .then((next) => {
        if (controller.signal.aborted) return;
        setState(next);
        if (next.status === 'missing') onUnavailable();
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: reason.message });
      });
    return () => controller.abort();
  }, [boardId, pageId, onUnavailable]);

  const board = state.status === 'ready' ? state.entry.snapshot.board : null;
  const currentPage = resolvePageId(board, requested);
  const view = board ? boardPage(board, currentPage) : null;
  const svg = useMemo(() => (view ? boardSvg(view) : ''), [view]);
  const size = useMemo(() => {
    const match = /width="([\d.]+)" height="([\d.]+)"/u.exec(svg);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  }, [svg]);
  useEffect(() => {
    document.title = view ? `${view.title} · Opsis` : 'Opsis';
    return () => {
      document.title = 'Opsis';
    };
  }, [view]);

  const signIn = () => navigate(`/login?next=${encodeURIComponent(appPath() + location.search)}`);
  const header = (
    <header className="shared-header">
      <a
        href={appUrl('/login')}
        className="shared-brand"
        aria-label="Opsis"
        onClick={(event) => {
          event.preventDefault();
          signIn();
        }}
      >
        <BrandMark size={26} />
      </a>
      <div className="shared-title">
        <h1>{view?.title ?? 'Shared board'}</h1>
        {state.status === 'ready' && (
          <small>Shared by {state.entry.owner?.name ?? 'someone'} · view only</small>
        )}
      </div>
      <button type="button" className="secondary-button" onClick={signIn}>
        <LogIn size={15} aria-hidden /> Sign in
      </button>
    </header>
  );

  if (state.status !== 'ready' || !board || !view)
    return (
      <div className="shared-page">
        {header}
        <main className="shared-message">
          {state.status === 'loading' ? (
            <p role="status">Opening the shared board…</p>
          ) : state.status === 'missing' ? (
            <>
              <h2>This board isn’t shared by link</h2>
              <p>
                Its owner may have made it private. If it was shared with your account, sign in to
                open it.
              </p>
              <button type="button" onClick={signIn}>
                <LogIn size={15} aria-hidden /> Sign in
              </button>
            </>
          ) : state.status === 'error' ? (
            <p role="alert">{state.message}</p>
          ) : (
            <p>This board is empty.</p>
          )}
        </main>
      </div>
    );

  const scaled = zoom && size ? { width: size.width * zoom, height: size.height * zoom } : null;
  return (
    <div className="shared-page">
      {header}
      <main className="shared-main">
        <section className="shared-canvas" aria-label="Board picture">
          <div className="shared-canvas-tools" role="toolbar" aria-label="Zoom">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom === ZOOMS[0]}
              onClick={() =>
                setZoom(
                  (value) => [...ZOOMS].reverse().find((step) => step < (value ?? 1)) ?? ZOOMS[0]!,
                )
              }
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom === ZOOMS.at(-1)}
              onClick={() =>
                setZoom((value) => ZOOMS.find((step) => step > (value ?? 0.75)) ?? ZOOMS.at(-1)!)
              }
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              aria-label="Fit to screen"
              aria-pressed={zoom === null}
              onClick={() => setZoom(null)}
            >
              <Expand size={16} />
            </button>
          </div>
          <div
            className={`shared-picture ${scaled ? 'is-zoomed' : ''}`}
            // Zoomed in, the picture scrolls; the keyboard can scroll it too.
            tabIndex={0}
            role="group"
            aria-label="Diagram, scrollable when zoomed in"
          >
            <img
              alt={`Diagram: ${view.title}`}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              {...(scaled ? { width: scaled.width, height: scaled.height } : {})}
            />
          </div>
          <BoardPages
            document={board}
            pageId={currentPage}
            boardId={boardId}
            editable={false}
            onOpen={(id) => setRequested(id)}
            onChange={() => undefined}
          />
        </section>
        <section className="shared-concepts" aria-label="Concepts">
          {view.description && <p className="shared-description">{view.description}</p>}
          {view.nodes.length ? (
            <ol>
              {view.nodes.map((node) => (
                <li key={node.id}>
                  <details>
                    <summary>
                      <strong>{node.label}</strong>
                      <span>{node.summary}</span>
                    </summary>
                    <p>{node.explanation}</p>
                    {node.notes && (
                      <p>
                        <strong>Notes:</strong> {node.notes}
                      </p>
                    )}
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="shared-description">No concepts on this page.</p>
          )}
        </section>
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { boardPage, resolvePageId } from '@opsis/schema';
import { BoardEntrySchema } from './board-library-api';
import { ReadOnlyBoard } from './ReadOnlyBoard';
import { BrandMark } from './BrandMark';
import { navigate } from '../router';
import { apiFetch as fetch, appPath, appUrl } from '../app-url';
import './styles/shared-board.css';

type Entry = ReturnType<typeof BoardEntrySchema.parse>;
type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entry: Entry };

/**
 * A shared board for someone who is not signed in: the owner chose "Anyone with the link" (or
 * Public). It is read-only: the canvas of each page to explore and play, its concepts, and the
 * pages to turn.
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

  return (
    <div className="shared-page">
      {header}
      <main className="shared-main">
        <ReadOnlyBoard
          board={board}
          boardId={boardId}
          pageId={currentPage}
          onPage={setRequested}
          label="Shared diagram"
          className="shared-canvas"
        />
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
